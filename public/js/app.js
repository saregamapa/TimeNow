/**
 * app.js — Main entry: state, clock, UI, tools. ES modules.
 */

import { getDefaultTz, syncWithServer, startClock, tick, getAccuracyMs, getSyncedNow, resumeTickSound } from './clock.js';
import { resolveZoneFromCities, getCityByZone } from './cities.js';
import { resolveZoneIANA, isValidTz, formatTime, getOffsetStr, getTzShort } from './timezone.js';
import {
  initTheme,
  applyTheme,
  cycleTheme,
  loadMultiClocks,
  saveMultiClocks,
  renderMultiClocks,
  addToMulti,
  renderCityStrip,
  bindAccordion,
  updateAccuracyEl,
} from './ui.js';
import {
  runTimeDiff,
  runEventAdjuster,
  runJetLag,
  runOverlap,
  runRelative,
} from './tools.js';

/** Default world clocks: slug must exist in server cities.json for /time/:slug to work */
const DEFAULT_WORLD_CLOCKS = [
  { slug: 'new-york-city', city: 'New York', zone: 'America/New_York', font: 'serif', accent: 1 },
  { slug: 'london', city: 'London', zone: 'Europe/London', font: 'elegant', accent: 2 },
  { slug: 'paris', city: 'Paris', zone: 'Europe/Paris', font: 'artistic', accent: 3 },
  { slug: 'tokyo', city: 'Tokyo', zone: 'Asia/Tokyo', font: 'minimal', accent: 4 },
  { slug: 'bengaluru', city: 'Bangalore', zone: 'Asia/Kolkata', font: 'strong', accent: 5 },
  { slug: 'sydney', city: 'Sydney', zone: 'Australia/Sydney', font: 'serif', accent: 1 },
  { slug: 'dubai', city: 'Dubai', zone: 'Asia/Dubai', font: 'elegant', accent: 2 },
  { slug: 'singapore', city: 'Singapore', zone: 'Asia/Singapore', font: 'minimal', accent: 3 },
  { slug: 'los-angeles', city: 'Los Angeles', zone: 'America/Los_Angeles', font: 'strong', accent: 4 },
  { slug: 'berlin', city: 'Berlin', zone: 'Europe/Berlin', font: 'artistic', accent: 5 },
];

const state = {
  mainTz: getDefaultTz(),
  mainCityName: null,
  use24: true,
  themeOverride: null,
  soundOn: false,
  multiClocks: [],
  synced: false,
  meetingZoneA: null,
  meetingZoneB: null,
};

const dom = {
  search: document.getElementById('global-search'),
  themeBtn: document.getElementById('theme-btn'),
  soundBtn: document.getElementById('sound-btn'),
  heroSubtext: document.getElementById('hero-subtext'),
  heroTime: document.getElementById('hero-time'),
  heroDate: document.getElementById('hero-date'),
  heroTzLong: document.getElementById('hero-tz-long'),
  heroTzAbbr: document.getElementById('hero-tz-abbr'),
  heroTzOffset: document.getElementById('hero-tz-offset'),
  accuracyEl: document.getElementById('accuracy'),
  tzOffsetValue: document.getElementById('tz-offset-value'),
  tzLongName: document.getElementById('tz-long-name'),
  tzIana: document.getElementById('tz-iana'),
  tzDst: document.getElementById('tz-dst'),
  tzLatestChange: document.getElementById('tz-latest-change'),
  tzNextChange: document.getElementById('tz-next-change'),
  sunSunrise: document.getElementById('sun-sunrise'),
  sunSunset: document.getElementById('sun-sunset'),
  sunDuration: document.getElementById('sun-duration'),
  sunProgressBar: document.getElementById('sun-progress-bar'),
  multiGrid: document.getElementById('multi-clock-grid'),
  addClockInput: document.getElementById('add-clock-input'),
  addClockBtn: document.getElementById('add-clock-btn'),
  cityStrip: document.getElementById('city-strip'),
  meetingTimeA: document.getElementById('meeting-time-a'),
  meetingTimeB: document.getElementById('meeting-time-b'),
  meetingOverlap: document.getElementById('meeting-overlap'),
  meetingCityA: document.getElementById('meeting-city-a'),
  meetingCityB: document.getElementById('meeting-city-b'),
  worldClocksDefault: document.getElementById('world-clocks-default'),
};

