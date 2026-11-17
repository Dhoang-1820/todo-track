/* AI-200 practice app: question bank, test runner, scoring and history.
   Questions and attempts live in Supabase; data/questions.json is the fallback copy. */
(function () {
  "use strict";

  const CFG = window.APP_CONFIG;
  const DOMAINS = {
    D1: { name: "Develop containerized solutions", weight: "20–25%", perMock: 9 },
    D2: { name: "AI solutions with Azure data services", weight: "25–30%", perMock: 12 },
    D3: { name: "Connect to and consume Azure services", weight: "20–25%", perMock: 10 },
    D4: { name: "Secure, monitor, and troubleshoot", weight: "20–25%", perMock: 9 }
  };
  const LS_CURRENT = "ai200.current";
  const LS_LOCAL = "ai200.attempts";
  const app = document.getElementById("app");
  const live = document.getElementById("live");

  let bank = [];            // all questions
  let byId = new Map();     // id -> question
  let attempts = [];        // newest first, each with answers:[{question_id, selected, is_correct}]
  let remoteOk = false;
  let timerHandle = null;
  let keyHandler = null;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const scaled = (correct, total) => (total ? Math.round((correct / total) * 1000) : 0);
  const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);
  const fmtTime = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
  const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const fmtShortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); }));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  // "order" questions: correct = keys in sequence. "yesno": correct[i] is "Y"/"N" for statement i.
  const slotType = (q) => q.type === "match" || q.type === "fill";
  const seqType = (q) => q.type === "order" || q.type === "yesno" || slotType(q);
  const isRight = (q, sel) => seqType(q) ? sel.length === q.correct.length && sel.every((x, i) => x === q.correct[i]) : sameSet(sel, q.correct);
  const isDone = (q, sel) => !!sel && (slotType(q) ? sel.length === q.slots.length && sel.every(Boolean) : q.type === "yesno" ? sel.length === q.options.length && sel.every(Boolean) : q.type === "order" ? sel.length === q.options.length : sel.length > 0);
  // Points like the real exam: each correct selection in multi-select, yes/no, match, and fill questions is worth one point.
  const points = (q, sel) => {
    sel = sel || [];
    if (slotType(q) || q.type === "yesno") return [q.correct.filter((c, i) => sel[i] === c).length, q.correct.length];
    if (q.type === "multi") return [sel.filter((k) => q.correct.includes(k)).length, q.correct.length]; // selections are capped at the number required
    return [isRight(q, sel) ? 1 : 0, 1];
  };
  const caseBlock = (q, open) => q.case_text ? `<details class="case" ${open ? "open" : ""}><summary>Case study: ${esc(q.case_title || "")}</summary>${q.case_text.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}</details>` : "";
  const isFull = (a) => a.mode === "mock" || a.mode === "random";
  const skillName = (code) => (bank.find((q) => q.skill === code) || {}).skill_name || code;
  const modeLabel = (a) => a.mode === "mock" ? `Mock test ${a.mock}` : a.mode === "domain" ? `${a.domain} practice`
    : a.mode === "skill" ? `Skill drill: ${skillName(a.skill)}` : a.mode === "review" ? "Mistake review" : "Smart mixed test";
  const announce = (msg) => { if (live) { live.textContent = ""; setTimeout(() => (live.textContent = msg), 50); } };
  const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !["radio", "checkbox"].includes(e.target.type);

  /* ---------- Supabase REST ---------- */
  async function api(path, opts = {}) {
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
      ...opts,
      headers: { apikey: CFG.supabaseKey, Authorization: `Bearer ${CFG.supabaseKey}`, "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }
  async function apiAll(path) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const rows = await api(path, { headers: { Range: `${from}-${from + size - 1}`, "Range-Unit": "items" } });
      out.push(...rows);
      if (rows.length < size) return out;
    }
  }

  async function loadBank() {
    try {
      const rows = await apiAll("questions?select=*&order=id");
      if (rows.length) { remoteOk = true; return rows; }
    } catch (e) { console.warn("Supabase questions unavailable, using bundled bank", e); }
    const res = await fetch("data/questions.json", { cache: "no-cache" });
    return (await res.json()).questions;
  }

  async function loadAttempts() {
    const local = lsGet(LS_LOCAL, []);
    let remote = [];
    try {
      const [rows, answers] = await Promise.all([
        apiAll("attempts?select=*&order=submitted_at.desc"),
        apiAll("attempt_answers?select=attempt_id,question_id,selected,is_correct")
      ]);
      const grouped = new Map();
      answers.forEach((a) => { if (!grouped.has(a.attempt_id)) grouped.set(a.attempt_id, []); grouped.get(a.attempt_id).push(a); });
      remote = rows.map((r) => ({ ...r, answers: grouped.get(r.id) || [], synced: true }));
      remoteOk = true;
    } catch (e) { console.warn("Supabase attempts unavailable", e); }
    const ids = new Set(remote.map((r) => r.id));
    const pending = local.filter((a) => !ids.has(a.id));
    for (const a of pending) { if (await pushAttempt(a)) a.synced = true; }
    const merged = [...remote, ...pending].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
    lsSet(LS_LOCAL, merged.filter((a) => !a.synced));
    return merged;
  }

  async function pushAttempt(a) {
    try {
      const { answers, synced, flags, order, ...row } = a;
      await api("attempts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
      await api("attempt_answers", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(answers.map((x) => ({ attempt_id: a.id, question_id: x.question_id, selected: x.selected, is_correct: x.is_correct }))) });
      return true;
    } catch (e) { console.warn("Could not save attempt to Supabase", e); return false; }
  }

  /* ---------- statistics ---------- */
  function questionStats() {
    const latest = new Map(); const seen = new Map();
    for (const a of attempts) for (const ans of a.answers) {
      seen.set(ans.question_id, (seen.get(ans.question_id) || 0) + 1);
      if (!latest.has(ans.question_id)) latest.set(ans.question_id, ans.is_correct);
    }
    return { latest, seen };
  }

  function domainBreakdown(items) {
    const d = {}; Object.keys(DOMAINS).forEach((k) => (d[k] = { correct: 0, total: 0 }));
    items.forEach(({ q, ok }) => { d[q.domain].total++; if (ok) d[q.domain].correct++; });
    return d;
  }

  function skillBreakdown(stats) {
    const s = new Map();
    for (const [id, ok] of stats.latest) {
      const q = byId.get(id); if (!q || !q.skill) continue;
      const v = s.get(q.skill) || { skill: q.skill, name: q.skill_name || q.skill, domain: q.domain, correct: 0, total: 0, pool: 0 };
      v.total++; if (ok) v.correct++; s.set(q.skill, v);
    }
    bank.forEach((q) => { if (s.has(q.skill)) s.get(q.skill).pool++; });
    return [...s.values()];
  }

  /* ---------- learning model: first attempts and spaced repetition ---------- */
  const DAY = 86400000, INTERVALS = [1, 3, 7];
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const optOrder = (o, q) => { if (q.type === "yesno" || slotType(q)) return q.options; const ord = o && o.order && o.order[q.id]; return ord ? ord.map((k) => q.options.find((x) => x.key === k)).filter(Boolean) : q.options; };

  function learning() {
    const seen = new Set(), fresh = [], srs = new Map();
    const chron = attempts.slice().sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    for (const a of chron) {
      const day = dayStart(Date.parse(a.submitted_at));
      for (const ans of a.answers) {
        const id = ans.question_id;
        if (!byId.has(id)) continue;
        if (!seen.has(id)) { seen.add(id); fresh.push(ans.is_correct); }
        const st = srs.get(id);
        if (!ans.is_correct) srs.set(id, { box: 0, day, due: day + INTERVALS[0] * DAY });
        else if (st && st.box < 3 && st.day !== day) { st.box++; st.day = day; st.due = st.box < 3 ? day + INTERVALS[st.box] * DAY : Infinity; }
      }
    }
    const now = Date.now(), states = [...srs.entries()];
    const recent = fresh.slice(-80);
    return {
      fresh, recent,
      estimate: recent.length >= 20 ? scaled(recent.filter(Boolean).length, recent.length) : null,
      due: states.filter(([, x]) => x.due <= now).map(([id]) => id),
      learningN: states.filter(([, x]) => x.box < 3).length,
      mastered: states.filter(([, x]) => x.box === 3).length,
      seenAll: seen.size >= bank.length
    };
  }

  function readiness(L) {
    if (L.fresh.length < 40) return { label: `Answer ${40 - L.fresh.length} more new questions to see readiness`, cls: "" };
    const e = L.estimate, n = L.recent.length, tail = L.seenAll ? " · all questions seen" : "";
    if (e >= 750) return { label: `Exam ready: ${e} on your last ${n} first attempts${tail}`, cls: "pass" };
    if (e >= CFG.passScore) return { label: `Close: ${e} on your last ${n} first attempts${tail}`, cls: "near" };
    return { label: `Keep practicing: ${e} on your last ${n} first attempts${tail}`, cls: "fail" };
  }

  /* ---------- test generation ---------- */
  function pick(pool, n, stats) {
    const tier = (q) => (!stats.seen.has(q.id) ? 0 : stats.latest.get(q.id) === false ? 1 : 2);
    return shuffle(pool).sort((a, b) => tier(a) - tier(b)).slice(0, n);
  }

  function generate(opts) {
    const stats = questionStats();
    let qs = [], minutes = 0;
    if (opts.mode === "mock") { qs = shuffle(bank.filter((q) => q.mock === opts.mock)); minutes = CFG.mockMinutes; }
    else if (opts.mode === "random") {
      for (const [d, info] of Object.entries(DOMAINS)) qs.push(...pick(bank.filter((q) => q.domain === d), info.perMock, stats));
      qs = shuffle(qs); minutes = CFG.mockMinutes;
    } else if (opts.mode === "domain") { qs = pick(bank.filter((q) => q.domain === opts.domain), opts.count, stats); minutes = qs.length * 3; }
    else if (opts.mode === "skill") { qs = pick(bank.filter((q) => q.skill === opts.skill), opts.count || 10, stats); minutes = qs.length * 3; }
    else if (opts.mode === "review") {
      const pool = opts.ids ? opts.ids.map((id) => byId.get(id)).filter(Boolean) : bank.filter((q) => stats.latest.get(q.id) === false);
      qs = shuffle(pool).slice(0, opts.count || 40); minutes = qs.length * 3;
    }
    if (!qs.length) return null;
    const study = !!opts.study;
    return {
      id: uuid(), mode: opts.mode, mock: opts.mock || null, domain: opts.domain || null, skill: opts.skill || null,
      ids: qs.map((q) => q.id), answers: {}, flags: {}, checked: {}, index: 0, study, follow: {},
      order: Object.fromEntries(qs.map((q) => [q.id, shuffle(q.options.map((o) => o.key))])),
      timed: !study && opts.timed !== false, limitSec: minutes * 60, startedAt: Date.now()
    };
  }

  function startTest(t) {
    if (!t) { alert("No questions available for this choice yet."); return; }
    const cur = lsGet(LS_CURRENT, null);
    if (cur && !confirm("Start a new test? Your test in progress will be discarded.")) return;
    lsSet(LS_CURRENT, t); location.hash = "#/test";
  }

  /* ---------- views ---------- */
  function setView(html) {
    clearInterval(timerHandle);
    if (keyHandler) { document.removeEventListener("keydown", keyHandler); keyHandler = null; }
    app.innerHTML = html; window.scrollTo(0, 0);
  }

  function bar(value, passLine, label) {
    return `<div class="bar" role="img" aria-label="${esc(label || value + "%")}"><div class="fill ${value >= passLine ? "good" : "low"}" style="width:${value}%"></div><div class="passline" style="left:${passLine}%"></div></div>`;
  }

  function trendChart() {
    const pts = attempts.filter(isFull).slice(0, 12).reverse();
    if (pts.length < 2) return `<p class="muted small">Your score trend appears after 2 full tests (mock or smart mixed).</p>`;
    const W = 600, H = 170, L = 34, R = 10, T = 12, B = 26;
    const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
    const y = (v) => T + (1 - v / 1000) * (H - T - B);
    const line = pts.map((a, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(a.score).toFixed(1)}`).join(" ");
    const summary = pts.map((a) => `${modeLabel(a)} ${a.score}`).join(", ");
    return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score trend, oldest to newest: ${esc(summary)}">
      ${[0, 500, 1000].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join("")}
      <line x1="${L}" x2="${W - R}" y1="${y(CFG.passScore)}" y2="${y(CFG.passScore)}" class="pass"/><text x="${W - R}" y="${y(CFG.passScore) - 5}" class="axis" text-anchor="end">pass ${CFG.passScore}</text>
      <path d="${line}" class="line"/>
      ${pts.map((a, i) => `<circle cx="${x(i)}" cy="${y(a.score)}" r="4" class="${a.passed ? "pt good" : "pt bad"}"><title>${esc(modeLabel(a))} · ${fmtShortDate(a.submitted_at)} · ${a.score}</title></circle>`).join("")}
      <text x="${L}" y="${H - 6}" class="axis">${fmtShortDate(pts[0].submitted_at)}</text>
      <text x="${W - R}" y="${H - 6}" class="axis" text-anchor="end">${fmtShortDate(pts[pts.length - 1].submitted_at)}</text>
    </svg>`;
  }

  function renderDashboard() {
    const stats = questionStats();
    const current = lsGet(LS_CURRENT, null);
    const passLine = CFG.passScore / 10;
    const answered = [...stats.latest.entries()].map(([id, ok]) => ({ q: byId.get(id), ok })).filter((x) => x.q);
    const dom = domainBreakdown(answered);
    const overall = scaled(answered.filter((x) => x.ok).length, answered.length);
    const scores = attempts.map((a) => a.score);
    const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : 0;
    const passed = attempts.filter((a) => a.passed).length;
    const wrongCount = [...stats.latest.values()].filter((v) => v === false).length;
    const bestMock = {};
    attempts.filter((a) => a.mode === "mock").forEach((a) => { bestMock[a.mock] = Math.max(bestMock[a.mock] || 0, a.score); });
    const weak = skillBreakdown(stats).filter((s) => s.total >= 2).sort((a, b) => a.correct / a.total - b.correct / b.total || b.total - a.total).slice(0, 5);
    const L = learning();
    const ready = readiness(L);

    setView(`
      ${current ? `<div class="banner"><span>Test in progress: <b>${esc(modeLabel(current))}</b>, ${current.ids.filter((id) => byId.get(id) && isDone(byId.get(id), current.answers[id] || [])).length}/${current.ids.length} answered.</span><span><a class="btn small primary" href="#/test">Resume</a> <button class="btn small ghost" id="discard">Discard</button></span></div>` : ""}
      <section class="hero">
        <div>
          <h1>Exam AI-200 practice</h1>
          <p class="muted">Developing AI Cloud Solutions on Azure · ${bank.length} questions${bank.some((q) => q.origin === "upload") ? " (including your uploads)" : ""} · 10 mock tests of 40 questions</p>
        </div>
        <div class="overall ${L.estimate === null ? "" : L.estimate >= CFG.passScore ? "pass" : "fail"}">
          <div class="big">${L.estimate ?? "—"}</div>
          <div class="small">Estimated exam score<br>${L.estimate === null ? "Answer 20 new questions to see it" : `first attempts only · ${L.estimate >= CFG.passScore ? "✓ above" : "✗ below"} ${CFG.passScore}`}</div>
        </div>
      </section>

      <section class="grid4">
        <div class="stat"><b>${attempts.length}</b><span>Tests taken</span></div>
        <div class="stat"><b>${attempts.length ? avg : "—"}</b><span>Average test score</span></div>
        <div class="stat"><b>${attempts.length ? pct(passed, attempts.length) + "%" : "—"}</b><span>Tests passed</span></div>
        <div class="stat"><b>${stats.latest.size}/${bank.length}</b><span>Questions seen</span></div>
      </section>

      <section class="card srs">
        <div class="rowhead"><h2>Spaced review</h2>${L.due.length ? `<button class="btn primary" id="srsStart">Review ${Math.min(40, L.due.length)} due now</button>` : ""}</div>
        <p class="small">${L.due.length ? `<b>${L.due.length}</b> question${L.due.length > 1 ? "s are" : " is"} due for review today.` : L.learningN ? "Nothing due today. Come back tomorrow." : "Questions you get wrong will come back here to review."} <span class="muted">Learning: ${L.learningN} · Mastered: ${L.mastered}</span></p>
        <p class="muted small">A wrong answer comes back the next day. Each correct answer on a later day pushes it out to 3, then 7 days; the third correct day marks it mastered.</p>
      </section>

      <section class="card">
        <h2>Generate questions</h2>
        <div class="seg" role="radiogroup" aria-label="Test type">
          <button role="radio" aria-checked="true" data-mode="mock" class="on">Full mock test</button>
          <button role="radio" aria-checked="false" data-mode="random">Smart mixed test</button>
          <button role="radio" aria-checked="false" data-mode="domain">One domain</button>
          <button role="radio" aria-checked="false" data-mode="review">Review mistakes</button>
        </div>
        <div id="modeOpts"></div>
        <label class="check studychk"><input type="checkbox" id="studyChk"> <span><b>Study mode</b>: check each answer and see the explanation right away (no timer)</span></label>
        <button class="btn primary wide" id="gen">Generate questions</button>
      </section>

      <section class="card">
        <div class="rowhead"><h2>Progress</h2><span class="ready ${ready.cls}">${esc(ready.label)}</span></div>
        ${trendChart()}
      </section>

      <section class="card">
        <h2>Weakest skills</h2>
        ${weak.length ? `<p class="muted small">Skills you've answered at least twice, weakest first. Drills use Study mode.</p>
          <ul class="weak">${weak.map((s) => { const v = pct(s.correct, s.total); return `<li>
            <div class="weakhead"><span><span class="tag">${s.domain}</span> ${esc(s.name)}</span><span class="${v >= passLine ? "okc" : "errc"}">${v}% · ${s.correct}/${s.total}</span></div>
            <div class="weakrow">${bar(v, passLine, `${s.name}: ${v}% correct`)}<button class="btn small" data-drill="${esc(s.skill)}">Drill ${Math.min(10, s.pool)}</button></div></li>`; }).join("")}</ul>`
          : `<p class="muted small">After a test or two, your weakest skills show up here with a one-click drill.</p>`}
      </section>

      <section class="card">
        <h2>Mastery by exam domain</h2>
        <p class="muted small">Based on your most recent answer to each question. The marker shows the 70% pass line.</p>
        ${Object.entries(DOMAINS).map(([k, d]) => { const v = pct(dom[k].correct, dom[k].total); return `
          <div class="domrow">
            <div class="domhead"><span><b>${k}</b> ${esc(d.name)} <span class="muted">(${d.weight})</span></span><span>${dom[k].total ? v + "% · " + dom[k].correct + "/" + dom[k].total : "not started"}</span></div>
            ${bar(dom[k].total ? v : 0, passLine, `${k}: ${dom[k].total ? v + "% correct" : "not started"}`)}
          </div>`; }).join("")}
      </section>

      <section class="card">
        <h2>Mock tests</h2>
        <div class="mocks">
          ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => { const b = bestMock[n]; return `
            <button class="mock ${b === undefined ? "" : b >= CFG.passScore ? "pass" : "fail"}" data-mock="${n}">
              <span>Mock ${n}</span><b>${b === undefined ? "Not taken" : `${b >= CFG.passScore ? "✓" : "✗"} Best ${b}`}</b>
            </button>`; }).join("")}
        </div>
      </section>
      ${remoteOk ? "" : `<p class="muted small center">Offline mode: results are saved in this browser and will sync when the database is reachable.</p>`}
    `);

    let mode = "mock";
    const opts = document.getElementById("modeOpts"), studyChk = document.getElementById("studyChk");
    const nextMock = (Array.from({ length: 10 }, (_, i) => i + 1).find((n) => bestMock[n] === undefined)) || 1;
    function drawOpts() {
      studyChk.checked = mode === "domain" || mode === "review";
      if (mode === "mock") opts.innerHTML = `<label>Mock test <select id="mockSel">${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${i + 1 === nextMock ? "selected" : ""}>Mock ${i + 1}${bestMock[i + 1] !== undefined ? " (best " + bestMock[i + 1] + ")" : ""}</option>`).join("")}</select></label><p class="muted small">About ${Math.round(bank.filter((q) => q.mock).length / 10)} questions in exam proportions, including case studies, ordering, and yes/no sets, with a 120-minute timer, like the real exam.</p>`;
      if (mode === "random") opts.innerHTML = `<p class="muted small">40 questions in exam proportions, picked from questions you haven't seen yet first, then ones you got wrong. 120-minute timer.</p>`;
      if (mode === "domain") opts.innerHTML = `<label>Domain <select id="domSel">${Object.entries(DOMAINS).map(([k, d]) => `<option value="${k}">${k} · ${esc(d.name)}</option>`).join("")}</select></label><label>Questions <select id="cntSel"><option>10</option><option selected>20</option><option>40</option></select></label>`;
      if (mode === "review") opts.innerHTML = wrongCount ? `<p class="muted small">${wrongCount} question${wrongCount > 1 ? "s" : ""} you last answered incorrectly (up to 40 per test).</p>` : `<p class="muted small">No mistakes to review yet. Take a test first.</p>`;
    }
    drawOpts();
    document.querySelectorAll(".seg button").forEach((b) => b.onclick = () => {
      document.querySelectorAll(".seg button").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
      b.classList.add("on"); b.setAttribute("aria-checked", "true"); mode = b.dataset.mode; drawOpts();
    });
    document.getElementById("gen").onclick = () => {
      const study = studyChk.checked;
      if (mode === "mock") startTest(generate({ mode, mock: +document.getElementById("mockSel").value, study }));
      if (mode === "random") startTest(generate({ mode, study }));
      if (mode === "domain") startTest(generate({ mode, domain: document.getElementById("domSel").value, count: +document.getElementById("cntSel").value, study, timed: false }));
      if (mode === "review") startTest(generate({ mode, count: 40, study, timed: false }));
    };
    document.querySelectorAll(".mock").forEach((b) => b.onclick = () => startTest(generate({ mode: "mock", mock: +b.dataset.mock })));
    document.querySelectorAll("[data-drill]").forEach((b) => b.onclick = () => startTest(generate({ mode: "skill", skill: b.dataset.drill, count: 10, study: true })));
    const srsBtn = document.getElementById("srsStart");
    if (srsBtn) srsBtn.onclick = () => startTest(generate({ mode: "review", ids: L.due, count: 40, study: true, timed: false }));
    const discard = document.getElementById("discard");
    if (discard) discard.onclick = () => { if (confirm("Discard the test in progress?")) { lsDel(LS_CURRENT); renderDashboard(); } };
  }

  const optText = (q, k) => { const o = q.options.find((x) => x.key === k); return o ? o.text : ""; };
  function slotSelect(q, i, mine, checked) {
    const keys = q.slots[i].keys || q.options.map((o) => o.key), right = q.correct[i];
    const state = checked ? (mine === right ? "right" : "wrong") : "";
    return `<select class="slotsel ${state}" data-slot="${i}" aria-label="${esc(q.type === "fill" ? "Blank " + (i + 1) : q.slots[i].text)}" ${checked ? "disabled" : ""}>
      <option value="">${q.type === "fill" ? "Blank " + (i + 1) + "…" : "Choose…"}</option>
      ${keys.map((k) => `<option value="${k}" ${mine === k ? "selected" : ""}>${esc(optText(q, k))}</option>`).join("")}
    </select>`;
  }
  function slotUI(q, chosen, checked, picked) {
    const fix = (i) => checked && chosen[i] !== q.correct[i] ? `<span class="mark errc">✗ Answer: ${esc(optText(q, q.correct[i]))}</span>` : checked ? `<span class="mark okc">✓</span>` : "";
    if (q.type === "fill") {
      const parts = q.code.split(/\{\{(\d)\}\}/);
      return `<pre class="code">${parts.map((p, n) => n % 2 ? slotSelect(q, +p - 1, chosen[+p - 1], checked) : esc(p)).join("")}</pre>
        ${checked ? `<ol class="fillres">${q.slots.map((_, i) => `<li class="${chosen[i] === q.correct[i] ? "right" : "wrong"}">Blank ${i + 1}: ${fix(i)}</li>`).join("")}</ol>` : ""}`;
    }
    return `<div class="dnd">
      <div class="dndvals"><p class="small"><b>Values</b></p>
        ${q.options.map((o) => `<button type="button" class="tile ${picked === o.key ? "picked" : ""}" draggable="${!checked}" data-val="${o.key}" aria-pressed="${picked === o.key}" ${checked ? "disabled" : ""}>${esc(o.text)}</button>`).join("")}
      </div>
      <div class="dndarea"><p class="small"><b>Answer area</b></p>
        ${q.slots.map((sl, i) => `<div class="mrow ${checked ? (chosen[i] === q.correct[i] ? "right" : "wrong") : ""}">
          <span class="txt">${esc(sl.text)}</span>
          <span class="dropwrap"><button type="button" class="drop ${chosen[i] ? "filled" : ""} ${picked ? "ready" : ""}" data-drop="${i}" aria-label="Target for ${esc(sl.text)}${chosen[i] ? ": " + esc(optText(q, chosen[i])) : ", empty"}" ${checked ? "disabled" : ""}>${chosen[i] ? esc(optText(q, chosen[i])) : picked ? "Place here" : "Drop a value here"}</button>
          ${chosen[i] && !checked ? `<button type="button" class="clr" data-clear="${i}" aria-label="Clear ${esc(sl.text)}">×</button>` : ""}</span>
          ${fix(i)}</div>`).join("")}
      </div></div>`;
  }

  function renderTest() {
    const t = lsGet(LS_CURRENT, null);
    if (!t) { location.hash = "#/"; return; }
    t.checked = t.checked || {}; t.follow = t.follow || {}; t.order = t.order || {};
    const qs = t.ids.map((id) => byId.get(id)).filter(Boolean);
    const save = () => lsSet(LS_CURRENT, t);
    const announced = {};
    let picked = null; // match questions: value chosen by tap/click, waiting to be placed

    function draw() {
      const q = qs[t.index];
      const multi = q.type === "multi", ord = q.type === "order", yn = q.type === "yesno", slot = slotType(q);
      const need = slot ? q.slots.length : seqType(q) ? q.options.length : q.correct.length;
      const chosen = t.answers[q.id] || [];
      const opts = optOrder(t, q);
      const checked = t.study && t.checked[q.id];
      const isOk = checked && isRight(q, chosen);
      const answeredCount = qs.filter((x) => isDone(x, t.answers[x.id] || [])).length;
      const last = t.index === qs.length - 1;
      const allDone = answeredCount === qs.length;
      setView(`
        <div class="testbar">
          <span><b>${esc(modeLabel(t))}</b>${t.study ? ` <span class="tag">Study mode</span>` : ""} · ${answeredCount}/${qs.length} answered</span>
          ${t.timed ? `<span class="timer" id="timer" aria-label="Time remaining"></span>` : `<span class="muted small">Untimed</span>`}
        </div>
        <div class="progress" aria-hidden="true"><div style="width:${pct(answeredCount, qs.length)}%"></div></div>
        <section class="card question">
          <div class="qmeta"><span>Question ${t.index + 1} of ${qs.length}${t.follow[q.id] ? ` <span class="tag fu">Follow-up: same concept</span>` : ""}</span>${t.study ? `<span class="tag">${q.domain} · ${esc(q.skill_name || "")}</span>` : ""}</div>
          ${caseBlock(q, true)}
          <fieldset ${checked ? "disabled" : ""}>
            <legend class="stem">${esc(q.stem)}</legend>
            ${multi ? `<p class="hint">Select ${need} answers. Each correct selection is worth one point.</p>` : ord ? `<p class="hint">Select the steps in the order you'd do them. Select a step again to remove it.</p>` : yn ? `<p class="hint">For each statement, select Yes if the statement is true. Otherwise, select No. Each correct selection is worth one point.</p>` : q.type === "match" ? `<p class="hint">Drag the values to the correct targets, or select a value and then a target. Each value may be used once, more than once, or not at all. Each correct selection is worth one point.</p>` : q.type === "fill" ? `<p class="hint">Select the correct option in each box. Each correct selection is worth one point.</p>` : ""}
            ${slot ? slotUI(q, chosen, checked, picked) : yn ? `<div class="yn">${q.options.map((o, i) => {
                const mine = chosen[i] || "", right = q.correct[i];
                const state = checked ? (mine === right ? "right" : "wrong") : "";
                return `<div class="ynrow ${state}" role="radiogroup" aria-label="Statement ${i + 1}">
                  <span class="txt">${esc(o.text)}</span>
                  <span class="ynbtns">${["Y", "N"].map((v) => `<label class="ynb ${mine === v ? "sel" : ""}"><input type="radio" name="yn${i}" value="${v}" data-i="${i}" ${mine === v ? "checked" : ""}> ${v === "Y" ? "Yes" : "No"}</label>`).join("")}</span>
                  ${state ? `<span class="mark ${state === "right" ? "okc" : "errc"}">${state === "right" ? "✓" : "✗"} Answer: ${right === "Y" ? "Yes" : "No"}</span>` : ""}
                </div>`; }).join("")}</div>`
            : `<div class="options">
              ${opts.map((o, i) => {
                const mine = chosen.includes(o.key), pos = chosen.indexOf(o.key) + 1, cpos = q.correct.indexOf(o.key) + 1;
                const right = ord ? pos === cpos : q.correct.includes(o.key);
                const state = checked ? (ord ? (right ? "right" : "wrong") : right ? "right" : mine ? "wrong" : "") : "";
                return `<label class="opt ${mine ? "sel" : ""} ${state}">
                  <input type="${multi || ord ? "checkbox" : "radio"}" name="opt" value="${o.key}" ${mine ? "checked" : ""}>
                  <span class="key">${"ABCDEF"[i]}</span>${o.text.includes("\n") ? `<pre class="txt optcode">${esc(o.text)}</pre>` : `<span class="txt">${esc(o.text)}</span>`}
                  ${ord && pos && !checked ? `<span class="ordn" aria-label="Step ${pos}">${pos}</span>` : ""}
                  ${ord && checked ? `<span class="mark ${right ? "okc" : "errc"}">${right ? "✓ Step " + cpos : "✗ You: " + (pos || "–") + " · Correct: " + cpos}</span>`
                    : state === "right" ? `<span class="mark okc">✓ Correct</span>` : state === "wrong" ? `<span class="mark errc">✗ Your answer</span>` : ""}
                </label>`; }).join("")}
            </div>`}
          </fieldset>
          ${!checked && chosen.some(Boolean) ? `<button class="btn small ghost reset" id="reset">↺ Reset answer</button>` : ""}
          ${checked ? `<div class="feedback ${isOk ? "ok" : "bad"}" role="status">
              <b>${isOk ? "✓ Correct." : "✗ Not quite."}</b> ${esc(q.explanation)}
              ${!isOk && qs[t.index + 1] && t.follow[qs[t.index + 1].id] === q.id ? `<p class="small"><b>Next:</b> a follow-up question on the same concept, to check you've got it.</p>` : ""}
              ${q.source_url ? `<p class="src">Source: <a href="${esc(q.source_url)}" target="_blank" rel="noopener">${esc(q.source_title || q.source_url)}</a></p>` : ""}
            </div>` : ""}
          <div class="qnav">
            <button class="btn ghost" id="prev" ${t.index === 0 ? "disabled" : ""}>← Prev</button>
            <button class="btn ghost ${t.flags[q.id] ? "flagged" : ""}" id="flag" aria-pressed="${!!t.flags[q.id]}">${t.flags[q.id] ? "★ Flagged" : "☆ Flag"}</button>
            ${t.study && !checked ? `<button class="btn primary" id="check" ${isDone(q, chosen) && (seqType(q) || chosen.length === need) ? "" : "disabled"}>Check answer</button>`
              : last ? `<button class="btn primary" id="submit2">Finish test</button>` : `<button class="btn primary" id="next">Next →</button>`}
          </div>
          <p class="muted small keys">Keyboard: ${yn || slot ? "" : `A–${"ABCDEF"[opts.length - 1]} choose · `}${t.study ? "Enter check/next · " : "Enter next · "}←/→ move · F flag</p>
        </section>
        <section class="card">
          <div class="palette" role="list">
            ${qs.map((x, i) => { const a = isDone(x, t.answers[x.id] || []), f = t.flags[x.id], c = t.study && t.checked[x.id];
              const res = c ? (isRight(x, t.answers[x.id] || []) ? "right" : "wrong") : "";
              return `<button role="listitem" class="pq ${i === t.index ? "cur" : ""} ${a ? "ans" : ""} ${f ? "flag" : ""} ${res}" data-i="${i}" aria-label="Question ${i + 1}, ${a ? "answered" : "not answered"}${f ? ", flagged" : ""}${res ? ", " + (res === "right" ? "correct" : "incorrect") : ""}"${i === t.index ? ' aria-current="true"' : ""}>${i + 1}${f ? "<i>★</i>" : ""}</button>`; }).join("")}
          </div>
          <p class="muted small legend"><span class="dot ans"></span> answered <span class="dot flag">★</span> flagged <span class="dot"></span> not answered${t.study ? ` <span class="dot right"></span> correct <span class="dot wrong"></span> incorrect` : ""}</p>
          <button class="btn ${allDone ? "primary" : "ghost"} wide" id="submit">Submit test${allDone ? "" : ` (${qs.length - answeredCount} unanswered)`}</button>
        </section>`);

      const pickKey = (key) => {
        if (checked) return;
        let sel = (t.answers[q.id] || []).slice();
        if (ord) sel = sel.includes(key) ? sel.filter((v) => v !== key) : [...sel, key];
        else if (multi) { sel = (sel.includes(key) ? sel.filter((v) => v !== key) : sel.length < need ? [...sel, key] : sel).sort(); }
        else sel = [key];
        t.answers[q.id] = sel; save(); draw();
        const el = document.querySelector(`.opt input[value="${key}"]`); if (el) el.focus();
      };
      document.querySelectorAll(".opt input").forEach((inp) => inp.onchange = () => pickKey(inp.value));
      const place = (i, key) => {
        if (checked) return;
        const sel = Array.from({ length: q.slots.length }, (_, n) => (t.answers[q.id] || [])[n] || "");
        sel[i] = key; t.answers[q.id] = sel; picked = null; save(); draw();
        const el = document.querySelector(`[data-drop="${i}"]`); if (el) el.focus();
      };
      document.querySelectorAll(".tile").forEach((b) => {
        b.onclick = () => { picked = picked === b.dataset.val ? null : b.dataset.val; draw(); const el = document.querySelector(`.tile[data-val="${b.dataset.val}"]`); if (el) el.focus(); };
        b.ondragstart = (e) => { e.dataTransfer.setData("text/plain", b.dataset.val); e.dataTransfer.effectAllowed = "copy"; };
      });
      document.querySelectorAll("[data-drop]").forEach((d) => {
        d.ondragover = (e) => { e.preventDefault(); d.classList.add("over"); };
        d.ondragleave = () => d.classList.remove("over");
        d.ondrop = (e) => { e.preventDefault(); const k = e.dataTransfer.getData("text/plain"); if (k) place(+d.dataset.drop, k); };
        d.onclick = () => { if (picked) place(+d.dataset.drop, picked); };
      });
      const rs = document.getElementById("reset"); if (rs) rs.onclick = () => { delete t.answers[q.id]; picked = null; save(); draw(); };
      document.querySelectorAll("[data-clear]").forEach((c) => c.onclick = () => place(+c.dataset.clear, ""));
      document.querySelectorAll("select[data-slot]").forEach((el) => el.onchange = () => {
        if (checked) return;
        const sel = Array.from({ length: q.slots.length }, (_, i) => (t.answers[q.id] || [])[i] || "");
        sel[+el.dataset.slot] = el.value; t.answers[q.id] = sel; save(); draw();
        const again = document.querySelector(`select[data-slot="${el.dataset.slot}"]`); if (again) again.focus();
      });
      document.querySelectorAll(".yn input").forEach((inp) => inp.onchange = () => {
        if (checked) return;
        const sel = Array.from({ length: q.options.length }, (_, i) => (t.answers[q.id] || [])[i] || "");
        sel[+inp.dataset.i] = inp.value; t.answers[q.id] = sel; save(); draw();
        const el = document.querySelector(`.yn input[name="${inp.name}"][value="${inp.value}"]`); if (el) el.focus();
      });
      const go = (i) => { if (i < 0 || i >= qs.length) return; t.index = i; save(); draw(); };
      const doCheck = () => {
        if (!isDone(q, chosen) || (!seqType(q) && chosen.length !== need)) return;
        t.checked[q.id] = true;
        const ok = isRight(q, chosen);
        if (!ok && !t.follow[q.id] && q.skill) {
          const used = new Set(t.ids);
          const f = pick(bank.filter((x) => x.skill === q.skill && !used.has(x.id)), 1, questionStats())[0];
          if (f) { t.ids.splice(t.index + 1, 0, f.id); qs.splice(t.index + 1, 0, f); t.follow[f.id] = q.id; t.order[f.id] = shuffle(f.options.map((o) => o.key)); }
        }
        save(); draw(); announce(ok ? "Correct" : "Incorrect");
      };
      document.getElementById("prev").onclick = () => go(t.index - 1);
      const nx = document.getElementById("next"); if (nx) nx.onclick = () => go(t.index + 1);
      const ck = document.getElementById("check"); if (ck) ck.onclick = doCheck;
      document.getElementById("flag").onclick = () => { t.flags[q.id] = !t.flags[q.id]; save(); draw(); };
      document.querySelectorAll(".pq").forEach((b) => b.onclick = () => go(+b.dataset.i));
      const submit = () => {
        const left = qs.filter((x) => !isDone(x, t.answers[x.id] || [])).length;
        const msg = left ? `${left} question${left > 1 ? "s are" : " is"} unanswered and will be marked wrong. Submit anyway?` : "Submit your test? You can't change answers afterwards.";
        if (confirm(msg)) finish(t, qs);
      };
      document.getElementById("submit").onclick = submit;
      const s2 = document.getElementById("submit2"); if (s2) s2.onclick = submit;

      keyHandler = (e) => {
        if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toUpperCase();
        const pos = k.length === 1 ? "ABCDEF".indexOf(k) : -1;
        const opt = yn || slot ? null : (pos >= 0 ? opts[pos] : null) || (/^[1-6]$/.test(k) ? opts[+k - 1] : null);
        if (opt) { e.preventDefault(); pickKey(opt.key); }
        else if (e.key === "ArrowRight") { e.preventDefault(); go(t.index + 1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); go(t.index - 1); }
        else if (k === "F") { e.preventDefault(); t.flags[q.id] = !t.flags[q.id]; save(); draw(); }
        else if (e.key === "Enter" && !/^(BUTTON|A)$/.test(e.target.tagName)) {
          e.preventDefault();
          if (t.study && !checked) doCheck(); else if (!last) go(t.index + 1);
        }
      };
      document.addEventListener("keydown", keyHandler);
      if (t.timed) tick();
    }
    function tick() {
      const el = document.getElementById("timer");
      const update = () => {
        const left = t.limitSec - (Date.now() - t.startedAt) / 1000;
        if (el) { el.textContent = "⏱ " + fmtTime(left); el.classList.toggle("warn", left < 600); }
        if (left < 600 && !announced.ten) { announced.ten = true; announce("10 minutes remaining"); }
        if (left < 60 && !announced.one) { announced.one = true; announce("1 minute remaining"); }
        if (left <= 0) { clearInterval(timerHandle); alert("Time is up. Your test will be submitted."); finish(t, qs); }
      };
      update(); timerHandle = setInterval(update, 1000);
    }
    draw();
  }

  async function finish(t, qs) {
    clearInterval(timerHandle);
    const answers = qs.map((q) => { const sel = t.answers[q.id] || []; return { question_id: q.id, selected: sel, is_correct: isRight(q, sel) }; });
    const correct = answers.filter((a) => a.is_correct).length;
    const pts = qs.reduce((acc, q) => { const [e, m] = points(q, t.answers[q.id]); return [acc[0] + e, acc[1] + m]; }, [0, 0]);
    const dom = domainBreakdown(answers.map((a) => ({ q: byId.get(a.question_id), ok: a.is_correct })));
    const domain_scores = {};
    Object.entries(dom).forEach(([k, v]) => { if (v.total) domain_scores[k] = v; });
    const score = scaled(pts[0], pts[1]);
    const attempt = {
      id: t.id, mode: t.mode, mock: t.mock, domain: t.domain, skill: t.skill || null, study: !!t.study, total: qs.length, correct, score,
      passed: score >= CFG.passScore, domain_scores, duration_sec: Math.round((Date.now() - t.startedAt) / 1000),
      submitted_at: new Date().toISOString(), answers, flags: t.flags, order: t.order, points: pts
    };
    setView(`<p class="muted center pad">Saving your result…</p>`);
    attempt.synced = await pushAttempt(attempt);
    if (!attempt.synced) { const { flags, ...keep } = attempt; const local = lsGet(LS_LOCAL, []); local.push(keep); lsSet(LS_LOCAL, local); }
    attempts.unshift(attempt);
    lsDel(LS_CURRENT);
    location.hash = `#/result/${attempt.id}`;
  }

  function renderResult(id) {
    const a = attempts.find((x) => x.id === id);
    if (!a) { setView(`<p class="center pad">Result not found. <a href="#/history">See history</a></p>`); return; }
    const passLine = CFG.passScore / 10;
    const items = a.answers.map((ans, i) => ({ ans, q: byId.get(ans.question_id), n: i + 1 })).filter((x) => x.q);
    const wrongIds = items.filter((x) => !x.ans.is_correct).map((x) => x.q.id);
    const flags = a.flags || {};
    const flagged = items.filter((x) => flags[x.q.id]).length;
    const before = new Set();
    attempts.forEach((x) => { if (x.submitted_at < a.submitted_at) x.answers.forEach((y) => before.add(y.question_id)); });
    const freshAns = a.answers.filter((x) => !before.has(x.question_id));
    const freshOk = freshAns.filter((x) => x.is_correct).length;
    setView(`
      <section class="result ${a.passed ? "pass" : "fail"}">
        <div>
          <p class="muted">${esc(modeLabel(a))}${a.study ? " · Study mode" : ""} · ${fmtDate(a.submitted_at)} · ${fmtTime(a.duration_sec || 0)}</p>
          <h1>${a.passed ? "✓ Passed" : "✗ Not passed yet"}</h1>
          <p>${a.correct} of ${a.total} fully correct${a.points && a.points[1] !== a.total ? ` · ${a.points[0]} of ${a.points[1]} points (each correct selection earns a point, like the real exam)` : ""}. Pass mark: ${CFG.passScore}.</p>
          ${freshAns.length < a.total ? `<p class="small">${freshAns.length ? `First-try score: <b>${scaled(freshOk, freshAns.length)}</b> (${freshOk}/${freshAns.length} questions you hadn't seen before). ` : ""}${a.total - freshAns.length} question${a.total - freshAns.length > 1 ? "s were" : " was"} repeats, which can inflate the score.</p>` : ""}
          ${a.synced === false ? `<p class="muted small">Saved in this browser only; it will sync to the database later.</p>` : ""}
        </div>
        <div class="scorebig">${a.score}<span>/1000</span></div>
      </section>
      <div class="actions">
        ${wrongIds.length ? `<button class="btn primary" id="practiceWrong">Practice these ${wrongIds.length} mistake${wrongIds.length > 1 ? "s" : ""}</button>` : ""}
        ${a.mode === "mock" ? `<button class="btn" id="retake">Retake mock ${a.mock}</button>` : ""}
        <a class="btn ghost" href="#/">Dashboard</a>
      </div>
      <section class="card">
        <h2>Score by domain</h2>
        ${Object.entries(a.domain_scores || {}).map(([k, v]) => { const p = pct(v.correct, v.total); return `
          <div class="domrow"><div class="domhead"><span><b>${k}</b> ${esc(DOMAINS[k].name)}</span><span>${p}% · ${v.correct}/${v.total}</span></div>${bar(p, passLine, `${k}: ${p}% correct`)}</div>`; }).join("")}
      </section>
      <section class="card">
        <div class="rowhead"><h2>Answers and explanations</h2>
          <div class="seg small" id="filt" role="radiogroup" aria-label="Filter answers">
            <button role="radio" data-f="wrong">Incorrect (${wrongIds.length})</button>
            ${flagged ? `<button role="radio" data-f="flag">Flagged (${flagged})</button>` : ""}
            <button role="radio" data-f="all">All (${items.length})</button>
          </div></div>
        <div id="review"></div>
      </section>`);

    function reviewBody(x) {
      const q = x.q, sel = x.ans.selected || [];
      if (slotType(q)) return `${q.code ? `<pre class="code">${esc(q.code)}</pre>` : ""}<ul class="ropts">${q.slots.map((sl, i) => {
        const ok = sel[i] === q.correct[i];
        return `<li class="${ok ? "c" : "w"}"><span class="key">${i + 1}</span><span>${q.type === "fill" ? "" : esc(sl.text) + " → "}<b>${esc(optText(q, q.correct[i]))}</b></span>${sel.length ? `<em class="mine">${ok ? "your answer" : "✗ you: " + esc(optText(q, sel[i]) || "–")}</em>` : ""}</li>`; }).join("")}</ul>`;
      if (q.type === "yesno") return `<ul class="ropts">${q.options.map((o, i) => {
        const ok = sel[i] === q.correct[i], yes = (v) => (v === "Y" ? "Yes" : v === "N" ? "No" : "–");
        return `<li class="${ok ? "c" : "w"}"><span class="key">${i + 1}</span><span>${esc(o.text)}</span><em>Answer: ${yes(q.correct[i])}</em>${sel.length ? `<em class="mine">${ok ? "you: " : "✗ you: "}${yes(sel[i])}</em>` : ""}</li>`; }).join("")}</ul>`;
      if (q.type === "order") return `<p class="small"><b>Correct order</b></p><ol class="ropts">${q.correct.map((k, i) => {
        const o = q.options.find((y) => y.key === k), mine = sel.indexOf(k) + 1, ok = mine === i + 1;
        return `<li class="${ok ? "c" : "w"}"><span class="key">${i + 1}</span><span>${esc(o ? o.text : k)}</span>${sel.length ? `<em class="mine">${ok ? "your step " + mine : "✗ your step " + (mine || "–")}</em>` : ""}</li>`; }).join("")}</ol>`;
      return `<ul class="ropts">${optOrder(a, q).map((o, i) => {
          const isC = q.correct.includes(o.key), mine = sel.includes(o.key);
          return `<li class="${isC ? "c" : ""} ${mine && !isC ? "w" : ""}"><span class="key">${"ABCDEF"[i]}</span><span>${esc(o.text)}</span>${isC ? `<em>✓ correct</em>` : ""}${mine ? `<em class="mine">${isC ? "your answer" : "✗ your answer"}</em>` : ""}</li>`;
        }).join("")}</ul>`;
    }
    function card(x, open) {
      return `<details class="rev ${x.ans.is_correct ? "ok" : "bad"}" ${open ? "open" : ""}>
        <summary><span class="qmeta"><span>${x.n}. ${x.ans.is_correct ? "✓ Correct" : "✗ Incorrect"}${flags[x.q.id] ? " · ★ flagged" : ""}</span><span class="tag">${x.q.domain} · ${esc(x.q.skill_name || "")}</span></span>
          <span class="stem">${esc(x.q.stem)}</span></summary>
        ${caseBlock(x.q, false)}
        ${reviewBody(x)}
        ${x.ans.selected.length ? "" : `<p class="muted small">Not answered.</p>`}
        <div class="expl"><b>Explanation.</b> ${esc(x.q.explanation)}</div>
        ${x.q.source_url ? `<p class="src">Source: <a href="${esc(x.q.source_url)}" target="_blank" rel="noopener">${esc(x.q.source_title || x.q.source_url)}</a></p>` : ""}
      </details>`;
    }
    function drawReview(f) {
      document.querySelectorAll("#filt button").forEach((b) => { const on = b.dataset.f === f; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
      const list = items.filter((x) => f === "all" || (f === "wrong" ? !x.ans.is_correct : flags[x.q.id]));
      document.getElementById("review").innerHTML = list.map((x) => card(x, f !== "all" || !x.ans.is_correct)).join("")
        || `<p class="muted">Nothing to show. Every answer was correct. 🎉</p>`;
    }
    drawReview(wrongIds.length ? "wrong" : "all");
    document.querySelectorAll("#filt button").forEach((b) => b.onclick = () => drawReview(b.dataset.f));
    const pw = document.getElementById("practiceWrong");
    if (pw) pw.onclick = () => startTest(generate({ mode: "review", ids: wrongIds, study: true, timed: false }));
    const rt = document.getElementById("retake");
    if (rt) rt.onclick = () => startTest(generate({ mode: "mock", mock: a.mock }));
  }

  function renderHistory() {
    setView(`
      <section class="card">
        <h2>Test history</h2>
        ${attempts.length ? `<div class="tablewrap"><table>
          <thead><tr><th>Date</th><th>Test</th><th>Correct</th><th>Score</th><th>Result</th></tr></thead>
          <tbody>${attempts.map((a) => `<tr><td>${fmtDate(a.submitted_at)}</td><td><a href="#/result/${a.id}">${esc(modeLabel(a))}</a>${a.study ? ` <span class="muted small">(study)</span>` : ""}</td><td>${a.correct}/${a.total}</td><td><b>${a.score}</b></td><td><span class="pill ${a.passed ? "pass" : "fail"}">${a.passed ? "✓ Pass" : "✗ Fail"}</span></td></tr>`).join("")}</tbody>
        </table></div>` : `<p class="muted">No tests yet. <a href="#/">Generate your first test</a>.</p>`}
      </section>`);
  }

  /* ---------- bulk upload ---------- */
  const CSV_COLS = ["id", "domain", "skill", "mock", "question", "option_a", "option_b", "option_c", "option_d", "option_e", "option_f", "correct", "explanation", "source_title", "source_url"];

  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = []; let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = ""; if (row.some((v) => v.trim() !== "")) rows.push(row); row = [];
      } else field += c;
    }
    row.push(field); if (row.some((v) => v.trim() !== "")) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase());
    return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
  }

  function fromCsvRow(r) {
    const options = ["a", "b", "c", "d", "e", "f"].map((l) => ({ key: l.toUpperCase(), text: r["option_" + l] || "" })).filter((o) => o.text);
    return {
      id: r.id || "", domain: (r.domain || "").toUpperCase(), skill: r.skill || "", mock: r.mock ? Number(r.mock) : null,
      stem: r.question || r.stem || "", options,
      correct: (r.correct || "").toUpperCase().split(/[^A-F]+/).filter(Boolean),
      explanation: r.explanation || "", source_title: r.source_title || "", source_url: r.source_url || ""
    };
  }

  function fromJsonItem(x) {
    let options = x.options || [];
    if (Array.isArray(options) && typeof options[0] === "string") options = options.map((t, i) => ({ key: "ABCDEF"[i], text: t }));
    let correct = x.correct ?? x.answer ?? [];
    if (!Array.isArray(correct)) correct = String(correct).toUpperCase().split(/[^A-F]+/).filter(Boolean);
    return {
      id: x.id || "", domain: String(x.domain || "").toUpperCase(), skill: x.skill || "", skill_name: x.skill_name || "",
      mock: x.mock ? Number(x.mock) : null, stem: x.stem || x.question || "", options: options.map((o) => ({ key: String(o.key).toUpperCase(), text: String(o.text || "").trim() })),
      correct: correct.map((c) => String(c).toUpperCase()), explanation: x.explanation || "", source_title: x.source_title || "", source_url: x.source_url || ""
    };
  }

  function validateItems(items) {
    const bankStems = new Map(bank.map((q) => [q.stem.trim().toLowerCase(), q]));
    const seen = new Set();
    return items.map((it, i) => {
      const errors = [], warnings = [];
      if (!DOMAINS[it.domain]) errors.push("domain must be D1–D4");
      if (!it.stem.trim()) errors.push("question text is missing");
      if (it.options.length < 2 || it.options.length > 6) errors.push("needs 2–6 options");
      if (!it.correct.length) errors.push("correct answer is missing");
      else if (!it.correct.every((c) => it.options.some((o) => o.key === c))) errors.push(`correct answer ${it.correct.join(",")} doesn't match an option`);
      if (!it.explanation.trim()) errors.push("explanation is missing");
      if (it.mock !== null && !(it.mock >= 1 && it.mock <= 10)) errors.push("mock must be 1–10 or empty");
      if (it.source_url && !/^https?:\/\//i.test(it.source_url)) errors.push("source_url must start with http(s)://");
      const key = it.stem.trim().toLowerCase();
      const dupe = bankStems.get(key);
      if (dupe && dupe.origin !== "upload") errors.push("same question already exists in the bank");
      else if (dupe) warnings.push("will update an uploaded question with the same text");
      if (seen.has(key) && key) errors.push("duplicate of an earlier row in this file");
      seen.add(key);
      if (!it.source_url) warnings.push("no source link");
      return { row: i + 1, item: it, errors, warnings };
    });
  }

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

  function templateCSV() {
    const rows = [CSV_COLS,
      ["", "D2", "cvec", "", "Which function orders Cosmos DB for NoSQL results by vector similarity?", "VectorDistance", "ST_DISTANCE", "ARRAY_CONTAINS", "", "", "", "A", "VectorDistance computes the distance between a stored vector and the query vector, so ORDER BY VectorDistance(...) returns the nearest items.", "Vector search in Azure Cosmos DB for NoSQL", "https://learn.microsoft.com/en-us/azure/cosmos-db/vector-search"],
      ["", "D3", "sb", "", "Which two settings help you inspect poison messages in Service Bus? Choose two.", "MaxDeliveryCount", "The dead-letter queue", "WEBSITES_PORT", "Event TTL", "", "", "A,B", "Messages that exceed MaxDeliveryCount move to the dead-letter queue, where you can inspect them.", "", ""]];
    return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  }
  function templateJSON() {
    return JSON.stringify([{ id: "", domain: "D4", skill: "kql", mock: null, stem: "Which KQL operator must be last in a query?", options: ["render", "where", "summarize", "project"], correct: ["A"], explanation: "render instructs the client how to visualize results and must be the last operator.", source_title: "render operator (KQL)", source_url: "https://learn.microsoft.com/en-us/kusto/query/render-operator" }], null, 2);
  }

  function renderUpload() {
    let parsed = [];
    const uploads = bank.filter((q) => q.origin === "upload");
    const batches = {};
    uploads.forEach((q) => { const b = q.batch_id || "unnamed"; batches[b] = batches[b] || { n: 0, at: q.uploaded_at }; batches[b].n++; });
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    setView(`
      <section class="card">
        <h1>Upload questions</h1>
        <p class="muted">Add many questions at once from a CSV file (works with Excel and Google Sheets) or a JSON file. Uploaded questions appear in smart mixed tests, domain practice, and mistake review, and in a mock test if you set its number.</p>
        <div class="rowbtns">
          <button class="btn small" id="tplCsv">Download CSV template</button>
          <button class="btn small" id="tplJson">Download JSON template</button>
        </div>
        <details class="fmt"><summary>Column guide</summary>
          <ul class="small">
            <li><b>domain</b> (required): D1, D2, D3 or D4</li>
            <li><b>question</b>, <b>explanation</b> (required)</li>
            <li><b>option_a … option_f</b>: 2 to 6 options</li>
            <li><b>correct</b> (required): letter(s), for example B or A,C. More than one letter makes it a "choose N" question; say so in the question text.</li>
            <li><b>mock</b> (optional): 1–10 to include it in that mock test</li>
            <li><b>id</b> (optional): reuse an id to update a question you uploaded before</li>
            <li><b>skill</b>, <b>source_title</b>, <b>source_url</b> (optional, but a Microsoft Learn link is recommended)</li>
          </ul>
        </details>
        <label class="drop" id="drop">
          <input type="file" id="file" accept=".csv,.json,text/csv,application/json">
          <b>Choose a .csv or .json file</b><span class="muted small">or drop it here</span>
        </label>
        <div id="preview"></div>
      </section>
      <section class="card">
        <h2>Uploaded batches</h2>
        ${Object.keys(batches).length ? `<div class="tablewrap"><table><thead><tr><th>Batch</th><th>Questions</th><th>Uploaded</th><th></th></tr></thead><tbody>
          ${Object.entries(batches).map(([b, v]) => `<tr class="static"><td>${esc(b)}</td><td>${v.n}</td><td>${v.at ? fmtDate(v.at) : ""}</td><td><button class="btn small ghost danger" data-del="${esc(b)}">Delete</button></td></tr>`).join("")}
        </tbody></table></div><p class="muted small">Deleting a batch also removes those questions from your past results.</p>` : `<p class="muted">Nothing uploaded yet. The built-in bank has ${bank.length} questions.</p>`}
      </section>`);

    document.getElementById("tplCsv").onclick = () => download("ai200-questions-template.csv", templateCSV(), "text/csv");
    document.getElementById("tplJson").onclick = () => download("ai200-questions-template.json", templateJSON(), "application/json");

    const fileIn = document.getElementById("file"), drop = document.getElementById("drop");
    const handle = async (file) => {
      if (!file) return;
      const text = await file.text();
      let items = [];
      try {
        if (/\.json$/i.test(file.name) || text.trim().startsWith("[") || text.trim().startsWith("{")) {
          const data = JSON.parse(text); items = (Array.isArray(data) ? data : data.questions || []).map(fromJsonItem);
        } else items = parseCSV(text).map(fromCsvRow);
      } catch (e) { document.getElementById("preview").innerHTML = `<p class="err">Couldn't read the file: ${esc(e.message)}</p>`; return; }
      parsed = validateItems(items);
      drawPreview(file.name);
    };
    fileIn.onchange = () => handle(fileIn.files[0]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); handle(e.dataTransfer.files[0]); };

    function drawPreview(name) {
      const ok = parsed.filter((p) => !p.errors.length), bad = parsed.length - ok.length;
      const byDom = {}; ok.forEach((p) => (byDom[p.item.domain] = (byDom[p.item.domain] || 0) + 1));
      document.getElementById("preview").innerHTML = parsed.length ? `
        <div class="summary ${bad ? "warnbox" : "okbox"}">
          <b>${esc(name)}</b>: ${parsed.length} rows · <span class="okc">${ok.length} ready</span>${bad ? ` · <span class="errc">${bad} with errors</span>` : ""}
          ${ok.length ? `<div class="small muted">${Object.entries(byDom).map(([d, n]) => `${d}: ${n}`).join(" · ")}</div>` : ""}
        </div>
        <div class="tablewrap"><table class="prev"><thead><tr><th>Row</th><th>Status</th><th>Domain</th><th>Question</th><th>Answer</th></tr></thead><tbody>
          ${parsed.map((p) => `<tr class="static ${p.errors.length ? "rowbad" : ""}"><td>${p.row}</td>
            <td>${p.errors.length ? `<span class="errc">✘ ${esc(p.errors.join("; "))}</span>` : `<span class="okc">✔ Ready</span>${p.warnings.length ? `<div class="small muted">${esc(p.warnings.join("; "))}</div>` : ""}`}</td>
            <td>${esc(p.item.domain)}</td><td class="wrap">${esc(p.item.stem.slice(0, 140))}${p.item.stem.length > 140 ? "…" : ""}</td><td>${esc(p.item.correct.join(","))}</td></tr>`).join("")}
        </tbody></table></div>
        ${ok.length ? `
        <div class="uploadform">
          <label>Batch name <input type="text" id="batch" value="upload-${stamp}" maxlength="60"></label>
          <label>Admin passcode <input type="password" id="pass" autocomplete="current-password"></label>
          <button class="btn primary" id="doUpload">Upload ${ok.length} question${ok.length > 1 ? "s" : ""}${bad ? " (skip rows with errors)" : ""}</button>
          <p id="upMsg" class="small" role="status"></p>
        </div>` : `<p class="err">Fix the errors in your file and choose it again.</p>`}` : `<p class="err">No questions found in this file. Check that the first row contains the column names.</p>`;
      const btn = document.getElementById("doUpload");
      if (btn) btn.onclick = async () => {
        const msg = document.getElementById("upMsg");
        const pass = document.getElementById("pass").value, batch = document.getElementById("batch").value.trim();
        if (!pass) { msg.textContent = "Enter the admin passcode."; msg.className = "small errc"; return; }
        btn.disabled = true; msg.textContent = "Uploading…"; msg.className = "small";
        try {
          const res = await api("rpc/upload_questions", { method: "POST", body: JSON.stringify({ p_passcode: pass, p_items: ok.map((p) => p.item), p_batch: batch || "upload-" + stamp }) });
          bank = await loadBank(); byId = new Map(bank.map((q) => [q.id, q]));
          msg.className = "small okc";
          msg.textContent = `Done: ${res.inserted} added, ${res.updated} updated${res.skipped ? `, ${res.skipped} skipped (id belongs to the built-in bank)` : ""}. The bank now has ${bank.length} questions.`;
          setTimeout(renderUpload, 2500);
        } catch (e) {
          btn.disabled = false; msg.className = "small errc";
          msg.textContent = /Invalid passcode/.test(e.message) ? "Wrong passcode." : "Upload failed: " + (e.message.match(/"message":"([^"]+)"/)?.[1] || e.message);
        }
      };
    }

    document.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      const batch = b.dataset.del;
      const pass = prompt(`Delete batch "${batch}" (${batches[batch].n} questions)? Enter the admin passcode to confirm.`);
      if (!pass) return;
      try {
        await api("rpc/delete_upload_batch", { method: "POST", body: JSON.stringify({ p_passcode: pass, p_batch: batch }) });
        bank = await loadBank(); byId = new Map(bank.map((q) => [q.id, q])); renderUpload();
      } catch (e) { alert(/Invalid passcode/.test(e.message) ? "Wrong passcode." : "Delete failed: " + e.message); }
    });
  }

  function route() {
    const h = location.hash || "#/";
    if (h.startsWith("#/test")) return renderTest();
    if (h.startsWith("#/result/")) return renderResult(h.slice(9));
    if (h.startsWith("#/history")) return renderHistory();
    if (h.startsWith("#/upload")) return renderUpload();
    return renderDashboard();
  }

  async function start() {
    try {
      bank = await loadBank();
      bank.forEach((q) => { if (typeof q.options === "string") q.options = JSON.parse(q.options); });
      byId = new Map(bank.map((q) => [q.id, q]));
      attempts = await loadAttempts();
    } catch (e) {
      app.innerHTML = `<p class="center pad">Couldn't load the question bank. Check your connection and reload.<br><span class="muted small">${esc(e.message)}</span></p>`;
      return;
    }
    window.addEventListener("hashchange", route);
    route();
  }

  // Remove the service worker left by the previous version of this site
  if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  start();
})();
