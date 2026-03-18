/**
 * cities.js — Hardcoded city list with IANA zones, slug lookup for SEO city pages
 */

export const CITIES_BY_CONTINENT = {
  Americas: [
    { city: 'New York', zone: 'America/New_York' }, { city: 'Los Angeles', zone: 'America/Los_Angeles' },
    { city: 'Chicago', zone: 'America/Chicago' }, { city: 'Houston', zone: 'America/Chicago' },
    { city: 'Phoenix', zone: 'America/Phoenix' }, { city: 'Philadelphia', zone: 'America/New_York' },
    { city: 'San Antonio', zone: 'America/Chicago' }, { city: 'San Diego', zone: 'America/Los_Angeles' },
    { city: 'Dallas', zone: 'America/Chicago' }, { city: 'San Jose', zone: 'America/Los_Angeles' },
    { city: 'Austin', zone: 'America/Chicago' }, { city: 'Toronto', zone: 'America/Toronto' },
    { city: 'Montreal', zone: 'America/Montreal' }, { city: 'Vancouver', zone: 'America/Vancouver' },
    { city: 'Mexico City', zone: 'America/Mexico_City' }, { city: 'Bogota', zone: 'America/Bogota' },
    { city: 'Lima', zone: 'America/Lima' }, { city: 'Santiago', zone: 'America/Santiago' },
    { city: 'Buenos Aires', zone: 'America/Argentina/Buenos_Aires' }, { city: 'Sao Paulo', zone: 'America/Sao_Paulo' },
    { city: 'Rio de Janeiro', zone: 'America/Sao_Paulo' }, { city: 'Denver', zone: 'America/Denver' },
    { city: 'Boston', zone: 'America/New_York' }, { city: 'Seattle', zone: 'America/Los_Angeles' },
  ],
  Europe: [
    { city: 'London', zone: 'Europe/London' }, { city: 'Paris', zone: 'Europe/Paris' },
    { city: 'Berlin', zone: 'Europe/Berlin' }, { city: 'Madrid', zone: 'Europe/Madrid' },
    { city: 'Rome', zone: 'Europe/Rome' }, { city: 'Amsterdam', zone: 'Europe/Amsterdam' },
    { city: 'Brussels', zone: 'Europe/Brussels' }, { city: 'Vienna', zone: 'Europe/Vienna' },
    { city: 'Prague', zone: 'Europe/Prague' }, { city: 'Warsaw', zone: 'Europe/Warsaw' },
    { city: 'Stockholm', zone: 'Europe/Stockholm' }, { city: 'Oslo', zone: 'Europe/Oslo' },
    { city: 'Copenhagen', zone: 'Europe/Copenhagen' }, { city: 'Helsinki', zone: 'Europe/Helsinki' },
    { city: 'Dublin', zone: 'Europe/Dublin' }, { city: 'Lisbon', zone: 'Europe/Lisbon' },
    { city: 'Athens', zone: 'Europe/Athens' }, { city: 'Istanbul', zone: 'Europe/Istanbul' },
    { city: 'Moscow', zone: 'Europe/Moscow' }, { city: 'Zurich', zone: 'Europe/Zurich' },
    { city: 'Munich', zone: 'Europe/Berlin' }, { city: 'Barcelona', zone: 'Europe/Madrid' },
    { city: 'Milan', zone: 'Europe/Rome' }, { city: 'Budapest', zone: 'Europe/Budapest' },
  ],
  Asia: [
    { city: 'Tokyo', zone: 'Asia/Tokyo' }, { city: 'Shanghai', zone: 'Asia/Shanghai' },
    { city: 'Beijing', zone: 'Asia/Shanghai' }, { city: 'Hong Kong', zone: 'Asia/Hong_Kong' },
    { city: 'Singapore', zone: 'Asia/Singapore' }, { city: 'Seoul', zone: 'Asia/Seoul' },
    { city: 'Mumbai', zone: 'Asia/Kolkata' }, { city: 'Delhi', zone: 'Asia/Kolkata' },
    { city: 'Dubai', zone: 'Asia/Dubai' }, { city: 'Bangkok', zone: 'Asia/Bangkok' },
    { city: 'Jakarta', zone: 'Asia/Jakarta' }, { city: 'Manila', zone: 'Asia/Manila' },
    { city: 'Taipei', zone: 'Asia/Taipei' }, { city: 'Kuala Lumpur', zone: 'Asia/Kuala_Lumpur' },
    { city: 'Tel Aviv', zone: 'Asia/Jerusalem' }, { city: 'Riyadh', zone: 'Asia/Riyadh' },
  ],
  'Africa & Oceania': [
    { city: 'Cairo', zone: 'Africa/Cairo' }, { city: 'Lagos', zone: 'Africa/Lagos' },
    { city: 'Johannesburg', zone: 'Africa/Johannesburg' }, { city: 'Nairobi', zone: 'Africa/Nairobi' },
    { city: 'Sydney', zone: 'Australia/Sydney' }, { city: 'Melbourne', zone: 'Australia/Melbourne' },
    { city: 'Auckland', zone: 'Pacific/Auckland' }, { city: 'Wellington', zone: 'Pacific/Auckland' },
    { city: 'Perth', zone: 'Australia/Perth' }, { city: 'Cape Town', zone: 'Africa/Johannesburg' },
  ],
};

/** Flatten list for search; build zone→city and slug→city */
let ALL_CITIES = [];
const ZONE_TO_CITY = {};
const SLUG_TO_CITY = {};

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

Object.keys(CITIES_BY_CONTINENT).forEach(cont => {
  CITIES_BY_CONTINENT[cont].forEach(o => {
    ALL_CITIES.push({ continent: cont, city: o.city, zone: o.zone, slug: slugify(o.city) });
    if (!ZONE_TO_CITY[o.zone]) ZONE_TO_CITY[o.zone] = o.city;
    SLUG_TO_CITY[slugify(o.city)] = o;
  });
});

export function getAllCities() {
  return ALL_CITIES;
}

export function getZoneToCity() {
  return ZONE_TO_CITY;
}

export function getCityBySlug(slug) {
  return SLUG_TO_CITY[slug] || null;
}

export function resolveZoneFromCities(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const bySlug = SLUG_TO_CITY[slugify(raw)];
  if (bySlug) return bySlug.zone;
  for (let i = 0; i < ALL_CITIES.length; i++) {
    const c = ALL_CITIES[i];
    if (c.city.toLowerCase() === lower || c.zone.toLowerCase() === lower) return c.zone;
  }
  return null;
}

export function getCityByZone(zone) {
  return ZONE_TO_CITY[zone] || null;
}

export const CARD_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#22c55e', '#14b8a6', '#3b82f6', '#64748b'];
export const CARD_FONTS = ['Inter', 'Georgia', 'Cambria', 'system-ui', 'Segoe UI', 'sans-serif'];
