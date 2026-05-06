export type WeatherSnapshot = {
  weatherCode: number;
  temperatureC: number;
  description: string;
  fishingRating: number;
  windKmh: number;
  windDirection: number;
  pressureHpa: number;
  humidity: number;
};

function wmoLabel(code: number): string {
  if (code === 0) return 'Ясно';
  if (code <= 3) return 'Облачно';
  if (code <= 48) return 'Мъгла';
  if (code <= 67) return 'Дъжд';
  if (code <= 77) return 'Сняг';
  if (code <= 82) return 'Превалявания';
  return 'Гръмотевични';
}

/** Проста оценка за риболов 1–5 по код и вятър */
function fishRating(code: number, windKmh: number): number {
  let base = 3;
  if (code >= 51 && code <= 67) base += 1;
  if (code >= 95) base -= 1;
  if (windKmh > 40) base -= 1;
  if (windKmh < 8) base -= 0.5;
  return Math.max(1, Math.min(5, Math.round(base)));
}

export async function fetchWeather(latitude: number, longitude: number): Promise<WeatherSnapshot> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Времето: HTTP ${res.status}`);
  const json = (await res.json()) as {
    current: {
      temperature_2m: number;
      relative_humidity_2m: number;
      weather_code: number;
      surface_pressure: number;
      wind_speed_10m: number;
      wind_direction_10m: number;
    };
  };
  const c = json.current;
  const windKmh = c.wind_speed_10m;
  const code = c.weather_code;
  return {
    weatherCode: code,
    temperatureC: Math.round(c.temperature_2m * 10) / 10,
    description: wmoLabel(code),
    fishingRating: fishRating(code, windKmh),
    windKmh: Math.round(windKmh * 10) / 10,
    windDirection: Math.round(c.wind_direction_10m),
    pressureHpa: Math.round(c.surface_pressure * 10) / 10,
    humidity: Math.round(c.relative_humidity_2m),
  };
}

const WIND_LABELS = ['С', 'СИ', 'И', 'ЮИ', 'Ю', 'ЮЗ', 'З', 'СЗ'];

export function windDirectionLabel(deg: number): string {
  const i = Math.round(deg / 45) % 8;
  return WIND_LABELS[i] ?? '';
}
