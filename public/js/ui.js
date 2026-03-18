/**
 * ui.js — Theme, accordion, city strip, multi-clock grid, search, format toggle, accuracy display
 */

import { CITIES_BY_CONTINENT, CARD_COLORS, CARD_FONTS, getCityByZone } from './cities.js';
import { escapeHtml } from './utils.js';

/** City strip: each city gets a distinct style variant (font, size, weight, color) */
const CITY_STRIP_VARIANTS = 10;
function getCityStripVariant(index) {
  const variants = [
    { font: 'Playfair Display', size: '1.35rem', weight: '700', style: 'normal', color: '#6366f1' },
    { font: 'Libre Baskerville', size: '1.25rem', weight: '700', style: 'normal', color: '#a78bfa' },
    { font: 'Oswald', size: '1.3rem', weight: '600', style: 'normal', color: '#34d399' },
    { font: 'DM Sans', size: '1.2rem', weight: '700', style: 'normal', color: '#f472b6' },
    { font: 'Inter', size: '1.4rem', weight: '700', style: 'normal', color: '#fb923c' },
    { font: 'Georgia', size: '1.2rem', weight: '700', style: 'italic', color: '#22c55e' },
    { font: 'Playfair Display', size: '1.15rem', weight: '600', style: 'italic', color: '#3b82f6' },
    { font: 'Oswald', size: '1.28rem', weight: '600', style: 'normal', color: '#ec4899' },
    { font: 'Libre Baskerville', size: '1.22rem', weight: '700', style: 'normal', color: '#14b8a6' },
    { font: 'DM Sans', size: '1.38rem', weight: '600', style: 'normal', color: '#f59e0b' },
  ];
  return variants[index % CITY_STRIP_VARIANTS];
}

const STORAGE_THEME = 'timenow-theme';
const STORAGE_MULTI = 'timenow-multi';

export function initTheme(themeOverride, apply) {
  try {
    const s = localStorage.getItem(STORAGE_THEME);
    if (s === 'dark' || s === 'light') return s;
  } catch (_) {}
  return themeOverride;
}

export function applyTheme(themeOverride, themeBtn) {
  const dark = themeOverride === 'dark' || (themeOverride === null && !window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (themeBtn) themeBtn.textContent = dark ? '🌙' : '☀️';
  try {
    localStorage.setItem(STORAGE_THEME, themeOverride == null ? 'auto' : themeOverride);
  } catch (_) {}
}

export function cycleTheme(current) {
  if (current === null) return 'light';
  if (current === 'light') return 'dark';
  return null;
}

export function loadMultiClocks() {
  try {
    const s = localStorage.getItem(STORAGE_MULTI);
    if (s) return JSON.parse(s);
  } catch (_) {}
  return [];
}

export function saveMultiClocks(arr) {
  try {
    localStorage.setItem(STORAGE_MULTI, JSON.stringify(arr));
  } catch (_) {}
}

export function renderMultiClocks(multiClocks, multiGrid, state, onTick) {
  if (!multiGrid) return;
  multiGrid.innerHTML = '';
  multiClocks.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'mini-clock pinned-city-card';
    card.dataset.zone = item.zone;
    card.innerHTML =
      '<div class="day-indicator" aria-label="Day"></div>' +
      '<button class="btn-remove" aria-label="Remove clock">×</button>' +
      '<div class="pinned-city-name">' + escapeHtml(item.city) + '</div>' +
      '<div class="pinned-city-time">--:--:--</div>' +
      '<div class="pinned-city-offset">—</div>';
    card.querySelector('.btn-remove').addEventListener('click', () => {
      multiClocks.splice(idx, 1);
      saveMultiClocks(multiClocks);
      renderMultiClocks(multiClocks, multiGrid, state, onTick);
      onTick && onTick();
    });
    multiGrid.appendChild(card);
  });
  onTick && onTick();
}

export function addToMulti(multiClocks, zone, city, max = 8) {
  const name = city || getCityByZone(zone) || zone;
  if (multiClocks.length >= max) return false;
  if (multiClocks.some(c => c.zone === zone)) return false;
  multiClocks.push({ city: name, zone });
  saveMultiClocks(multiClocks);
  return true;
}

export function renderCityStrip(cityStrip, onSelectCity) {
  if (!cityStrip) return;
  cityStrip.innerHTML = '';
  let globalIndex = 0;
  Object.keys(CITIES_BY_CONTINENT).forEach(cont => {
    const label = document.createElement('span');
    label.className = 'continent-label';
    label.textContent = cont;
    cityStrip.appendChild(label);
    CITIES_BY_CONTINENT[cont].forEach((o) => {
      const v = getCityStripVariant(globalIndex++);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'city-card city-card-styled';
      card.setAttribute('data-city-variant', String(globalIndex % CITY_STRIP_VARIANTS));
      card.style.fontFamily = v.font + ', serif';
      card.style.fontSize = v.size;
      card.style.fontWeight = v.weight;
      card.style.fontStyle = v.style;
      card.style.color = v.color;
      card.style.borderColor = v.color;
      card.textContent = o.city;
      card.setAttribute('aria-label', `Time in ${o.city}`);
      card.addEventListener('click', () => onSelectCity(o.zone, o.city));
      cityStrip.appendChild(card);
    });
  });
}

export function bindAccordion() {
  document.querySelectorAll('.accordion-head').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.accordion-item');
      const open = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
    });
  });
}

export function updateAccuracyEl(el, accuracyMs) {
  if (!el) return;
  if (accuracyMs != null) {
    el.textContent = `Your clock is accurate to ±${accuracyMs} ms`;
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}
