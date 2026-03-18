#!/usr/bin/env node
/**
 * Generate AI city content (overview, history, economy, tourism, FAQs) via OpenAI API.
 * Writes data/city-content/<slug>.json. Skips cities that already have a file.
 *
 * Usage: OPENAI_API_KEY=your_key node scripts/generateCityContent.js [--limit N] [--slug X] [--major-first]
 * Env: OPENAI_API_KEY (required).
 *   --limit N       Process only N cities. Default: all cities.
 *   --slug X        Process only the city with slug X (e.g. nassau).
 *   --major-first   Process major world cities first (then remaining cities). Ensures overview/history/FAQs for major cities.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const CITIES_PATH = path.join(ROOT, 'data', 'cities.json');
const CONTENT_DIR = path.join(ROOT, 'data', 'city-content');

// Same major city slugs as server.js (used for "Time in popular cities" and --major-first).
const MAJOR_SLUGS = new Set(['london', 'paris', 'new-york', 'tokyo', 'berlin', 'sydney', 'dubai', 'singapore', 'los-angeles', 'madrid', 'rome', 'amsterdam']);

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : null;
const SINGLE_SLUG = args.includes('--slug') ? (args[args.indexOf('--slug') + 1] || '').toLowerCase().trim() : null;
const MAJOR_FIRST = args.includes('--major-first');

function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key.trim()) {
    console.error('Error: OPENAI_API_KEY environment variable is required.');
    console.error('Example: OPENAI_API_KEY=sk-... node scripts/generateCityContent.js');
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
      temperature: 0.5,
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
  const timezone = city.timezone || 'UTC';
  const population = city.population != null ? String(city.population) : '';
  const continent = city.continent || '';

  return `You are writing factual, SEO-friendly content for a world clock and city info website.

Generate content for the city: ${name}, ${country}.
Timezone: ${timezone}.${population ? ' Population: ' + population + '.' : ''}${continent ? ' Continent: ' + continent + '.' : ''}

Respond with a single JSON object (no markdown, no code fence) with exactly these keys:

"overview": A single paragraph, 120-150 words, introducing the city: its role, location, and why it matters. Factual and engaging.

"history": Exactly 2-3 short sentences (40-60 words total) on the city's history: founding or key historical role. Keep it brief.

"economy": A short paragraph (50-80 words) on economic importance: key industries, business role.

"tourism": A short paragraph (60-90 words) on tourism: main attractions and what visitors do.

"best_places": An array of 4-8 strings: top places to visit (e.g. "Buckingham Palace", "Tower of London"). Names only, no descriptions.

"best_restaurants": An array of 4-6 objects, each with "name" (string) and "description" (one short sentence). Famous or well-known restaurants in the city.

"weather_summary": One short sentence (15-25 words) describing typical weather or climate in the city. Do not use live data; describe generally (e.g. "Mild, rainy winters and warm summers with occasional heat waves.").

"faqs": An array of exactly 5 objects, each with "question" and "answer". Use these topics (one per FAQ):
1. What time zone is ${name} in?
2. Does ${name} observe daylight saving time?
3. What is the population of ${name}?
4. When does sunrise typically occur in ${name}?
5. What is the best time to visit ${name}?

Keep answers concise (1-3 sentences). Be factual. Use the timezone "${timezone}" in the time zone FAQ.`;
}

async function generateForCity(key, city) {
  const slug = (city.slug || '').toLowerCase().trim();
  if (!slug) return null;
  const outPath = path.join(CONTENT_DIR, slug + '.json');
  if (fs.existsSync(outPath)) return 'skip';

  const prompt = buildPrompt(city);
  const raw = await openAIChat(key, [{ role: 'user', content: prompt }]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('Invalid JSON from OpenAI for ' + city.city + ': ' + raw.slice(0, 200));
  }

  const best_places = Array.isArray(parsed.best_places) ? parsed.best_places.filter((p) => typeof p === 'string').map((p) => String(p).trim()).slice(0, 12) : [];
  const best_restaurants = Array.isArray(parsed.best_restaurants)
    ? parsed.best_restaurants
        .filter((r) => r && (typeof r === 'string' || (r.name && typeof r.name === 'string')))
        .slice(0, 8)
        .map((r) => (typeof r === 'string' ? { name: r, description: '' } : { name: String(r.name).trim(), description: typeof r.description === 'string' ? r.description.trim() : '' }))
    : [];
  const out = {
    overview: typeof parsed.overview === 'string' ? parsed.overview.trim() : '',
    history: typeof parsed.history === 'string' ? parsed.history.trim() : '',
    economy: typeof parsed.economy === 'string' ? parsed.economy.trim() : '',
    tourism: typeof parsed.tourism === 'string' ? parsed.tourism.trim() : '',
    best_places,
    best_restaurants,
    weather_summary: typeof parsed.weather_summary === 'string' ? parsed.weather_summary.trim() : '',
    faqs: Array.isArray(parsed.faqs)
      ? parsed.faqs
          .slice(0, 5)
          .filter((f) => f && typeof f.question === 'string' && typeof f.answer === 'string')
          .map((f) => ({ question: String(f.question).trim(), answer: String(f.answer).trim() }))
      : [],
  };

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
      console.log('Major-first order: ' + major.length + ' major/popular cities, then ' + rest.length + ' rest.');
    }
    if (LIMIT) cities = cities.slice(0, LIMIT);
  }
  const list = cities;
  console.log('Cities to process: ' + list.length + (LIMIT ? ' (limit ' + LIMIT + ')' : '') + (SINGLE_SLUG ? ' (slug: ' + SINGLE_SLUG + ')' : '') + (MAJOR_FIRST ? ' [major-first]' : ''));

  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < list.length; i++) {
    const city = list[i];
    const slug = (city.slug || '').toLowerCase().trim();
    if (!slug) continue;
    try {
      const result = await generateForCity(key, city);
      if (result === 'written') {
        written++;
        console.log('  [' + (i + 1) + '/' + list.length + '] Wrote ' + slug + '.json');
      } else skipped++;
    } catch (err) {
      errors++;
      console.error('  [' + (i + 1) + '/' + list.length + '] ERROR ' + slug + ': ' + err.message);
    }
    if ((i + 1) % 100 === 0) console.log('  Progress: ' + (i + 1) + '/' + list.length + ' (written: ' + written + ', skipped: ' + skipped + ', errors: ' + errors + ')');
    if (i < list.length - 1) await new Promise((r) => setTimeout(r, 350));
  }

  console.log('\nDone. Written: ' + written + ', Skipped (existing): ' + skipped + ', Errors: ' + errors);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
