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

## Question formats
- `bank/d*.json`: the original 400 questions. `bank/course_*.json`: questions written from the AI-200T00 course modules.
- Choice (default): `o` options, `a` indexes of correct options.
- `"t": "order"`: `o` lists the steps in the correct order (shuffled for the learner).
- `"t": "yesno"`: `o` lists statements, `a` lists the indexes that are Yes.
- `"c": "<case id>"`: attaches a case study from `bank/cases.json`. All questions of a case go in the same mock.
- Original question IDs and mocks never change when course questions are added. Some D2 course questions are practice-only (no mock) so mocks keep the exam's 25-30% D2 weight.

## Add or change questions
1. Edit a file in `bank/`.
2. Run `python3 tools/build_bank.py`.
3. Commit and push; GitHub Pages redeploys, then re-seed Supabase from `data/questions.json`.

## Run locally
    python3 -m http.server 8000     # then open http://localhost:8000
