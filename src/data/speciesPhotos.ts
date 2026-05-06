/**
 * Снимки по вид — Wikimedia Commons и GBIF (Naturalis и др.), предимно CC BY / обществен достъп.
 * За upload.wikimedia.org подайте headers от commonsImageHeaders().
 */
export type SpeciesPhotoMeta = {
  url: string;
  /** Кратко авторство за показване под снимката */
  credit: string;
};

/** Речен костур */
const kosturPhoto: SpeciesPhotoMeta = {
  url: 'https://images.naturalis.nl/original/125157_baarsje_gevangen_met_made_4.jpg',
  credit: 'Peter van der Sluijs · CC BY · Nederlands Soortenregister (чрез GBIF)',
};

/** Мряна — обобщена „барбел“ снимка (род Barbus) */
const mryanaPhoto: SpeciesPhotoMeta = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/8/81/Barbel.jpg',
  credit: 'Wikimedia Commons · виж страницата на файла за автор и лиценз',
};

/** Цаца — допускаме CC BY-NC за по-близък реален кадър (Naturalis) */
const tsatsaPhoto: SpeciesPhotoMeta = {
  url: 'https://images.naturalis.nl/original/112577_126425-sprattus_sprattus-sprot-sprat-ibts2002-101-0179_img-henk_heessen.jpg',
  credit: 'Henk Heessen (Wageningen Marine Research) · CC BY-NC · Nederlands Soortenregister',
};

/** Чернокоп */
const chernokopPhoto: SpeciesPhotoMeta = {
  url: 'https://images.naturalis.nl/original/148229_gewone_zeebarbeel_mullus_barbatus_madeira136813.jpg',
  credit: 'Marion Haarsma · CC BY-NC-ND · Nederlands Soortenregister',
};

/** Скумрия */
const skumbriyaPhoto: SpeciesPhotoMeta = {
  url: 'https://images.naturalis.nl/original/112617_127023-scomber_scombrus-makreel-mackerel-ibts2011-img_4098-henk_heessen.jpg',
  credit: 'Henk Heessen · CC BY-NC · Nederlands Soortenregister',
};

export const speciesPhotos: Record<string, SpeciesPhotoMeta> = {
  sharan: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Cyprinus_carpio_%28Carpe_commune%29_-_426.jpg',
    credit: 'Donald Hobern · CC BY · Wikimedia Commons',
  },
  som: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Silurus_glanis_02.jpg',
    credit: 'Ники Иванов · CC BY-SA · Wikimedia Commons',
  },
  shtuka: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/0/05/Esox_lucius_2021_G1.jpg',
    credit: 'George Chernilevsky · Public domain · Wikimedia Commons',
  },
  kostur: kosturPhoto,
  beleza: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/63/Sander_lucioperca_1.jpg',
    credit: 'T. Mills · CC BY-SA · Wikimedia Commons',
  },
  karaknuda: {
    url: 'https://images.naturalis.nl/original/124514_kroeskarper_gevangen_in_nederland_aan_hengel.jpg',
    credit: 'Peter van der Sluijs · CC BY · Nederlands Soortenregister (чрез GBIF)',
  },
  platika: {
    url: 'https://images.naturalis.nl/original/124965_brasem_in_het_gras.jpg',
    credit: 'Peter van der Sluijs · CC BY · Nederlands Soortenregister (чрез GBIF)',
  },
  mryana: mryanaPhoto,
  pastarva: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/6d/Brown_trout_%28Salmo_trutta%29_%2814398386287%29.jpg',
    credit: 'Andrew Shiva · CC BY-SA · Wikimedia Commons',
  },
  amur: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/f/f6/Ctenopharyngodon_idella_01.jpg',
    credit: 'Przemek Sobiecki · CC BY-SA · Wikimedia Commons',
  },
  tolstolob: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/e4/Hypophthalmichthys_molitrix_%2838-%2058cm%29.jpg',
    credit: 'Ellen van Dam · CC BY-SA · Wikimedia Commons',
  },
  klen: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/63/Chub_Squalius_cephalus_%2849580878736%29.jpg',
    credit: 'Francesco Veronesi · CC BY-SA · Wikimedia Commons',
  },
  uklei: {
    url: 'https://images.naturalis.nl/original/124528_alver_op_een_witte_achtergrond_.jpg',
    credit: 'Peter van der Sluijs · CC BY · Nederlands Soortenregister',
  },
  chervenoperka: {
    url: 'https://images.naturalis.nl/original/124504_ruisvoorns_zijn_ook_jagers.jpg',
    credit: 'Peter van der Sluijs · CC BY · Nederlands Soortenregister',
  },
  lin: {
    url: 'https://images.naturalis.nl/original/124536_grote_zeelt_gevangen_aan_een_hengel_in_een_sloot.jpg',
    credit: 'Peter van der Sluijs · CC BY · Nederlands Soortenregister',
  },
  vimba: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/4/40/Vimba_vimba.jpg',
    credit: 'Virkok · CC BY-SA · Wikimedia Commons',
  },
  asp: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/e5/Aspius_aspius_Ohrid.jpg',
    credit: 'Ljupco Ilkoski · CC BY-SA · Wikimedia Commons',
  },
  'rechna-kosturka': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/f/fe/Gymnocephalus_cernua_2009_G2.jpg',
    credit: 'Georg Hötsch · CC BY-SA · Wikimedia Commons',
  },
  peska: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/f/f6/Gobio_gobio_2009_G4.jpg',
    credit: 'Georg Hötsch · CC BY-SA · Wikimedia Commons',
  },
  cheshminka: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/9/92/Oncorhynchus_mykiss_%281%29.jpg',
    credit: 'Tarquin · CC BY-SA · Wikimedia Commons',
  },
  kefal: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/d/d6/Mugil_cephalus.jpg',
    credit: 'Robert Patzner · CC BY-SA · Wikimedia Commons',
  },
  tsatsa: tsatsaPhoto,
  chernokop: chernokopPhoto,
  kalkan: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/9/95/Psetta_maxima_landa.jpg',
    credit: 'Luca Lorenzi · CC BY-SA · Wikimedia Commons (плоска риба от рода Scophthalmus / калканоподобни)',
  },
  lavrak: {
    url: 'https://images.naturalis.nl/original/123279_zeebaars.jpg',
    credit: 'Peter van der Sluijs · CC BY · Nederlands Soortenregister',
  },
  palamud: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/e5/Bonito_portugal.jpg',
    credit: 'Feliciano Guimarães · CC BY · Wikimedia Commons',
  },
  safrid: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/88/Trachurus_trachurus_%281%29.jpg',
    credit: 'Hans Hillewaert · CC BY-SA · Wikimedia Commons (Trachurus trachurus — близък вид)',
  },
  skumbriya: skumbriyaPhoto,
  zmiyorka: {
    url: 'https://images.naturalis.nl/original/124505_een_paling.jpg',
    credit: 'Peter van der Sluijs · CC BY · Nederlands Soortenregister',
  },
  karagyoz: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/9/99/Diplodus_annularis_01.jpg',
    credit: 'Roberto Pillon · CC BY · Wikimedia Commons',
  },
};

export function commonsImageHeaders(): Record<string, string> {
  return {
    Referer: 'https://commons.wikimedia.org/',
    'User-Agent': 'RibolovApp/1.0 (species photos; +https://commons.wikimedia.org/)',
  };
}

export function imageHeadersForUrl(url: string): Record<string, string> | undefined {
  if (url.includes('upload.wikimedia.org')) return commonsImageHeaders();
  return undefined;
}
