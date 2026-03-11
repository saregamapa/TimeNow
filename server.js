/**
 * TimeNow Global — production server
 * Serves /public, /api/time, /time/:citySlug (dynamic from data/cities.json), /meeting, /countdown, sitemap.xml, robots.txt
 * City pages: reusable template (templates/city.html), dataset (data/cities.json). Scales to 5000+ cities.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
const CONTACT_EMAIL_TO = 'saregamaus@gmail.com';
const DATA_DIR = path.join(__dirname, 'data');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const CITY_CONTENT_DIR = path.join(DATA_DIR, 'city-content');

// --- CITY CONTENT CACHE (loaded on first request per slug, then cached in memory) ---
const CITY_CONTENT_CACHE = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

// --- CITY DATASET (cached in memory for performance, single read at startup) ---
let CITIES_LIST = [];
let CITIES_BY_SLUG = new Map();
try {
  const citiesPath = path.join(DATA_DIR, 'cities.json');
  CITIES_LIST = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));
  CITIES_LIST.forEach((c) => {
    const slug = (c.slug || '').toLowerCase().trim();
    if (slug) CITIES_BY_SLUG.set(slug, c);
  });
  console.log('Loaded ' + CITIES_LIST.length + ' cities from data/cities.json');
} catch (err) {
  console.warn('Could not load data/cities.json:', err.message);
}

// --- TEMPLATES (cached in memory) ---
let CITY_TEMPLATE = '';
let COUNTRY_TEMPLATE = '';
let TIME_DIFF_TEMPLATE = '';
try {
  CITY_TEMPLATE = fs.readFileSync(path.join(TEMPLATES_DIR, 'city.html'), 'utf8');
} catch (err) { console.warn('Could not load templates/city.html:', err.message); }
try {
  COUNTRY_TEMPLATE = fs.readFileSync(path.join(TEMPLATES_DIR, 'country.html'), 'utf8');
} catch (err) { console.warn('Could not load templates/country.html:', err.message); }
try {
  TIME_DIFF_TEMPLATE = fs.readFileSync(path.join(TEMPLATES_DIR, 'time-difference.html'), 'utf8');
} catch (err) { console.warn('Could not load templates/time-difference.html:', err.message); }
let CONTINENT_TEMPLATE = '';
try {
  CONTINENT_TEMPLATE = fs.readFileSync(path.join(TEMPLATES_DIR, 'continent.html'), 'utf8');
} catch (err) { console.warn('Could not load templates/continent.html:', err.message); }

// --- COUNTRY INDEX (from cities: group by country slug for /country/:countrySlug) ---
const CACHE_TTL_MS = 25 * 60 * 1000; // sun cache TTL
const sunCache = new Map();

function toSlug(s) {
  if (typeof s !== 'string') return '';
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

let COUNTRIES_BY_SLUG = new Map();
(function () {
  const byCountry = new Map();
  CITIES_LIST.forEach((c) => {
    const country = (c.country || '').trim();
    if (!country) return;
    const slug = toSlug(country);
    if (!byCountry.has(slug)) byCountry.set(slug, { country, countrySlug: slug, cities: [] });
    byCountry.get(slug).cities.push(c);
  });
  byCountry.forEach((v, k) => COUNTRIES_BY_SLUG.set(k, v));
})();

// --- CONTINENT INDEX (for /continent/:continentSlug — group by continent from cities) ---
let CONTINENTS_BY_SLUG = new Map();
(function () {
  const byContinent = new Map();
  CITIES_LIST.forEach((c) => {
    const continent = (c.continent || '').trim();
    if (!continent) return;
    const slug = toSlug(continent);
    if (!byContinent.has(slug)) byContinent.set(slug, { continent, continentSlug: slug, byCountry: new Map(), cities: [] });
    const entry = byContinent.get(slug);
    entry.cities.push(c);
    const country = (c.country || '').trim();
    if (country) {
      const cs = toSlug(country);
      if (!entry.byCountry.has(cs)) entry.byCountry.set(cs, { country, countrySlug: cs, cities: [] });
      entry.byCountry.get(cs).cities.push(c);
    }
  });
  byContinent.forEach((data, slug) => {
    const countries = Array.from(data.byCountry.values()).sort((a, b) => (a.country || '').localeCompare(b.country || ''));
    CONTINENTS_BY_SLUG.set(slug, { continent: data.continent, continentSlug: slug, countries, cities: data.cities });
  });
})();

/** OpenStreetMap bbox (minLon,minLat,maxLon,maxLat) per continent slug for embed. */
const CONTINENT_BBOX = {
  europe: [-25, 35, 40, 72],
  africa: [-18, -35, 52, 37],
  asia: [60, 10, 150, 75],
  'north-america': [-170, 15, -50, 72],
  'south-america': [-82, -56, -35, 12],
  oceania: [110, -50, 180, 5],
  antarctica: [-180, -90, 180, -60],
};
/** CSS theme class per continent slug (continent-themed colors). */
const CONTINENT_THEME = {
  europe: 'continent-card--europe',
  africa: 'continent-card--africa',
  asia: 'continent-card--asia',
  'north-america': 'continent-card--north-america',
  'south-america': 'continent-card--south-america',
  oceania: 'continent-card--oceania',
  antarctica: 'continent-card--antarctica',
};
function getContinentBbox(slug) {
  const b = CONTINENT_BBOX[(slug || '').toLowerCase()];
  return b ? b.join(',') : '-10,20,30,60';
}
/** Center (lat, lon) of continent bbox for marker. Returns [lat, lon] or null. */
function getContinentCenter(slug) {
  const b = CONTINENT_BBOX[(slug || '').toLowerCase()];
  if (!b || b.length !== 4) return null;
  const centerLat = (b[1] + b[3]) / 2;
  const centerLon = (b[0] + b[2]) / 2;
  return [centerLat, centerLon];
}
function getContinentThemeClass(slug) {
  return CONTINENT_THEME[(slug || '').toLowerCase()] || 'continent-card--default';
}
/** Country bbox from cities (minLon,minLat,maxLon,maxLat) with padding. Returns null if no coords. */
function getCountryBbox(countryData) {
  const cities = countryData && countryData.cities ? countryData.cities : [];
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const c of cities) {
    const lat = c.lat != null ? Number(c.lat) : NaN;
    const lon = c.lng != null ? Number(c.lng) : (c.lon != null ? Number(c.lon) : NaN);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    }
  }
  if (minLat === Infinity) return null;
  const padLat = Math.max(1, (maxLat - minLat) * 0.3);
  const padLon = Math.max(1, (maxLon - minLon) * 0.3);
  return [minLon - padLon, minLat - padLat, maxLon + padLon, maxLat + padLat].join(',');
}
/** ISO 3166-1 alpha-2 (e.g. US) to flag emoji. */
function countryCodeToFlag(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  const a = code.toUpperCase().charCodeAt(0) - 65 + 0x1F1E6;
  const b = code.toUpperCase().charCodeAt(1) - 65 + 0x1F1E6;
  if (a < 0x1F1E6 || a > 0x1F1FF || b < 0x1F1E6 || b > 0x1F1FF) return '';
  return String.fromCodePoint(a, b);
}

/** Send contact form submission to CONTACT_EMAIL_TO. Uses GMAIL_USER + GMAIL_APP_PASSWORD if set. */
function sendContactEmail(data) {
  const fromEmail = process.env.GMAIL_USER || CONTACT_EMAIL_TO;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) return Promise.reject(new Error('Email not configured'));
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: fromEmail, pass }
  });
  const name = (data.name || '').toString().trim() || 'No name';
  const email = (data.email || '').toString().trim() || 'no-email@unknown';
  const subject = (data.subject || '').toString().trim() || 'TimeNow Contact';
  const text = (data.message || '').toString().trim() || '(No message)';
  const body = `Name: ${name}\nEmail: ${email}\n\nMessage:\n${text}`;
  return transporter.sendMail({
    from: `"TimeNow Contact" <${fromEmail}>`,
    to: CONTACT_EMAIL_TO,
    replyTo: email,
    subject: `[TimeNow] ${subject}`,
    text: body
  });
}

