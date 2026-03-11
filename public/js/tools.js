/**
 * tools.js — Time tools: difference, event adjuster, jet lag, overlap, relative, age, duration, unix, etc.
 */

import { isValidTz, formatTime, getOffsetStr, getOffsetMinutes } from './timezone.js';

export function runTimeDiff(zoneA, zoneB, use24) {
  if (!isValidTz(zoneA) || !isValidTz(zoneB)) return 'Invalid timezone. Use IANA (e.g. America/Chicago).';
  const dt = new Date();
  const offsetA = getOffsetStr(dt, zoneA);
  const offsetB = getOffsetStr(dt, zoneB);
  const minA = getOffsetMinutes(dt, zoneA);
  const minB = getOffsetMinutes(dt, zoneB);
  let diffH = (minB - minA) / 60;
  if (Number.isNaN(diffH)) {
    return `${zoneA} → ${zoneB}\nOffset A: ${offsetA}, Offset B: ${offsetB}\nCould not compute difference (invalid offset).`;
  }
  if (diffH > 12) diffH -= 24;
  if (diffH < -12) diffH += 24;
  const fun = Math.abs(diffH) >= 6 ? "It's a very different part of the day—e.g. bedtime there when it's lunch here." : "Similar part of the day.";
  return `${zoneA} → ${zoneB}\nOffset A: ${offsetA}, Offset B: ${offsetB}\nDifference: ${diffH.toFixed(1)} hours.\n${fun}`;
}

export function runEventAdjuster(timeStr, tz, targetsStr, use24) {
  if (!isValidTz(tz)) return 'Invalid event timezone.';
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i) || timeStr.match(/(\d{1,2})/);
  let h = m ? parseInt(m[1], 10) : 14;
  let min = (m && m[2]) ? parseInt(m[2], 10) : 0;
  if (m && (m[3] || '').toLowerCase() === 'pm' && h < 12) h += 12;
  if (m && (m[3] || '').toLowerCase() === 'am' && h === 12) h = 0;
  const now = new Date();
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const getPart = type => parseInt(p.find(x => x.type === type).value, 10);
  const y = getPart('year');
  const mo = getPart('month') - 1;
  const d = getPart('day');
  let ref = new Date(Date.UTC(y, mo, d, h, min, 0));
  const inTz = ref.toLocaleString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
  const got = inTz.match(/(\d{1,2}):(\d{2})/);
  if (got) {
    const gh = parseInt(got[1], 10);
    const gmin = parseInt(got[2], 10);
    ref = new Date(ref.getTime() + ((h - gh) * 60 + (min - gmin)) * 60 * 1000);
  }
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: !use24 });
  const targetZones = targetsStr.split(',').map(z => z.trim()).filter(Boolean);
  let out = 'Event at ' + formatter.format(ref) + ' (' + tz + ')\n\n';
  targetZones.forEach(z => {
    if (!isValidTz(z)) return;
    const f = new Intl.DateTimeFormat('en-US', { timeZone: z, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: !use24 });
    out += z + ': ' + f.format(ref) + '\n';
  });
  return out || 'No valid target zones.';
}

export function runJetLag(origin, dest, dateStr) {
  if (!isValidTz(origin) || !isValidTz(dest)) return 'Invalid timezone.';
  let dt = new Date();
  if (dateStr) dt = new Date(dateStr);
  if (isNaN(dt.getTime())) dt = new Date();
  const minOrigin = getOffsetMinutes(dt, origin);
  const minDest = getOffsetMinutes(dt, dest);
  let shiftH = (minDest - minOrigin) / 60;
  if (Number.isNaN(shiftH)) shiftH = 0;
  if (shiftH > 12) shiftH -= 24;
  if (shiftH < -12) shiftH += 24;
  const tip = shiftH > 0 ? 'Shift sleep 1–2 hours earlier each night before travel.' : 'Shift sleep 1–2 hours later each night before travel.';
  return `Origin: ${origin}\nDest: ${dest}\nApprox. shift: ${shiftH.toFixed(1)} hours.\n\n${tip}`;
}

export function runOverlap(zonesText, hoursStr) {
  const zones = zonesText.split(/\n/).map(z => z.trim()).filter(Boolean);
  const hm = (hoursStr || '9-17').match(/(\d+)\s*-\s*(\d+)/);
  let startH = hm ? parseInt(hm[1], 10) : 9;
  let endH = hm ? parseInt(hm[2], 10) : 17;
  // Treat "9-5" as 9am–5pm: if end < start and end <= 12, assume end is PM (e.g. 5 → 17)
  if (endH <= 12 && endH < startH) endH += 12;
  const dt = new Date();
  const result = [];
  zones.forEach(z => {
    if (!isValidTz(z)) return;
    const offsetMin = getOffsetMinutes(dt, z);
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dt);
    const getPart = (type) => parseInt(p.find(x => x.type === type).value, 10);
    const y = getPart('year');
    const mo = getPart('month') - 1;
    const d = getPart('day');
    const midnightUtc = Date.UTC(y, mo, d, 0, 0, 0) - offsetMin * 60 * 1000;
    const startUtc = midnightUtc + startH * 60 * 60 * 1000;
    const endUtc = midnightUtc + endH * 60 * 60 * 1000;
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', hour12: false });
    result.push({
      zone: z,
      start: fmt.format(new Date(startUtc)),
      end: fmt.format(new Date(endUtc)),
      startH,
      endH,
    });
  });
  return result;
}

