# AI-200 Practice

Practice tests for **Microsoft Exam AI-200: Developing AI Cloud Solutions on Azure**.

- 400 questions written from official Microsoft Learn documentation, each with a detailed explanation and a source link
- 10 mock tests of 40 questions, weighted like the exam (D1 20–25%, D2 25–30%, D3 20–25%, D4 20–25%)
- Smart mixed tests (unseen and previously wrong questions first), single-domain practice, and mistake review
- Score on a 1–1000 scale with 700 to pass, per test and overall, plus a score per domain
- Results stored in Supabase (falls back to the browser when offline)

## How it works
- `bank/*.json` – the authored questions (correct answer listed first) and `bank/sources.json` (Microsoft Learn links)
- `tools/build_bank.py` – validates the bank, shuffles options, assigns ids and mock numbers, writes `data/questions.json`
- `index.html`, `app.js`, `styles.css`, `config.js` – the static app (no build step)
- Supabase tables: `questions`, `attempts`, `attempt_answers`

## Add or change questions
1. Edit a file in `bank/`.
2. Run `python3 tools/build_bank.py`.
3. Commit and push; GitHub Pages redeploys, then re-seed Supabase from `data/questions.json`.

## Run locally
    python3 -m http.server 8000     # then open http://localhost:8000