// Optional: extra "places to visit" for cities not in JSON (backward compatibility)
const PLACES_BY_SLUG = {
  london: ['Big Ben', 'London Eye', 'Tower Bridge', 'Buckingham Palace', 'Hyde Park', 'British Museum', 'Westminster Abbey', 'Tower of London', 'St Paul\'s Cathedral', 'Natural History Museum', 'Covent Garden', 'Camden Market', 'The Shard', 'Kensington Palace', 'National Gallery', 'Victoria and Albert Museum', 'Science Museum', 'Regent\'s Park', 'Borough Market', 'Shakespeare\'s Globe', 'Hampton Court Palace', 'Greenwich Park', 'Kew Gardens', 'Madame Tussauds', 'London Zoo', 'Churchill War Rooms', 'Imperial War Museum', 'Tate Modern', 'Tate Britain', 'Royal Albert Hall', 'Windsor Castle', 'Stonehenge (day trip)', 'Brick Lane', 'Notting Hill', 'Leicester Square', 'Piccadilly Circus', 'Oxford Street', 'Harrods', 'Sky Garden', 'Thames River Cruise', 'St James\'s Park', 'Hampstead Heath', 'Portobello Road', 'Columbia Road Flower Market', 'Spitalfields Market', 'Dennis Severs\' House', 'Highgate Cemetery', 'Leadenhall Market', 'Neal\'s Yard', 'Little Venice', 'Canary Wharf'],
  paris: ['Eiffel Tower', 'Louvre Museum', 'Notre-Dame Cathedral', 'Arc de Triomphe', 'Champs-Élysées', 'Sacré-Cœur', 'Palace of Versailles', 'Musée d\'Orsay', 'Luxembourg Gardens', 'Seine River Cruise', 'Montmartre', 'Centre Pompidou', 'Sainte-Chapelle', 'Père Lachaise Cemetery', 'Latin Quarter', 'Moulin Rouge', 'Tuileries Garden', 'Place de la Concorde', 'Pont Alexandre III', 'Rodin Museum', 'Orangerie Museum', 'Palais Garnier', 'Catacombs', 'Saint-Germain-des-Prés', 'Le Marais', 'Île de la Cité', 'Place des Vosges', 'Palais Royal', 'Galeries Lafayette', 'Marché aux Puces', 'Jardin des Plantes', 'Panthéon', 'Musée de l\'Orangerie', 'Musée Picasso', 'Conciergerie', 'La Défense', 'Parc des Buttes-Chaumont', 'Canal Saint-Martin', 'Bois de Boulogne', 'Bois de Vincennes', 'Marché d\'Aligre', 'Rue Cler', 'Shakespeare and Company', 'Ladurée', 'Angelina', 'Berthillon', 'Montparnasse Tower', 'Fondation Louis Vuitton', 'La Villette', 'Parc de la Villette', 'Grande Arche'],
  tokyo: ['Senso-ji Temple', 'Shibuya Crossing', 'Tokyo Skytree', 'Meiji Shrine', 'Imperial Palace', 'Tsukiji Outer Market', 'teamLab Borderless', 'Akihabara', 'Harajuku', 'Shinjuku Gyoen', 'Roppongi Hills', 'Ginza', 'Asakusa', 'Odaiba', 'Ueno Park', 'Tokyo Tower', 'Nakameguro', 'Yoyogi Park', 'Robot Restaurant', 'Golden Gai', 'Mori Art Museum', 'teamLab Planets', 'Edo-Tokyo Museum', 'Ghibli Museum', 'Mount Fuji (day trip)', 'Nikko (day trip)', 'Kamakura', 'Disneyland Tokyo', 'DisneySea', 'Kiyosumi Garden', 'Hama Rikyu', 'Rikugien Garden', 'Koishikawa Korakuen', 'Kappabashi Street', 'Ameya Yokocho', 'Omoide Yokocho', 'Kagurazaka', 'Yanaka', 'Nezu Shrine', 'Meguro River', 'Shibuya Sky', 'Tokyo Station', 'Ram Street', 'Pokémon Center', 'Ginza Six', 'Don Quijote', '100 Yen Shops', 'Karaoke', 'Onsen', 'Izakaya', 'Ramen Street'],
  'new-york': ['Statue of Liberty', 'Central Park', 'Empire State Building', 'Times Square', 'Metropolitan Museum of Art', 'Brooklyn Bridge', 'One World Trade Center', 'Museum of Natural History', 'High Line', 'Broadway Show', 'Grand Central Terminal', 'Rockefeller Center', '9/11 Memorial', 'MoMA', 'Chelsea Market', 'DUMBO', 'Williamsburg', 'Greenwich Village', 'SoHo', 'Little Italy', 'Chinatown', 'Fifth Avenue', 'Bryant Park', 'St Patrick\'s Cathedral', 'Lincoln Center', 'Carnegie Hall', 'Madison Square Garden', 'Yankee Stadium', 'Coney Island', 'Coney Island Cyclone', 'Prospect Park', 'Brooklyn Botanic Garden', 'Bronx Zoo', 'Cloisters', 'Ellis Island', 'Staten Island Ferry', 'Top of the Rock', 'Edge Hudson Yards', 'Vessel', 'Washington Square Park', 'Union Square', 'Flatiron Building', 'Chrysler Building', 'Wall Street', 'Battery Park', 'South Street Seaport', 'Chelsea Piers', 'Intrepid Museum', 'Roosevelt Island Tram', 'Smorgasburg'],
  'new-york-city': ['Statue of Liberty', 'Central Park', 'Empire State Building', 'Times Square', 'Metropolitan Museum of Art', 'Brooklyn Bridge', 'One World Trade Center', 'Museum of Natural History', 'High Line', 'Broadway Show', 'Grand Central Terminal', 'Rockefeller Center', '9/11 Memorial', 'MoMA', 'Chelsea Market', 'DUMBO', 'Williamsburg', 'Greenwich Village', 'SoHo', 'Little Italy', 'Chinatown', 'Fifth Avenue', 'Bryant Park', 'St Patrick\'s Cathedral', 'Lincoln Center', 'Carnegie Hall', 'Madison Square Garden', 'Yankee Stadium', 'Coney Island', 'Prospect Park', 'Brooklyn Botanic Garden', 'Bronx Zoo', 'Ellis Island', 'Staten Island Ferry', 'Top of the Rock', 'Edge Hudson Yards', 'Washington Square Park', 'Union Square', 'Flatiron Building', 'Chrysler Building', 'Wall Street', 'Battery Park'],
  berlin: ['Brandenburg Gate', 'Reichstag Building', 'East Side Gallery', 'Museum Island', 'Checkpoint Charlie', 'Berlin Wall Memorial', 'Holocaust Memorial', 'Tiergarten', 'Charlottenburg Palace', 'Alexanderplatz', 'TV Tower', 'Pergamon Museum', 'Gendarmenmarkt', 'Kurfürstendamm', 'Jewish Museum', 'DDR Museum', 'Topography of Terror', 'Sanssouci Palace (Potsdam)', 'Treptower Park', 'Mauerpark', 'Flea Market', 'Berlin Cathedral', 'Victory Column', 'Olympic Stadium', 'Grünewald', 'Spree River Cruise', 'Hackescher Markt', 'Nikolaiviertel', 'KaDeWe', 'Clärchens Ballhaus', 'Berghain', 'Tempelhof Park', 'Street food Thursday', 'Markthalle Neun', 'Teufelsberg', 'Soviet Memorial', 'Bode Museum', 'Alte Nationalgalerie', 'Neues Museum', 'Alte Pinakothek', 'Gemäldegalerie', 'Natural History Museum', 'Aquarium', 'Berlin Zoo', 'Botanical Garden', 'Gardens of the World', 'Treptower Park', 'Plänterwald', 'Spreepark', 'Lake Wannsee', 'Pfaueninsel'],
  sydney: ['Sydney Opera House', 'Harbour Bridge', 'Bondi Beach', 'Royal Botanic Gardens', 'The Rocks', 'Taronga Zoo', 'Darling Harbour', 'Circular Quay', 'Manly Beach', 'Blue Mountains', 'Hunter Valley', 'Featherdale Wildlife Park', 'Luna Park', 'Queen Victoria Building', 'Hyde Park Barracks', 'Australian Museum', 'Powerhouse Museum', 'Sea Life Aquarium', 'WILD LIFE Sydney', 'Barangaroo', 'Mrs Macquarie\'s Chair', 'Watson Bay', 'Watsons Bay Hotel', 'Coogee to Bondi Walk', 'Chinese Garden', 'Sydney Tower Eye', 'St Mary\'s Cathedral', 'Art Gallery of NSW', 'Museum of Contemporary Art', 'Cockatoo Island', 'Palm Beach', 'Northern Beaches', 'Royal National Park', 'Featherdale', 'Scenic World', 'Three Sisters', 'Jenolan Caves', 'Canberra day trip', 'Wine tasting', 'Surf lessons', 'Harbour cruise', 'Vivid Sydney', 'New Year\'s Eve fireworks', 'Sydney Fish Market', 'Paddy\'s Markets', 'Oxford Street', 'Paddington', 'Surry Hills', 'Newtown', 'Bondi Markets'],
  dubai: ['Burj Khalifa', 'Dubai Mall', 'Palm Jumeirah', 'Burj Al Arab', 'Dubai Marina', 'Old Dubai', 'Gold Souk', 'Spice Souk', 'Dubai Fountain', 'Dubai Frame', 'Mall of the Emirates', 'Ski Dubai', 'Desert Safari', 'Dubai Creek', 'Al Fahidi', 'Jumeirah Beach', 'Kite Beach', 'La Mer', 'Global Village', 'Miracle Garden', 'IMG Worlds', 'Dubai Aquarium', 'At the Top', 'Sky Views', 'Ain Dubai', 'Museum of the Future', 'Etihad Museum', 'Al Seef', 'Souk Madinat', 'Madinat Jumeirah', 'Wild Wadi', 'Aquaventure', 'Yas Island (Abu Dhabi)', 'Sheikh Zayed Mosque', 'Louvre Abu Dhabi', 'Ferrari World', 'Warner Bros World', 'Emirates Palace', 'Qasr Al Hosn', 'Heritage Village', 'Hatta', 'Hatta Pools', 'Al Qudra', 'Love Lakes', 'Camel racing', 'Dhow cruise', 'Brunch', 'Rooftop bars', 'Beach clubs', 'Spa'],
  singapore: ['Marina Bay Sands', 'Gardens by the Bay', 'Sentosa Island', 'Merlion Park', 'Singapore Zoo', 'Night Safari', 'River Safari', 'Chinatown', 'Little India', 'Kampong Glam', 'Orchard Road', 'Clarke Quay', 'Singapore Flyer', 'Universal Studios', 'S.E.A. Aquarium', 'ArtScience Museum', 'National Gallery', 'Botanic Gardens', 'East Coast Park', 'Hawker centres', 'Lau Pa Sat', 'Maxwell Food Centre', 'Changi Jewel', 'Jewel Waterfall', 'Haji Lane', 'Bugis Street', 'Arab Street', 'Peranakan houses', 'Raffles Hotel', 'Singapore Sling', 'Helix Bridge', 'Supertree Grove', 'Cloud Forest', 'Flower Dome', 'Fort Canning', 'Southern Ridges', 'MacRitchie Reservoir', 'Pulau Ubin', 'Sri Mariamman Temple', 'Buddha Tooth Relic', 'Thian Hock Keng', 'Marina Bay light show', 'Clarke Quay nightlife', 'Ann Siang Hill', 'Tiong Bahru', 'Dempsey Hill', 'Holland Village', 'Katong', 'Joo Chiat', 'Singapore River cruise'],
  'los-angeles': ['Hollywood Sign', 'Griffith Observatory', 'Santa Monica Pier', 'Universal Studios', 'Disneyland', 'Getty Center', 'Getty Villa', 'Venice Beach', 'Rodeo Drive', 'Beverly Hills', 'Hollywood Walk of Fame', 'TCL Chinese Theatre', 'LACMA', 'The Broad', 'Natural History Museum', 'La Brea Tar Pits', 'Petersen Museum', 'Huntington Library', 'Malibu', 'Zuma Beach', 'Manhattan Beach', 'Long Beach', 'Aquarium of the Pacific', 'Queen Mary', 'Downtown LA', 'Grand Central Market', 'Olvera Street', 'Walt Disney Concert Hall', 'Dodger Stadium', 'Staples Center', 'Runyon Canyon', 'Echo Park', 'Silver Lake', 'Griffith Park', 'Hiking trails', 'Sunset Strip', 'Comedy Store', 'Laugh Factory', 'Rodeo Drive', 'Abbot Kinney', 'The Grove', 'Farmers Market', 'Melrose Avenue', 'MOCA', 'Hammer Museum', 'Norton Simon', 'Huntington Gardens', 'Descanso Gardens', 'South Coast Plaza', 'Catalina Island'],
  bangalore: ['Lalbagh Botanical Garden', 'Cubbon Park', 'Bangalore Palace', 'Tipu Sultan\'s Summer Palace', 'ISKCON Temple', 'Bannerghatta National Park', 'Wonderla', 'UB City Mall', 'Commercial Street', 'MG Road', 'Koramangala', 'Indiranagar', 'Nandi Hills', 'Innovation Film City', 'Vidhana Soudha', 'Visvesvaraya Museum', 'Jawaharlal Nehru Planetarium', 'National Gallery of Modern Art', 'Chunchi Falls', 'Shivanasamudra Falls', 'HAL Heritage Centre', 'Bangalore Fort', 'Bull Temple', 'Dodda Ganesha', 'Art of Living', 'Phoenix Mall', 'Orion Mall', 'Forum Mall', 'Brigade Road', 'Church Street', 'Blossom Book House', 'Indian Music Experience', 'Rangoli Art Centre', 'Guhantara Cave Resort', 'Big Banyan Tree', 'Hebbal Lake', 'Ulsoor Lake', 'Lumbini Gardens', 'Snow City', 'GRS Fantasy Park', 'Innovation Film City', 'Prestige Falcon City', 'Wonderla', 'Jawahar Lal Nehru Planetarium', 'Venkatappa Art Gallery', 'Government Museum', 'Kempegowda Tower', 'Bangalore Turf Club', 'Chinnaswamy Stadium', 'UB City'],
  bengaluru: ['Lalbagh Botanical Garden', 'Cubbon Park', 'Bangalore Palace', 'Tipu Sultan\'s Summer Palace', 'ISKCON Temple', 'Bannerghatta National Park', 'Wonderla', 'UB City Mall', 'Commercial Street', 'MG Road', 'Koramangala', 'Indiranagar', 'Nandi Hills', 'Vidhana Soudha', 'Visvesvaraya Museum', 'Jawaharlal Nehru Planetarium', 'National Gallery of Modern Art', 'Bangalore Fort', 'Bull Temple', 'Art of Living', 'Phoenix Mall', 'Forum Mall', 'Brigade Road', 'Church Street', 'Indian Music Experience', 'Hebbal Lake', 'Ulsoor Lake', 'Lumbini Gardens', 'Government Museum', 'Chinnaswamy Stadium'],
  goa: ['Calangute Beach', 'Baga Beach', 'Anjuna Beach', 'Fort Aguada', 'Basilica of Bom Jesus', 'Se Cathedral', 'Dudhsagar Falls', 'Panaji', 'Fontainhas', 'Anjuna Flea Market', 'Water sports', 'Spice plantations', 'Goan cuisine', 'Casino cruises', 'Chapora Fort', 'Palolem Beach', 'Agonda Beach', 'Mumbai–Goa highway', 'Old Goa', 'Reis Magos Fort', 'Mangeshi Temple', 'Shanta Durga Temple', 'Marine Drive Panaji', 'Cruise on Mandovi', 'Carnival', 'Christmas in Goa'],
  ahmedabad: ['Sabarmati Ashram', 'Sabarmati Riverfront', 'Sidi Saiyyed Mosque', 'Jama Masjid', 'Adalaj Stepwell', 'Kankaria Lake', 'Science City', 'Calico Museum of Textiles', 'Sarkhej Roza', 'Bhadra Fort', 'Law Garden', 'Vastrapur Lake', 'Auto World Vintage Car Museum', 'Swaminarayan Temple (Kalupur)', 'Manek Chowk', 'Rani no Hajiro', 'Gujarat Science City', 'Vishalla', 'Heritage Walk', 'Pols of Old Ahmedabad'],
};
/** Slug aliases for place lookup (e.g. new-york-city -> new-york). */
const PLACES_SLUG_ALIASES = { 'new-york-city': 'new-york', bengaluru: 'bangalore' };
/** Country-level fallback: when a city has no places, show these generic "places to visit" in the country. */
const PLACES_BY_COUNTRY = {
  'India': ['Taj Mahal (Agra)', 'Goa beaches', 'Mumbai', 'Delhi', 'Rajasthan', 'Kerala backwaters', 'Varanasi', 'Darjeeling', 'Rishikesh', 'Hampi', 'Mysore Palace', 'Jaipur', 'Udaipur', 'Amritsar', 'Leh–Ladakh', 'Andaman Islands', 'Ooty', 'Shimla', 'Pondicherry', 'Hampi ruins'],
  'United States': ['Grand Canyon', 'New York City', 'Los Angeles', 'San Francisco', 'Las Vegas', 'Miami', 'Chicago', 'Washington DC', 'National parks', 'Yellowstone', 'Yosemite', 'New Orleans', 'Boston', 'Seattle', 'Austin', 'Nashville', 'Orlando', 'Hawaii', 'Alaska', 'Niagara Falls'],
  'United Kingdom': ['London', 'Stonehenge', 'Edinburgh', 'Bath', 'Lake District', 'York', 'Cambridge', 'Oxford', 'Windsor Castle', 'Scottish Highlands', 'Cornwall', 'Stratford-upon-Avon', 'Canterbury', 'Brighton', 'Liverpool', 'Manchester', 'Belfast', 'Giant\'s Causeway', 'Snowdonia', 'Cotswolds'],
  'France': ['Paris', 'Eiffel Tower', 'Louvre', 'French Riviera', 'Mont Saint-Michel', 'Loire Valley', 'Provence', 'Normandy', 'Chamonix', 'Bordeaux', 'Lyon', 'Strasbourg', 'Versailles', 'Côte d\'Azur', 'Alsace', 'Brittany', 'Corsica', 'Dordogne', 'Champagne', 'Burgundy'],
  'Australia': ['Sydney Opera House', 'Great Barrier Reef', 'Uluru', 'Melbourne', 'Gold Coast', 'Bondi Beach', 'Blue Mountains', 'Kakadu', 'Tasmania', 'Perth', 'Adelaide', 'Cairns', 'Whitsundays', 'Great Ocean Road', 'Daintree', 'Kangaroo Island', 'Barossa Valley', 'Byron Bay', 'Hobart', 'Darwin'],
  'Germany': ['Berlin', 'Neuschwanstein Castle', 'Munich', 'Cologne Cathedral', 'Black Forest', 'Hamburg', 'Frankfurt', 'Dresden', 'Heidelberg', 'Bavarian Alps', 'Romantic Road', 'Christmas markets', 'Rhine Valley', 'Leipzig', 'Nuremberg', 'Rügen', 'Bremen', 'Rothenburg', 'Berchtesgaden', 'Lübeck'],
  'Japan': ['Tokyo', 'Mount Fuji', 'Kyoto', 'Osaka', 'Hiroshima', 'Nara', 'Hokkaido', 'Okinawa', 'Nikko', 'Kamakura', 'Takayama', 'Kanazawa', 'Hakone', 'Miyajima', 'Shibuya', 'Temples and shrines', 'Cherry blossom', 'Onsen', 'Bullet train', 'Japanese cuisine'],
  'China': ['Great Wall', 'Forbidden City', 'Terracotta Army', 'Shanghai', 'Beijing', 'Guilin', 'Zhangjiajie', 'Chengdu pandas', 'Hangzhou', 'Suzhou', 'Hong Kong', 'Lijiang', 'Yangshuo', 'Tibet', 'Xi\'an', 'Yellow Mountains', 'West Lake', 'Pandas', 'Li River', 'Ancient towns'],
  'Brazil': ['Rio de Janeiro', 'Christ the Redeemer', 'Iguazu Falls', 'Amazon', 'Salvador', 'Fernando de Noronha', 'Pantanal', 'São Paulo', 'Brasília', 'Ouro Preto', 'Bonito', 'Lençóis Maranhenses', 'Paraty', 'Florianópolis', 'Fortaleza', 'Manaus', 'Recife', 'Curitiba', 'Foz do Iguaçu', 'Copacabana'],
  'Spain': ['Barcelona', 'Sagrada Familia', 'Madrid', 'Seville', 'Alhambra', 'Valencia', 'Santiago de Compostela', 'Ibiza', 'Granada', 'Toledo', 'Bilbao', 'San Sebastián', 'Córdoba', 'Mallorca', 'Costa del Sol', 'Camino de Santiago', 'Park Güell', 'Prado Museum', 'Flamenco', 'Tapas'],
  'Italy': ['Rome', 'Colosseum', 'Venice', 'Florence', 'Milan', 'Amalfi Coast', 'Cinque Terre', 'Pisa', 'Vatican', 'Pompeii', 'Lake Como', 'Tuscany', 'Naples', 'Siena', 'Verona', 'Turin', 'Capri', 'Sardinia', 'Sicily', 'Dolomites'],
  'Canada': ['Niagara Falls', 'Toronto', 'Vancouver', 'Banff', 'Montreal', 'Quebec City', 'Whistler', 'Rocky Mountains', 'Ottawa', 'Victoria', 'Calgary', 'Jasper', 'Churchill (polar bears)', 'Prince Edward Island', 'Gros Morne', 'Bay of Fundy', 'Algonquin Park', 'CN Tower', 'Stanley Park', 'Old Montreal'],
  'Mexico': ['Cancún', 'Chichen Itza', 'Tulum', 'Mexico City', 'Oaxaca', 'Guanajuato', 'San Miguel de Allende', 'Riviera Maya', 'Cenotes', 'Teotihuacan', 'Copper Canyon', 'Playa del Carmen', 'Los Cabos', 'Guadalajara', 'Mérida', 'Puerto Vallarta', 'Palenque', 'Isla Mujeres', 'Taxco', 'Puebla'],
};