export function runRelative(phrase, tz, othersStr, use24) {
  if (!isValidTz(tz)) return 'Invalid timezone.';
  const base = new Date();
  let hour = 9, min = 0;
  if (phrase.indexOf('tomorrow') !== -1) base.setDate(base.getDate() + 1);
  if (phrase.indexOf('next monday') !== -1 || phrase.indexOf('next mon') !== -1) {
    const d = base.getDay();
    base.setDate(base.getDate() + ((1 + 7 - d) % 7));
  }
  if (phrase.indexOf('morning') !== -1) { hour = 9; min = 0; }
  if (phrase.indexOf('noon') !== -1 || phrase.indexOf('midday') !== -1) { hour = 12; min = 0; }
  if (phrase.indexOf('evening') !== -1) { hour = 18; min = 0; }
  if (phrase.indexOf('night') !== -1) { hour = 21; min = 0; }
  const m = phrase.match(/(\d{1,2})\s*(?:am|pm)?\s*(?:o'clock)?/i) || phrase.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    hour = parseInt(m[1], 10);
    if (m[2]) min = parseInt(m[2], 10);
    if (phrase.indexOf('pm') !== -1 && hour < 12) hour += 12;
  }
  base.setHours(hour, min, 0, 0);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: !use24 });
  let out = 'In ' + tz + ': ' + f.format(base) + '\n';
  (othersStr ? othersStr.split(',') : []).forEach(z => {
    z = z.trim();
    if (!z || !isValidTz(z)) return;
    const f2 = new Intl.DateTimeFormat('en-US', { timeZone: z, weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: !use24 });
    out += z + ': ' + f2.format(base) + '\n';
  });
  return out;
}

export function runConverter(timeStr, fromZone, targetZones, use24) {
  if (!isValidTz(fromZone)) return [];
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  let h = m ? parseInt(m[1], 10) : 12;
  let min = (m && m[2]) ? parseInt(m[2], 10) : 0;
  if (m && (m[3] || '').toLowerCase() === 'pm' && h < 12) h += 12;
  if (m && (m[3] || '').toLowerCase() === 'am' && h === 12) h = 0;
  const now = new Date();
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fromZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const getPart = type => parseInt(p.find(x => x.type === type).value, 10);
  const y = getPart('year');
  const mo = getPart('month') - 1;
  const d = getPart('day');
  let ref = new Date(Date.UTC(y, mo, d, h, min, 0));
  const inTz = ref.toLocaleString('en-US', { timeZone: fromZone, hour12: false, hour: '2-digit', minute: '2-digit' });
  const got = inTz.match(/(\d{1,2}):(\d{2})/);
  if (got) {
    const gh = parseInt(got[1], 10);
    const gmin = parseInt(got[2], 10);
    ref = new Date(ref.getTime() + ((h - gh) * 60 + (min - gmin)) * 60 * 1000);
  }
  return targetZones.filter(isValidTz).map(z => ({
    zone: z,
    time: new Intl.DateTimeFormat('en-US', { timeZone: z, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !use24 }).format(ref),
  }));
}

/** Age calculator: birthdate → age in years, months, days */
export function runAgeCalculator(birthDateStr) {
  if (!birthDateStr) return 'Enter birth date.';
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return 'Invalid date.';
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  let months = now.getMonth() - birth.getMonth();
  let days = now.getDate() - birth.getDate();
  if (days < 0) { months--; days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
  if (months < 0) { years--; months += 12; }
  return `Age: ${years} years, ${months} months, ${days} days.`;
}

/** Unix timestamp converter */
export function runUnixConverter(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return 'Enter a Unix timestamp (seconds or ms) or an ISO date.';
  const num = parseInt(trimmed, 10);
  if (!isNaN(num)) {
    const ms = num < 1e12 ? num * 1000 : num;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return 'Invalid timestamp.';
    return d.toISOString() + '\n(Local: ' + d.toLocaleString() + ')';
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return 'Invalid date or timestamp.';
  return 'Unix (seconds): ' + Math.floor(d.getTime() / 1000) + '\nUnix (ms): ' + d.getTime();
}

/** Duration between two dates */
export function runDurationCalculator(startStr, endStr) {
  if (!startStr || !endStr) return 'Enter both start and end date/time.';
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'Invalid date(s).';
  const ms = end.getTime() - start.getTime();
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hours = Math.floor(min / 60);
  const days = Math.floor(hours / 24);
  return `Duration: ${days} days, ${hours % 24} hours, ${min % 60} minutes, ${sec % 60} seconds.`;
}
