# Deploy TimeNow Global on Render

## 1. Prepare the project

- Ensure `package.json` exists with `"start": "node server.js"`.
- All static assets are under `public/`. The server serves from `public/` and handles routes for `/api/time`, `/time/:city`, `/meeting`, `/countdown`, `sitemap.xml`, `robots.txt`.

## 2. Create a Web Service on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) and sign in.
2. Click **New** → **Web Service**.
3. Connect your Git repo (GitHub/GitLab) or use "Deploy an existing image".
4. Configure:
   - **Name:** `timenow-global` (or any name).
   - **Runtime:** Node.
   - **Build Command:** leave empty (no build step) or `npm install` if you add dependencies.
   - **Start Command:** `npm start` or `node server.js`.
   - **Instance type:** Free or paid.

## 3. Environment variables (optional)

- **PORT** — Render sets this automatically; the server uses `process.env.PORT || 3000`.
- **BASE_URL** — Your public URL, e.g. `https://timenow-global.onrender.com`. Used in `sitemap.xml` and `robots.txt`. If not set, the sitemap uses `https://timenow.example.com`.

## 4. Deploy

- Push to your repo; Render will build and deploy.
- The app will be available at `https://<your-service>.onrender.com`.

## 5. Scale and performance

- For high traffic, use a paid instance and consider a CDN for static assets.
- The server is stateless; scale horizontally by running more instances behind a load balancer.
- `requestAnimationFrame` is used for clock updates to reduce layout thrashing; `/api/time` is used for NTP-style accuracy.

## 6. SEO

- Set **BASE_URL** to your production domain so `sitemap.xml` and `robots.txt` use correct URLs.
- City pages are at `/time/<slug>` (e.g. `/time/new-york`) and include meta tags and schema.org JSON-LD.
- Submit your sitemap in Google Search Console: `https://your-domain.com/sitemap.xml`.

---

## 7. Custom domain (e.g. timenow.co.in on Hostinger)

After the app is live on Render (e.g. `https://timenow-global.onrender.com`), you can use your own domain.

### On Render

1. Open your **Web Service** → **Settings** → **Custom Domains**.
2. Click **Add Custom Domain**.
3. Add **timenow.co.in** (root). Render may also show **www.timenow.co.in**; add it if you want both.
4. Render will show the DNS records you need. Note:
   - **Root (timenow.co.in):** use the **A record** target IP Render shows (e.g. `216.24.57.1`).
   - **www:** use the **CNAME** target (e.g. `timenow-global.onrender.com`).
5. Wait for Render to issue SSL (can take a few minutes after DNS is correct).

### On Hostinger

1. Log in to **hPanel** → **Domains** → select **timenow.co.in** → **DNS / Nameservers** → **DNS records** (or “Manage DNS”).
2. Add or edit records:

   | Type  | Name | Value / Target |
   |-------|------|----------------|
   | **A** | `@`  | `216.24.57.1` (or the IP Render shows for your service) |
   | **CNAME** | `www` | `timenow-global.onrender.com` (your Render service hostname) |

3. Remove any conflicting **A** or **CNAME** for `@` or `www` that point elsewhere.
4. Save. DNS can take a few minutes up to 24 hours to propagate.

### After DNS is live

- In Render **Environment**, set **BASE_URL** = `https://timenow.co.in` so sitemap and robots use the correct domain.
- Visit `https://timenow.co.in` and `https://www.timenow.co.in`; Render will serve HTTPS once the certificate is ready.
