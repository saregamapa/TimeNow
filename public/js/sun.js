/**
 * sun.js — Day/night and sun times.
 * Uses latitude/longitude when available for real sunrise/sunset; otherwise 6:00 / 18:00 local.
 */

/** Approximate lat/lon by IANA zone (one representative point per zone for sun calc) */
export const ZONE_LATLON = {
  'America/New_York': { lat: 40.71, lon: -74.01 },
  'America/Los_Angeles': { lat: 34.05, lon: -118.24 },
  'America/Chicago': { lat: 41.88, lon: -87.63 },
  'America/Denver': { lat: 39.74, lon: -104.99 },
  'America/Phoenix': { lat: 33.45, lon: -112.07 },
  'America/Toronto': { lat: 43.65, lon: -79.38 },
  'America/Mexico_City': { lat: 19.43, lon: -99.13 },
  'America/Sao_Paulo': { lat: -23.55, lon: -46.63 },
  'Europe/London': { lat: 51.51, lon: -0.13 },
  'Europe/Paris': { lat: 48.86, lon: 2.35 },
  'Europe/Berlin': { lat: 52.52, lon: 13.40 },
  'Europe/Madrid': { lat: 40.42, lon: -3.70 },
  'Europe/Rome': { lat: 41.90, lon: 12.50 },
  'Europe/Amsterdam': { lat: 52.37, lon: 4.89 },
  'Europe/Moscow': { lat: 55.75, lon: 37.62 },
  'Europe/Athens': { lat: 37.98, lon: 23.73 },
  'Europe/Istanbul': { lat: 41.01, lon: 28.95 },
  'Asia/Tokyo': { lat: 35.68, lon: 139.69 },
  'Asia/Shanghai': { lat: 31.23, lon: 121.47 },
  'Asia/Hong_Kong': { lat: 22.28, lon: 114.16 },
  'Asia/Singapore': { lat: 1.29, lon: 103.85 },
  'Asia/Seoul': { lat: 37.57, lon: 126.98 },
  'Asia/Kolkata': { lat: 22.57, lon: 88.36 },
  'Asia/Dubai': { lat: 25.20, lon: 55.27 },
  'Asia/Bangkok': { lat: 13.76, lon: 100.50 },
  'Australia/Sydney': { lat: -33.87, lon: 151.21 },
  'Australia/Melbourne': { lat: -37.81, lon: 144.96 },
  'Pacific/Auckland': { lat: -36.85, lon: 174.76 },
  'Africa/Cairo': { lat: 30.04, lon: 31.24 },
  'Africa/Johannesburg': { lat: -26.20, lon: 28.04 },
};

/**
 * @param {Date} dt
 * @param {string} tz IANA timezone
 * @returns {{ isDay: boolean, hour: number }}
 */
export function getDayNight(dt, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hour12: false }).formatToParts(dt);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const isDay = hour >= 6 && hour < 18;
  return { isDay, hour };
}

/**
 * Sunrise/sunset in local decimal hours (0-24) for a given date and lat/lon.
 * Uses standard solar formula (declination + hour angle + equation of time).
 */
function getSunriseSunsetHoursLocal(latDeg, lonDeg, y, m, d) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const n = Math.floor((new Date(y, m - 1, d) - new Date(y, 0, 0)) / 86400000) + 1;
  const phi = toRad(latDeg);
  const dec = toRad(23.44 * Math.sin((2 * Math.PI / 365) * (284 + n)));
  const cosOmega = (Math.sin(toRad(-0.83)) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  const omega = Math.acos(Math.max(-1, Math.min(1, cosOmega)));
  const H = (omega * 180) / Math.PI / 15;
  const sunriseSolar = 12 - H;
  const sunsetSolar = 12 + H;
  const B = (2 * Math.PI * (n - 81)) / 364;
  const EMin = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const E = EMin / 60;
  return {
    sunrise: sunriseSolar - E,
    sunset: sunsetSolar - E,
  };
}

