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

  let bank = [];            // all questions
  let byId = new Map();     // id -> question
  let attempts = [];        // [{id, mode, mock, domain, total, correct, score, passed, domain_scores, duration_sec, submitted_at, answers:[...]}]
  let remoteOk = false;
  let timerHandle = null;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const scaled = (correct, total) => (total ? Math.round((correct / total) * 1000) : 0);
  const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);
  const fmtTime = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
  const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); }));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const modeLabel = (a) => a.mode === "mock" ? `Mock test ${a.mock}` : a.mode === "domain" ? `${a.domain} practice` : a.mode === "review" ? "Review mistakes" : "Smart mixed test";

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
    // try to upload attempts that were saved while offline
    for (const a of pending) { if (await pushAttempt(a)) a.synced = true; }
    const merged = [...remote, ...pending].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
    lsSet(LS_LOCAL, merged.filter((a) => !a.synced));
    return merged;
  }

  async function pushAttempt(a) {
    try {
      const { answers, synced, ...row } = a;
      await api("attempts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
      await api("attempt_answers", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(answers.map((x) => ({ attempt_id: a.id, question_id: x.question_id, selected: x.selected, is_correct: x.is_correct }))) });
      return true;
    } catch (e) { console.warn("Could not save attempt to Supabase", e); return false; }
  }

  /* ---------- statistics ---------- */
  function questionStats() {
    // latest answer per question (attempts are newest first)
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

  /* ---------- test generation ---------- */
  function pick(pool, n, stats) {
    // unseen first, then previously wrong, then the rest; random inside each group
    const tier = (q) => (!stats.seen.has(q.id) ? 0 : stats.latest.get(q.id) === false ? 1 : 2);
    return shuffle(pool).sort((a, b) => tier(a) - tier(b)).slice(0, n);
  }

  function generate(opts) {
    const stats = questionStats();
    let qs = [], minutes = 0;
    if (opts.mode === "mock") {
      qs = shuffle(bank.filter((q) => q.mock === opts.mock));
      minutes = CFG.mockMinutes;
    } else if (opts.mode === "random") {
      for (const [d, info] of Object.entries(DOMAINS)) qs.push(...pick(bank.filter((q) => q.domain === d), info.perMock, stats));
      qs = shuffle(qs); minutes = CFG.mockMinutes;
    } else if (opts.mode === "domain") {
      qs = pick(bank.filter((q) => q.domain === opts.domain), opts.count, stats);
      minutes = Math.round(qs.length * 3);
    } else if (opts.mode === "review") {
      qs = shuffle(bank.filter((q) => stats.latest.get(q.id) === false)).slice(0, opts.count || 40);
      minutes = Math.round(qs.length * 3);
    }
    if (!qs.length) return null;
    return {
      id: uuid(), mode: opts.mode, mock: opts.mock || null, domain: opts.domain || null,
      ids: qs.map((q) => q.id), answers: {}, flags: {}, index: 0,
      timed: opts.timed !== false, limitSec: minutes * 60, startedAt: Date.now()
    };
  }

  /* ---------- views ---------- */
  function setView(html) { clearInterval(timerHandle); app.innerHTML = html; window.scrollTo(0, 0); }

  function bar(value, passLine) {
    return `<div class="bar"><div class="fill ${value >= passLine ? "good" : "low"}" style="width:${value}%"></div><div class="passline" style="left:${passLine}%"></div></div>`;
  }

  function renderDashboard() {
    const stats = questionStats();
    const current = lsGet(LS_CURRENT, null);
    const passLine = CFG.passScore / 10;
    const answered = [...stats.latest.entries()].map(([id, ok]) => ({ q: byId.get(id), ok })).filter((x) => x.q);
    const dom = domainBreakdown(answered);
    const totalCorrect = answered.filter((x) => x.ok).length;
    const overall = scaled(totalCorrect, answered.length);
    const scores = attempts.map((a) => a.score);
    const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : 0;
    const passed = attempts.filter((a) => a.passed).length;
    const wrongCount = [...stats.latest.values()].filter((v) => v === false).length;
    const bestMock = {};
    attempts.filter((a) => a.mode === "mock").forEach((a) => { bestMock[a.mock] = Math.max(bestMock[a.mock] || 0, a.score); });

    setView(`
      ${current ? `<div class="banner"><span>You have a test in progress (${esc(modeLabel(current))}, ${Object.keys(current.answers).length}/${current.ids.length} answered).</span><span><a class="btn small" href="#/test">Resume</a> <button class="btn small ghost" id="discard">Discard</button></span></div>` : ""}
      <section class="hero">
        <div>
          <h1>Exam AI-200 practice</h1>
          <p class="muted">Developing AI Cloud Solutions on Azure · ${bank.length} questions${bank.some((q) => q.origin === "upload") ? " (including your uploads)" : ""} · 10 mock tests of 40 questions</p>
        </div>
        <div class="overall ${answered.length ? (overall >= CFG.passScore ? "pass" : "fail") : ""}">
          <div class="big">${answered.length ? overall : "—"}</div>
          <div class="small">Overall score<br>${answered.length ? (overall >= CFG.passScore ? "On track to pass" : `Pass mark ${CFG.passScore}`) : "Take a test to start"}</div>
        </div>
      </section>

      <section class="grid4">
        <div class="stat"><b>${attempts.length}</b><span>Tests taken</span></div>
        <div class="stat"><b>${attempts.length ? avg : "—"}</b><span>Average test score</span></div>
        <div class="stat"><b>${attempts.length ? pct(passed, attempts.length) + "%" : "—"}</b><span>Tests passed</span></div>
        <div class="stat"><b>${stats.latest.size}/${bank.length}</b><span>Questions seen</span></div>
      </section>

      <section class="card">
        <h2>Generate questions</h2>
        <div class="seg" role="tablist">
          <button data-mode="mock" class="on">Full mock test</button>
          <button data-mode="random">Smart mixed test</button>
          <button data-mode="domain">One domain</button>
          <button data-mode="review">Review mistakes</button>
        </div>
        <div id="modeOpts"></div>
        <button class="btn primary wide" id="gen">Generate questions</button>
      </section>

      <section class="card">
        <h2>Score by exam domain</h2>
        <p class="muted small">Based on your most recent answer to each question. The marker shows the 70% pass line.</p>
        ${Object.entries(DOMAINS).map(([k, d]) => { const v = pct(dom[k].correct, dom[k].total); return `
          <div class="domrow">
            <div class="domhead"><span><b>${k}</b> ${esc(d.name)} <span class="muted">(${d.weight})</span></span><span>${dom[k].total ? v + "% · " + dom[k].correct + "/" + dom[k].total : "not started"}</span></div>
            ${bar(dom[k].total ? v : 0, passLine)}
          </div>`; }).join("")}
      </section>

      <section class="card">
        <h2>Mock tests</h2>
        <div class="mocks">
          ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `
            <button class="mock ${bestMock[n] === undefined ? "" : bestMock[n] >= CFG.passScore ? "pass" : "fail"}" data-mock="${n}">
              <span>Mock ${n}</span><b>${bestMock[n] === undefined ? "Not taken" : "Best " + bestMock[n]}</b>
            </button>`).join("")}
        </div>
      </section>
      ${remoteOk ? "" : `<p class="muted small center">Offline mode: results are saved in this browser and will sync when the database is reachable.</p>`}
    `);

    let mode = "mock";
    const opts = document.getElementById("modeOpts");
    const nextMock = (Array.from({ length: 10 }, (_, i) => i + 1).find((n) => bestMock[n] === undefined)) || 1;
    function drawOpts() {
      if (mode === "mock") opts.innerHTML = `<label>Mock test <select id="mockSel">${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${i + 1 === nextMock ? "selected" : ""}>Mock ${i + 1}${bestMock[i + 1] !== undefined ? " (best " + bestMock[i + 1] + ")" : ""}</option>`).join("")}</select></label><p class="muted small">40 questions in exam proportions, 120-minute timer.</p>`;
      if (mode === "random") opts.innerHTML = `<p class="muted small">40 questions in exam proportions, picked from questions you haven't seen yet first, then ones you got wrong. 120-minute timer.</p>`;
      if (mode === "domain") opts.innerHTML = `<label>Domain <select id="domSel">${Object.entries(DOMAINS).map(([k, d]) => `<option value="${k}">${k} · ${esc(d.name)}</option>`).join("")}</select></label><label>Questions <select id="cntSel"><option>10</option><option selected>20</option><option>40</option></select></label><label class="check"><input type="checkbox" id="timedChk"> Timed (3 min per question)</label>`;
      if (mode === "review") opts.innerHTML = wrongCount ? `<p class="muted small">${wrongCount} question${wrongCount > 1 ? "s" : ""} you last answered incorrectly (up to 40 per test, untimed).</p>` : `<p class="muted small">No mistakes to review yet. Take a test first.</p>`;
    }
    drawOpts();
    document.querySelectorAll(".seg button").forEach((b) => b.onclick = () => {
      document.querySelectorAll(".seg button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); mode = b.dataset.mode; drawOpts();
    });
    document.getElementById("gen").onclick = () => {
      if (lsGet(LS_CURRENT, null) && !confirm("Start a new test? Your test in progress will be discarded.")) return;
      let t = null;
      if (mode === "mock") t = generate({ mode, mock: +document.getElementById("mockSel").value });
      if (mode === "random") t = generate({ mode });
      if (mode === "domain") t = generate({ mode, domain: document.getElementById("domSel").value, count: +document.getElementById("cntSel").value, timed: document.getElementById("timedChk").checked });
      if (mode === "review") t = generate({ mode, count: 40, timed: false });
      if (!t) { alert("No questions available for this choice yet."); return; }
      lsSet(LS_CURRENT, t); location.hash = "#/test";
    };
    document.querySelectorAll(".mock").forEach((b) => b.onclick = () => {
      if (lsGet(LS_CURRENT, null) && !confirm("Start a new test? Your test in progress will be discarded.")) return;
      lsSet(LS_CURRENT, generate({ mode: "mock", mock: +b.dataset.mock })); location.hash = "#/test";
    });
    const discard = document.getElementById("discard");
    if (discard) discard.onclick = () => { if (confirm("Discard the test in progress?")) { lsDel(LS_CURRENT); renderDashboard(); } };
  }

  function renderTest() {
    const t = lsGet(LS_CURRENT, null);
    if (!t) { location.hash = "#/"; return; }
    const qs = t.ids.map((id) => byId.get(id)).filter(Boolean);
    const save = () => lsSet(LS_CURRENT, t);

    function draw() {
      const q = qs[t.index];
      const multi = q.type === "multi";
      const need = q.correct.length;
      const chosen = t.answers[q.id] || [];
      const answeredCount = Object.values(t.answers).filter((v) => v.length).length;
      setView(`
        <div class="testbar">
          <span><b>${esc(modeLabel(t))}</b> · ${answeredCount}/${qs.length} answered</span>
          ${t.timed ? `<span class="timer" id="timer"></span>` : `<span class="muted small">Untimed</span>`}
        </div>
        <section class="card question">
          <div class="qmeta"><span>Question ${t.index + 1} of ${qs.length}</span><span class="tag">${q.domain}</span></div>
          <p class="stem">${esc(q.stem)}</p>
          ${multi ? `<p class="hint">Select ${need} answers.</p>` : ""}
          <div class="options">
            ${q.options.map((o) => `
              <label class="opt ${chosen.includes(o.key) ? "sel" : ""}">
                <input type="${multi ? "checkbox" : "radio"}" name="opt" value="${o.key}" ${chosen.includes(o.key) ? "checked" : ""}>
                <span class="key">${o.key}</span><span class="txt">${esc(o.text)}</span>
              </label>`).join("")}
          </div>
          <div class="qnav">
            <button class="btn ghost" id="prev" ${t.index === 0 ? "disabled" : ""}>← Prev</button>
            <button class="btn ghost ${t.flags[q.id] ? "flagged" : ""}" id="flag">${t.flags[q.id] ? "★ Flagged" : "☆ Flag"}</button>
            ${t.index < qs.length - 1 ? `<button class="btn primary" id="next">Next →</button>` : `<button class="btn primary" id="submit2">Submit test</button>`}
          </div>
        </section>
        <section class="card">
          <div class="palette">
            ${qs.map((x, i) => `<button class="pq ${i === t.index ? "cur" : ""} ${(t.answers[x.id] || []).length ? "ans" : ""} ${t.flags[x.id] ? "flag" : ""}" data-i="${i}" aria-label="Question ${i + 1}">${i + 1}</button>`).join("")}
          </div>
          <p class="muted small legend"><span class="dot ans"></span> answered <span class="dot flag"></span> flagged <span class="dot"></span> not answered</p>
          <button class="btn primary wide" id="submit">Submit test</button>
        </section>`);

      document.querySelectorAll(".opt input").forEach((inp) => inp.onchange = () => {
        let sel = [...document.querySelectorAll(".opt input:checked")].map((x) => x.value);
        if (multi && sel.length > need) { inp.checked = false; sel = sel.filter((v) => v !== inp.value); }
        t.answers[q.id] = sel.sort(); save();
        document.querySelectorAll(".opt").forEach((l) => l.classList.toggle("sel", l.querySelector("input").checked));
        const p = document.querySelector(`.pq[data-i="${t.index}"]`); if (p) p.classList.toggle("ans", sel.length > 0);
      });
      const go = (i) => { t.index = i; save(); draw(); };
      document.getElementById("prev").onclick = () => go(t.index - 1);
      const nx = document.getElementById("next"); if (nx) nx.onclick = () => go(t.index + 1);
      document.getElementById("flag").onclick = () => { t.flags[q.id] = !t.flags[q.id]; save(); draw(); };
      document.querySelectorAll(".pq").forEach((b) => b.onclick = () => go(+b.dataset.i));
      const submit = () => {
        const left = qs.filter((x) => !(t.answers[x.id] || []).length).length;
        if (left && !confirm(`${left} question${left > 1 ? "s are" : " is"} unanswered and will be marked wrong. Submit anyway?`)) return;
        finish(t, qs);
      };
      document.getElementById("submit").onclick = submit;
      const s2 = document.getElementById("submit2"); if (s2) s2.onclick = submit;
      if (t.timed) tick();
    }
    function tick() {
      const el = document.getElementById("timer");
      const update = () => {
        const left = t.limitSec - (Date.now() - t.startedAt) / 1000;
        if (el) { el.textContent = "⏱ " + fmtTime(left); el.classList.toggle("warn", left < 600); }
        if (left <= 0) { clearInterval(timerHandle); alert("Time is up. Your test will be submitted."); finish(t, qs); }
      };
      update(); timerHandle = setInterval(update, 1000);
    }
    draw();
  }

  async function finish(t, qs) {
    clearInterval(timerHandle);
    const answers = qs.map((q) => { const sel = t.answers[q.id] || []; return { question_id: q.id, selected: sel, is_correct: sameSet(sel, q.correct) }; });
    const correct = answers.filter((a) => a.is_correct).length;
    const dom = domainBreakdown(answers.map((a) => ({ q: byId.get(a.question_id), ok: a.is_correct })));
    const domain_scores = {};
    Object.entries(dom).forEach(([k, v]) => { if (v.total) domain_scores[k] = v; });
    const score = scaled(correct, qs.length);
    const attempt = {
      id: t.id, mode: t.mode, mock: t.mock, domain: t.domain, total: qs.length, correct, score,
      passed: score >= CFG.passScore, domain_scores, duration_sec: Math.round((Date.now() - t.startedAt) / 1000),
      submitted_at: new Date().toISOString(), answers, flags: t.flags
    };
    setView(`<p class="muted center pad">Saving your result…</p>`);
    const { flags, ...toSave } = attempt;
    attempt.synced = await pushAttempt(toSave);
    if (!attempt.synced) { const local = lsGet(LS_LOCAL, []); local.push({ ...toSave, synced: false }); lsSet(LS_LOCAL, local); }
    attempts.unshift(attempt);
    lsDel(LS_CURRENT);
    location.hash = `#/result/${attempt.id}`;
  }

  function renderResult(id) {
    const a = attempts.find((x) => x.id === id);
    if (!a) { setView(`<p class="center pad">Result not found. <a href="#/history">See history</a></p>`); return; }
    const passLine = CFG.passScore / 10;
    const items = a.answers.map((ans) => ({ ans, q: byId.get(ans.question_id) })).filter((x) => x.q);
    const wrong = items.filter((x) => !x.ans.is_correct).length;
    setView(`
      <section class="result ${a.passed ? "pass" : "fail"}">
        <div>
          <p class="muted">${esc(modeLabel(a))} · ${fmtDate(a.submitted_at)} · ${fmtTime(a.duration_sec || 0)}</p>
          <h1>${a.passed ? "Passed" : "Not passed yet"}</h1>
          <p>${a.correct} of ${a.total} correct (${pct(a.correct, a.total)}%). Pass mark: ${CFG.passScore}.</p>
          ${a.synced === false ? `<p class="muted small">Saved in this browser only; it will sync to the database later.</p>` : ""}
        </div>
        <div class="scorebig">${a.score}<span>/1000</span></div>
      </section>
      <section class="card">
        <h2>Score by domain</h2>
        ${Object.entries(a.domain_scores || {}).map(([k, v]) => { const p = pct(v.correct, v.total); return `
          <div class="domrow"><div class="domhead"><span><b>${k}</b> ${esc(DOMAINS[k].name)}</span><span>${p}% · ${v.correct}/${v.total}</span></div>${bar(p, passLine)}</div>`; }).join("")}
      </section>
      <section class="card">
        <div class="rowhead"><h2>Answers and explanations</h2>
          <div class="seg small" id="filt"><button data-f="all" class="on">All (${items.length})</button><button data-f="wrong">Incorrect (${wrong})</button></div></div>
        <div id="review"></div>
      </section>
      <div class="center"><a class="btn primary" href="#/">Back to dashboard</a></div>`);

    const flags = a.flags || {};
    function drawReview(f) {
      document.getElementById("review").innerHTML = items.filter((x) => f === "all" || !x.ans.is_correct).map((x) => {
        const n = items.indexOf(x) + 1;
        return `<article class="rev ${x.ans.is_correct ? "ok" : "bad"}">
          <div class="qmeta"><span>${n}. ${x.ans.is_correct ? "✔ Correct" : "✘ Incorrect"}${flags[x.q.id] ? " · ★ flagged" : ""}</span><span class="tag">${x.q.domain} · ${esc(x.q.skill_name || "")}</span></div>
          <p class="stem">${esc(x.q.stem)}</p>
          <ul class="ropts">${x.q.options.map((o) => {
            const isC = x.q.correct.includes(o.key), mine = x.ans.selected.includes(o.key);
            return `<li class="${isC ? "c" : ""} ${mine && !isC ? "w" : ""}"><span class="key">${o.key}</span><span>${esc(o.text)}</span>${isC ? `<em>correct</em>` : ""}${mine ? `<em class="mine">your answer</em>` : ""}</li>`;
          }).join("")}</ul>
          ${x.ans.selected.length ? "" : `<p class="muted small">Not answered.</p>`}
          <div class="expl"><b>Explanation.</b> ${esc(x.q.explanation)}</div>
          ${x.q.source_url ? `<p class="src">Source: <a href="${esc(x.q.source_url)}" target="_blank" rel="noopener">${esc(x.q.source_title || x.q.source_url)}</a></p>` : ""}
        </article>`;
      }).join("") || `<p class="muted">Nothing to show. Every answer was correct.</p>`;
    }
    drawReview("all");
    document.querySelectorAll("#filt button").forEach((b) => b.onclick = () => {
      document.querySelectorAll("#filt button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); drawReview(b.dataset.f);
    });
  }

  function renderHistory() {
    setView(`
      <section class="card">
        <h2>Test history</h2>
        ${attempts.length ? `<div class="tablewrap"><table>
          <thead><tr><th>Date</th><th>Test</th><th>Correct</th><th>Score</th><th>Result</th></tr></thead>
          <tbody>${attempts.map((a) => `<tr data-id="${a.id}"><td>${fmtDate(a.submitted_at)}</td><td>${esc(modeLabel(a))}</td><td>${a.correct}/${a.total}</td><td><b>${a.score}</b></td><td><span class="pill ${a.passed ? "pass" : "fail"}">${a.passed ? "Pass" : "Fail"}</span></td></tr>`).join("")}</tbody>
        </table></div>` : `<p class="muted">No tests yet. <a href="#/">Generate your first test</a>.</p>`}
      </section>`);
    document.querySelectorAll("tr[data-id]").forEach((r) => r.onclick = () => (location.hash = `#/result/${r.dataset.id}`));
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
