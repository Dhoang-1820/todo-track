# AI-200 Tracker

A static, offline-capable tracker and roadmap for a 26-week Microsoft AI-200 study plan.
Plain HTML, CSS and JavaScript. No build step. Progress is stored in the browser (localStorage).

## Run locally
    python3 -m http.server 8000     # then open http://localhost:8000

## Deploy to GitHub Pages (not done yet)
1. Create a repo and copy these files to the root of the `main` branch.
2. Settings > Pages > Source: **GitHub Actions**.
3. Push. `.github/workflows/pages.yml` publishes the site.

## Edit the plan
All content lives in `data.js` (weeks, topics, labs, projects, AI steps). Change the exam week and start date in Settings.

## Files
index.html, styles.css, app.js, data.js, sw.js (offline cache), manifest.webmanifest, icon.svg