function resolveZone(input) {
  return resolveZoneFromCities(input) || resolveZoneIANA(input);
}

/** Resolve city name or IANA zone; if not in client list, try server search API. Returns { zone, city } or null. */
async function resolveZoneAndCity(input) {
  const val = (input || '').trim();
  if (!val) return null;
  const zone = resolveZone(val);
  if (zone) return { zone, city: getCityByZone(zone) || val };
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(val));
    const data = await res.json();
    if (data.cities && data.cities.length) {
      const c = data.cities[0];
      return { zone: c.timezone || '', city: c.city || val };
    }
  } catch (_) {}
  return null;
}

function onSelectCity(zone, city) {
  state.mainTz = zone;
  state.mainCityName = city;
  addToMulti(state.multiClocks, zone, city);
  renderMultiClocks(state.multiClocks, dom.multiGrid, state, () => tick(state, dom));
}

// Theme
state.themeOverride = initTheme(null);
applyTheme(state.themeOverride, dom.themeBtn);
dom.themeBtn?.addEventListener('click', () => {
  state.themeOverride = cycleTheme(state.themeOverride);
  applyTheme(state.themeOverride, dom.themeBtn);
});
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(state.themeOverride, dom.themeBtn));
}

// Clock tick sound (persisted in localStorage)
try {
  const s = localStorage.getItem('timenow-sound');
  state.soundOn = s === 'on';
} catch (_) {}
function applySoundBtn() {
  if (dom.soundBtn) {
    dom.soundBtn.textContent = state.soundOn ? '🔊' : '🔇';
    dom.soundBtn.setAttribute('aria-label', state.soundOn ? 'Clock tick sound on' : 'Toggle clock tick sound');
    dom.soundBtn.setAttribute('title', state.soundOn ? 'Clock tick sound on' : 'Turn on clock tick sound');
  }
}
applySoundBtn();
dom.soundBtn?.addEventListener('click', () => {
  state.soundOn = !state.soundOn;
  try { localStorage.setItem('timenow-sound', state.soundOn ? 'on' : 'off'); } catch (_) {}
  applySoundBtn();
  if (state.soundOn) resumeTickSound();
});

// Multi clocks
state.mainCityName = getCityByZone(state.mainTz) || state.mainTz.split('/').pop().replace(/_/g, ' ');
state.multiClocks = loadMultiClocks();
renderMultiClocks(state.multiClocks, dom.multiGrid, state, () => tick(state, dom));

// Default world clocks (10 cities, links to /time/:slug)
function renderWorldClocksDefault() {
  const grid = dom.worldClocksDefault;
  if (!grid) return;
  grid.innerHTML = '';
  const dt = state.synced ? getSyncedNow() : new Date();
  DEFAULT_WORLD_CLOCKS.forEach(({ slug, city, zone, font, accent }) => {
    const a = document.createElement('a');
    a.className = 'world-clock-card';
    a.setAttribute('data-font', font);
    a.setAttribute('data-zone', zone);
    if (accent) a.setAttribute('data-accent', String(accent));
    a.href = '/time/' + slug;
    a.setAttribute('role', 'listitem');
    a.innerHTML = '<span class="city-name">' + escapeHtml(city) + '</span><span class="city-time">' + formatTime(dt, zone, state.use24) + '</span><span class="city-tz">' + escapeHtml(getTzShort(dt, zone)) + '</span>';
    grid.appendChild(a);
  });
}
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
renderWorldClocksDefault();

function setAddClockMsg(msg) {
  const el = document.getElementById('add-clock-msg');
  if (el) el.textContent = msg;
  if (msg) setTimeout(() => { if (el) el.textContent = ''; }, 4000);
}