/** Look up city by slug. Returns normalized object including optional SEO fields. */
function getCityBySlug(slug) {
  const s = (slug || '').toLowerCase().trim();
  const c = CITIES_BY_SLUG.get(s);
  if (!c) return null;
  const lat = c.lat != null ? c.lat : null;
  const lng = c.lng != null ? c.lng : null;
  const slugForPlaces = PLACES_SLUG_ALIASES[s] || s;
  const places = (c.touristPlaces && Array.isArray(c.touristPlaces)) ? c.touristPlaces : (c.places && Array.isArray(c.places) ? c.places : (PLACES_BY_SLUG[slugForPlaces] || PLACES_BY_SLUG[s] || []));
  /* Do not use PLACES_BY_COUNTRY here: "Great places to visit in [City]" must show city-specific or generic suggestions, not other cities in the country. */
  const countrySlug = toSlug(c.country || '');
  const continent = c.continent;
  return {
    city: c.city,
    country: c.country || '',
    countrySlug,
    slug: c.slug || s,
    timezone: c.timezone || c.zone || 'UTC',
    zone: c.timezone || c.zone || 'UTC',
    lat,
    lng,
    lon: lng,
    places,
    popular: !!c.popular,
    population: c.population,
    state: c.state,
    continent: continent || '',
    continentSlug: continent ? toSlug(continent) : '',
    countryCode: c.countryCode,
    region: c.region,
    description: c.description,
  };
}

