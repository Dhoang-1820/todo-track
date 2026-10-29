(function () {
  "use strict";

  var P = window.PLAN;
  var KEY = "ai200-tracker-v1";
  var DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var DAYF = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var TOTAL = P.weeks.length;
  var SAT_MIN = [120, 120, 90, 30];

  /* ---------- state ---------- */
  function defaults() {
    return { v: 1, start: P.startDefault, examWeek: P.examWeekDefault, done: {}, notes: {}, scores: [], minMode: false, theme: "auto" };
  }
  function load() {
    var s = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var o = JSON.parse(raw); if (o && typeof o === "object") s = Object.assign(s, o); }
    } catch (e) { /* storage blocked: run in memory */ }
    return s;
  }
  var S = load();
  var viewDay = null;
  var roadFilter = "all";
  var noteTimer = null;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { say("Could not save in this browser. Export your data from Settings."); }
  }
  function say(msg) {
    var el = document.getElementById("status");
    el.textContent = "";
    setTimeout(function () { el.textContent = msg; }, 30);
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function iso(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function monday(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
  function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function startMon() { return monday(pd(S.start) || pd(P.startDefault)); }
  function weekStart(n) { return addDays(startMon(), (n - 1) * 7); }
  function short(d) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  function longd(d) { return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); }
  function weekIndexToday() {
    var days = Math.round((today() - startMon()) / 864e5);
    return Math.floor(days / 7) + 1;
  }
  function hm(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + "h" + (m ? " " + m + "m" : "") : m + "m";
  }
  function phaseOf(n) {
    for (var i = 0; i < P.phases.length; i++) if (n >= P.phases[i].from && n <= P.phases[i].to) return P.phases[i];
    return P.phases[0];
  }

  /* ---------- plan to tasks ---------- */
  function tasksFor(w, d) {
    var light = !!w.light, T = [];
    function add(k, text, min, o) {
      T.push(Object.assign({ id: "w" + w.n + "d" + d + k, text: text, min: min, kind: "", core: false, opt: false }, o || {}));
    }
    var quizYourself = "Quiz yourself: 5 questions on today's topic, no notes";
    if (d === 0) {
      if (w.n > 1) add("r", "Review last week: flashcards and wrong answers", 20, { kind: "Spaced review" });
      add("t", "Learn: " + w.theory[0], 40, { kind: "Theory" });
      add("q", "Recall: " + w.retr, 20, { kind: "Retrieval", core: true });
      if (!light) add("l", "Lab: " + w.labs[0], 40, { kind: "Hands-on" });
    } else if ((d === 1 || d === 2) && !(light && d === 1)) {
      var i = light ? 1 : d;
      add("t", "Learn: " + w.theory[i], 40, { kind: "Theory" });
      add("l", "Lab: " + w.labs[i], 60, { kind: "Hands-on" });
      add("q", quizYourself, 20, { kind: "Retrieval", core: true });
    } else if (d === 3 && !light) {
      add("t", "Learn: " + w.theory[3], 30, { kind: "Theory" });
      add("l", "Lab: " + w.labs[3], 60, { kind: "Hands-on" });
      add("q", "Teach-back: explain this week's hardest topic aloud for 5 minutes, then write 5 flashcards", 30, { kind: "Retrieval", core: true });
    } else if (d === 4) {
      if (w.quiz) add("p", w.quiz, 60, { kind: "Practice test", core: true });
      else add("p", "Practice set: 20 questions on this week's topics", 40, { kind: "Practice test", core: true });
      add("f", "Fix every wrong answer and write why you missed it", 30, { kind: "Review" });
      add("n", "Write a 3-line note: what to revisit next week", 10, { kind: "Notes" });
    } else if (d === 5) {
      var steps = w.project.steps;
      steps.forEach(function (s, i) {
        var txt = i === 0 ? "Project (" + w.project.title + "): " + s : s;
        add("s" + i, txt, SAT_MIN[i] || 30, { kind: i === steps.length - 1 && /teardown|rest|delete/i.test(s) ? "Cleanup" : "Project", core: i === 0, opt: light });
        if (i === 0) add("ai", "AI step: " + w.ai, 30, { kind: "AI practice", opt: light });
      });
    } else if (d === 6) {
      add("o", "Optional: 20-minute flashcard pass", 20, { kind: "Spaced review", opt: true });
    }
    return T;
  }
  function required(T) { return T.filter(function (t) { return !t.opt; }); }
  function dayStat(w, d) {
    var T = tasksFor(w, d), R = required(T), done = 0, dm = 0, tm = 0, left = 0;
    T.forEach(function (t) { if (S.done[t.id]) dm += t.min; });
    R.forEach(function (t) { tm += t.min; if (S.done[t.id]) done++; else left += t.min; });
    return { tasks: T, req: R.length, done: done, doneMin: dm, totalMin: tm, leftMin: left };
  }
  function weekStat(w) {
    var o = { done: 0, total: 0, doneMin: 0, totalMin: 0 };
    for (var d = 0; d < 7; d++) {
      var s = dayStat(w, d);
      o.done += s.done; o.total += s.req; o.doneMin += s.doneMin; o.totalMin += s.totalMin;
    }
    return o;
  }
  function overall() {
    var o = { done: 0, total: 0, doneMin: 0, totalMin: 0, weeksDone: 0 };
    P.weeks.forEach(function (w) {
      var s = weekStat(w);
      o.done += s.done; o.total += s.total; o.doneMin += s.doneMin; o.totalMin += s.totalMin;
      if (s.total && s.done === s.total) o.weeksDone++;
    });
    return o;
  }

  /* ---------- html pieces ---------- */
  function taskItem(t) {
    return '<li class="task' + (t.opt ? " opt" : "") + '"><label>' +
      '<input type="checkbox" data-id="' + t.id + '"' + (S.done[t.id] ? " checked" : "") + '>' +
      '<span class="box" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg></span>' +
      '<span class="t-text">' + esc(t.text) + '<span class="t-meta">' + esc(t.kind) + '</span></span>' +
      '<span class="mins num">' + t.min + ' min</span></label></li>';
  }
  function bar(pct, label) {
    return '<div class="bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '" aria-label="' + esc(label) + '"><div class="bar-fill" style="width:' + pct + '%"></div></div>';
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function badges(w) {
    var p = phaseOf(w.n), out = '<span class="badge accent">' + esc(p.name) + '</span>';
    if (w.light) out += '<span class="badge">Light week</span>';
    if (w.n === S.examWeek) out += '<span class="badge warn">Exam target</span>';
    return out;
  }

  /* ---------- views ---------- */
  function vToday() {
    var wi = weekIndexToday(), before = wi < 1, after = wi > TOTAL;
    var html = "";
    if (after) {
      var o = overall();
      return '<div class="page-head"><p class="eyebrow">Plan finished</p><h1>The 26 weeks are over</h1></div>' +
        '<div class="card"><p>You completed ' + o.done + " of " + o.total + " planned tasks (" + pct(o.done, o.total) + '%).</p><div class="row"><a class="btn" href="#/progress">See progress</a><a class="btn ghost" href="#/settings">Change start date</a></div></div>';
    }
    if (before) wi = 1;
    var w = P.weeks[wi - 1];
    var tdi = (today().getDay() + 6) % 7;
    var d = viewDay != null ? viewDay : (before ? 0 : tdi);
    var date = addDays(weekStart(wi), d);
    var st = dayStat(w, d);
    var T = st.tasks;
    var shown = T;
    var rest = st.req === 0;
    if (S.minMode && !rest) shown = T.filter(function (t) { return t.core; });
    var allDone = st.req > 0 && st.done === st.req;

    if (before) {
      var n = Math.ceil((startMon() - today()) / 864e5);
      html += '<div class="notice"><strong>Your plan starts on ' + longd(startMon()) + "</strong> (in " + n + " day" + (n === 1 ? "" : "s") + "). You can preview and tick week 1 early, or change the start date in Settings.</div>";
    }

    html += '<section class="card hero" aria-labelledby="h-today">' +
      '<p class="eyebrow">Week ' + wi + " of " + TOTAL + " · " + DAYF[d] + " " + short(date) + (d === tdi && !before ? " · Today" : "") + "</p>" +
      '<h1 id="h-today">' + (rest ? "Rest day" : esc(w.title)) + "</h1>" +
      '<div class="row">' + badges(w) + "</div>";
    if (rest) {
      html += "<p>Rest is part of the plan. Sleep is when new material consolidates.</p>";
    } else {
      html += '<div class="row between"><span class="num"><strong>' + st.done + " of " + st.req + '</strong> done</span><span class="muted num">' +
        (allDone ? "All done for today" : hm(st.leftMin) + " left") + "</span></div>" + bar(pct(st.done, st.req), "Progress for " + DAYF[d]);
      html += '<label class="switch"><input type="checkbox" data-act="minmode"' + (S.minMode ? " checked" : "") + '> Tough day? Show only the essentials</label>';
    }
    html += "</section>";

    if (S.minMode && !rest) html += '<div class="notice">Minimum day: do just this. Anything more is a bonus, and the streak of showing up matters more than the length.</div>';
    if (shown.length) html += '<ul class="tasks" aria-label="Tasks for ' + DAYF[d] + '">' + shown.map(taskItem).join("") + "</ul>";
    if (allDone) html += '<div class="notice">Nice work. Close the laptop; sleep helps memory more than another hour.</div>';

    html += '<section aria-labelledby="h-week"><h2 id="h-week" class="sr-only">This week</h2><div class="days">';
    for (var i = 0; i < 7; i++) {
      var s = dayStat(w, i), label = s.req === 0 ? "Rest" : s.done + "/" + s.req;
      html += '<button class="day' + (i === tdi && !before ? " today" : "") + '" data-act="day" data-d="' + i + '" aria-pressed="' + (i === d) + '" aria-label="' + DAYF[i] + ": " + (s.req === 0 ? "rest day" : s.done + " of " + s.req + " done") + '"><span class="d">' + DAYS[i] + '</span><span class="c num">' + label + "</span></button>";
    }
    html += "</div></section>";

    html += '<div class="grid2"><section class="card" aria-labelledby="h-ai"><h2 id="h-ai">AI this week</h2><p>' + esc(w.ai) + "</p></section>";
    var ws = weekStat(w);
    html += '<section class="card" aria-labelledby="h-wk"><h2 id="h-wk">Week at a glance</h2><p class="num">' + ws.done + " of " + ws.total + " tasks · " + hm(ws.doneMin) + " logged</p>" + bar(pct(ws.done, ws.total), "Week progress") +
      '<div class="row"><a class="btn ghost" href="#/week/' + wi + '">Open full week</a>' + (wi < TOTAL ? '<a class="btn ghost" href="#/roadmap">See roadmap</a>' : "") + "</div></section></div>";

    var ex = S.examWeek && S.examWeek >= 1 && S.examWeek <= TOTAL ? weekStart(S.examWeek) : null;
    if (ex) {
      var left = Math.ceil((ex - today()) / 864e5);
      html += '<p class="muted">Exam target: week ' + S.examWeek + " (from " + short(ex) + ")" + (left > 0 ? ", " + left + " days away." : ".") + " Change it in Settings.</p>";
    }
    return html;
  }

  function weekCard(w, current) {
    var s = weekStat(w), s0 = weekStart(w.n), s1 = addDays(s0, 6);
    var complete = s.total && s.done === s.total;
    var h = '<details class="week' + (current ? " current" : "") + (complete ? " complete" : "") + '"' + (current ? " open" : "") + ">" +
      '<summary><span class="w-num num">W' + w.n + '</span><span class="w-main"><span class="w-title">' + esc(w.title) + "</span>" +
      '<span class="w-sub">' + short(s0) + " – " + short(s1) + (current ? " · This week" : "") + (w.n === S.examWeek ? " · Exam target" : "") + (w.light ? " · Light" : "") + "</span></span>" +
      '<span class="w-count num">' + (complete ? "Done" : s.done + "/" + s.total) + "</span></summary>" +
      '<div class="week-body">' +
      "<div><h3>Weekday theory</h3><ul>" + w.theory.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
      "<div><h3>Weekday labs</h3><ul>" + w.labs.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
      "<div><h3>Weekend project: " + esc(w.project.title) + "</h3><ul>" + w.project.steps.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
      "<div><h3>AI usage</h3><p>" + esc(w.ai) + "</p>" + (w.quiz ? '<h3 style="margin-top:12px">Checkpoint</h3><p>' + esc(w.quiz) + "</p>" : "") + "</div>" +
      '<div class="full"><a class="btn" href="#/week/' + w.n + '">Open checklist</a></div></div></details>';
    return h;
  }

  function vRoadmap() {
    var cur = weekIndexToday();
    var html = '<div class="page-head"><p class="eyebrow">26 weeks</p><h1>Roadmap</h1><p class="muted">Tap a week to see what it covers. Nothing is locked: open any week and tick tasks to catch up.</p></div>';
    html += '<div class="row" role="group" aria-label="Filter by phase"><button class="chip" data-act="filter" data-f="all" aria-pressed="' + (roadFilter === "all") + '">All</button>';
    P.phases.forEach(function (p) {
      html += '<button class="chip" data-act="filter" data-f="' + p.id + '" aria-pressed="' + (roadFilter === p.id) + '">' + p.id + "</button>";
    });
    html += "</div>";
    P.phases.forEach(function (p) {
      if (roadFilter !== "all" && roadFilter !== p.id) return;
      var dom = P.domains[p.domain], done = 0, total = 0;
      for (var n = p.from; n <= p.to; n++) { var s = weekStat(P.weeks[n - 1]); done += s.done; total += s.total; }
      html += '<section class="phase" aria-labelledby="ph-' + p.id + '"><div class="phase-head"><h2 id="ph-' + p.id + '">' + p.id + ". " + esc(p.name) + "</h2>" +
        '<p class="muted">Weeks ' + p.from + "–" + p.to + " · " + short(weekStart(p.from)) + " – " + short(addDays(weekStart(p.to), 6)) +
        (dom.weight ? " · exam weight " + dom.weight : "") + " · " + pct(done, total) + "% done</p></div>";
      for (var k = p.from; k <= p.to; k++) html += weekCard(P.weeks[k - 1], k === cur);
      html += "</section>";
    });
    return html;
  }

  function vWeek(n) {
    n = Math.max(1, Math.min(TOTAL, n || 1));
    var w = P.weeks[n - 1], s = weekStat(w), s0 = weekStart(n);
    var html = '<div class="page-head"><p class="eyebrow">Week ' + n + " of " + TOTAL + " · " + short(s0) + " – " + short(addDays(s0, 6)) + '</p><h1>' + esc(w.title) + "</h1>" +
      '<div class="row">' + badges(w) + "</div></div>" +
      '<div class="card">' + '<p class="num">' + s.done + " of " + s.total + " tasks · " + hm(s.doneMin) + " of " + hm(s.totalMin) + " planned</p>" + bar(pct(s.done, s.total), "Week progress") + "</div>";
    for (var d = 0; d < 7; d++) {
      var st = dayStat(w, d);
      html += '<section class="phase" aria-labelledby="d' + d + '"><h2 id="d' + d + '">' + DAYF[d] + ' <span class="muted num" style="font-weight:500;font-size:.9rem">' + short(addDays(s0, d)) + "</span></h2>";
      if (!st.tasks.length) html += '<p class="muted">Rest day.</p>';
      else html += '<ul class="tasks">' + st.tasks.map(taskItem).join("") + "</ul>";
      html += "</section>";
    }
    html += '<section class="card" aria-labelledby="notes-h"><h2 id="notes-h">Week notes</h2><div class="field"><label for="note" class="hint">What did you get wrong? What should you revisit?</label>' +
      '<textarea id="note" data-note="' + n + '" maxlength="2000">' + esc(S.notes[n] || "") + "</textarea></div></section>";
    html += '<section class="card"><h2>AI this week</h2><p>' + esc(w.ai) + "</p></section>";
    html += '<nav class="pager" aria-label="Week navigation">' +
      (n > 1 ? '<a class="btn ghost" href="#/week/' + (n - 1) + '">Week ' + (n - 1) + "</a>" : "<span></span>") +
      '<a class="btn ghost" href="#/roadmap">Roadmap</a>' +
      (n < TOTAL ? '<a class="btn ghost" href="#/week/' + (n + 1) + '">Week ' + (n + 1) + "</a>" : "<span></span>") + "</nav>";
    return html;
  }

  function ring(p) {
    var r = 48, c = 2 * Math.PI * r;
    return '<svg class="ring" viewBox="0 0 120 120" role="img" aria-label="' + p + ' percent of planned tasks done"><circle class="tr" cx="60" cy="60" r="' + r + '"/>' +
      '<circle class="fg" cx="60" cy="60" r="' + r + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - p / 100)).toFixed(1) + '" transform="rotate(-90 60 60)"/>' +
      '<text x="60" y="68" text-anchor="middle">' + p + "%</text></svg>";
  }

  function vProgress() {
    var o = overall(), cur = weekIndexToday();
    var html = '<div class="page-head"><p class="eyebrow">Your numbers</p><h1>Progress</h1></div>';
    html += '<section class="card" aria-labelledby="ov"><h2 id="ov">Overall</h2><div class="overall">' + ring(pct(o.done, o.total)) +
      '<div class="stats"><div class="stat"><span class="v num">' + hm(o.doneMin) + '</span><span class="l">studied</span></div>' +
      '<div class="stat"><span class="v num">' + o.weeksDone + "/" + TOTAL + '</span><span class="l">weeks complete</span></div>' +
      '<div class="stat"><span class="v num">' + o.done + '</span><span class="l">tasks done</span></div>' +
      '<div class="stat"><span class="v num">' + (o.total - o.done) + '</span><span class="l">tasks left</span></div></div></div>';
    var behind = null;
    for (var n = 1; n < Math.min(cur, TOTAL + 1); n++) {
      var s = weekStat(P.weeks[n - 1]);
      if (s.done < s.total) { behind = { n: n, left: s.total - s.done }; break; }
    }
    if (behind) html += '<div class="notice warn">Earlier weeks still have open tasks. Start with <a href="#/week/' + behind.n + '">week ' + behind.n + "</a> (" + behind.left + " left). Skipping is fine; just pick the heaviest topics first.</div>";
    html += "</section>";

    html += '<section class="card" aria-labelledby="dm"><h2 id="dm">Coverage by exam domain</h2>';
    Object.keys(P.domains).forEach(function (key) {
      var d = P.domains[key], done = 0, total = 0, weeks = [];
      P.phases.forEach(function (p) { if (p.domain === key) for (var n = p.from; n <= p.to; n++) { weeks.push(n); var s = weekStat(P.weeks[n - 1]); done += s.done; total += s.total; } });
      if (!weeks.length) return;
      var p = pct(done, total);
      html += '<div class="field"><div class="row between"><span><strong>' + esc(d.name) + "</strong>" + (d.weight ? ' <span class="muted">(' + d.weight + ")</span>" : "") + '</span><span class="num"><strong>' + p + "%</strong></span></div>" + bar(p, d.name + " coverage") + "</div>";
    });
    html += "</section>";

    var max = 1, i;
    var mins = P.weeks.map(function (w) { var s = weekStat(w); if (s.doneMin > max) max = s.doneMin; return s.doneMin; });
    html += '<section class="card" aria-labelledby="hw"><h2 id="hw">Study time per week</h2><div class="weekbars" role="img" aria-label="Minutes studied per week, weeks 1 to ' + TOTAL + '. Total ' + hm(o.doneMin) + '.">';
    for (i = 0; i < TOTAL; i++) {
      var h = mins[i] ? Math.max(4, Math.round((mins[i] / max) * 100)) : 100;
      html += '<span class="' + (mins[i] ? (i + 1 === cur ? "now" : "") : "zero") + '" style="height:' + (mins[i] ? h : 2) + '%" title="Week ' + (i + 1) + ": " + hm(mins[i]) + '"></span>';
    }
    html += '</div><p class="hint">Week 1 on the left. Orange marks the current week.</p></section>';

    html += '<section class="card" aria-labelledby="sc"><h2 id="sc">Practice scores</h2><p class="hint">Suggested rule: book the exam once two timed practice exams reach ' + P.passTarget + "% or more. This is my own threshold, not Microsoft's; the pass mark is 700 of 1000.</p>";
    var pe = S.scores.filter(function (x) { return x.type === "Practice exam"; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 2);
    var ok = pe.filter(function (x) { return x.score >= P.passTarget; }).length;
    html += '<p class="num"><strong>' + ok + " of your last " + Math.min(2, Math.max(pe.length, 2)) + "</strong> practice exams are at " + P.passTarget + "% or more.</p>";
    html += '<form data-form="score" class="form-grid two"><div class="field"><label for="sc-type">Type</label><select id="sc-type" name="type"><option>Practice exam</option><option>Mixed quiz</option><option>Friday set</option></select></div>' +
      '<div class="field"><label for="sc-score">Score (%)</label><input id="sc-score" name="score" type="number" inputmode="numeric" min="0" max="100" required></div>' +
      '<div class="field"><label for="sc-date">Date</label><input id="sc-date" name="date" type="date" value="' + iso(today()) + '" required></div>' +
      '<div class="field" style="align-content:end"><button class="btn" type="submit">Add score</button></div></form>';
    var list = S.scores.slice().map(function (x, idx) { return { x: x, idx: idx }; }).sort(function (a, b) { return a.x.date < b.x.date ? 1 : -1; });
    if (!list.length) html += '<p class="empty">No scores yet. Add your first quiz result above.</p>';
    else html += '<ul class="score-list">' + list.map(function (e) {
      return "<li><span><strong>" + esc(e.x.type) + '</strong> <span class="muted num">' + esc(e.x.date) + '</span></span><span class="sc num">' + e.x.score + '%</span><button class="icon-btn" data-act="delscore" data-i="' + e.idx + '" aria-label="Delete ' + esc(e.x.type) + " score from " + esc(e.x.date) + '">×</button></li>';
    }).join("") + "</ul>";
    html += "</section>";
    return html;
  }

  function vSettings() {
    var html = '<div class="page-head"><p class="eyebrow">Preferences</p><h1>Settings</h1></div>';
    html += '<section class="card" aria-labelledby="pl"><h2 id="pl">Plan</h2><div class="form-grid two">' +
      '<div class="field"><label for="set-start">Start date</label><input id="set-start" type="date" value="' + esc(S.start) + '" data-set="start"><span class="hint">Weeks run Monday to Sunday. If you pick another day, the plan starts that week\'s Monday.</span></div>' +
      '<div class="field"><label for="set-exam">Exam target week</label><select id="set-exam" data-set="exam">';
    for (var n = 1; n <= TOTAL; n++) html += '<option value="' + n + '"' + (n === S.examWeek ? " selected" : "") + ">Week " + n + " (" + short(weekStart(n)) + ")</option>";
    html += '</select><span class="hint">Default is week 20. Book the real exam only after your practice scores say you are ready.</span></div>' +
      '<div class="field"><label for="set-theme">Theme</label><select id="set-theme" data-set="theme">' +
      ["auto", "light", "dark"].map(function (t) { return '<option value="' + t + '"' + (S.theme === t ? " selected" : "") + ">" + (t === "auto" ? "Match my device" : t[0].toUpperCase() + t.slice(1)) + "</option>"; }).join("") + "</select></div></div></section>";
    html += '<section class="card" aria-labelledby="bk"><h2 id="bk">Your data</h2><p>Progress is saved only in this browser. Export a backup before clearing browser data or switching phones.</p>' +
      '<div class="row"><button class="btn" data-act="export">Export backup</button>' +
      '<input id="imp" class="sr-only" type="file" accept="application/json,.json" data-act="import"><label class="btn ghost" for="imp">Import backup</label>' +
      '<button class="btn danger" data-act="reset">Reset all progress</button></div></section>';
    html += '<section class="card" aria-labelledby="ab"><h2 id="ab">About this plan</h2><p>It follows the four AI-200 skill areas by weight, puts the biggest area (AI data management, 25-30%) on fresh weeks, and uses short retrieval practice and weekly spaced review instead of rereading. Always check the skills list on Microsoft Learn before booking: it can change.</p></section>';
    return html;
  }

  /* ---------- rendering and routing ---------- */
  var main = document.getElementById("main");
  var TITLES = { today: "Today", roadmap: "Roadmap", progress: "Progress", settings: "Settings", week: "Week" };

  var MOON = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  var SUN = '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
  function effectiveTheme() {
    if (S.theme === "light" || S.theme === "dark") return S.theme;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme() {
    if (S.theme === "light" || S.theme === "dark") document.documentElement.setAttribute("data-theme", S.theme);
    else document.documentElement.removeAttribute("data-theme");
    var eff = effectiveTheme(), btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.innerHTML = eff === "dark" ? SUN : MOON;
      btn.setAttribute("aria-label", eff === "dark" ? "Switch to light theme" : "Switch to dark theme");
    }
    Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) {
      m.removeAttribute("media"); m.setAttribute("content", eff === "dark" ? "#161715" : "#f4f2ee");
    });
  }
  document.getElementById("theme-toggle").addEventListener("click", function () {
    S.theme = effectiveTheme() === "dark" ? "light" : "dark";
    save(); applyTheme();
    var sel = document.getElementById("set-theme"); if (sel) sel.value = S.theme;
    say(S.theme === "dark" ? "Dark theme on" : "Light theme on");
  });
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onMq = function () { if (S.theme === "auto") applyTheme(); };
    if (mq.addEventListener) mq.addEventListener("change", onMq);
  }

  function current() {
    var parts = (location.hash.replace(/^#\/?/, "") || "today").split("/");
    return { name: TITLES[parts[0]] ? parts[0] : "today", arg: parseInt(parts[1], 10) };
  }

  function render(nav) {
    var r = current(), html;
    if (r.name === "roadmap") html = vRoadmap();
    else if (r.name === "week") html = vWeek(r.arg);
    else if (r.name === "progress") html = vProgress();
    else if (r.name === "settings") html = vSettings();
    else html = vToday();
    main.innerHTML = html;
    var navName = r.name === "week" ? "roadmap" : r.name;
    Array.prototype.forEach.call(document.querySelectorAll(".nav a"), function (a) {
      if (a.getAttribute("data-route") === navName) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.title = (r.name === "week" ? "Week " + (r.arg || 1) : TITLES[r.name]) + " · AI-200 Tracker";
    if (nav) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  }

  window.addEventListener("hashchange", function () { viewDay = null; render(true); });

  /* ---------- events ---------- */
  main.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches('input[type="checkbox"][data-id]')) {
      var id = t.getAttribute("data-id");
      if (t.checked) S.done[id] = true; else delete S.done[id];
      save();
      var y = window.scrollY;
      render(false);
      window.scrollTo(0, y);
      var again = main.querySelector('input[data-id="' + id + '"]');
      if (again) again.focus({ preventScroll: true });
      say(t.checked ? "Task done" : "Task unchecked");
    } else if (t.matches('[data-act="minmode"]')) {
      S.minMode = t.checked; save(); render(false);
      var sw = main.querySelector('[data-act="minmode"]'); if (sw) sw.focus({ preventScroll: true });
    } else if (t.matches("[data-set]")) {
      var k = t.getAttribute("data-set");
      if (k === "start") { if (pd(t.value)) { S.start = t.value; save(); say("Start date saved"); } }
      else if (k === "exam") { S.examWeek = parseInt(t.value, 10); save(); say("Exam target saved"); }
      else if (k === "theme") { S.theme = t.value; applyTheme(); save(); }
    } else if (t.matches('[data-act="import"]')) {
      importFile(t.files && t.files[0]); t.value = "";
    }
  });

  main.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b || b.tagName === "INPUT") return;
    var act = b.getAttribute("data-act");
    if (act === "day") { viewDay = parseInt(b.getAttribute("data-d"), 10); render(false); var nb = main.querySelector('.day[data-d="' + viewDay + '"]'); if (nb) nb.focus({ preventScroll: true }); }
    else if (act === "filter") { roadFilter = b.getAttribute("data-f"); render(false); var f = main.querySelector('[data-f="' + roadFilter + '"]'); if (f) f.focus({ preventScroll: true }); }
    else if (act === "delscore") {
      var i = parseInt(b.getAttribute("data-i"), 10);
      if (S.scores[i] && window.confirm("Delete this score?")) { S.scores.splice(i, 1); save(); render(false); say("Score deleted"); }
    }
    else if (act === "export") exportData();
    else if (act === "reset") {
      if (window.confirm("Reset all progress, notes and scores in this browser? This cannot be undone.")) {
        S = defaults(); save(); applyTheme(); render(false); say("Progress reset");
      }
    }
  });

  main.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.getAttribute("data-form") !== "score") return;
    e.preventDefault();
    var score = parseInt(f.elements.score.value, 10), date = f.elements.date.value, type = f.elements.type.value;
    if (isNaN(score) || score < 0 || score > 100 || !pd(date)) { say("Enter a score from 0 to 100 and a valid date."); return; }
    S.scores.push({ type: type, score: score, date: date });
    save(); render(false); say("Score added");
  });

  main.addEventListener("input", function (e) {
    var t = e.target;
    if (t.matches("textarea[data-note]")) {
      var n = t.getAttribute("data-note"), v = t.value;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { if (v.trim()) S.notes[n] = v; else delete S.notes[n]; save(); }, 400);
    }
  });

  /* ---------- export / import ---------- */
  function exportData() {
    var blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ai200-progress-" + iso(today()) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    say("Backup downloaded");
  }
  function importFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var o = JSON.parse(rd.result);
        if (!o || typeof o !== "object" || typeof o.done !== "object") throw new Error("bad");
        var next = defaults();
        Object.keys(o.done || {}).forEach(function (k) { if (/^w\d{1,2}d[0-6][a-z0-9]{1,3}$/.test(k) && o.done[k] === true) next.done[k] = true; });
        if (pd(o.start)) next.start = o.start;
        var ew = parseInt(o.examWeek, 10); if (ew >= 1 && ew <= TOTAL) next.examWeek = ew;
        if (["auto", "light", "dark"].indexOf(o.theme) >= 0) next.theme = o.theme;
        next.minMode = o.minMode === true;
        if (Array.isArray(o.scores)) o.scores.slice(0, 500).forEach(function (x) {
          if (x && typeof x.score === "number" && x.score >= 0 && x.score <= 100 && pd(x.date) && ["Practice exam", "Mixed quiz", "Friday set"].indexOf(x.type) >= 0) next.scores.push({ type: x.type, score: Math.round(x.score), date: x.date });
        });
        if (o.notes && typeof o.notes === "object") Object.keys(o.notes).forEach(function (k) { var n = parseInt(k, 10); if (n >= 1 && n <= TOTAL && typeof o.notes[k] === "string") next.notes[n] = o.notes[k].slice(0, 2000); });
        if (!window.confirm("Replace the progress in this browser with the backup?")) return;
        S = next; save(); applyTheme(); render(false); say("Backup imported");
      } catch (err) { say("That file is not a valid backup."); window.alert("That file is not a valid backup."); }
    };
    rd.readAsText(file);
  }

  /* ---------- start ---------- */
  applyTheme();
  if (!location.hash) location.hash = "#/today";
  render(false);
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
