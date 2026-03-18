#!/usr/bin/env node
/**
 * Generate AI "great places to visit" for each city via OpenAI API.
 * Writes or updates data/city-content/<slug>.json with best_places only (or merges into existing).
 * Use this to populate the "Great places to visit" section on city pages so each city shows
 * real, AI-generated places instead of the generic fallback.
 *
 * Usage: OPENAI_API_KEY=your_key node scripts/generatePlaces.js [--limit N] [--slug nassau] [--major-first]
 *   --limit N       Process only N cities (default: all cities that need places).
 *   --slug X        Process only the city with slug X (e.g. nassau).
 *   --force         Regenerate even if best_places already exists (replace with new list).
 *   --major-first   Process major/popular world cities first (then remaining). Use for nearby + all countries.
 *
 * To fix "Great places to visit" for ALL cities in all countries at once, run with no args
 * (skips cities that already have 8+ places): OPENAI_API_KEY=... npm run generate-places
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const CITIES_PATH = path.join(ROOT, 'data', 'cities.json');
const CONTENT_DIR = path.join(ROOT, 'data', 'city-content');

const MAJOR_SLUGS = new Set(['london', 'paris', 'new-york', 'tokyo', 'berlin', 'sydney', 'dubai', 'singapore', 'los-angeles', 'madrid', 'rome', 'amsterdam']);

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : null;
const SINGLE_SLUG = args.includes('--slug') ? (args[args.indexOf('--slug') + 1] || '').toLowerCase().trim() : null;
const FORCE = args.includes('--force');
const MAJOR_FIRST = args.includes('--major-first');

function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key.trim()) {
    console.error('Error: OPENAI_API_KEY environment variable is required.');
    console.error('Example: OPENAI_API_KEY=sk-... node scripts/generatePlaces.js --limit 10');
    process.exit(1);
  }
  return key.trim();
}

function openAIChat(key, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.4,
    });
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error('OpenAI API ' + res.statusCode + ': ' + data));
            return;
          }
          try {
            const j = JSON.parse(data);
            const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
            resolve(content);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildPrompt(city) {
  const name = city.city || 'City';
  const country = city.country || '';
  return `List 12–18 specific, real places to visit in ${name}${country ? ', ' + country : ''}. Include landmarks, museums, neighborhoods, parks, beaches, markets, historic sites, and popular experiences. Use well-known names (e.g. "Queen's Staircase", "Pompey Museum", "Cable Beach"). Return a JSON object with a single key "places" whose value is an array of strings. Example: {"places": ["Place One", "Place Two"]}. No descriptions, only place names.`;
}

async function generatePlacesForCity(key, city) {
  const slug = (city.slug || '').toLowerCase().trim();
  if (!slug) return null;
  const outPath = path.join(CONTENT_DIR, slug + '.json');

  let existing = {};
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (_) {}
  }
  if (!FORCE && existing.best_places && existing.best_places.length >= 8) return 'skip';

  const prompt = buildPrompt(city);
  const raw = await openAIChat(key, [{ role: 'user', content: prompt }]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('Invalid JSON: ' + raw.slice(0, 200));
  }
  const places = Array.isArray(parsed.places)
    ? parsed.places.filter((p) => typeof p === 'string').map((p) => String(p).trim()).filter(Boolean).slice(0, 20)
    : [];
  if (!places.length) throw new Error('No places in response');

  const best_places = places;
  const out = { ...existing, best_places };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  return 'written';
}

async function main() {
  const key = getOpenAIKey();
  if (!fs.existsSync(CITIES_PATH)) {
    console.error('Missing data/cities.json');
    process.exit(1);
  }
  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });

  let cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
  if (SINGLE_SLUG) {
    cities = cities.filter((c) => (c.slug || '').toLowerCase().trim() === SINGLE_SLUG);
    if (!cities.length) {
      console.error('No city found with slug: ' + SINGLE_SLUG);
      process.exit(1);
    }
  } else {
    if (MAJOR_FIRST) {
      const slugNorm = (c) => (c.slug || '').toLowerCase().trim();
      const isMajor = (c) => MAJOR_SLUGS.has(slugNorm(c)) || !!c.popular;
      const major = cities.filter(isMajor);
      const rest = cities.filter((c) => !isMajor(c));
      cities = [...major, ...rest];
      console.log('Major-first order: ' + major.length + ' major/popular, then ' + rest.length + ' rest.');
    }
    if (LIMIT) cities = cities.slice(0, LIMIT);
  }
  console.log('Cities to process: ' + cities.length + (LIMIT ? ' (limit ' + LIMIT + ')' : '') + (SINGLE_SLUG ? ' (slug: ' + SINGLE_SLUG + ')' : '') + (MAJOR_FIRST ? ' [major-first]' : ''));

  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const slug = (city.slug || '').toLowerCase().trim();
    if (!slug) continue;
    try {
      const result = await generatePlacesForCity(key, city);
      if (result === 'written') {
        written++;
        console.log('  [' + (i + 1) + '/' + cities.length + '] ' + slug + '.json');
      } else skipped++;
    } catch (err) {
      errors++;
      console.error('  [' + (i + 1) + '/' + cities.length + '] ERROR ' + slug + ': ' + err.message);
    }
    if (i < cities.length - 1) await new Promise((r) => setTimeout(r, 400));
  }

  console.log('\nDone. Written: ' + written + ', Skipped: ' + skipped + ', Errors: ' + errors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
