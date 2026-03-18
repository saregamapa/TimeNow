/**
 * clock.js — Live clock tick, NTP-style sync, accuracy, timezone/sun info
 * Uses requestAnimationFrame for smooth updates.
 * Optional tick sound on each second when sound is enabled (Web Audio).
 */

import { formatTime, formatDate, getOffsetStr, getTzLong, getTzShort, getDstInfo, getOffsetMinutes } from './timezone.js';
import { getDayNight, getSunTimes, getSunProgress } from './sun.js';

let tickAudioContext = null;

/** Call from a user gesture (e.g. when enabling sound) to allow tick playback. */
export function resumeTickSound() {
  if (!tickAudioContext) tickAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (tickAudioContext.state === 'suspended') tickAudioContext.resume();
}

/** Play a short tick sound (like a real clock). Call every second when state.soundOn is true. */
function playTickSound(state) {
  if (!state.soundOn || !tickAudioContext) return;
  try {
    if (tickAudioContext.state === 'suspended') return;
    const now = tickAudioContext.currentTime;
    const osc = tickAudioContext.createOscillator();
    const gain = tickAudioContext.createGain();
    osc.connect(gain);
    gain.connect(tickAudioContext.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.start(now);
    osc.stop(now + 0.04);
  } catch (_) {}
}

const DEFAULT_TZ = 'America/Chicago';

export function getDefaultTz() {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return detected || DEFAULT_TZ;
  } catch (_) {
    return DEFAULT_TZ;
  }
}

/** Server time sync: fetch /api/time, compute offset from client, return ms accuracy estimate */
let serverTimeOffsetMs = 0;
let accuracyMs = null;

export async function syncWithServer() {
  const clientSend = Date.now();
  try {
    const res = await fetch('/api/time', { cache: 'no-store' });
    const clientRecv = Date.now();
    if (!res.ok) return;
    const data = await res.json();
    const serverMs = data.now;
    const rtt = clientRecv - clientSend;
    serverTimeOffsetMs = serverMs - clientRecv;
    accuracyMs = Math.max(0, Math.round(rtt / 2 + 10));
  } catch (_) {
    accuracyMs = null;
  }
}

export function getSyncedNow() {
  return new Date(Date.now() + serverTimeOffsetMs);
}

export function getAccuracyMs() {
  return accuracyMs;
}