/** Look up country by slug (e.g. united-kingdom). Returns { country, countrySlug, cities, continent?, continentSlug? } or null. */
function getCountryBySlug(countrySlug) {
  const s = (countrySlug || '').toLowerCase().trim();
  const data = COUNTRIES_BY_SLUG.get(s) || null;
  if (data && data.cities && data.cities[0]) {
    const continent = data.cities[0].continent;
    if (continent) {
      data.continent = continent;
      data.continentSlug = toSlug(continent);
    }
  }
  return data;
}

/** Look up continent by slug (e.g. europe). Returns { continent, continentSlug, countries, cities } or null. */
function getContinentBySlug(continentSlug) {
  const s = (continentSlug || '').toLowerCase().trim();
  return CONTINENTS_BY_SLUG.get(s) || null;
}

function serveFile(filePath, res, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', contentType || MIME[path.extname(filePath)] || 'application/octet-stream');
    res.end(data);
  });
}

/** Sunrise/sunset for zone (cached 30 min by zone+date). If lat provided, use latitude-based calculation; else use noon ± 6h. */
function getSunTimesServer(now, zone, lat) {
  const dateKey = now.getUTCFullYear() + '-' + (now.getUTCMonth() + 1) + '-' + now.getUTCDate();
  const cacheKey = zone + '|' + dateKey + '|' + (lat != null ? lat : '');
  const cached = sunCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return cached.data;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true });
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const y = parseInt(p.find(x => x.type === 'year').value, 10);
  const m = parseInt(p.find(x => x.type === 'month').value, 10) - 1;
  const d = parseInt(p.find(x => x.type === 'day').value, 10);
  const offsetParts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now);
  const offsetStr = (offsetParts.find(x => x.type === 'timeZoneName') || {}).value || 'UTC+0';
  const match = offsetStr.match(/([+-])(\d+)(?::(\d+))?/);
  const offsetMin = match ? (match[1] === '+' ? 1 : -1) * (parseInt(match[2], 10) * 60 + (parseInt(match[3], 10) || 0)) : 0;
  const utcMidnight = Date.UTC(y, m, d, 0, 0, 0) - offsetMin * 60 * 1000;

  let sunriseDate;
  let sunsetDate;
  if (lat != null && !Number.isNaN(Number(lat)) && lat >= -90 && lat <= 90) {
    const n = Math.floor((now - new Date(y, 0, 0)) / 86400000);
    const deg = (x) => x * Math.PI / 180;
    const decl = 23.45 * Math.sin(deg(360 * (n + 284) / 365));
    const latRad = deg(Number(lat));
    const decRad = deg(decl);
    const cosHour = (Math.sin(deg(-0.83)) - Math.sin(latRad) * Math.sin(decRad)) / (Math.cos(latRad) * Math.cos(decRad));
    const hourAngle = Math.acos(Math.max(-1, Math.min(1, cosHour))) * 180 / Math.PI / 15;
    const sunriseHour = 12 - hourAngle;
    const sunsetHour = 12 + hourAngle;
    sunriseDate = new Date(utcMidnight + sunriseHour * 3600 * 1000);
    sunsetDate = new Date(utcMidnight + sunsetHour * 3600 * 1000);
  } else {
    sunriseDate = new Date(utcMidnight + 6 * 3600 * 1000);
    sunsetDate = new Date(utcMidnight + 18 * 3600 * 1000);
  }
  const durMs = sunsetDate - sunriseDate;
  const durH = Math.floor(durMs / 3600000);
  const durM = Math.round((durMs % 3600000) / 60000);
  const duration = durH + 'h ' + (durM ? durM + 'm' : '0m');
  const data = { sunrise: fmt.format(sunriseDate), sunset: fmt.format(sunsetDate), duration };
  sunCache.set(cacheKey, { data, exp: Date.now() + CACHE_TTL_MS });
  return data;
}

/** Next DST change (simple iteration) */
function getNextDstChange(now, zone) {
  const long = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'long' }).formatToParts(now).find(p => p.type === 'timeZoneName').value;
  const isDst = /daylight|summer/i.test(long);
  for (let d = 0; d < 400; d++) {
    const next = new Date(now.getTime() + d * 86400000);
    const nextLong = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'long' }).formatToParts(next).find(p => p.type === 'timeZoneName').value;
    if (/daylight|summer/i.test(nextLong) !== isDst) {
      return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(next);
    }
  }
  return null;
}

/** Default cities for "Time difference from [City]" section */
const TIME_DIFF_CITIES = [
  { city: 'New York', zone: 'America/New_York' }, { city: 'Los Angeles', zone: 'America/Los_Angeles' },
  { city: 'Tokyo', zone: 'Asia/Tokyo' }, { city: 'Dubai', zone: 'Asia/Dubai' }, { city: 'Sydney', zone: 'Australia/Sydney' },
  { city: 'Singapore', zone: 'Asia/Singapore' }, { city: 'Berlin', zone: 'Europe/Berlin' }, { city: 'Toronto', zone: 'America/Toronto' },
  { city: 'Delhi', zone: 'Asia/Kolkata' }, { city: 'Bangkok', zone: 'Asia/Bangkok' }, { city: 'Hong Kong', zone: 'Asia/Hong_Kong' },
  { city: 'San Francisco', zone: 'America/Los_Angeles' }, { city: 'Cape Town', zone: 'Africa/Johannesburg' }, { city: 'Rio de Janeiro', zone: 'America/Sao_Paulo' }, { city: 'Moscow', zone: 'Europe/Moscow' },
];

/** Rough distance between two points (lat/lng) for sorting; no need for exact haversine. */
function cityDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const dlat = (lat2 - lat1) * 111; const dlon = (lon2 - lon1) * 111 * Math.cos((lat1 + lat2) * Math.PI / 360);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

/** Build internal links HTML: nearby, popular, major cities, and time difference pages (e.g. London vs New York). */
function getInternalLinksHtml(currentCity) {
  const slug = (currentCity.slug || '').toLowerCase();
  const country = (currentCity.country || '').toLowerCase();
  const cityName = currentCity.city || '';
  const majorSlugs = ['london', 'paris', 'new-york', 'tokyo', 'berlin', 'sydney', 'dubai', 'singapore', 'los-angeles', 'madrid', 'rome', 'amsterdam'];
  const curLat = currentCity.lat != null ? Number(currentCity.lat) : null;
  const curLon = currentCity.lon != null ? Number(currentCity.lon) : (currentCity.lng != null ? Number(currentCity.lng) : null);
  let nearby = CITIES_LIST.filter((c) => {
    const s = (c.slug || '').toLowerCase();
    return s !== slug && (c.country || '').toLowerCase() === country;
  });
  if (curLat != null && curLon != null && nearby.length) {
    const lon = (c) => c.lon != null ? Number(c.lon) : (c.lng != null ? Number(c.lng) : null);
    nearby = nearby.slice().sort((a, b) => cityDistance(curLat, curLon, Number(a.lat), lon(a)) - cityDistance(curLat, curLon, Number(b.lat), lon(b)));
  }
  nearby = nearby.slice(0, 8);
  const popular = CITIES_LIST.filter((c) => (c.slug || '').toLowerCase() !== slug && c.popular).slice(0, 8);
  const major = majorSlugs.filter((s) => s !== slug && CITIES_BY_SLUG.has(s)).slice(0, 8).map((s) => CITIES_BY_SLUG.get(s));

  const linkList = (list, title) => {
    if (!list.length) return '';
    const links = list.map((c) => '<a href="/time/' + escapeHtml(c.slug || c) + '">' + escapeHtml(c.city || c) + '</a>').join(', ');
    return '<div class="internal-links-block"><h3 class="section-title">' + escapeHtml(title) + '</h3><p class="internal-links-list">' + links + '</p></div>';
  };
  const majorLinks = major.map((c) => ({ city: c.city, slug: c.slug }));
  let html = '';
  if (nearby.length) html += linkList(nearby, 'Time in nearby cities');
  if (popular.length) html += linkList(popular, 'Time in major world cities');
  if (majorLinks.length) html += linkList(majorLinks, 'Time in popular cities');
  // Time difference pages: "London vs New York", "London vs Tokyo", etc.
  const vsCities = CITIES_LIST.filter((c) => (c.slug || '').toLowerCase() !== slug && (c.popular || majorSlugs.includes((c.slug || '').toLowerCase()))).slice(0, 10);
  if (vsCities.length) {
    const vsLinks = vsCities.map((c) => {
      const otherSlug = (c.slug || '').toLowerCase();
      const path = '/time-difference/' + slug + '/' + otherSlug;
      return '<a href="' + escapeHtml(path) + '">' + escapeHtml(cityName + ' vs ' + (c.city || '')) + '</a>';
    }).join(', ');
    html += '<div class="internal-links-block"><h3 class="section-title">Time difference</h3><p class="internal-links-list">' + vsLinks + '</p></div>';
  }
  return html || '<p class="muted">Explore more cities from the <a href="/">homepage</a>.</p>';
}

/** Breadcrumbs HTML: Home > Continent > Country > City (SEO + structure). Links continent to /continent/:slug. */
function getBreadcrumbsHtml(data, type) {
  const items = [{ name: 'Home', url: '/' }];
  if (data.continent) items.push({ name: data.continent, url: data.continentSlug ? '/continent/' + data.continentSlug : '#' });
  if (data.country && data.countrySlug) items.push({ name: data.country, url: '/country/' + data.countrySlug });
  if (type === 'city' && data.city) items.push({ name: data.city, url: '#' });
  if (type === 'country' && data.country) items.push({ name: data.country, url: '#' });
  if (type === 'continent' && data.continent) items.push({ name: data.continent, url: '#' });
  const list = items.map((it, i) => i < items.length - 1
    ? '<a href="' + escapeHtml(it.url) + '">' + escapeHtml(it.name) + '</a>'
    : '<span aria-current="page">' + escapeHtml(it.name) + '</span>').join(' <span class="breadcrumb-sep">›</span> ');
  return '<nav class="breadcrumbs" aria-label="Breadcrumb">' + list + '</nav>';
}

