export type WeatherSnapshot = {
  weatherCode: number;
  temperatureC: number;
  feelsLikeC: number;
  description: string;
  fishingRating: number;
  windKmh: number;
  windGustKmh: number;
  windDirection: number;
  pressureHpa: number;
  humidity: number;
  cloudCover: number;
  uvIndex: number;
  precipitationProbability: number;
  moonPhase: number;      // 0–1 (0 = new, 0.5 = full)
  moonPhaseName: string;
};

function wmoLabel(code: number): string {
  if (code === 0) return 'Ясно';
  if (code <= 2) return 'Частично облачно';
  if (code <= 3) return 'Облачно';
  if (code <= 48) return 'Мъгла';
  if (code <= 55) return 'Ситен дъжд';
  if (code <= 67) return 'Дъжд';
  if (code <= 77) return 'Сняг';
  if (code <= 82) return 'Превалявания';
  return 'Гръмотевични';
}

/** Фаза на луната по дата — чиста математика, без API */
function calcMoonPhase(date: Date): { phase: number; name: string } {
  const knownNewMoon = new Date('2000-01-06T18:14:00Z');
  const lunarCycle = 29.530588853;
  const elapsed = (date.getTime() - knownNewMoon.getTime()) / 86_400_000;
  const phase = ((elapsed % lunarCycle) + lunarCycle) % lunarCycle;
  const n = phase / lunarCycle; // 0–1

  let name: string;
  if (n < 0.033 || n >= 0.967) name = 'Нова луна 🌑';
  else if (n < 0.25) name = 'Нарастваща 🌒';
  else if (n < 0.283) name = 'Първа четвъртина 🌓';
  else if (n < 0.5) name = 'Пълнееща 🌔';
  else if (n < 0.533) name = 'Пълна луна 🌕';
  else if (n < 0.75) name = 'Намаляваща 🌖';
  else if (n < 0.783) name = 'Последна четвъртина 🌗';
  else name = 'Намаляваща 🌘';

  return { phase: n, name };
}

/** Риболовна оценка 1–5, базирана на всички налични параметри */
function fishRating(p: {
  code: number;
  windKmh: number;
  windGustKmh: number;
  pressureHpa: number;
  cloudCover: number;
  uvIndex: number;
  moonPhase: number;
  precipProbability: number;
}): number {
  let s = 3.0;

  // Код на времето
  if (p.code === 0) s += 0.2;                        // Ясно
  else if (p.code <= 3) s += 0.4;                    // Частично/Облачно — отлично
  else if (p.code <= 48) s -= 0.3;                   // Мъгла
  else if (p.code >= 51 && p.code <= 67) s -= 0.2;   // Дъжд — умерено влияние
  else if (p.code >= 95) s -= 1.5;                   // Гръмотевична буря

  // Вятър — умерен е идеален
  if (p.windKmh >= 5 && p.windKmh <= 15) s += 0.3;
  else if (p.windKmh < 3) s -= 0.3;                  // Пълно безветрие — по-труден риболов
  else if (p.windKmh > 35) s -= 0.6;
  else if (p.windKmh > 50) s -= 1.2;
  if (p.windGustKmh > 55) s -= 0.4;

  // Атмосферно налягане — 1013–1022 hPa е оптимално
  if (p.pressureHpa >= 1013 && p.pressureHpa <= 1022) s += 0.3;
  else if (p.pressureHpa < 1000) s -= 0.6;           // Ниско — буря идва
  else if (p.pressureHpa > 1030) s -= 0.2;           // Много високо — риба неактивна

  // Облачност — 30–70% е добро за риболов
  if (p.cloudCover >= 30 && p.cloudCover <= 70) s += 0.2;
  else if (p.cloudCover > 90) s -= 0.1;

  // UV индекс — висок → риба отива на дълбочина
  if (p.uvIndex > 8) s -= 0.4;
  else if (p.uvIndex > 6) s -= 0.2;

  // Фаза на луната — нова и пълна → пик на хранене
  const fromFull = Math.abs(p.moonPhase - 0.5);
  const fromNew = Math.min(p.moonPhase, 1 - p.moonPhase);
  if (fromFull < 0.05 || fromNew < 0.05) s += 0.5;
  else if (fromFull < 0.12 || fromNew < 0.12) s += 0.2;

  // Вероятност за валежи
  if (p.precipProbability > 75) s -= 0.3;
  else if (p.precipProbability >= 20 && p.precipProbability <= 50) s += 0.1;

  return Math.max(1, Math.min(5, Math.round(s)));
}

