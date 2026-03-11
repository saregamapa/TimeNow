/**
 * Generate public/sitemap.xml in XML Sitemaps format (lastmod + priority).
 * Run: node scripts/generateSitemap.js
 * BASE_URL env or default https://timenow.co.in
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.BASE_URL || 'https://timenow.co.in').replace(/\/$/, '');
const lastmod = new Date().toISOString().slice(0, 19) + '+00:00';

const dataDir = path.join(__dirname, '..', 'data');
const publicDir = path.join(__dirname, '..', 'public');
const citiesPath = path.join(dataDir, 'cities.json');

const cities = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));

function toSlug(s) {
  if (typeof s !== 'string') return '';
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

const countriesBySlug = new Map();
const continentsBySlug = new Map();
cities.forEach((c) => {
  const country = (c.country || '').trim();
  if (country) countriesBySlug.set(toSlug(country), country);
  const continent = (c.continent || '').trim();
  if (continent) continentsBySlug.set(toSlug(continent), continent);
});

const urls = [];

// Static pages
[
  { loc: '/', priority: '1.00' },
  { loc: '/continents', priority: '0.80' },
  { loc: '/countries', priority: '0.80' },
  { loc: '/about', priority: '0.80' },
  { loc: '/privacy', priority: '0.80' },
  { loc: '/terms', priority: '0.80' },
  { loc: '/contact', priority: '0.80' },
].forEach(({ loc, priority }) => {
  urls.push(`<url>\n  <loc>${BASE_URL}${loc}</loc>\n  <lastmod>${lastmod}</lastmod>\n  <priority>${priority}</priority>\n</url>`);
});

// Continents
Array.from(continentsBySlug.keys()).sort().forEach((slug) => {
  urls.push(`<url>\n  <loc>${BASE_URL}/continent/${encodeURIComponent(slug)}</loc>\n  <lastmod>${lastmod}</lastmod>\n  <priority>0.64</priority>\n</url>`);
});

// Countries
Array.from(countriesBySlug.keys()).sort().forEach((slug) => {
  urls.push(`<url>\n  <loc>${BASE_URL}/country/${encodeURIComponent(slug)}</loc>\n  <lastmod>${lastmod}</lastmod>\n  <priority>0.64</priority>\n</url>`);
});

// City pages (/time/:slug)
cities.forEach((c) => {
  const slug = (c.slug || '').toLowerCase().trim();
  if (slug) {
    urls.push(`<url>\n  <loc>${BASE_URL}/time/${encodeURIComponent(slug)}</loc>\n  <lastmod>${lastmod}</lastmod>\n  <priority>0.51</priority>\n</url>`);
  }
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
      xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
            http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${urls.join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), xml, 'utf8');
console.log('Wrote public/sitemap.xml with', urls.length, 'URLs');