/**
 * Get sunrise/sunset times for the given date in the given timezone.
 * If zone has coordinates in ZONE_LATLON, uses real solar calculation; otherwise 6:00 / 18:00 local.
 * @param {Date} dt
 * @param {string} tz IANA timezone
 * @param {number} offsetMinutes — from getOffsetMinutes(dt, tz)
 * @returns {{ sunrise: string, sunset: string, duration: string }}
 */
export function getSunTimes(dt, tz, offsetMinutes) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dt);
  const y = parseInt(p.find(x => x.type === 'year').value, 10);
  const m = parseInt(p.find(x => x.type === 'month').value, 10) - 1;
  const d = parseInt(p.find(x => x.type === 'day').value, 10);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });

  const coords = ZONE_LATLON[tz];
  if (coords) {
    const { sunrise: srH, sunset: ssH } = getSunriseSunsetHoursLocal(coords.lat, coords.lon, y, m + 1, d);
    const noonUtc = Date.UTC(y, m, d, 12, 0, 0);
    const noonDate = new Date(noonUtc);
    const offsetParts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(noonDate);
    const offStr = (offsetParts.find(x => x.type === 'timeZoneName') || {}).value || '';
    const match = offStr.match(/([+-])(\d+)(?::(\d+))?/);
    const offsetMin = match ? (match[1] === '+' ? 1 : -1) * (parseInt(match[2], 10) * 60 + (parseInt(match[3], 10) || 0)) : 0;
    const noonTzUtc = noonUtc - offsetMin * 60 * 1000;
    const sunriseUtc = noonTzUtc + (srH - 12) * 3600000;
    const sunsetUtc = noonTzUtc + (ssH - 12) * 3600000;
    const sunriseStr = fmt.format(new Date(sunriseUtc));
    const sunsetStr = fmt.format(new Date(sunsetUtc));
    const durM = Math.round((ssH - srH) * 60);
    const duration = (durM >= 60 ? Math.floor(durM / 60) + 'h ' : '') + (durM % 60 ? durM % 60 + 'm' : '');
    return { sunrise: sunriseStr, sunset: sunsetStr, duration: duration.trim() || '0m' };
  }

  const utcMidnight = Date.UTC(y, m, d, 0, 0, 0) - (offsetMinutes || 0) * 60 * 1000;
  const sunriseDate = new Date(utcMidnight + 6 * 60 * 60 * 1000);
  const sunsetDate = new Date(utcMidnight + 18 * 60 * 60 * 1000);
  return {
    sunrise: fmt.format(sunriseDate),
    sunset: fmt.format(sunsetDate),
    duration: '12h 0m',
  };
}

/**
 * Progress through daylight (0 = sunrise, 1 = sunset). For sun progress bar.
 * @param {Date} dt
 * @param {string} tz IANA timezone
 * @returns {number} 0–1 (before sunrise → 0, after sunset → 1)
 */
export function getSunProgress(dt, tz) {
  const coords = ZONE_LATLON[tz];
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dt);
  const y = parseInt(p.find(x => x.type === 'year').value, 10);
  const m = parseInt(p.find(x => x.type === 'month').value, 10) - 1;
  const d = parseInt(p.find(x => x.type === 'day').value, 10);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(dt);
  const hour = parseInt(parts.find(x => x.type === 'hour').value, 10);
  const minute = parseInt(parts.find(x => x.type === 'minute').value, 10);
  const nowLocal = hour + minute / 60;

  if (coords) {
    const { sunrise: srH, sunset: ssH } = getSunriseSunsetHoursLocal(coords.lat, coords.lon, y, m + 1, d);
    if (nowLocal <= srH) return 0;
    if (nowLocal >= ssH) return 1;
    return (nowLocal - srH) / (ssH - srH);
  }
  if (nowLocal <= 6) return 0;
  if (nowLocal >= 18) return 1;
  return (nowLocal - 6) / 12;
}