async function doAddClock() {
  const input = dom.addClockInput;
  const val = input?.value?.trim();
  if (!val) return;
  const resolved = await resolveZoneAndCity(val);
  if (!resolved || !resolved.zone) {
    setAddClockMsg('City or timezone not found. Try a city name (e.g. London, Nassau) or IANA zone (e.g. America/New_York).');
    return;
  }
  const { zone, city } = resolved;
  const added = addToMulti(state.multiClocks, zone, city);
  if (added) {
    input.value = '';
    setAddClockMsg('Added ' + (city || zone) + '.');
    renderMultiClocks(state.multiClocks, dom.multiGrid, state, () => tick(state, dom));
  } else {
    if (state.multiClocks.some((c) => c.zone === zone)) setAddClockMsg('That clock is already pinned.');
    else setAddClockMsg('Maximum 8 clocks. Remove one to add another.');
  }
}

dom.addClockBtn?.addEventListener('click', () => doAddClock());
dom.addClockInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddClock(); } });

// City strip
renderCityStrip(dom.cityStrip, onSelectCity);


// Search
dom.search?.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const val = dom.search.value.trim();
  if (!val) return;
  const zone = resolveZone(val);
  if (zone) {
    state.mainTz = zone;
    state.mainCityName = getCityByZone(zone) || zone.split('/').pop().replace(/_/g, ' ');
    tick(state, dom);
  }
});

// Format 24/12
document.getElementById('btn-24')?.addEventListener('click', () => {
  state.use24 = true;
  document.getElementById('btn-24').classList.add('active');
  document.getElementById('btn-12').classList.remove('active');
  tick(state, dom);
});
document.getElementById('btn-12')?.addEventListener('click', () => {
  state.use24 = false;
  document.getElementById('btn-12').classList.add('active');
  document.getElementById('btn-24').classList.remove('active');
  tick(state, dom);
});

// Accordion
bindAccordion();

// Meeting planner: resolve zones on blur and update times in tick
function resolveMeetingZones() {
  const a = dom.meetingCityA?.value?.trim();
  const b = dom.meetingCityB?.value?.trim();
  state.meetingZoneA = a ? resolveZone(a) : null;
  state.meetingZoneB = b ? resolveZone(b) : null;
}
dom.meetingCityA?.addEventListener('blur', resolveMeetingZones);
dom.meetingCityA?.addEventListener('keydown', e => { if (e.key === 'Enter') resolveMeetingZones(); });
dom.meetingCityB?.addEventListener('blur', resolveMeetingZones);
dom.meetingCityB?.addEventListener('keydown', e => { if (e.key === 'Enter') resolveMeetingZones(); });

document.getElementById('btn-diff')?.addEventListener('click', () => {
  const aRaw = document.getElementById('diff-city-a')?.value?.trim() || 'America/Chicago';
  const bRaw = document.getElementById('diff-city-b')?.value?.trim() || 'Europe/London';
  const out = document.getElementById('out-diff');
  const a = resolveZone(aRaw) || aRaw;
  const b = resolveZone(bRaw) || bRaw;
  if (!isValidTz(a) || !isValidTz(b)) {
    if (out) out.textContent = 'Invalid timezone. Use IANA (e.g. America/Chicago) or a city name (e.g. London, Tokyo).';
    return;
  }
  if (out) out.textContent = runTimeDiff(a, b, state.use24);
});

document.getElementById('btn-event')?.addEventListener('click', () => {
  const timeStr = document.getElementById('event-time')?.value?.trim() || '14:00';
  const tzRaw = document.getElementById('event-tz')?.value?.trim() || 'America/New_York';
  const targetsRaw = document.getElementById('event-targets')?.value?.trim() || 'Europe/London, Asia/Tokyo';
  const out = document.getElementById('out-event');
  const tz = resolveZone(tzRaw) || tzRaw;
  if (!isValidTz(tz)) {
    if (out) out.textContent = 'Invalid event timezone. Use IANA (e.g. America/New_York) or a city name (e.g. London, Tokyo).';
    return;
  }
  const targetsResolved = targetsRaw.split(',').map(s => resolveZone(s.trim()) || s.trim()).filter(z => z && isValidTz(z));
  if (out) out.textContent = runEventAdjuster(timeStr, tz, targetsResolved.join(', '), state.use24);
});

