/**
 * timezone.js — IANA timezone validation and resolution (no external API)
 */

export function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

/** Resolve IANA-style string (e.g. America/New_York) to valid timezone. */
export function resolveZoneIANA(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  const iana = raw.toLowerCase().replace(/\s+/g, '_');
  if (iana.includes('/')) {
    const capitalized = iana.split('/').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('/');
    if (isValidTz(capitalized)) return capitalized;
    if (isValidTz(iana)) return iana;
  }
  return null;
}

export function formatTime(dt, tz, hour24 = true) {
  const opts = { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !hour24 };
  return new Intl.DateTimeFormat('en-GB', opts).format(dt);
}

export function formatDate(dt, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(dt);
}

export function getOffsetStr(dt, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(dt);
  const p = parts.find(x => x.type === 'timeZoneName');
  return p ? p.value : '';
}

export function getTzLong(dt, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(dt);
  const p = parts.find(x => x.type === 'timeZoneName');
  return p ? p.value : tz;
}

export function getOffsetMinutes(dt, tz) {
  const str = (getOffsetStr(dt, tz) || '').replace(/\u2212/g, '-');
  // Match "UTC±H", "GMT±H", "GMT±H:M", "GMT±HH:MM" (browsers may use unicode minus or colon)
  const m = str.match(/(?:UTC|GMT)([+-])(\d{1,2})(?::(\d{2})?)?/);
  if (m) {
    const sign = m[1] === '+' ? 1 : -1;
    const h = parseInt(m[2], 10);
    const min = m[3] ? parseInt(m[3], 10) : 0;
    return sign * (h * 60 + min);
  }
  // Fallback: compute offset from local time vs UTC at same instant
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(dt);
    const utcH = dt.getUTCHours();
    const utcM = dt.getUTCMinutes();
    const localH = parseInt(p.find(x => x.type === 'hour').value, 10);
    const localM = parseInt(p.find(x => x.type === 'minute').value, 10);
    return (localH * 60 + localM) - (utcH * 60 + utcM);
  } catch (_) {
    return 0;
  }
}

/** Abbreviation e.g. CST, EDT */
export function getTzShort(dt, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(dt);
  const p = parts.find(x => x.type === 'timeZoneName');
  return p ? p.value : '';
}

/** DST: isDst, nextChange (date string), lastChange (date string) */
export function getDstInfo(dt, tz) {
  const long = getTzLong(dt, tz);
  const isDst = /daylight|summer/i.test(long);
  let nextChange = null;
  let lastChange = null;
  try {
    const now = dt.getTime();
    for (let d = 0; d < 400; d++) {
      const next = new Date(now + d * 86400000);
      const nextLong = getTzLong(next, tz);
      const nextDst = /daylight|summer/i.test(nextLong);
      if (nextDst !== isDst) {
        nextChange = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(next);
        break;
      }
    }
    for (let d = 1; d <= 400; d++) {
      const prev = new Date(now - d * 86400000);
      const prevLong = getTzLong(prev, tz);
      const prevDst = /daylight|summer/i.test(prevLong);
      if (prevDst !== isDst) {
        lastChange = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(prev);
        break;
      }
    }
  } catch (_) {}
  return { isDst, nextChange, lastChange };
}
