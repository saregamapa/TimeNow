#!/usr/bin/env node
/**
 * Dataset generation pipeline: build data/cities.json (5000+) and data/countries.json
 * from GeoNames cities5000 + countryInfo. No manual city entry.
 *
 * Usage: node scripts/generateCities.js
 * Env:   MIN_POPULATION=100000 (default), GEONAMES_CITIES_URL, GEONAMES_COUNTRIES_URL
 *
 * Requires: unzip (macOS/Linux) or 7z on PATH for extracting cities5000.zip
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const TEMP_DIR = path.join(ROOT, '.gen-temp');
const MIN_POPULATION = Math.max(0, parseInt(process.env.MIN_POPULATION, 10) || 100000);

const GEONAMES_CITIES_URL = process.env.GEONAMES_CITIES_URL || 'https://download.geonames.org/export/dump/cities5000.zip';
const GEONAMES_COUNTRIES_URL = process.env.GEONAMES_COUNTRIES_URL || 'https://download.geonames.org/export/dump/countryInfo.txt';

// Continent code -> full name (GeoNames uses 2-letter)
const CONTINENT_NAMES = {
  AF: 'Africa',
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  OC: 'Oceania',
  SA: 'South America',
  AN: 'Antarctica',
};

// Major cities to flag as popular (asciiname|countryCode lowercase, from GeoNames)
const POPULAR_SET = new Set([
  'london|gb', 'paris|fr', 'new york|us', 'tokyo|jp', 'dubai|ae', 'singapore|sg',
  'los angeles|us', 'chicago|us', 'sydney|au', 'hong kong|hk', 'berlin|de',
  'madrid|es', 'rome|it', 'amsterdam|nl', 'moscow|ru', 'barcelona|es',
  'vienna|at', 'prague|cz', 'dublin|ie', 'lisbon|pt', 'athens|gr', 'istanbul|tr',
  'shanghai|cn', 'beijing|cn', 'seoul|kr', 'mumbai|in', 'bangkok|th', 'cairo|eg',
  'mexico city|mx', 'sao paulo|br', 'toronto|ca', 'san francisco|us', 'boston|us',
  'washington|us', 'miami|us', 'seattle|us', 'denver|us', 'vancouver|ca',
  'montreal|ca', 'munich|de', 'warsaw|pl', 'stockholm|se', 'copenhagen|dk',
  'oslo|no', 'helsinki|fi', 'brussels|be', 'zurich|ch', 'delhi|in', 'jakarta|id',
  'manila|ph', 'kuala lumpur|my', 'taipei|tw', 'tel aviv|il', 'riyadh|sa',
  'johannesburg|za', 'cape town|za', 'lagos|ng', 'nairobi|ke', 'melbourne|au',
  'perth|au', 'auckland|nz', 'buenos aires|ar', 'santiago|cl', 'lima|pe',
  'bogota|co', 'rio de janeiro|br', 'baghdad|iq', 'tehran|ir', 'karachi|pk',
  'dhaka|bd', 'ho chi minh city|vn', 'hanoi|vn', 'phnom penh|kh', 'yangon|mm',
]);

function download(url) {
  return new Promise((resolve, reject) => {
    const followRedirect = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, followRedirect).on('error', reject);
        return;
      }
      resolve(res);
    };
    https.get(url, { headers: { 'User-Agent': 'TimeNow-generateCities/1' } }, followRedirect).on('error', reject);
  });
}

function downloadToFile(url, filepath) {
  return download(url).then((res) => {
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(filepath);
      res.pipe(out);
      out.on('finish', () => { out.close(); resolve(); });
      out.on('error', reject);
    });
  });
}

function slugFromName(name) {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureUniqueSlugs(rows) {
  const used = new Map();
  const out = [];
  for (const r of rows) {
    let slug = r.slug;
    if (used.has(slug)) {
      let n = 2;
      while (used.has(slug + '-' + n)) n++;
      slug = slug + '-' + n;
    }
    used.set(slug, true);
    r.slug = slug;
    out.push(r);
  }
  return out;
}

function parseCountryInfo(content) {
  const byCode = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (cols.length < 9) continue;
    const countryCode = (cols[0] || '').trim();
    const country = (cols[4] || '').trim();
    const continentCode = (cols[8] || '').trim();
    if (countryCode && country) {
      byCode[countryCode] = {
        country,
        continent: CONTINENT_NAMES[continentCode] || continentCode || '',
        countryCode,
      };
    }
  }
  return byCode;
}

// geoname table: 0=id, 1=name, 2=asciiname, 3=alt, 4=lat, 5=lng, 6=fclass, 7=fcode, 8=cc, 9=cc2, 10-13=admin, 14=pop, 15=ele, 16=dem, 17=timezone, 18=mod
function parseCitiesTxt(content, countryInfo) {
  const rows = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (cols.length < 18) continue;
    const population = parseInt(cols[14], 10);
    if (population < MIN_POPULATION) continue;
    const timezone = (cols[17] || '').trim();
    if (!timezone) continue;
    const fclass = (cols[6] || '').trim();
    if (fclass !== 'P') continue; // P = populated place
    const name = (cols[1] || cols[2] || '').trim();
    const asciiname = (cols[2] || name).trim();
    const countryCode = (cols[8] || '').trim().toUpperCase();
    const info = countryInfo[countryCode];
    const country = info ? info.country : countryCode;
    const continent = info ? info.continent : '';
    const lat = parseFloat(cols[4]);
    const lng = parseFloat(cols[5]);
    const slugBase = slugFromName(asciiname);
    if (!slugBase) continue;
    const popular = POPULAR_SET.has((asciiname || name).toLowerCase() + '|' + countryCode.toLowerCase());
    rows.push({
      city: name,
      country,
      slug: slugBase,
      timezone,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
      population,
      continent,
      countryCode,
      ...(popular && { popular: true }),
    });
  }
  return ensureUniqueSlugs(rows);
}

function buildCountries(cities) {
  const bySlug = new Map();
  for (const c of cities) {
    const slug = slugFromName(c.country);
    if (!slug) continue;
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { country: c.country, slug, cities: [] });
    }
    bySlug.get(slug).cities.push(c.slug);
  }
  return Array.from(bySlug.values()).sort((a, b) => a.country.localeCompare(b.country));
}

async function main() {
  console.log('TimeNow dataset pipeline — MIN_POPULATION=' + MIN_POPULATION);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const countryInfoPath = path.join(TEMP_DIR, 'countryInfo.txt');
  const zipPath = path.join(TEMP_DIR, 'cities5000.zip');
  const citiesTxtPath = path.join(TEMP_DIR, 'cities5000.txt');

  try {
    console.log('Downloading countryInfo.txt...');
    await downloadToFile(GEONAMES_COUNTRIES_URL, countryInfoPath);
    const countryInfo = parseCountryInfo(fs.readFileSync(countryInfoPath, 'utf8'));
    console.log('Country info entries: ' + Object.keys(countryInfo).length);

    console.log('Downloading cities5000.zip...');
    await downloadToFile(GEONAMES_CITIES_URL, zipPath);

    console.log('Extracting cities5000.txt...');
    try {
      execSync(`unzip -o -j "${zipPath}" -d "${TEMP_DIR}"`, { stdio: 'inherit' });
    } catch (e) {
      try {
        execSync(`7z x -y -o"${TEMP_DIR}" "${zipPath}"`, { stdio: 'inherit' });
      } catch (e2) {
        console.error('Need unzip or 7z on PATH to extract cities5000.zip');
        process.exit(1);
      }
    }

    const extractedName = fs.readdirSync(TEMP_DIR).find((f) => f.toLowerCase() === 'cities5000.txt');
    const txtPath = extractedName ? path.join(TEMP_DIR, extractedName) : citiesTxtPath;
    if (!fs.existsSync(txtPath)) {
      console.error('cities5000.txt not found after extract');
      process.exit(1);
    }

    const citiesContent = fs.readFileSync(txtPath, 'utf8');
    const cities = parseCitiesTxt(citiesContent, countryInfo);
    console.log('Cities (pop >= ' + MIN_POPULATION + '): ' + cities.length);

    const sorted = cities.slice().sort((a, b) => {
      const c = (a.country || '').localeCompare(b.country || '');
      return c !== 0 ? c : (a.city || '').localeCompare(b.city || '');
    });

    const citiesPath = path.join(DATA_DIR, 'cities.json');
    fs.writeFileSync(citiesPath, JSON.stringify(sorted, null, 2), 'utf8');
    console.log('Wrote ' + citiesPath);

    const countries = buildCountries(sorted);
    const countriesPath = path.join(DATA_DIR, 'countries.json');
    fs.writeFileSync(countriesPath, JSON.stringify(countries, null, 2), 'utf8');
    console.log('Wrote ' + countriesPath);
  } finally {
    if (fs.existsSync(TEMP_DIR)) {
      try {
        fs.rmSync(TEMP_DIR, { recursive: true });
      } catch (_) {}
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