export async function fetchWeather(latitude: number, longitude: number): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code` +
    `,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover` +
    `&hourly=uv_index,precipitation_probability` +
    `&forecast_days=1&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Времето: HTTP ${res.status}`);
  const json = await res.json();
  if (!json?.current) throw new Error('Времето: неочакван формат на отговора');

  const c = json.current as {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    surface_pressure: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
    cloud_cover: number;
  };

  // Намираме текущия час в hourly масива
  const hourlyTimes: string[] = json.hourly?.time ?? [];
  const hourlyIdx = hourlyTimes.findIndex((t: string) => t === c.time);
  const uvIndex: number = hourlyIdx >= 0 ? (json.hourly.uv_index[hourlyIdx] ?? 0) : 0;
  const precipProb: number = hourlyIdx >= 0 ? (json.hourly.precipitation_probability[hourlyIdx] ?? 0) : 0;

  const moon = calcMoonPhase(new Date());
  const code = c.weather_code;
  const windKmh = Math.round(c.wind_speed_10m * 10) / 10;
  const windGustKmh = Math.round(c.wind_gusts_10m * 10) / 10;

  return {
    weatherCode: code,
    temperatureC: Math.round(c.temperature_2m * 10) / 10,
    feelsLikeC: Math.round(c.apparent_temperature * 10) / 10,
    description: wmoLabel(code),
    fishingRating: fishRating({
      code,
      windKmh,
      windGustKmh,
      pressureHpa: c.surface_pressure,
      cloudCover: c.cloud_cover,
      uvIndex,
      moonPhase: moon.phase,
      precipProbability: precipProb,
    }),
    windKmh,
    windGustKmh,
    windDirection: Math.round(c.wind_direction_10m),
    pressureHpa: Math.round(c.surface_pressure * 10) / 10,
    humidity: Math.round(c.relative_humidity_2m),
    cloudCover: Math.round(c.cloud_cover),
    uvIndex: Math.round(uvIndex * 10) / 10,
    precipitationProbability: Math.round(precipProb),
    moonPhase: moon.phase,
    moonPhaseName: moon.name,
  };
}

const WIND_LABELS = ['С', 'СИ', 'И', 'ЮИ', 'Ю', 'ЮЗ', 'З', 'СЗ'];

export function windDirectionLabel(deg: number): string {
  const i = Math.round(deg / 45) % 8;
  return WIND_LABELS[i] ?? '';
}

export type ForecastDay = {
  dateIso: string;
  dayLabel: string;
  fishingRating: number;
  maxTempC: number;
  precipProbability: number;
  weatherCode: number;
  moonPhaseName: string;
};

const DAY_NAMES_BG = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export async function fetchForecast(latitude: number, longitude: number): Promise<ForecastDay[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&daily=weather_code,temperature_2m_max,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,cloud_cover_mean` +
    `&forecast_days=7&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Прогноза: HTTP ${res.status}`);
  const json = await res.json();

  const dates: string[] = json.daily?.time ?? [];
  return dates.map((dateStr, i) => {
    const date = new Date(dateStr);
    const moon = calcMoonPhase(date);
    const code: number = json.daily.weather_code[i] ?? 0;
    const windKmh: number = Math.round((json.daily.wind_speed_10m_max[i] ?? 0) * 10) / 10;
    const precipProb: number = json.daily.precipitation_probability_max[i] ?? 0;
    const cloudCover: number = json.daily.cloud_cover_mean[i] ?? 50;

    const rating = fishRating({
      code,
      windKmh,
      windGustKmh: json.daily.wind_gusts_10m_max[i] ?? windKmh,
      pressureHpa: 1013,
      cloudCover,
      uvIndex: 0,
      moonPhase: moon.phase,
      precipProbability: precipProb,
    });

    return {
      dateIso: dateStr,
      dayLabel: i === 0 ? 'Днес' : i === 1 ? 'Утре' : DAY_NAMES_BG[date.getDay()] ?? '',
      fishingRating: rating,
      maxTempC: Math.round(json.daily.temperature_2m_max[i] ?? 0),
      precipProbability: Math.round(precipProb),
      weatherCode: code,
      moonPhaseName: moon.name,
    };
  });
}
