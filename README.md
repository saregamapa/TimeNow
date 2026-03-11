# TimeNow Global

Production-grade world clock and time tools: accurate time sync, SEO city pages, shareable meeting/countdown links, and modular vanilla JS.

## Structure

```
/public
  index.html       # Main app (uses /css, /js)
  /css
    main.css
  /js
    app.js         # Entry (ES modules)
    clock.js       # NTP-style sync, tick loop (requestAnimationFrame)
    cities.js      # City list, slugs, resolveZoneFromCities
    timezone.js    # IANA validation, formatTime, getOffsetStr
    tools.js       # Time diff, event adjuster, jet lag, overlap, relative
    ui.js          # Theme, accordion, city strip, multi-clock
    utils.js
server.js          # Static + /api/time, /time/:city, /meeting, /countdown, sitemap, robots
package.json
DEPLOY.md          # Render deployment
```

## Run locally

```bash
npm start
# or: node server.js
```

Open http://localhost:3000 (or `PORT` env).

## Features

- **Accurate time:** `/api/time` returns server timestamp; client computes offset and shows “Your clock is accurate to ±X ms”.
- **City pages (SEO):** `/time/new-york`, `/time/london`, etc. Meta + schema.org.
- **Shareable links:** `/meeting?time=14:00&from=NewYork&to=London`, `/countdown?event=Launch&date=2026-12-01`.
- **World clocks:** Pin cities, persisted in localStorage; reorder by add/remove.
- **Time tools:** Difference explainer, event adjuster, jet lag, workhours overlap, relative time translator.
- **Accessibility:** ARIA, labels, high-contrast media query.
- **Monetization:** `.ad-slot` placeholder in layout.

## Deploy

See [DEPLOY.md](DEPLOY.md) for Render. Set `BASE_URL` for sitemap/robots.