/** Single tick: update hero, timezone block, sun block, mini-clocks. Minimal DOM writes. */
export function tick(state, dom) {
  const dt = state.synced ? getSyncedNow() : new Date();
  const mainTz = state.mainTz;
  const use24 = state.use24;
  const cityName = state.mainCityName || mainTz.split('/').pop().replace(/_/g, ' ');

  if (dom.heroSubtext) dom.heroSubtext.textContent = 'Current time in ' + cityName;
  if (dom.heroTime) dom.heroTime.textContent = formatTime(dt, mainTz, use24);
  if (dom.heroDate) dom.heroDate.textContent = formatDate(dt, mainTz);
  if (dom.heroTzLong) dom.heroTzLong.textContent = getTzLong(dt, mainTz);
  if (dom.heroTzAbbr) dom.heroTzAbbr.textContent = getTzShort(dt, mainTz);
  if (dom.heroTzOffset) dom.heroTzOffset.textContent = getOffsetStr(dt, mainTz);

  if (dom.tzOffsetValue) dom.tzOffsetValue.textContent = getOffsetStr(dt, mainTz);
  if (dom.tzLongName) dom.tzLongName.textContent = getTzLong(dt, mainTz);
  if (dom.tzIana) dom.tzIana.textContent = mainTz;
  const dst = getDstInfo(dt, mainTz);
  if (dom.tzDst) dom.tzDst.textContent = dst.isDst ? 'Daylight saving time is in effect.' : 'Standard time.';
  if (dom.tzLatestChange) {
    dom.tzLatestChange.textContent = dst.lastChange ? 'Latest change: ' + dst.lastChange + (dst.isDst ? ' — Summer time started.' : ' — Winter time started.') : '';
    dom.tzLatestChange.classList.toggle('muted', !!dst.lastChange);
  }
  if (dom.tzNextChange) {
    dom.tzNextChange.textContent = dst.nextChange ? 'Next change: ' + dst.nextChange + (dst.isDst ? ' — Switching to winter time.' : ' — Summer time starts.') : '';
    dom.tzNextChange.classList.toggle('muted', !!dst.nextChange);
  }

  const sun = getSunTimes(dt, mainTz, getOffsetMinutes(dt, mainTz));
  if (dom.sunSunrise) dom.sunSunrise.textContent = sun.sunrise;
  if (dom.sunSunset) dom.sunSunset.textContent = sun.sunset;
  if (dom.sunDuration) dom.sunDuration.textContent = sun.duration;
  const sunProgress = getSunProgress(dt, mainTz);
  if (dom.sunProgressBar) dom.sunProgressBar.style.width = (sunProgress * 100) + '%';

  if (dom.multiGrid) {
    dom.multiGrid.querySelectorAll('.mini-clock').forEach(el => {
      const zone = el.dataset.zone;
      if (!zone) return;
      const dn = getDayNight(dt, zone);
      const timeEl = el.querySelector('.pinned-city-time') || el.querySelector('.mini-time');
      const dateEl = el.querySelector('.mini-date');
      const offsetEl = el.querySelector('.pinned-city-offset') || el.querySelector('.mini-offset');
      const dnEl = el.querySelector('.day-night');
      const indicatorEl = el.querySelector('.day-indicator');
      if (timeEl) timeEl.textContent = formatTime(dt, zone, use24);
      if (dateEl) dateEl.textContent = formatDate(dt, zone);
      if (offsetEl) offsetEl.textContent = getOffsetStr(dt, zone);
      if (dnEl) {
        dnEl.textContent = dn.isDay ? '☀️' : '🌙';
        dnEl.setAttribute('aria-label', dn.isDay ? 'Day' : 'Night');
      }
      if (indicatorEl) {
        indicatorEl.classList.toggle('night', !dn.isDay);
        indicatorEl.setAttribute('aria-label', dn.isDay ? 'Day' : 'Night');
      }
    });
  }

  if (dom.worldClocksDefault) {
    dom.worldClocksDefault.querySelectorAll('.world-clock-card').forEach(el => {
      const zone = el.dataset.zone;
      if (!zone) return;
      const timeEl = el.querySelector('.city-time');
      const tzEl = el.querySelector('.city-tz');
      if (timeEl) timeEl.textContent = formatTime(dt, zone, use24);
      if (tzEl) tzEl.textContent = getTzShort(dt, zone);
    });
  }

  if (state.meetingZoneA && dom.meetingTimeA) dom.meetingTimeA.textContent = formatTime(dt, state.meetingZoneA, use24);
  if (state.meetingZoneB && dom.meetingTimeB) dom.meetingTimeB.textContent = formatTime(dt, state.meetingZoneB, use24);
  if (dom.meetingOverlap && state.meetingZoneA && state.meetingZoneB) {
    const oa = getOffsetMinutes(dt, state.meetingZoneA);
    const ob = getOffsetMinutes(dt, state.meetingZoneB);
    const diffH = (ob - oa) / 60;
    dom.meetingOverlap.textContent = diffH === 0 ? 'Same time' : diffH > 0 ? `B is ${diffH} hour${diffH !== 1 ? 's' : ''} ahead of A` : `B is ${-diffH} hour${-diffH !== 1 ? 's' : ''} behind A`;
  }

  if (state.soundOn) playTickSound(state);
}

let rafId = null;
let lastSec = -1;

function loop(state, dom) {
  const now = state.synced ? getSyncedNow() : new Date();
  const sec = now.getSeconds();
  if (sec !== lastSec) {
    lastSec = sec;
    tick(state, dom);
  }
  rafId = requestAnimationFrame(() => loop(state, dom));
}

export function startClock(state, dom) {
  lastSec = -1;
  tick(state, dom);
  if (rafId) cancelAnimationFrame(rafId);
  loop(state, dom);
}

export function stopClock() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}