/** Structured data for city page: Place, City, BreadcrumbList (SEO). */
function getCityStructuredData(data) {
  const items = [
    { '@context': 'https://schema.org', '@type': 'Place', name: data.city, address: { addressCountry: data.country } },
    { '@context': 'https://schema.org', '@type': 'City', name: data.city, address: { addressCountry: data.country } },
  ];
  const breadcrumbItems = [{ '@type': 'ListItem', position: 1, name: 'Home', item: '/' }];
  if (data.continent && data.continentSlug) breadcrumbItems.push({ '@type': 'ListItem', position: breadcrumbItems.length + 1, name: data.continent, item: '/continent/' + data.continentSlug });
  if (data.country && data.countrySlug) breadcrumbItems.push({ '@type': 'ListItem', position: breadcrumbItems.length + 1, name: data.country, item: '/country/' + data.countrySlug });
  breadcrumbItems.push({ '@type': 'ListItem', position: breadcrumbItems.length + 1, name: data.city });
  items.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: breadcrumbItems });
  return JSON.stringify(items);
}

/** Load city content from data/city-content/<slug>.json. Cached in memory after first load. */
function loadCityContent(slug) {
  const s = (slug || '').toLowerCase().trim();
  if (!s) return null;
  if (CITY_CONTENT_CACHE.has(s)) return CITY_CONTENT_CACHE.get(s);
  const filePath = path.join(CITY_CONTENT_DIR, s + '.json');
  let content = null;
  try {
    if (fs.existsSync(filePath)) {
      content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      CITY_CONTENT_CACHE.set(s, content);
    }
  } catch (err) {
    // ignore parse or read errors
  }
  return content;
}

/** Inject internal links into plain text: continent name -> /continent/slug, country -> /country/slug. */
function injectInternalLinks(text, data) {
  if (typeof text !== 'string' || !text.trim()) return '';
  let out = escapeHtml(text);
  if (data.continent && data.continentSlug) {
    const re = new RegExp('\\b(' + escapeRegex(data.continent) + ')\\b', 'gi');
    out = out.replace(re, '<a href="/continent/' + escapeHtml(data.continentSlug) + '">$1</a>');
  }
  if (data.country && data.countrySlug) {
    const re = new RegExp('\\b(' + escapeRegex(data.country) + ')\\b', 'gi');
    out = out.replace(re, '<a href="/country/' + escapeHtml(data.countrySlug) + '">$1</a>');
  }
  return out;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** About [City] section HTML (full section or empty). */
function getAboutCitySectionHtml(data) {
  const parts = [];
  if (data.description) parts.push('<p>' + escapeHtml(data.description) + '</p>');
  const meta = [];
  if (data.population != null) meta.push('Population: ' + Number(data.population).toLocaleString());
  if (data.country) meta.push('Country: ' + escapeHtml(data.country));
  if (data.continent) meta.push('Continent: ' + escapeHtml(data.continent));
  if (meta.length) parts.push('<p class="city-meta">' + meta.join(' · ') + '</p>');
  if (!parts.length) return '';
  return '<section class="section info-block about-city-section"><h2 class="section-title">About ' + escapeHtml(data.city) + '</h2><div class="info-content">' + parts.join('') + '</div></section>';
}

/** Compact search bar HTML (in header-right, reused on city, country, time-diff pages). */
const SEARCH_BAR_HTML = '<div class="header-search-wrap"><label for="global-search" class="visually-hidden">Search cities</label><input type="text" id="global-search" class="header-search-input" placeholder="Search" autocomplete="off" aria-label="Search cities"/><div id="global-search-results" class="global-search-results" aria-live="polite"></div></div>';
/** Header right: nav links + search + theme + sound (same as frontpage on all pages). */
const HEADER_RIGHT_HTML = '<a href="/continents">Continents</a><a href="/countries">Countries</a><a href="/world-clock">World Clock</a><a href="/tools">Tools</a>' + SEARCH_BAR_HTML + '<button type="button" class="theme-btn" id="theme-btn" title="Toggle theme" aria-label="Toggle dark/light theme">🌙</button><button type="button" class="sound-btn theme-btn" id="sound-btn" title="Clock tick sound" aria-label="Toggle clock tick sound">🔇</button>';
/** Full app header HTML for list pages (continents, countries) that build HTML in server. */
const APP_HEADER_HTML = '<header class="app-header" role="banner"><div class="header-container"><div class="header-left"><a href="/" class="logo" aria-label="TimeNow home">TimeNow</a></div><div class="header-right">' + HEADER_RIGHT_HTML + '</div></div></header>';

/** Render city page from template: replace all {{key}} with values. */
function renderCityPage(data) {
  const { city, country, slug, timezone: zone, lat, places = [], continent, population, description } = data;
  const lon = data.lon != null ? data.lon : data.lng;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const dateStr = now.toLocaleDateString('en-US', { timeZone: zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const offsetParts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now);
  const offset = (offsetParts.find(p => p.type === 'timeZoneName') || {}).value || '';
  const tzShort = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(now).find(p => p.type === 'timeZoneName').value || '';
  const tzLong = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'long' }).formatToParts(now).find(p => p.type === 'timeZoneName').value || zone;
  const sun = getSunTimesServer(now, zone, lat);
  const nextChange = getNextDstChange(now, zone);
  const isDst = /daylight|summer/i.test(tzLong);

  const mapHtml = (lat != null && lon != null)
    ? '<iframe title="' + escapeHtml(city) + ' on map" class="city-map-iframe" src="https://www.openstreetmap.org/export/embed.html?bbox=' + (lon - 0.5) + ',' + (lat - 0.3) + ',' + (lon + 0.5) + ',' + (lat + 0.3) + '&layer=mapnik&marker=' + lat + ',' + lon + '" width="100%" height="320" loading="lazy"></iframe>'
    : '<p class="muted">Map not available.</p>';

  const content = loadCityContent(slug);
  const defaultPlaces = ['City center', 'Local museums', 'Parks and gardens', 'Local cuisine', 'Markets and shopping', 'Historic sites', 'Viewpoints', 'Day trips'];
  const placesToShow = (content && content.best_places && content.best_places.length) ? content.best_places : (places.length ? places : defaultPlaces);
  const placesHtml = placesToShow.slice(0, 50).map((name, i) => '<span class="place-chip place-chip-' + ((i % 10) + 1) + '">' + escapeHtml(name) + '</span>').join('');

  const timeDiffRows = TIME_DIFF_CITIES.map(({ city: c, zone: z }) => ({
    city: c,
    zone: z,
    time: now.toLocaleTimeString('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    diff: diffHours(now, zone, z),
  }));
  const timeDiffTableBody = timeDiffRows.map((r) => '<tr data-zone="' + r.zone + '"><td>' + escapeHtml(r.city) + '</td><td class="diff-time">' + r.time + '</td><td class="diff-diff">' + r.diff + '</td><td><button type="button" class="btn-remove-city" aria-label="Remove">×</button></td></tr>').join('');

  const pageTitle = 'Current Time in ' + city + ' – Local Time, Timezone';
  const metaDescription = 'Current time in ' + city + ', ' + (country || '') + '. View local time, timezone, sunrise and sunset times.';

  const nextChangeText = nextChange ? '<p class="muted">Next change: ' + escapeHtml(nextChange) + ' — switching to ' + (isDst ? 'standard' : 'summer') + ' time.</p>' : '';

  let overviewSectionHtml = '';
  let historySectionHtml = '';
  let economySectionHtml = '';
  let tourismSectionHtml = '';
  let bestPlacesSectionHtml = '';
  let bestRestaurantsSectionHtml = '';
  let faqSectionHtml = '';
  let faqSchemaScript = '';
  if (content) {
    if (content.overview) {
      overviewSectionHtml = '<section class="section info-block city-content-section"><h2 class="section-title">About ' + escapeHtml(city) + '</h2><div class="info-content"><p>' + injectInternalLinks(content.overview, data) + '</p></div></section>';
    }
    if (content.history) {
      historySectionHtml = '<section class="section info-block city-content-section"><h2 class="section-title">History of ' + escapeHtml(city) + '</h2><div class="info-content"><p>' + injectInternalLinks(content.history, data) + '</p></div></section>';
    }
    if (content.economy) {
      economySectionHtml = '<section class="section info-block city-content-section"><h2 class="section-title">Economy</h2><div class="info-content"><p>' + injectInternalLinks(content.economy, data) + '</p></div></section>';
    }
    if (content.tourism) {
      tourismSectionHtml = '<section class="section info-block city-content-section"><h2 class="section-title">Tourism</h2><div class="info-content"><p>' + injectInternalLinks(content.tourism, data) + '</p></div></section>';
    }
    if (content.best_places && content.best_places.length) {
      bestPlacesSectionHtml = '<section class="section info-block city-content-section"><h2 class="section-title">Top places to visit in ' + escapeHtml(city) + '</h2><ul class="best-places-list">' + content.best_places.map((p) => '<li>' + escapeHtml(p) + '</li>').join('') + '</ul></section>';
    }
    if (content.best_restaurants && content.best_restaurants.length) {
      bestRestaurantsSectionHtml = '<section class="section info-block city-content-section"><h2 class="section-title">Best restaurants in ' + escapeHtml(city) + '</h2><ul class="best-restaurants-list">' + content.best_restaurants.map((r) => '<li><strong>' + escapeHtml(r.name) + '</strong>' + (r.description ? ' — ' + escapeHtml(r.description) : '') + '</li>').join('') + '</ul></section>';
    }
    if (content.faqs && content.faqs.length) {
      const faqItems = content.faqs.map((faq, i) => '<div class="faq-item"><button type="button" class="faq-question" aria-expanded="false" aria-controls="faq-ans-' + i + '" id="faq-q-' + i + '" data-faq-id="' + i + '">' + escapeHtml(faq.question) + '</button><div class="faq-answer" id="faq-ans-' + i + '" role="region" aria-labelledby="faq-q-' + i + '">' + escapeHtml(faq.answer) + '</div></div>').join('');
      faqSectionHtml = '<section class="section info-block city-content-section faq-section"><h2 class="section-title">Frequently Asked Questions</h2><div class="faq-accordion">' + faqItems + '</div></section>';
      const faqSchema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: content.faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
      };
      faqSchemaScript = '<script type="application/ld+json">' + JSON.stringify(faqSchema) + '</script>';
    }
  }

  const vars = {
    pageTitle: escapeHtml(pageTitle),
    metaDescription: escapeHtml(metaDescription),
    city: escapeHtml(city),
    country: escapeHtml(country),
    timezone: escapeHtml(zone),
    lat: lat != null ? String(lat) : '',
    lng: lon != null ? String(lon) : '',
    slug: escapeHtml(slug),
    timeStr,
    dateStr,
    tzShort: escapeHtml(tzShort),
    offset: escapeHtml(offset),
    sunrise: escapeHtml(sun.sunrise),
    sunset: escapeHtml(sun.sunset),
    duration: escapeHtml(sun.duration),
    tzLong: escapeHtml(tzLong),
    iana: escapeHtml(zone),
    dstText: isDst ? 'Daylight saving time is in effect.' : 'Standard time.',
    nextChangeText,
    mapHtml,
    timeDiffTableBody,
    placesHtml,
    internalLinksHtml: getInternalLinksHtml(data),
    breadcrumbsHtml: getBreadcrumbsHtml(data, 'city'),
    aboutCitySectionHtml: getAboutCitySectionHtml(data),
    searchBarHtml: SEARCH_BAR_HTML,
    headerRightHtml: HEADER_RIGHT_HTML,
    structuredDataJson: getCityStructuredData(data),
    timezoneJson: JSON.stringify(zone),
    cityJson: JSON.stringify(city),
    countryJson: JSON.stringify(country),
    overviewSectionHtml,
    historySectionHtml,
    economySectionHtml,
    tourismSectionHtml,
    bestPlacesSectionHtml,
    bestRestaurantsSectionHtml,
    faqSectionHtml,
    faqSchemaScript,
  };

  let out = CITY_TEMPLATE;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split('{{' + k + '}}').join(v);
  }
  return out;
}