document.getElementById('btn-jetlag')?.addEventListener('click', () => {
  const originRaw = document.getElementById('jetlag-origin')?.value?.trim() || 'America/Chicago';
  const destRaw = document.getElementById('jetlag-dest')?.value?.trim() || 'Europe/London';
  const dateStr = document.getElementById('jetlag-date')?.value?.trim() || '';
  const out = document.getElementById('out-jetlag');
  const origin = resolveZone(originRaw) || originRaw;
  const dest = resolveZone(destRaw) || destRaw;
  if (!isValidTz(origin) || !isValidTz(dest)) {
    if (out) out.textContent = 'Invalid timezone. Use IANA (e.g. America/Chicago) or a city name (e.g. London, Tokyo).';
    return;
  }
  if (out) out.textContent = runJetLag(origin, dest, dateStr);
});

document.getElementById('btn-overlap')?.addEventListener('click', () => {
  const textRaw = document.getElementById('overlap-zones')?.value?.trim() || 'America/New_York\nEurope/London\nAsia/Tokyo';
  const hoursStr = document.getElementById('overlap-hours')?.value?.trim() || '9-17';
  const zonesResolved = textRaw.split(/\n/).map(line => resolveZone(line.trim()) || line.trim()).filter(z => z && isValidTz(z));
  if (zonesResolved.length === 0) {
    const outEl = document.getElementById('out-overlap');
    const barsEl = document.getElementById('overlap-bars');
    if (outEl) outEl.textContent = 'Invalid timezone(s). Use IANA (e.g. America/New_York) or city names (e.g. London, Tokyo), one per line.';
    if (barsEl) barsEl.innerHTML = '';
    return;
  }
  const text = zonesResolved.join('\n');
  const result = runOverlap(text, hoursStr);
  const outEl = document.getElementById('out-overlap');
  const barsEl = document.getElementById('overlap-bars');
  if (outEl) outEl.textContent = result.map(x => `${x.zone}: ${x.start}–${x.end} (local)`).join('\n');
  if (barsEl) {
    barsEl.innerHTML = '';
    result.forEach(x => {
      const row = document.createElement('div');
      row.className = 'overlap-row';
      const pct = Math.min(100, ((x.endH - x.startH) / 24) * 100);
      row.innerHTML = '<span class="label">' + x.zone.replace(/</g, '&lt;') + '</span><div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%"></div></div>';
      barsEl.appendChild(row);
    });
  }
});

document.getElementById('btn-relative')?.addEventListener('click', () => {
  const phrase = document.getElementById('relative-phrase')?.value?.trim() || 'tomorrow morning';
  const tzRaw = document.getElementById('relative-tz')?.value?.trim() || state.mainTz || 'America/Chicago';
  const othersRaw = document.getElementById('relative-others')?.value?.trim() || '';
  const out = document.getElementById('out-relative');
  const tz = resolveZone(tzRaw) || tzRaw;
  if (!isValidTz(tz)) {
    if (out) out.textContent = 'Invalid timezone. Use IANA (e.g. America/Chicago) or a city name (e.g. London).';
    return;
  }
  const othersResolved = othersRaw.split(',').map(s => resolveZone(s.trim()) || s.trim()).filter(z => z && isValidTz(z));
  if (out) out.textContent = runRelative(phrase, tz, othersResolved.join(', '), state.use24);
});

// NTP-style sync and start clock
(async () => {
  await syncWithServer();
  state.synced = getAccuracyMs() != null;
  updateAccuracyEl(dom.accuracyEl, getAccuracyMs());
})();
startClock(state, dom);

// Re-export for shareable links / meeting page
window.__timenowState = state;
window.__timenowDom = dom;
