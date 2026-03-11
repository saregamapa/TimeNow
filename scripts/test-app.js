#!/usr/bin/env node
/**
 * Thorough test of TimeNow app: homepage, city/country/time-diff pages, APIs, sitemap, robots, static files.
 * Run with server already up: node scripts/test-app.js [baseUrl]
 */
const http = require('http');
const BASE = process.argv[2] || 'http://localhost:3001';

function fetch(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url.startsWith('http') ? url : BASE + url);
    const req = http.get(u, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('Homepage (/)', async () => {
  const r = await fetch('/');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('TimeNow') || !r.body.includes('hero-time')) throw new Error('Missing key content');
});

test('City page /time/london', async () => {
  const r = await fetch('/time/london');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('London') || (!r.body.includes('Current Time') && !r.body.includes('Current time'))) throw new Error('Missing London content');
  if (!r.body.includes('time-difference')) throw new Error('Missing time-difference links');
  if (!r.body.includes('breadcrumb') && !r.body.includes('About') && !r.body.includes('section')) throw new Error('Missing SEO sections');
});

test('City page /time/tokyo', async () => {
  const r = await fetch('/time/tokyo');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('Tokyo') || !r.body.includes('Asia/Tokyo')) throw new Error('Missing Tokyo content');
});

test('City page 404 for invalid slug', async () => {
  const r = await fetch('/time/nonexistent-city-xyz-999');
  if (r.status !== 404) throw new Error('Expected 404, got ' + r.status);
});

test('Country page /country/united-kingdom', async () => {
  const r = await fetch('/country/united-kingdom');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('United Kingdom') || !r.body.includes('Cities in')) throw new Error('Missing country content');
  if (!r.body.includes('/time/london')) throw new Error('Missing city links');
});

test('Country page /country/japan', async () => {
  const r = await fetch('/country/japan');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('Japan') || !r.body.includes('Tokyo')) throw new Error('Missing Japan content');
});

test('Country page 404 for invalid slug', async () => {
  const r = await fetch('/country/nowhere-country-xyz');
  if (r.status !== 404) throw new Error('Expected 404, got ' + r.status);
});

test('Continent page /continent/europe', async () => {
  const r = await fetch('/continent/europe');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('Europe') || !r.body.includes('Countries') || !r.body.includes('Major cities')) throw new Error('Missing continent content');
  if (!r.body.includes('/country/')) throw new Error('Missing country links');
});

test('Continent page 404 for invalid slug', async () => {
  const r = await fetch('/continent/invalid-continent-xyz');
  if (r.status !== 404) throw new Error('Expected 404, got ' + r.status);
});

test('Time difference /time-difference/london/new-york-city', async () => {
  const r = await fetch('/time-difference/london/new-york-city');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('London') || !r.body.includes('New York')) throw new Error('Missing city names');
  if (!r.body.includes('Time difference') && !r.body.includes('difference')) throw new Error('Missing time diff title');
  if (!r.body.includes('Working hours') || !r.body.includes('meeting')) throw new Error('Missing overlap/meeting section');
  if (!r.body.includes('overlap-chart') && !r.body.includes('hour-cell')) throw new Error('Missing working hours chart');
});

test('Time difference /time-difference/tokyo/paris', async () => {
  const r = await fetch('/time-difference/tokyo/paris');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('Tokyo') || !r.body.includes('Paris')) throw new Error('Missing city names');
});

test('Time difference 404 for invalid slugs', async () => {
  const r = await fetch('/time-difference/fake-city-xyz/another-fake');
  if (r.status !== 404) throw new Error('Expected 404, got ' + r.status);
});

test('API /api/cities', async () => {
  const r = await fetch('/api/cities');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  let data;
  try {
    data = JSON.parse(r.body);
  } catch (e) {
    throw new Error('Invalid JSON');
  }
  const list = data.cities || data;
  if (!Array.isArray(list)) throw new Error('Expected cities array');
  if (list.length < 100) throw new Error('Expected many cities, got ' + list.length);
  const first = list[0];
  if (!first || !first.slug || !first.city || !first.country) throw new Error('Expected city fields');
});

test('API /api/search?q=london', async () => {
  const r = await fetch('/api/search?q=london');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  const data = JSON.parse(r.body);
  if (!data.cities || !Array.isArray(data.cities)) throw new Error('Expected cities array');
  const hasLondon = data.cities.some((c) => (c.city || '').toLowerCase().includes('london'));
  if (!hasLondon) throw new Error('Search for london should return London');
});

test('API /api/search?q=tokyo', async () => {
  const r = await fetch('/api/search?q=tokyo');
  const data = JSON.parse(r.body);
  if (!data.cities || data.cities.length === 0) throw new Error('Search for tokyo should return results');
});

test('API /api/search empty query', async () => {
  const r = await fetch('/api/search?q=');
  if (r.status !== 200) throw new Error('Expected 200');
  const data = JSON.parse(r.body);
  if (!data.cities || !Array.isArray(data.cities)) throw new Error('Expected cities array');
});

test('Sitemap /sitemap.xml', async () => {
  const r = await fetch('/sitemap.xml', 60000);
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('<?xml') || !r.body.includes('urlset')) throw new Error('Invalid sitemap XML');
  if (!r.body.includes('/time/')) throw new Error('Missing /time/ URLs');
});

test('Robots /robots.txt', async () => {
  const r = await fetch('/robots.txt');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('User-agent') || !r.body.includes('Allow') || !r.body.includes('Sitemap')) throw new Error('Missing robots directives');
});

test('Meeting planner /meeting', async () => {
  const r = await fetch('/meeting');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('Meeting') && !r.body.includes('meeting')) throw new Error('Missing meeting content');
});

test('Countdown /countdown', async () => {
  const r = await fetch('/countdown');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('Countdown') && !r.body.includes('countdown')) throw new Error('Missing countdown content');
});

test('Static CSS /css/main.css', async () => {
  const r = await fetch('/css/main.css');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (r.body.length < 100) throw new Error('CSS too short');
});

test('Static JS /js/search.js', async () => {
  const r = await fetch('/js/search.js');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  if (!r.body.includes('global-search')) throw new Error('Missing search script content');
});

test('Static JS /js/app.js', async () => {
  const r = await fetch('/js/app.js');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
});

test('City page has global search bar', async () => {
  const r = await fetch('/time/london');
  if (!r.body.includes('id="global-search"') && !r.body.includes('global-search')) throw new Error('Missing global search on city page');
});

test('City page has structured data (schema)', async () => {
  const r = await fetch('/time/london');
  if (!r.body.includes('application/ld+json') || !r.body.includes('BreadcrumbList')) throw new Error('Missing schema markup');
});

test('API /api/time (server time)', async () => {
  const r = await fetch('/api/time');
  if (r.status !== 200) throw new Error('Expected 200, got ' + r.status);
  const data = JSON.parse(r.body);
  if (typeof data.now !== 'number') throw new Error('Expected { now: number }');
});

test('City page has sun section', async () => {
  const r = await fetch('/time/london');
  if (!r.body.includes('Sun') || !r.body.includes('Sunrise')) throw new Error('Missing sun section');
});

test('Country page has live clock element', async () => {
  const r = await fetch('/country/united-kingdom');
  if (!r.body.includes('country-hero-time') || !r.body.includes('setInterval')) throw new Error('Missing clock tick script');
});

async function run() {
  console.log('Testing TimeNow at ' + BASE + '\n');
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log('  ✓ ' + name);
      passed++;
    } catch (err) {
      console.log('  ✗ ' + name + ': ' + err.message);
      failed++;
    }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