/** Group cities by first letter (A–Z, 0–9, or "Other") for country page. */
function groupCitiesByLetter(cities) {
  const groups = new Map();
  const sorted = [...cities].sort((a, b) => (a.city || '').localeCompare(b.city || '', undefined, { sensitivity: 'base' }));
  sorted.forEach((c) => {
    const name = (c.city || '').trim();
    const first = name.charAt(0).toUpperCase();
    const key = /[A-Z]/.test(first) ? first : /[0-9]/.test(first) ? '0–9' : 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });
  return groups;
}

/** Render country page: current time in capital (first city), list of cities grouped by first letter. */
function renderCountryPage(countryData) {
  const { country, countrySlug, cities } = countryData;
  const capital = cities[0];
  const zone = capital ? (capital.timezone || 'UTC') : 'UTC';
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const dateStr = now.toLocaleDateString('en-US', { timeZone: zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const capitalName = capital ? capital.city : country;
  const byLetter = groupCitiesByLetter(cities);
  const letters = [...byLetter.keys()].sort((a, b) => (a === 'Other' ? 1 : a === '0–9' ? (b === 'Other' ? -1 : 1) : b === 'Other' || b === '0–9' ? -1 : a.localeCompare(b)));
  const cityListHtml = letters.map((letter) => {
    const list = byLetter.get(letter).map((c) => '<a href="/time/' + escapeHtml(c.slug || '') + '">' + escapeHtml(c.city || '') + '</a>').join(', ');
    return '<div class="country-cities-group"><h3 class="country-cities-group-title">' + escapeHtml(letter) + '</h3><p class="internal-links-list">' + list + '</p></div>';
  }).join('');
  const breadcrumbs = getBreadcrumbsHtml({ country, countrySlug, continent: countryData.continent, continentSlug: countryData.continentSlug }, 'country');
  const pageTitle = 'Current Time in ' + country + ' – Local Time by City';
  const metaDescription = 'Current time in ' + country + '. View local time in ' + capitalName + ' and all cities. Compare time zones.';
  const countryBbox = getCountryBbox(countryData);
  let mapHtml;
  if (countryBbox) {
    const parts = countryBbox.split(',');
    const centerLat = parts.length >= 4 ? (parseFloat(parts[1]) + parseFloat(parts[3])) / 2 : null;
    const centerLon = parts.length >= 4 ? (parseFloat(parts[0]) + parseFloat(parts[2])) / 2 : null;
    let mapUrl = 'https://www.openstreetmap.org/export/embed.html?bbox=' + encodeURIComponent(countryBbox) + '&layer=mapnik';
    if (centerLat != null && centerLon != null && !Number.isNaN(centerLat) && !Number.isNaN(centerLon)) {
      mapUrl += '&marker=' + encodeURIComponent(centerLat + ',' + centerLon);
    }
    mapHtml = '<iframe title="' + escapeHtml(country) + ' on map" class="detail-page-map" src="' + escapeHtml(mapUrl) + '" width="100%" height="360" loading="lazy"></iframe>';
  } else {
    mapHtml = '<p class="muted">Map not available for this country.</p>';
  }
  const countryPlaces = PLACES_BY_COUNTRY[country] || cities.slice(0, 24).map((c) => c.city || '');
  const countryPlacesHtml = countryPlaces.length
    ? countryPlaces.slice(0, 30).map((name, i) => {
        const cityObj = cities.find((c) => (c.city || '').trim() === name.trim());
        if (cityObj && cityObj.slug) return '<a href="/time/' + escapeHtml(cityObj.slug) + '" class="place-chip place-chip-' + ((i % 10) + 1) + '">' + escapeHtml(name) + '</a>';
        return '<span class="place-chip place-chip-' + ((i % 10) + 1) + '">' + escapeHtml(name) + '</span>';
      }).join('')
    : cities.slice(0, 24).map((c, i) => '<a href="/time/' + escapeHtml(c.slug || '') + '" class="place-chip place-chip-' + ((i % 10) + 1) + '">' + escapeHtml(c.city || '') + '</a>').join('');
  const vars = {
    pageTitle: escapeHtml(pageTitle),
    metaDescription: escapeHtml(metaDescription),
    country: escapeHtml(country),
    countryJson: JSON.stringify(country),
    countrySlug: escapeHtml(countrySlug),
    capitalName: escapeHtml(capitalName),
    timeStr,
    dateStr,
    timezoneJson: JSON.stringify(zone),
    cityListHtml,
    countryPlacesHtml,
    mapHtml,
    breadcrumbsHtml: breadcrumbs,
    searchBarHtml: SEARCH_BAR_HTML,
    headerRightHtml: HEADER_RIGHT_HTML,
  };
  let out = COUNTRY_TEMPLATE;
  for (const [k, v] of Object.entries(vars)) out = out.split('{{' + k + '}}').join(v);
  return out;
}

/** Render continent page: countries in continent, major cities, links to city/country pages. */
function renderContinentPage(continentData) {
  const { continent, continentSlug, countries, cities } = continentData;
  const countryListHtml = countries.map((ct) => '<a href="/country/' + escapeHtml(ct.countrySlug || '') + '">' + escapeHtml(ct.country || '') + '</a>').join(', ');
  const majorCities = cities.filter((c) => c.popular).length ? cities.filter((c) => c.popular) : cities.slice(0, 50);
  const cityListHtml = majorCities.slice(0, 80).map((c) => '<a href="/time/' + escapeHtml((c.slug || '').toLowerCase()) + '">' + escapeHtml(c.city || '') + '</a>').join(', ');
  const breadcrumbs = getBreadcrumbsHtml({ continent, continentSlug }, 'continent');
  const pageTitle = 'Current Time in ' + continent + ' – Countries and Cities';
  const metaDescription = 'Current time in ' + continent + '. View countries and major cities. Compare time zones across the continent.';
  const continentBbox = getContinentBbox(continentSlug);
  const center = getContinentCenter(continentSlug);
  let mapUrl = 'https://www.openstreetmap.org/export/embed.html?bbox=' + encodeURIComponent(continentBbox) + '&layer=mapnik';
  if (center) mapUrl += '&marker=' + encodeURIComponent(center[0] + ',' + center[1]);
  const mapHtml = '<iframe title="' + escapeHtml(continent) + ' on map" class="detail-page-map" src="' + escapeHtml(mapUrl) + '" width="100%" height="360" loading="lazy"></iframe>';
  const vars = {
    pageTitle: escapeHtml(pageTitle),
    metaDescription: escapeHtml(metaDescription),
    continent: escapeHtml(continent),
    continentJson: JSON.stringify(continent),
    continentSlug: escapeHtml(continentSlug),
    countryListHtml,
    cityListHtml,
    mapHtml,
    breadcrumbsHtml: breadcrumbs,
    searchBarHtml: SEARCH_BAR_HTML,
    headerRightHtml: HEADER_RIGHT_HTML,
  };
  let out = CONTINENT_TEMPLATE;
  for (const [k, v] of Object.entries(vars)) out = out.split('{{' + k + '}}').join(v);
  return out;
}

/** Working hours overlap (9–17 local): returns { startA, endA, startB, endB } in local times or null. */
function getWorkingOverlap(now, zoneA, zoneB) {
  const fmt = (dt, z) => ({ h: parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', hour12: false }).format(dt), 10), m: 0 });
  const offsetA = getOffsetMinutes(now, zoneA);
  const offsetB = getOffsetMinutes(now, zoneB);
  const diffMin = offsetB - offsetA;
  if (Math.abs(diffMin) >= 8 * 60) return null;
  const startA = 9;
  const endA = 17;
  let startB = 9 - Math.floor(diffMin / 60);
  let endB = 17 - Math.floor(diffMin / 60);
  if (startB < 0) startB += 24;
  if (endB < 0) endB += 24;
  return { startA, endA, startB, endB, diffHours: Math.floor(diffMin / 60) };
}

function getOffsetMinutes(now, zone) {
  const str = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName').value || '';
  const m = str.match(/(?:UTC|GMT)([+-])(\d+)(?::(\d+))?/);
  if (m) return (m[1] === '+' ? 1 : -1) * (parseInt(m[2], 10) * 60 + (parseInt(m[3], 10) || 0));
  return 0;
}

/** Render time-difference page: time in both cities, difference, working hours overlap, example meeting times. */
function renderTimeDiffPage(cityA, cityB) {
  const now = new Date();
  const zoneA = cityA.zone || cityA.timezone;
  const zoneB = cityB.zone || cityB.timezone;
  const timeA = now.toLocaleTimeString('en-GB', { timeZone: zoneA, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const timeB = now.toLocaleTimeString('en-GB', { timeZone: zoneB, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const diff = diffHours(now, zoneA, zoneB);
  const overlap = getWorkingOverlap(now, zoneA, zoneB);
  let overlapHtml = '<p class="muted">Working hours (9:00–17:00 local) overlap varies by time zone.</p>';
  let overlapChartHtml = '';
  if (overlap) {
    overlapHtml = '<p><strong>' + escapeHtml(cityA.city) + '</strong> 9:00–17:00 local. <strong>' + escapeHtml(cityB.city) + '</strong> ' + overlap.startB + ':00–' + (overlap.endB > 24 ? overlap.endB - 24 : overlap.endB) + ':00 local.</p><p>Difference: ' + (overlap.diffHours >= 0 ? '+' : '') + overlap.diffHours + ' hour(s).</p>';
    const rowA = Array.from({ length: 24 }, (_, i) => (i >= 9 && i < 17));
    let startB = overlap.startB;
    let endB = overlap.endB;
    if (startB < 0) startB += 24;
    if (endB < 0) endB += 24;
    if (endB > 24) endB %= 24;
    const rowB = Array.from({ length: 24 }, (_, i) => {
      if (endB > startB) return i >= startB && i < endB;
      return i >= startB || i < endB;
    });
    const cell = (hour, filled) => '<span class="hour-cell' + (filled ? ' work' : '') + '" title="' + hour + ':00">' + hour + '</span>';
    overlapChartHtml = '<div class="overlap-chart" aria-label="Working hours overlap"><div class="overlap-chart-row"><span class="overlap-label">' + escapeHtml(cityA.city) + '</span><div class="overlap-hours">' + rowA.map((f, i) => cell(i, f)).join('') + '</div></div><div class="overlap-chart-row"><span class="overlap-label">' + escapeHtml(cityB.city) + '</span><div class="overlap-hours">' + rowB.map((f, i) => cell(i, f)).join('') + '</div></div><p class="overlap-legend"><span class="hour-cell work"></span> Working hours (9:00–17:00 local)</p></div>';
  }
  const offsetDiffH = (getOffsetMinutes(now, zoneB) - getOffsetMinutes(now, zoneA)) / 60;
  const exampleHours = [9, 12, 17];
  const examplesHtml = exampleHours.map((hA) => {
    const hB = (hA + offsetDiffH + 24) % 24;
    const h = Math.floor(hB);
    const m = Math.round((hB % 1) * 60) || 0;
    const inBStr = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    return escapeHtml(hA + ':00 in ' + cityA.city) + ' = ' + escapeHtml(inBStr) + ' in ' + escapeHtml(cityB.city);
  }).join('<br/>');
  const breadcrumbs = '<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span class="breadcrumb-sep">›</span> <span aria-current="page">' + escapeHtml(cityA.city + ' vs ' + cityB.city) + '</span></nav>';
  const pageTitle = 'Time Difference: ' + cityA.city + ' and ' + cityB.city + ' – Compare Local Time';
  const metaDescription = 'Compare current time in ' + cityA.city + ' and ' + cityB.city + '. Time difference, working hours overlap, and meeting time converter.';
  const vars = {
    pageTitle: escapeHtml(pageTitle),
    metaDescription: escapeHtml(metaDescription),
    pageTitleJson: JSON.stringify(pageTitle),
    metaDescriptionJson: JSON.stringify(metaDescription),
    cityA: escapeHtml(cityA.city),
    cityB: escapeHtml(cityB.city),
    slugA: escapeHtml(cityA.slug),
    slugB: escapeHtml(cityB.slug),
    timeA,
    timeB,
    dateStr: now.toLocaleDateString('en-US', { timeZone: zoneA, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    diffText: escapeHtml(diff),
    overlapHtml,
    overlapChartHtml: overlapChartHtml || '<p class="muted">Chart available when working hours overlap.</p>',
    examplesHtml,
    breadcrumbsHtml: breadcrumbs,
    searchBarHtml: SEARCH_BAR_HTML,
    headerRightHtml: HEADER_RIGHT_HTML,
    zoneAJson: JSON.stringify(zoneA),
    zoneBJson: JSON.stringify(zoneB),
    cityAJson: JSON.stringify(cityA.city),
    cityBJson: JSON.stringify(cityB.city),
  };
  let out = TIME_DIFF_TEMPLATE;
  for (const [k, v] of Object.entries(vars)) out = out.split('{{' + k + '}}').join(v);
  return out;
}

/** 404 page when city slug is not found. */
function city404Html(slug) {
  const s = escapeHtml((slug || '').trim() || 'unknown');
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>City not found | TimeNow</title><link rel="stylesheet" href="/css/main.css"/></head><body><header class="top-bar"><a href="/" class="logo">TimeNow</a></header><main class="main"><section class="section"><h1 class="section-title">City not found</h1><p>We could not find a city with the slug &quot;' + s + '&quot;.</p><p><a href="/">View world clock</a> or search for a city above.</p></section></main><footer class="global-footer"><p class="footer-brand">TimeNow</p><nav class="footer-nav"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a></nav></footer></body></html>';
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function diffHours(now, fromZone, toZone) {
  const from = now.toLocaleString('en-CA', { timeZone: fromZone, hour: 'numeric', minute: 'numeric', hour12: false }).replace(':', '');
  const to = now.toLocaleString('en-CA', { timeZone: toZone, hour: 'numeric', minute: 'numeric', hour12: false }).replace(':', '');
  let fromM = parseInt(from.slice(0, 2), 10) * 60 + parseInt(from.slice(2), 10);
  let toM = parseInt(to.slice(0, 2), 10) * 60 + parseInt(to.slice(2), 10);
  let diff = (toM - fromM + 24 * 60) % (24 * 60);
  if (diff > 12 * 60) diff -= 24 * 60;
  const h = Math.floor(Math.abs(diff) / 60);
  const m = Math.abs(diff) % 60;
  const sign = diff >= 0 ? 'ahead' : 'behind';
  return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + sign;
}

function meetingPageHtml(q) {
  const from = (q.from || 'New York').replace(/[^a-zA-Z]/g, '');
  const to = (q.to || 'London').replace(/[^a-zA-Z]/g, '');
  const time = q.time || '14:00';
  const zoneMap = { NewYork: 'America/New_York', London: 'Europe/London', Tokyo: 'Asia/Tokyo', Sydney: 'Australia/Sydney' };
  const fromZone = zoneMap[from] || 'America/New_York';
  const toZone = zoneMap[to] || 'Europe/London';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Meeting time: ${from} & ${to} | TimeNow</title>
  <link rel="stylesheet" href="/css/main.css"/>
</head>
<body>
  <header class="top-bar"><a href="/" style="color:var(--text);text-decoration:none;">TimeNow</a></header>
  <div class="container">
    <section class="hero">
      <h1 style="font-size:1.25rem;">Meeting: ${time} ${from} → ${to}</h1>
      <p id="from-time">—</p>
      <p id="to-time">—</p>
      <p><a href="/">Meeting planner</a></p>
    </section>
  </div>
  <script>
    const fromZone = ${JSON.stringify(fromZone)};
    const toZone = ${JSON.stringify(toZone)};
    const time = ${JSON.stringify(time)};
    function tick() {
      const dt = new Date();
      document.getElementById('from-time').textContent = fromZone + ': ' + dt.toLocaleTimeString('en-GB', { timeZone: fromZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      document.getElementById('to-time').textContent = toZone + ': ' + dt.toLocaleTimeString('en-GB', { timeZone: toZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
    tick(); setInterval(tick, 1000);
  </script>
</body>
</html>`;
}

function countdownPageHtml(q) {
  const event = (q.event || 'Event').replace(/[<>]/g, '');
  const dateStr = q.date || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Countdown: ${event} | TimeNow</title>
  <link rel="stylesheet" href="/css/main.css"/>
</head>
<body>
  <header class="top-bar"><a href="/" style="color:var(--text);text-decoration:none;">TimeNow</a></header>
  <div class="container">
    <section class="hero">
      <h1 style="font-size:1.25rem;">${event}</h1>
      <div class="time-display" id="countdown">--:--:--</div>
      <p id="countdown-days"></p>
      <p><a href="/">Create countdown</a></p>
    </section>
  </div>
  <script>
    const target = new Date(${JSON.stringify(dateStr)}).getTime();
    function tick() {
      const now = Date.now();
      const diff = Math.max(0, target - now);
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      document.getElementById('countdown').textContent = (h + d * 24).toString().padStart(2,'0') + ':' + m.toString().padStart(2,'0') + ':' + s.toString().padStart(2,'0');
      document.getElementById('countdown-days').textContent = d + ' days until ' + ${JSON.stringify(event)};
    }
    setInterval(tick, 1000); tick();
  </script>
</body>
</html>`;
}

/** Sitemap cache (50k URL cap): regenerated on first request, then cached for 1 hour. */
const SITEMAP_MAX_URLS = 50000;
let sitemapCache = { xml: '', ts: 0 };
const SITEMAP_CACHE_TTL_MS = 60 * 60 * 1000;

/** Generate sitemap.xml: /, /time/:slug, /country/:slug, /continent/:slug, /time-difference/:a/:b. Cap at 50k URLs. */
function getSitemapXml() {
  if (sitemapCache.xml && (Date.now() - sitemapCache.ts < SITEMAP_CACHE_TTL_MS)) return sitemapCache.xml;
  const base = (process.env.BASE_URL || 'https://timenow.example.com').replace(/\/$/, '');
  const urls = [];
  urls.push('<url><loc>' + base + '/</loc><changefreq>hourly</changefreq><priority>1</priority></url>');
  CITIES_LIST.forEach((c) => {
    const slug = (c.slug || '').trim();
    if (slug) urls.push('<url><loc>' + base + '/time/' + encodeURIComponent(slug) + '</loc><changefreq>daily</changefreq><priority>0.8</priority></url>');
  });
  COUNTRIES_BY_SLUG.forEach((_, countrySlug) => {
    urls.push('<url><loc>' + base + '/country/' + encodeURIComponent(countrySlug) + '</loc><changefreq>daily</changefreq><priority>0.7</priority></url>');
  });
  CONTINENTS_BY_SLUG.forEach((_, continentSlug) => {
    urls.push('<url><loc>' + base + '/continent/' + encodeURIComponent(continentSlug) + '</loc><changefreq>daily</changefreq><priority>0.7</priority></url>');
  });
  const popularSlugs = CITIES_LIST.filter((c) => c.popular).map((c) => (c.slug || '').toLowerCase().trim()).filter(Boolean);
  const extra = CITIES_LIST.filter((c) => !c.popular).map((c) => (c.slug || '').toLowerCase().trim()).filter(Boolean);
  let timeDiffSlugs = [...new Set([...popularSlugs, ...extra])];
  const n = timeDiffSlugs.length;
  const pairs = n * (n - 1) / 2;
  const totalSoFar = urls.length;
  if (totalSoFar + pairs > SITEMAP_MAX_URLS) {
    let maxN = 0;
    while (maxN * (maxN - 1) / 2 + totalSoFar <= SITEMAP_MAX_URLS) maxN++;
    maxN = Math.max(1, maxN - 1);
    timeDiffSlugs = timeDiffSlugs.slice(0, maxN);
  }
  for (let i = 0; i < timeDiffSlugs.length; i++) {
    for (let j = i + 1; j < timeDiffSlugs.length; j++) {
      urls.push('<url><loc>' + base + '/time-difference/' + encodeURIComponent(timeDiffSlugs[i]) + '/' + encodeURIComponent(timeDiffSlugs[j]) + '</loc><changefreq>daily</changefreq><priority>0.6</priority></url>');
      if (urls.length >= SITEMAP_MAX_URLS) break;
    }
    if (urls.length >= SITEMAP_MAX_URLS) break;
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.join('') + '</urlset>';
  sitemapCache = { xml, ts: Date.now() };
  return xml;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '', 'http://' + (req.headers.host || 'localhost'));
  const pathname = u.pathname;
  const q = Object.fromEntries(u.searchParams);

  // Header nav redirects: same header on all pages
  if (pathname === '/world-clock') {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }
  if (pathname === '/tools') {
    res.writeHead(302, { Location: '/#more-tools' });
    res.end();
    return;
  }

  // API: server time for NTP-style sync
  if (pathname === '/api/time') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ now: Date.now() }));
    return;
  }

  // API: contact form — POST only, sends email to CONTACT_EMAIL_TO
  if (pathname === '/api/contact') {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        sendContactEmail(data)
          .then(() => {
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, message: 'Message sent.' }));
          })
          .catch((err) => {
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'Could not send message. Please email us directly at ' + CONTACT_EMAIL_TO }));
          });
      } catch (_) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // City page (SEO): dynamic from data/cities.json + templates/city.html
  const cityMatch = pathname.match(/^\/time\/([a-z0-9-]+)\/?$/);
  if (cityMatch) {
    const citySlug = cityMatch[1];
    const cityData = getCityBySlug(citySlug);
    if (cityData && CITY_TEMPLATE) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderCityPage(cityData));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(city404Html(citySlug));
    return;
  }

  // Continent page: /continent/:continentSlug — countries and major cities
  const continentMatch = pathname.match(/^\/continent\/([a-z0-9-]+)\/?$/);
  if (continentMatch) {
    const continentData = getContinentBySlug(continentMatch[1]);
    if (continentData && CONTINENT_TEMPLATE) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderContinentPage(continentData));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><title>Continent not found | TimeNow</title><link rel="stylesheet" href="/css/main.css"/></head><body><header class="top-bar"><a href="/" class="logo">TimeNow</a></header><main class="main"><section class="section"><h1>Continent not found</h1><p><a href="/">Home</a></p></section></main></body></html>');
    return;
  }

  // Country page: /country/:countrySlug — time in country, list of cities
  const countryMatch = pathname.match(/^\/country\/([a-z0-9-]+)\/?$/);
  if (countryMatch) {
    const countryData = getCountryBySlug(countryMatch[1]);
    if (countryData && COUNTRY_TEMPLATE) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderCountryPage(countryData));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><title>Country not found | TimeNow</title><link rel="stylesheet" href="/css/main.css"/></head><body><header class="top-bar"><a href="/" class="logo">TimeNow</a></header><main class="main"><section class="section"><h1>Country not found</h1><p><a href="/">Home</a></p></section></main></body></html>');
    return;
  }

  // List pages: /continents, /countries (card grid with OSM maps)
  if (pathname === '/continents' || pathname === '/continents/') {
    const continentSlugs = Array.from(CONTINENTS_BY_SLUG.keys()).sort();
    const cards = continentSlugs.map((slug) => {
      const data = CONTINENTS_BY_SLUG.get(slug) || {};
      const name = data.continent || slug;
      const bbox = getContinentBbox(slug);
      const themeClass = getContinentThemeClass(slug);
      const mapUrl = 'https://www.openstreetmap.org/export/embed.html?bbox=' + encodeURIComponent(bbox) + '&layer=mapnik';
      return '<article class="continent-card ' + escapeHtml(themeClass) + '"><a href="/continent/' + escapeHtml(slug) + '" class="continent-card__link"><h2 class="continent-card__title">' + escapeHtml(name) + '</h2><div class="continent-card__map-wrap"><iframe title="' + escapeHtml(name) + ' on map" class="continent-card__map" src="' + escapeHtml(mapUrl) + '" loading="lazy"></iframe></div><span class="continent-card__cta">View countries & cities</span></a></article>';
    });
    const gridHtml = '<div class="continents-grid" role="list">' + cards.join('') + '</div>';
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Continents | TimeNow</title><link rel="stylesheet" href="/css/main.css"/></head><body>' + APP_HEADER_HTML + '<main class="main list-page"><section class="section"><h1 class="section-title">Continents</h1>' + gridHtml + '</section></main><footer class="global-footer"><p class="footer-brand">TimeNow</p><nav class="footer-nav"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a></nav></footer><script type="module" src="/js/app.js"></script><script src="/js/search.js" defer></script></body></html>';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  if (pathname === '/countries' || pathname === '/countries/') {
    const countryEntries = Array.from(COUNTRIES_BY_SLUG.entries()).sort((a, b) => (a[1].country || '').localeCompare(b[1].country || ''));
    const cards = countryEntries.map(([, data]) => {
      const name = data.country || '';
      const slug = data.countrySlug || '';
      const flag = countryCodeToFlag(data.cities && data.cities[0] ? data.cities[0].countryCode : '');
      const bbox = getCountryBbox(data);
      const mapPart = bbox ? '<div class="country-card__map-wrap"><iframe title="' + escapeHtml(name) + ' on map" class="country-card__map" src="https://www.openstreetmap.org/export/embed.html?bbox=' + encodeURIComponent(bbox) + '&layer=mapnik" loading="lazy"></iframe></div>' : '';
      return '<article class="country-card" role="listitem"><a href="/country/' + escapeHtml(slug) + '" class="country-card__link"><span class="country-card__flag" aria-hidden="true">' + (flag || '🌐') + '</span><h2 class="country-card__title">' + escapeHtml(name) + '</h2>' + mapPart + '<span class="country-card__cta">View cities</span></a></article>';
    });
    const gridHtml = '<div class="countries-grid" role="list">' + cards.join('') + '</div>';
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Countries | TimeNow</title><link rel="stylesheet" href="/css/main.css"/></head><body>' + APP_HEADER_HTML + '<main class="main list-page"><section class="section"><h1 class="section-title">Countries</h1>' + gridHtml + '</section></main><footer class="global-footer"><p class="footer-brand">TimeNow</p><nav class="footer-nav"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a></nav></footer><script type="module" src="/js/app.js"></script><script src="/js/search.js" defer></script></body></html>';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }

  // Time difference page: /time-difference/:slugA/:slugB
  const timeDiffMatch = pathname.match(/^\/time-difference\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/);
  if (timeDiffMatch) {
    const cityA = getCityBySlug(timeDiffMatch[1]);
    const cityB = getCityBySlug(timeDiffMatch[2]);
    if (cityA && cityB && TIME_DIFF_TEMPLATE) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderTimeDiffPage(cityA, cityB));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><head><title>Not found | TimeNow</title><link rel="stylesheet" href="/css/main.css"/></head><body><header class="top-bar"><a href="/" class="logo">TimeNow</a></header><main class="main"><section class="section"><h1>Page not found</h1><p><a href="/">Home</a></p></section></main></body></html>');
    return;
  }

  // API: list cities for search (minimal: city, country, slug, countrySlug)
  if (pathname === '/api/cities') {
    const list = CITIES_LIST.map((c) => ({ city: c.city, country: c.country, slug: c.slug, countrySlug: toSlug(c.country) }));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(JSON.stringify({ cities: list }));
    return;
  }

  // API: search cities, countries, and time-difference suggestions (?q=...)
  if (pathname === '/api/search') {
    const query = (q.q || '').toLowerCase().trim();
    const results = { cities: [], countries: [], timeDiff: [] };
    if (query.length >= 2) {
      const tokens = query.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      const combined = (c) => [(c.city || ''), (c.country || ''), (c.slug || '')].join(' ').toLowerCase();
      results.cities = CITIES_LIST.filter((c) => {
        const str = combined(c);
        if (str.includes(query)) return true;
        if (tokens.length) return tokens.some((t) => t.length >= 2 && str.includes(t));
        return false;
      }).slice(0, 15).map((c) => ({ city: c.city, country: c.country, slug: c.slug, timezone: c.timezone || '' }));
      const countrySlugSet = new Set();
      const countryMatches = [];
      COUNTRIES_BY_SLUG.forEach((data, slug) => {
        if ((data.country || '').toLowerCase().includes(query) || slug.includes(query)) {
          if (!countrySlugSet.has(slug)) {
            countrySlugSet.add(slug);
            countryMatches.push({ country: data.country, slug });
          }
        }
      });
      results.countries = countryMatches.slice(0, 10);
      const popularSlugs = CITIES_LIST.filter((c) => c.popular).map((c) => (c.slug || '').toLowerCase()).filter(Boolean);
      results.cities.slice(0, 5).forEach((c) => {
        const slug = (c.slug || '').toLowerCase();
        popularSlugs.filter((s) => s !== slug).slice(0, 3).forEach((other) => {
          results.timeDiff.push({ cityA: c.city, cityB: CITIES_BY_SLUG.get(other)?.city, slugA: slug, slugB: other });
        });
      });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.end(JSON.stringify(results));
    return;
  }

  // Meeting planner shareable link
  if (pathname === '/meeting') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(meetingPageHtml(q));
    return;
  }

  // Countdown shareable link
  if (pathname === '/countdown') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(countdownPageHtml(q));
    return;
  }

  if (pathname === '/sitemap.xml') {
    res.setHeader('Content-Type', 'application/xml');
    res.end(getSitemapXml());
    return;
  }

  if (pathname === '/robots.txt') {
    res.setHeader('Content-Type', 'text/plain');
    res.end('User-agent: *\nAllow: /\nSitemap: ' + (process.env.BASE_URL || 'https://timenow.example.com') + '/sitemap.xml\n');
    return;
  }

  // Static file from /public
  let filePath = ROOT + (pathname === '/' ? '/index.html' : pathname);
  if (!path.extname(filePath)) filePath += '.html';
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  serveFile(filePath, res);
});

server.listen(PORT, () => {
  console.log('TimeNow Global at http://localhost:' + PORT);
});
