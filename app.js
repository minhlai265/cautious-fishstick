(function () {
  "use strict";
  const D = window.IELTS_DATA;
  const app = document.getElementById("app");

  /* ================= Utilities ================= */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/[.,!?;:]+$/g, "").replace(/\s+/g, " ");

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("ielts." + key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem("ielts." + key, JSON.stringify(val)); } catch (e) { /* ignore */ }
    }
  };

  // Cleanup callbacks run when leaving a page (timers, audio, recorders).
  let cleanups = [];
  const onLeave = (fn) => cleanups.push(fn);
  function runCleanups() { cleanups.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); cleanups = []; }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function countdown(el, seconds, onEnd) {
    let left = seconds;
    el.textContent = fmtTime(left);
    const id = setInterval(() => {
      left--;
      el.textContent = fmtTime(Math.max(left, 0));
      el.classList.toggle("low", left <= 60);
      if (left <= 0) { clearInterval(id); onEnd && onEnd(); }
    }, 1000);
    const stop = () => clearInterval(id);
    onLeave(stop);
    return { stop, elapsed: () => seconds - left };
  }

  /* ================= Band scores ================= */
  // Bảng quy đổi (thang 40 câu) tham khảo phổ biến.
  const READING_TABLE = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [0, 0]];
  const LISTENING_TABLE = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [11, 4], [8, 3.5], [6, 3], [4, 2.5], [0, 0]];
  function bandFromRaw(correct, total, table) {
    const scaled = Math.round((correct / total) * 40);
    for (const [min, band] of table) if (scaled >= min) return band;
    return 0;
  }
  // Làm tròn theo quy tắc IELTS: .25 → .5, .75 → lên 1.
  function roundBand(x) {
    const f = Math.floor(x), d = x - f;
    if (d < 0.25) return f;
    if (d < 0.75) return f + 0.5;
    return f + 1;
  }
  const fmtBand = (b) => (b == null ? "–" : Number(b).toFixed(1));

  function saveResult(rec) {
    const hist = store.get("history", []);
    hist.push(Object.assign({ date: new Date().toISOString() }, rec));
    store.set("history", hist.slice(-200));
  }
  function skillAverages() {
    const hist = store.get("history", []);
    const out = {};
    ["reading", "listening", "writing", "speaking"].forEach((sk) => {
      const items = hist.filter((h) => h.skill === sk && typeof h.band === "number").slice(-5);
      out[sk] = items.length ? roundBand(items.reduce((a, b) => a + b.band, 0) / items.length) : null;
    });
    const vals = Object.values(out).filter((v) => v != null);
    out.overall = vals.length ? roundBand(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    out.complete = vals.length === 4;
    return out;
  }

  /* ================= Text-to-speech ================= */
  const tts = {
    supported: "speechSynthesis" in window,
    voices: [],
    load() {
      if (!this.supported) return;
      const pick = () => { this.voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang)); };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    },
    voiceFor(gender) {
      const v = this.voices;
      if (!v.length) return null;
      const gb = v.filter((x) => /en[-_]GB/i.test(x.lang));
      const pool = gb.length >= 2 ? gb : v;
      const female = /female|woman|samantha|victoria|karen|serena|susan|hazel|libby|sonia|kate|zira|aria|jenny|moira|fiona|tessa/i;
      const male = /\bmale\b|daniel|george|ryan|thomas|arthur|david|mark|guy|oliver|fred|alex|rishi/i;
      const match = pool.find((x) => (gender === "F" ? female : male).test(x.name));
      if (match) return match;
      return gender === "F" ? pool[0] : pool[Math.min(1, pool.length - 1)];
    },
    speak(text, gender = "F", rate = 1) {
      return new Promise((resolve) => {
        if (!this.supported) return resolve();
        const u = new SpeechSynthesisUtterance(text);
        const voice = this.voiceFor(gender);
        if (voice) u.voice = voice;
        u.lang = voice ? voice.lang : "en-GB";
        u.rate = rate;
        u.pitch = gender === "F" ? 1.1 : 0.85;
        u.onend = u.onerror = () => resolve();
        speechSynthesis.speak(u);
      });
    },
    stop() { if (this.supported) speechSynthesis.cancel(); }
  };
  tts.load();

  /* ================= Question rendering & grading ================= */
  function renderGroups(groups, prefix) {
    let n = 0;
    return groups.map((g, gi) => {
      const items = g.items.map((it, ii) => {
        n++;
        const name = `${prefix}-${gi}-${ii}`;
        let input = "";
        if (g.type === "choice") {
          input = `<select name="${name}" aria-label="Câu ${n}"><option value="">— chọn —</option>${g.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
          return `<div class="q" data-q="${name}"><div><span class="num">${n}</span>${esc(it.q)}</div><div style="margin-top:8px">${input}</div><div class="feedback"></div></div>`;
        }
        if (g.type === "mcq") {
          input = it.options.map((o) => `<label class="opt"><input type="radio" name="${name}" value="${esc(o.charAt(0))}"> <span>${esc(o)}</span></label>`).join("");
          return `<div class="q" data-q="${name}"><div><span class="num">${n}</span>${esc(it.q)}</div><div style="margin-top:6px">${input}</div><div class="feedback"></div></div>`;
        }
        // gap
        const parts = esc(it.q).split("____");
        input = `<input type="text" name="${name}" autocomplete="off" spellcheck="false" aria-label="Câu ${n}">`;
        return `<div class="q" data-q="${name}"><span class="num">${n}</span>${parts[0]}${input}${parts[1] || ""}<div class="feedback"></div></div>`;
      }).join("");
      return `<section class="q-group"><h3>${esc(g.title)}</h3><div class="instr">${esc(g.instr)}</div><div class="questions">${items}</div></section>`;
    }).join("");
  }

  function gradeGroups(root, groups, prefix) {
    let correct = 0, total = 0;
    groups.forEach((g, gi) => g.items.forEach((it, ii) => {
      total++;
      const name = `${prefix}-${gi}-${ii}`;
      const box = $(`[data-q="${name}"]`, root);
      let val = "";
      if (g.type === "mcq") { const r = $(`input[name="${name}"]:checked`, root); val = r ? r.value : ""; }
      else { val = $(`[name="${name}"]`, root).value; }
      const answers = Array.isArray(it.a) ? it.a : [it.a];
      const ok = val !== "" && answers.some((a) => norm(a) === norm(val));
      if (ok) correct++;
      box.classList.remove("correct", "wrong");
      box.classList.add(ok ? "correct" : "wrong");
      $$("input, select", box).forEach((el) => (el.disabled = true));
      $(".feedback", box).innerHTML =
        (ok ? "✅ Chính xác" : `❌ Đáp án: <span class="ans">${esc(answers[0])}</span>`) +
        (it.ex ? ` <span class="explain">— ${esc(it.ex)}</span>` : "");
    }));
    return { correct, total };
  }

  function countQuestions(groups) { return groups.reduce((a, g) => a + g.items.length, 0); }

  function resultCard(correct, total, band, extra = "") {
    return `<div class="card result"><div><div class="muted small">Điểm ước tính</div><div class="big">${fmtBand(band)}</div></div>
      <div><strong>${correct}/${total}</strong> câu đúng (${Math.round((correct / total) * 100)}%)<br>
      <span class="muted small">Quy đổi sang thang 40 câu: ~${Math.round((correct / total) * 40)}/40</span></div>
      <div class="spacer"></div>${extra}</div>`;
  }

  /* ================= Pages ================= */
  function pageHome() {
    const avg = skillAverages();
    const pct = avg.overall ? (avg.overall / 9) * 100 : 0;
    const skills = [
      ["reading", "📖", "Reading", "Đọc hiểu học thuật với True/False/Not Given, trắc nghiệm, điền từ."],
      ["listening", "🎧", "Listening", "Nghe hội thoại & độc thoại, điền form, trắc nghiệm."],
      ["writing", "✍️", "Writing", "Task 1 biểu đồ & Task 2 nghị luận, đếm từ, phân tích bài viết."],
      ["speaking", "🗣️", "Speaking", "Part 1–3, cue card, bấm giờ chuẩn và ghi âm câu trả lời."],
      ["vocab", "🧠", "Từ vựng", "Flashcard & quiz theo chủ đề thường gặp trong IELTS."],
      ["progress", "📈", "Tiến độ", "Lịch sử làm bài và band ước tính theo từng kỹ năng."]
    ];
    app.innerHTML = `
      <section class="hero">
        <div>
          <span class="badge red">IELTS Academic</span>
          <h1>Luyện thi IELTS mỗi ngày, đủ 4 kỹ năng</h1>
          <p class="lead">Làm bài có bấm giờ, chấm điểm tự động, xem giải thích đáp án và theo dõi band điểm của bạn — hoàn toàn trên trình duyệt.</p>
          <div class="row"><a class="btn primary" href="#/reading">Bắt đầu với Reading</a><a class="btn" href="#/speaking">Luyện Speaking</a></div>
        </div>
        <div class="card" style="text-align:center">
          <div class="band-ring" style="--p:${pct}"><div><div class="muted small">Overall</div><strong>${fmtBand(avg.overall)}</strong></div></div>
          <p class="muted small" style="margin:12px 0 0">${avg.overall == null ? "Làm bài đầu tiên để xem band ước tính." : avg.complete ? "Trung bình 5 bài gần nhất của mỗi kỹ năng." : "Chưa đủ 4 kỹ năng – band tạm tính."}</p>
        </div>
      </section>
      <div class="grid">
        ${skills.map(([k, i, t, d]) => `<a class="card skill-card" href="#/${k}"><span class="icon">${i}</span><h3>${t}</h3><p class="muted small" style="margin:0">${d}</p>${avg[k] !== undefined ? `<span class="badge">Band: ${fmtBand(avg[k])}</span>` : ""}</a>`).join("")}
      </div>
      <h2 style="margin-top:32px">Mẹo nhanh</h2>
      <div class="grid">
        <div class="card"><h3>Reading</h3><p class="small muted">Đọc câu hỏi trước, gạch chân từ khóa rồi scan bài. Với NOT GIVEN: thông tin không được nhắc tới, đừng suy diễn.</p></div>
        <div class="card"><h3>Listening</h3><p class="small muted">Tận dụng thời gian trước khi nghe để đoán loại từ cần điền (số, danh từ, tên riêng). Chú ý chính tả!</p></div>
        <div class="card"><h3>Writing</h3><p class="small muted">Task 1 luôn cần câu Overview. Task 2 phải trả lời đúng và đủ mọi phần của đề bài.</p></div>
        <div class="card"><h3>Speaking</h3><p class="small muted">Mở rộng câu trả lời: Trả lời → Lý do → Ví dụ. Đừng học thuộc lòng – giám khảo nhận ra ngay.</p></div>
      </div>`;
  }

  function testList(kind, items, icon) {
    const hist = store.get("history", []);
    return `<div class="list">${items.map((t) => {
      const last = hist.filter((h) => h.testId === t.id).pop();
      return `<div class="card list-item"><span style="font-size:1.6rem">${icon}</span>
        <div><h3>${esc(t.title)}</h3><div class="muted small">${t.desc ? esc(t.desc) + " · " : ""}${countQuestions(t.groups)} câu${t.minutes ? " · " + t.minutes + " phút" : ""}</div></div>
        <div class="spacer"></div>
        ${last ? `<span class="badge">Lần trước: ${last.correct}/${last.total} · Band ${fmtBand(last.band)}</span>` : ""}
        <a class="btn primary" href="#/${kind}/${t.id}">Làm bài</a></div>`;
    }).join("")}</div>`;
  }

  function pageReadingList() {
    app.innerHTML = `<h1>Reading</h1><p class="muted">Mỗi bài đọc tương đương một passage trong đề thi thật (khoảng 20 phút). Đáp án điền từ không phân biệt chữ hoa/thường.</p>${testList("reading", D.reading, "📖")}`;
  }

  function pageReadingTest(id) {
    const t = D.reading.find((x) => x.id === id);
    if (!t) return notFound();
    const prefix = "r";
    app.innerHTML = `
      <div class="test-head"><a class="btn small" href="#/reading">← Danh sách</a><h2 style="margin:0">${esc(t.title)}</h2><div class="spacer"></div><span class="timer" id="timer"></span></div>
      <div id="result"></div>
      <div class="split">
        <article class="card passage"><h2>${esc(t.title)}</h2>${t.paragraphs.map(([l, p]) => `<p><span class="para-label">${l}</span>${esc(p)}</p>`).join("")}</article>
        <form class="stack" id="qform">${renderGroups(t.groups, prefix)}<button class="btn primary" type="submit">Nộp bài</button></form>
      </div>`;
    const timer = countdown($("#timer"), t.minutes * 60, () => { alert("Hết giờ! Bài làm sẽ được nộp."); submit(); });
    let done = false;
    function submit() {
      if (done) return; done = true; timer.stop();
      const { correct, total } = gradeGroups(app, t.groups, prefix);
      const band = bandFromRaw(correct, total, READING_TABLE);
      saveResult({ skill: "reading", testId: t.id, title: t.title, correct, total, band });
      $("#result").innerHTML = resultCard(correct, total, band, `<button class="btn" id="retry">Làm lại</button>`) ;
      $("#retry").onclick = () => route();
      $('#qform button[type="submit"]').disabled = true;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    $("#qform").onsubmit = (e) => { e.preventDefault(); submit(); };
  }

  function pageListeningList() {
    app.innerHTML = `<h1>Listening</h1>
      <p class="muted">Audio được đọc bằng giọng tổng hợp của trình duyệt (Text-to-Speech). Giống bài thi thật, bạn chỉ nên nghe <strong>một lần</strong> — bản transcript sẽ hiện sau khi nộp bài.</p>
      ${tts.supported ? "" : `<div class="card" style="border-color:var(--bad)">⚠️ Trình duyệt của bạn không hỗ trợ Text-to-Speech. Hãy thử Chrome, Edge hoặc Safari.</div>`}
      ${testList("listening", D.listening, "🎧")}`;
  }

  function pageListeningTest(id) {
    const t = D.listening.find((x) => x.id === id);
    if (!t) return notFound();
    const prefix = "l";
    app.innerHTML = `
      <div class="test-head"><a class="btn small" href="#/listening">← Danh sách</a><h2 style="margin:0">${esc(t.title)}</h2></div>
      <div id="result"></div>
      <div class="card stack">
        <div class="row">
          <button class="btn primary" id="play">▶ Phát audio</button>
          <button class="btn" id="stop" disabled>■ Dừng</button>
          <label class="small muted">Tốc độ
            <select id="rate"><option value="0.85">Chậm</option><option value="1" selected>Bình thường</option><option value="1.1">Nhanh</option></select>
          </label>
          <span class="spacer"></span>
          <span class="muted small" id="status">${tts.supported ? "Đọc trước câu hỏi rồi bấm phát." : "TTS không khả dụng."}</span>
        </div>
      </div>
      <form class="stack" id="qform" style="margin-top:16px">${renderGroups(t.groups, prefix)}<button class="btn primary" type="submit">Nộp bài</button></form>
      <details id="script" style="margin-top:16px" hidden><summary>Transcript</summary>${t.script.map(([g, s]) => `<p><strong>${g === "F" ? "Woman" : "Man"}:</strong> ${esc(s)}</p>`).join("")}</details>`;

    let playing = false, plays = 0;
    const playBtn = $("#play"), stopBtn = $("#stop"), status = $("#status");
    playBtn.disabled = !tts.supported;
    playBtn.onclick = async () => {
      if (plays >= 1 && !confirm("Trong bài thi thật bạn chỉ được nghe một lần. Vẫn nghe lại?")) return;
      plays++;
      playing = true; playBtn.disabled = true; stopBtn.disabled = false;
      const rate = parseFloat($("#rate").value);
      for (let i = 0; i < t.script.length && playing; i++) {
        status.textContent = `Đang phát… (${i + 1}/${t.script.length})`;
        await tts.speak(t.script[i][1], t.script[i][0], rate);
        if (playing) await new Promise((r) => setTimeout(r, 350));
      }
      if (playing) status.textContent = "Đã phát xong. Kiểm tra lại đáp án và nộp bài.";
      playing = false; playBtn.disabled = false; stopBtn.disabled = true;
    };
    stopBtn.onclick = () => { playing = false; tts.stop(); status.textContent = "Đã dừng."; };
    onLeave(() => { playing = false; tts.stop(); });

    $("#qform").onsubmit = (e) => {
      e.preventDefault();
      playing = false; tts.stop();
      const { correct, total } = gradeGroups(app, t.groups, prefix);
      const band = bandFromRaw(correct, total, LISTENING_TABLE);
      saveResult({ skill: "listening", testId: t.id, title: t.title, correct, total, band });
      $("#result").innerHTML = resultCard(correct, total, band, `<button class="btn" id="retry">Làm lại</button>`);
      $("#retry").onclick = () => route();
      $('#qform button[type="submit"]').disabled = true;
      $("#script").hidden = false; $("#script").open = true;
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  }

  /* ---------- Writing ---------- */
  function chartSVG(c) {
    const W = 560, H = 300, L = 44, R = 16, T = 16, B = 56;
    const pw = W - L - R, ph = H - T - B;
    const colors = ["#c8102e", "#1f4e9c", "#e0a100", "#2a9d8f"];
    const y = (v) => T + ph - (v / c.max) * ph;
    let g = "";
    for (let i = 0; i <= 5; i++) {
      const v = (c.max / 5) * i, yy = y(v);
      g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity=".15"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${Math.round(v)}${c.unit}</text>`;
    }
    const n = c.categories.length;
    if (c.kind === "bar") {
      const gw = pw / n, bw = (gw * 0.7) / c.series.length;
      c.categories.forEach((cat, ci) => {
        const x0 = L + gw * ci + gw * 0.15;
        c.series.forEach((s, si) => {
          const v = s.values[ci];
          g += `<rect x="${x0 + bw * si}" y="${y(v)}" width="${bw - 2}" height="${T + ph - y(v)}" fill="${colors[si]}" rx="2"><title>${esc(cat)} ${esc(s.name)}: ${v}${c.unit}</title></rect>`;
        });
        g += `<text x="${L + gw * ci + gw / 2}" y="${T + ph + 18}" text-anchor="middle">${esc(cat)}</text>`;
      });
    } else {
      const x = (i) => L + (pw / (n - 1)) * i;
      c.categories.forEach((cat, i) => (g += `<text x="${x(i)}" y="${T + ph + 18}" text-anchor="middle">${esc(cat)}</text>`));
      c.series.forEach((s, si) => {
        g += `<polyline fill="none" stroke="${colors[si]}" stroke-width="2.5" points="${s.values.map((v, i) => x(i) + "," + y(v)).join(" ")}"/>`;
        s.values.forEach((v, i) => (g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${colors[si]}"><title>${esc(s.name)} ${c.categories[i]}: ${v}${c.unit}</title></circle>`));
      });
    }
    // legend
    let lx = L;
    c.series.forEach((s, si) => { g += `<rect x="${lx}" y="${H - 20}" width="12" height="12" fill="${colors[si]}" rx="2"/><text x="${lx + 16}" y="${H - 10}">${esc(s.name)}</text>`; lx += 90; });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ" style="color:var(--text)">${g}</svg>`;
  }

  function pageWritingList() {
    const card = (t, task) => `<div class="card list-item"><span class="badge red">Task ${task}</span>
      <div style="flex:1;min-width:200px"><h3>${esc(t.title || t.type)}</h3><div class="muted small">${esc(t.prompt.slice(0, 120))}…</div></div>
      <a class="btn primary" href="#/writing/${t.id}">Viết bài</a></div>`;
    app.innerHTML = `<h1>Writing</h1>
      <p class="muted">Task 1: tối thiểu 150 từ trong 20 phút. Task 2: tối thiểu 250 từ trong 40 phút. Bài viết được tự động lưu nháp trên trình duyệt.</p>
      <h2>Task 1 – Mô tả biểu đồ</h2><div class="list">${D.writing.task1.map((t) => card(t, 1)).join("")}</div>
      <h2 style="margin-top:28px">Task 2 – Bài luận</h2><div class="list">${D.writing.task2.map((t) => card(t, 2)).join("")}</div>`;
  }

  const LINKERS = ["however", "moreover", "furthermore", "in addition", "therefore", "consequently", "nevertheless", "on the other hand", "in contrast", "whereas", "while", "although", "for example", "for instance", "in conclusion", "to sum up", "overall", "firstly", "secondly", "finally", "as a result", "similarly", "meanwhile", "despite", "in spite of", "thus", "hence"];
  const STOP = new Set("the a an and or but of to in on at for with by from is are was were be been being it its this that these those as which who whom their there they them he she his her we our you your i my me not no so than then also can could would should will may might must do does did have has had more most such very into over about between".split(" "));

  function analyze(text) {
    const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    const paras = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
    const sentences = text.split(/[.!?]+(\s|$)/).filter((s) => s && s.trim().length > 2).length;
    const lower = " " + text.toLowerCase().replace(/\s+/g, " ") + " ";
    const linkers = LINKERS.filter((l) => new RegExp("\\b" + l.replace(/ /g, "\\s+") + "\\b").test(lower));
    const freq = {};
    words.forEach((w) => { const k = w.toLowerCase(); if (!STOP.has(k) && k.length > 3) freq[k] = (freq[k] || 0) + 1; });
    const repeated = Object.entries(freq).filter(([, c]) => c >= 4).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const unique = new Set(words.map((w) => w.toLowerCase())).size;
    return { words: words.length, paras, sentences, avgLen: sentences ? Math.round(words.length / sentences) : 0, linkers, repeated, lexical: words.length ? Math.round((unique / words.length) * 100) : 0 };
  }

  function pageWritingTask(id) {
    let task = D.writing.task1.find((x) => x.id === id), num = 1;
    if (!task) { task = D.writing.task2.find((x) => x.id === id); num = 2; }
    if (!task) return notFound();
    const minWords = num === 1 ? 150 : 250, minutes = num === 1 ? 20 : 40;
    const draftKey = "draft." + id;
    const criteria = num === 1
      ? ["Task Achievement", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy"]
      : ["Task Response", "Coherence & Cohesion", "Lexical Resource", "Grammatical Range & Accuracy"];
    const checklist = num === 1
      ? ["Có câu mở bài paraphrase đề", "Có đoạn Overview nêu xu hướng chính", "Dẫn số liệu cụ thể và so sánh", "Không đưa ý kiến cá nhân", "Chia đoạn rõ ràng"]
      : ["Trả lời đầy đủ mọi phần của đề", "Nêu rõ quan điểm (nếu đề yêu cầu)", "Mỗi đoạn thân bài có 1 ý chính + giải thích + ví dụ", "Có đoạn kết luận", "Dùng từ nối đa dạng, không lặp từ"];

    app.innerHTML = `
      <div class="test-head"><a class="btn small" href="#/writing">← Danh sách</a><h2 style="margin:0">Writing Task ${num}${task.type ? " · " + esc(task.type) : ""}</h2><div class="spacer"></div>
        <button class="btn small" id="startTimer">⏱ Bấm giờ ${minutes} phút</button><span class="timer" id="timer" hidden></span></div>
      <div class="split">
        <div class="stack">
          <div class="prompt-box"><p style="margin:0">${esc(task.prompt)}</p><p class="muted small" style="margin:8px 0 0">Write at least ${minWords} words.</p></div>
          ${task.chart ? `<div class="card chart">${chartSVG(task.chart)}<p class="muted small" style="margin:8px 0 0;text-align:center">Số liệu minh họa dùng cho luyện tập.</p></div>` : ""}
          ${task.tips ? `<details><summary>💡 Gợi ý dàn ý</summary><ul>${task.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></details>` : ""}
          ${task.sample ? `<details><summary>📄 Bài mẫu tham khảo</summary>${task.sample.split("\n\n").map((p) => `<p>${esc(p)}</p>`).join("")}<p class="muted small">${analyze(task.sample).words} words</p></details>` : ""}
          <div class="card checklist"><h3>Tự kiểm tra</h3>${checklist.map((c, i) => `<label><input type="checkbox" data-ck="${i}"> ${esc(c)}</label>`).join("")}</div>
        </div>
        <div class="stack">
          <textarea id="essay" placeholder="Viết bài của bạn ở đây (bằng tiếng Anh)…" spellcheck="false"></textarea>
          <div class="row small"><span id="wc" class="badge">0 words</span><span class="muted" id="saved"></span><span class="spacer"></span><button class="btn small" id="analyzeBtn">Phân tích bài viết</button></div>
          <div id="analysis"></div>
          <div class="card"><h3>Tự chấm theo 4 tiêu chí</h3>
            <p class="muted small">So sánh bài viết với bài mẫu và band descriptors, rồi chọn band cho từng tiêu chí.</p>
            <div class="criteria">${criteria.map((c, i) => `<label class="small">${c}<select data-crit="${i}"><option value="">–</option>${[9, 8, 7, 6, 5, 4, 3].map((b) => `<option>${b}</option>`).join("")}</select></label>`).join("")}</div>
            <div class="row" style="margin-top:12px"><button class="btn primary" id="saveScore">Lưu điểm</button><span id="scoreOut" class="muted"></span></div>
          </div>
        </div>
      </div>`;

    const ta = $("#essay"), wc = $("#wc");
    ta.value = store.get(draftKey, "");
    const update = () => {
      const n = analyze(ta.value).words;
      wc.textContent = n + " words";
      wc.className = "badge" + (n >= minWords ? "" : " red");
    };
    let saveT;
    ta.addEventListener("input", () => {
      update();
      clearTimeout(saveT);
      saveT = setTimeout(() => { store.set(draftKey, ta.value); $("#saved").textContent = "Đã lưu nháp"; }, 600);
    });
    onLeave(() => { clearTimeout(saveT); store.set(draftKey, ta.value); });
    update();

    $("#startTimer").onclick = (e) => {
      e.target.hidden = true;
      const el = $("#timer"); el.hidden = false;
      countdown(el, minutes * 60, () => alert("Hết giờ! Hãy dừng bút và kiểm tra lại bài."));
    };

    $("#analyzeBtn").onclick = () => {
      const a = analyze(ta.value);
      const tips = [];
      if (a.words < minWords) tips.push(`Bài viết mới có ${a.words} từ – cần tối thiểu ${minWords} từ, nếu thiếu sẽ bị trừ điểm.`);
      if (a.paras < (num === 1 ? 3 : 4)) tips.push(`Chỉ có ${a.paras} đoạn. Nên chia ${num === 1 ? "3–4" : "4–5"} đoạn (cách nhau bằng một dòng trống).`);
      if (a.linkers.length < 4) tips.push("Dùng thêm từ nối (However, Moreover, In contrast…) để tăng điểm Coherence & Cohesion.");
      if (a.avgLen > 30) tips.push("Câu trung bình khá dài – kiểm tra lỗi câu chạy (run-on sentence).");
      if (a.avgLen && a.avgLen < 11) tips.push("Câu khá ngắn – thử kết hợp mệnh đề phụ để đa dạng ngữ pháp.");
      if (a.repeated.length) tips.push("Từ lặp nhiều: " + a.repeated.map(([w, c]) => `<b>${esc(w)}</b> (${c})`).join(", ") + " – hãy dùng từ đồng nghĩa.");
      if (!tips.length) tips.push("Cấu trúc bài ổn! Hãy tự kiểm tra ngữ pháp và độ chính xác của từ vựng.");
      $("#analysis").innerHTML = `<div class="card"><div class="row small">
          <span class="badge">${a.words} từ</span><span class="badge">${a.paras} đoạn</span><span class="badge">${a.sentences} câu</span>
          <span class="badge">~${a.avgLen} từ/câu</span><span class="badge">Đa dạng từ: ${a.lexical}%</span></div>
        <p class="small" style="margin:10px 0 4px"><b>Từ nối đã dùng:</b> ${a.linkers.length ? a.linkers.map(esc).join(", ") : "<i>chưa có</i>"}</p>
        <ul class="small">${tips.map((t) => `<li>${t}</li>`).join("")}</ul>
        <p class="muted small" style="margin:0">Phân tích tự động chỉ kiểm tra hình thức; không thay thế giáo viên chấm.</p></div>`;
    };

    $("#saveScore").onclick = () => {
      const vals = $$("[data-crit]").map((s) => parseFloat(s.value));
      if (vals.some(isNaN)) { $("#scoreOut").textContent = "Hãy chọn đủ 4 tiêu chí."; return; }
      const band = roundBand(vals.reduce((a, b) => a + b, 0) / 4);
      saveResult({ skill: "writing", testId: id, title: `Task ${num}: ${task.title || task.type}`, band, words: analyze(ta.value).words });
      $("#scoreOut").innerHTML = `Band ước tính: <b>${fmtBand(band)}</b> – đã lưu vào Tiến độ.`;
    };
  }

  /* ---------- Speaking ---------- */
  const recorder = {
    supported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder),
    mr: null, stream: null, chunks: [],
    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.mr = new MediaRecorder(this.stream);
      this.mr.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.mr.start();
    },
    stop() {
      return new Promise((resolve) => {
        if (!this.mr || this.mr.state === "inactive") return resolve(null);
        this.mr.onstop = () => {
          const blob = new Blob(this.chunks, { type: this.mr.mimeType || "audio/webm" });
          this.stream.getTracks().forEach((t) => t.stop());
          resolve(URL.createObjectURL(blob));
        };
        this.mr.stop();
      });
    },
    kill() { try { if (this.mr && this.mr.state !== "inactive") this.mr.stop(); if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ } }
  };

  function recordWidget(root) {
    if (!recorder.supported) { root.innerHTML = `<p class="muted small">Trình duyệt không hỗ trợ ghi âm. Bạn vẫn có thể nói và tự bấm giờ.</p>`; return; }
    root.innerHTML = `<div class="row"><button class="btn" data-rec>🎙 Ghi âm</button><span data-st class="muted small"></span></div><div data-out></div>`;
    const btn = $("[data-rec]", root), st = $("[data-st]", root), out = $("[data-out]", root);
    let on = false, t0 = 0, tick;
    btn.onclick = async () => {
      if (!on) {
        try { await recorder.start(); } catch (e) { st.textContent = "Không truy cập được micro: " + e.message; return; }
        on = true; t0 = Date.now(); btn.textContent = "■ Dừng ghi";
        tick = setInterval(() => (st.innerHTML = `<span class="rec-dot"></span> ${fmtTime(Math.round((Date.now() - t0) / 1000))}`), 500);
      } else {
        on = false; clearInterval(tick); btn.textContent = "🎙 Ghi lại";
        const url = await recorder.stop();
        st.textContent = `Đã ghi ${fmtTime(Math.round((Date.now() - t0) / 1000))}. Nghe lại và tự đánh giá:`;
        if (url) out.innerHTML = `<audio controls src="${url}"></audio>`;
      }
    };
    onLeave(() => { clearInterval(tick); recorder.kill(); });
  }

  function speakingRating(id, title) {
    const crit = ["Fluency & Coherence", "Lexical Resource", "Grammatical Range & Accuracy", "Pronunciation"];
    return `<div class="card"><h3>Tự đánh giá</h3><div class="criteria">${crit.map((c, i) => `<label class="small">${c}<select data-crit="${i}"><option value="">–</option>${[9, 8, 7, 6, 5, 4, 3].map((b) => `<option>${b}</option>`).join("")}</select></label>`).join("")}</div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="saveSpk" data-id="${esc(id)}" data-title="${esc(title)}">Lưu điểm</button><span id="spkOut" class="muted"></span></div></div>`;
  }
  function bindSpeakingRating() {
    const b = $("#saveSpk"); if (!b) return;
    b.onclick = () => {
      const vals = $$("[data-crit]").map((s) => parseFloat(s.value));
      if (vals.some(isNaN)) { $("#spkOut").textContent = "Hãy chọn đủ 4 tiêu chí."; return; }
      const band = roundBand(vals.reduce((a, c) => a + c, 0) / 4);
      saveResult({ skill: "speaking", testId: b.dataset.id, title: b.dataset.title, band });
      $("#spkOut").innerHTML = `Band ước tính: <b>${fmtBand(band)}</b> – đã lưu.`;
    };
  }

  function pageSpeaking() {
    const S = D.speaking;
    app.innerHTML = `<h1>Speaking</h1>
      <p class="muted">Bài thi Speaking kéo dài 11–14 phút gồm 3 phần. Câu hỏi được đọc bằng giọng tổng hợp; bạn có thể ghi âm để nghe lại phần trả lời của mình.</p>
      <div class="grid">
        <div class="card"><span class="badge red">Part 1 · 4–5 phút</span><h3 style="margin-top:8px">Câu hỏi quen thuộc</h3><p class="small muted">Chọn chủ đề:</p><div class="chips">${S.part1.map((p, i) => `<a class="chip" href="#/speaking/p1/${i}">${esc(p.topic)}</a>`).join("")}</div></div>
        <div class="card"><span class="badge red">Part 2 + 3 · 7–9 phút</span><h3 style="margin-top:8px">Cue card & thảo luận</h3><p class="small muted">1 phút chuẩn bị, nói 1–2 phút, sau đó thảo luận sâu.</p><div class="list">${S.part2.map((c) => `<a href="#/speaking/p2/${c.id}">${esc(c.topic)}</a>`).join("")}</div></div>
      </div>
      <h2 style="margin-top:28px">Cụm từ hữu ích</h2>
      <div class="card table-scroll"><table>${S.phrases.map(([k, v]) => `<tr><th style="width:30%">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></div>`;
  }

  function pageSpeakingP1(idx) {
    const p = D.speaking.part1[+idx];
    if (!p) return notFound();
    let i = 0;
    app.innerHTML = `<div class="test-head"><a class="btn small" href="#/speaking">← Speaking</a><h2 style="margin:0">Part 1 · ${esc(p.topic)}</h2></div>
      <div class="card stack" id="box"></div>
      <div style="margin-top:16px">${speakingRating("p1-" + idx, "Part 1: " + p.topic)}</div>`;
    const box = $("#box");
    function show() {
      tts.stop();
      box.innerHTML = `<div class="muted small">Câu ${i + 1}/${p.questions.length} · Trả lời khoảng 20–30 giây</div>
        <h2 style="margin:0">${esc(p.questions[i])}</h2>
        <div class="row"><button class="btn" id="hear">🔊 Nghe câu hỏi</button><span class="spacer"></span>
          <button class="btn" id="prev" ${i === 0 ? "disabled" : ""}>← Trước</button>
          <button class="btn primary" id="next" ${i === p.questions.length - 1 ? "disabled" : ""}>Câu tiếp →</button></div>
        <div id="rec"></div>`;
      $("#hear").onclick = () => tts.speak(p.questions[i], "F");
      $("#prev").onclick = () => { i--; recorder.kill(); show(); };
      $("#next").onclick = () => { i++; recorder.kill(); show(); };
      recordWidget($("#rec"));
      tts.speak(p.questions[i], "F");
    }
    show();
    bindSpeakingRating();
    onLeave(() => tts.stop());
  }

  function pageSpeakingP2(id) {
    const c = D.speaking.part2.find((x) => x.id === id);
    if (!c) return notFound();
    app.innerHTML = `<div class="test-head"><a class="btn small" href="#/speaking">← Speaking</a><h2 style="margin:0">Part 2 · Cue card</h2><div class="spacer"></div><span class="timer" id="timer">01:00</span></div>
      <div class="split">
        <div class="stack">
          <div class="cue-card"><h3>${esc(c.topic)}</h3>You should say:<ul>${c.points.map((pt) => `<li>${esc(pt)}</li>`).join("")}</ul></div>
          <div class="row"><button class="btn primary" id="prep">Bắt đầu 1 phút chuẩn bị</button><button class="btn" id="talk">Bắt đầu nói (2 phút)</button></div>
          <p class="muted small" id="phase">Bấm "Bắt đầu" khi sẵn sàng. Ghi chú từ khóa vào ô bên cạnh trong lúc chuẩn bị.</p>
          <div id="rec"></div>
        </div>
        <textarea id="notes" style="min-height:220px" placeholder="Ghi chú nhanh (từ khóa, ý chính)…"></textarea>
      </div>
      <h2 style="margin-top:28px">Part 3 · Thảo luận</h2>
      <div class="list">${c.part3.map((q, i) => `<div class="card list-item"><span class="num badge red">${i + 1}</span><div style="flex:1;min-width:200px">${esc(q)}</div><button class="btn small" data-say="${i}">🔊 Nghe</button></div>`).join("")}</div>
      <p class="muted small">Gợi ý Part 3: trả lời 3–5 câu, đưa lý do và ví dụ, có thể so sánh quá khứ – hiện tại hoặc các nhóm người khác nhau.</p>
      <div style="margin-top:16px">${speakingRating(c.id, "Part 2–3: " + c.topic)}</div>`;

    let timer = null;
    const timerEl = $("#timer"), phase = $("#phase");
    const startTalk = () => {
      if (timer) timer.stop();
      phase.textContent = "Đang nói… Cố gắng nói liên tục đến khi hết 2 phút. Bấm ghi âm bên dưới để nghe lại.";
      timer = countdown(timerEl, 120, () => { phase.textContent = "Hết giờ! Giám khảo sẽ ngắt lời bạn tại đây."; tts.speak("Thank you. That's the end of part two.", "F"); });
    };
    $("#prep").onclick = () => {
      if (timer) timer.stop();
      tts.speak("You have one minute to prepare. You can make some notes if you wish.", "F");
      phase.textContent = "Đang chuẩn bị…";
      timer = countdown(timerEl, 60, () => { tts.speak("All right. Please begin speaking now.", "F"); startTalk(); });
    };
    $("#talk").onclick = startTalk;
    $$("[data-say]").forEach((b) => (b.onclick = () => { tts.stop(); tts.speak(c.part3[+b.dataset.say], "F"); }));
    recordWidget($("#rec"));
    bindSpeakingRating();
    onLeave(() => tts.stop());
  }

  /* ---------- Vocabulary ---------- */
  function pageVocab() {
    const topics = ["Tất cả", ...new Set(D.vocab.map((v) => v.topic))];
    let topic = store.get("vocabTopic", "Tất cả");
    if (!topics.includes(topic)) topic = "Tất cả";
    const known = new Set(store.get("vocabKnown", []));
    let mode = "flash", deck = [], idx = 0;

    app.innerHTML = `<h1>Từ vựng</h1>
      <div class="row" style="margin-bottom:12px"><div class="chips" id="topics"></div></div>
      <div class="row" style="margin-bottom:20px">
        <div class="chips"><button class="chip" data-mode="flash">Flashcard</button><button class="chip" data-mode="quiz">Quiz</button><button class="chip" data-mode="list">Danh sách</button></div>
        <span class="spacer"></span><span class="muted small" id="knownCount"></span></div>
      <div id="vbody"></div>`;

    const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const pool = () => D.vocab.filter((v) => topic === "Tất cả" || v.topic === topic);
    const saveKnown = () => { store.set("vocabKnown", [...known]); $("#knownCount").textContent = `Đã thuộc: ${known.size}/${D.vocab.length}`; };

    function drawTopics() {
      $("#topics").innerHTML = topics.map((t) => `<button class="chip ${t === topic ? "active" : ""}" data-t="${esc(t)}">${esc(t)}</button>`).join("");
      $$("[data-t]").forEach((b) => (b.onclick = () => { topic = b.dataset.t; store.set("vocabTopic", topic); drawTopics(); start(); }));
    }
    function start() {
      $$("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
      deck = shuffle(pool()); idx = 0;
      ({ flash: drawFlash, quiz: drawQuiz, list: drawList })[mode]();
    }
    function drawFlash() {
      const v = deck[idx];
      $("#vbody").innerHTML = `<div class="flash-wrap"><div class="flash" id="card" tabindex="0" aria-label="Lật thẻ">
          <div class="face"><span class="badge">${esc(v.topic)}</span><div class="word" style="margin-top:12px">${esc(v.word)}</div><div class="muted">(${esc(v.pos)})</div><div class="muted small" style="margin-top:14px">Bấm để lật thẻ</div></div>
          <div class="face back"><div style="font-size:1.4rem;font-weight:700">${esc(v.vi)}</div><div class="ex">"${esc(v.ex)}"</div></div>
        </div>
        <div class="row" style="justify-content:center;margin-top:16px">
          <button class="btn" id="prev">←</button><button class="btn" id="say">🔊</button>
          <button class="btn ${known.has(v.word) ? "primary" : ""}" id="know">${known.has(v.word) ? "✓ Đã thuộc" : "Đánh dấu đã thuộc"}</button>
          <button class="btn" id="next">→</button></div>
        <p class="muted small" style="text-align:center">${idx + 1}/${deck.length}</p></div>`;
      const card = $("#card");
      card.onclick = () => card.classList.toggle("flipped");
      card.onkeydown = (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); card.classList.toggle("flipped"); } };
      $("#prev").onclick = () => { idx = (idx - 1 + deck.length) % deck.length; drawFlash(); };
      $("#next").onclick = () => { idx = (idx + 1) % deck.length; drawFlash(); };
      $("#say").onclick = () => { tts.stop(); tts.speak(v.word + ". " + v.ex, "F", 0.9); };
      $("#know").onclick = () => { known.has(v.word) ? known.delete(v.word) : known.add(v.word); saveKnown(); drawFlash(); };
    }
    let qScore = 0;
    function drawQuiz() {
      if (idx === 0) qScore = 0;
      if (idx >= Math.min(deck.length, 10)) {
        const tot = Math.min(deck.length, 10);
        $("#vbody").innerHTML = `<div class="card result"><div class="big">${qScore}/${tot}</div><div>Hoàn thành quiz!</div><span class="spacer"></span><button class="btn primary" id="again">Làm lại</button></div>`;
        $("#again").onclick = start; return;
      }
      const v = deck[idx];
      const others = shuffle(D.vocab.filter((x) => x.word !== v.word)).slice(0, 3);
      const opts = shuffle([v, ...others]);
      $("#vbody").innerHTML = `<div class="card stack" style="max-width:620px;margin:0 auto">
        <div class="muted small">Câu ${idx + 1}/${Math.min(deck.length, 10)} · Điểm: ${qScore}</div>
        <h2 style="margin:0">Từ nào có nghĩa “${esc(v.vi)}”?</h2>
        <div class="list">${opts.map((o) => `<button class="btn" style="justify-content:flex-start" data-w="${esc(o.word)}">${esc(o.word)}</button>`).join("")}</div>
        <div id="qfb"></div></div>`;
      $$("[data-w]").forEach((b) => (b.onclick = () => {
        const ok = b.dataset.w === v.word;
        if (ok) qScore++;
        $$("[data-w]").forEach((x) => { x.disabled = true; if (x.dataset.w === v.word) x.style.borderColor = "var(--ok)"; });
        if (!ok) b.style.borderColor = "var(--bad)";
        $("#qfb").innerHTML = `<p>${ok ? "✅ Chính xác!" : "❌ Đáp án: <b>" + esc(v.word) + "</b>"}</p><p class="muted"><i>${esc(v.ex)}</i></p><button class="btn primary" id="qn">Tiếp →</button>`;
        $("#qn").onclick = () => { idx++; drawQuiz(); };
      }));
    }
    function drawList() {
      $("#vbody").innerHTML = `<div class="card table-scroll"><table><thead><tr><th>Từ</th><th>Loại</th><th>Nghĩa</th><th>Ví dụ</th><th></th></tr></thead><tbody>
        ${pool().map((v) => `<tr><td><b>${esc(v.word)}</b> ${known.has(v.word) ? "✓" : ""}</td><td class="muted">${esc(v.pos)}</td><td>${esc(v.vi)}</td><td class="muted small">${esc(v.ex)}</td><td><button class="btn small" data-sp="${esc(v.word)}">🔊</button></td></tr>`).join("")}
      </tbody></table></div>`;
      $$("[data-sp]").forEach((b) => (b.onclick = () => { tts.stop(); tts.speak(b.dataset.sp, "F", 0.9); }));
    }
    $$("[data-mode]").forEach((b) => (b.onclick = () => { mode = b.dataset.mode; start(); }));
    drawTopics(); saveKnown(); start();
    onLeave(() => tts.stop());
  }

  /* ---------- Progress ---------- */
  function pageProgress() {
    const hist = store.get("history", []).slice().reverse();
    const avg = skillAverages();
    const names = { reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" };
    app.innerHTML = `<h1>Tiến độ</h1>
      <div class="grid">${Object.keys(names).map((k) => `<div class="card"><div class="muted small">${names[k]}</div><div style="font-size:2rem;font-weight:800">${fmtBand(avg[k])}</div><div class="bar"><span style="width:${avg[k] ? (avg[k] / 9) * 100 : 0}%"></span></div><div class="muted small" style="margin-top:6px">${hist.filter((h) => h.skill === k).length} bài đã làm</div></div>`).join("")}
        <div class="card" style="border-color:var(--primary)"><div class="muted small">Overall (ước tính)</div><div style="font-size:2rem;font-weight:800;color:var(--primary)">${fmtBand(avg.overall)}</div><div class="muted small">Trung bình các kỹ năng, làm tròn theo quy tắc IELTS.</div></div>
      </div>
      <h2 style="margin-top:28px">Lịch sử làm bài</h2>
      ${hist.length ? `<div class="card table-scroll"><table><thead><tr><th>Ngày</th><th>Kỹ năng</th><th>Bài</th><th>Kết quả</th><th>Band</th></tr></thead><tbody>
        ${hist.map((h) => `<tr><td class="small">${new Date(h.date).toLocaleString("vi-VN")}</td><td>${names[h.skill] || h.skill}</td><td>${esc(h.title || h.testId)}</td><td>${h.total ? h.correct + "/" + h.total : h.words ? h.words + " từ" : "tự chấm"}</td><td><b>${fmtBand(h.band)}</b></td></tr>`).join("")}
        </tbody></table></div>
        <button class="btn" id="clear" style="margin-top:16px">Xóa toàn bộ lịch sử</button>` : `<div class="card muted">Chưa có bài làm nào. <a href="#/reading">Bắt đầu với Reading →</a></div>`}`;
    const c = $("#clear");
    if (c) c.onclick = () => { if (confirm("Xóa toàn bộ lịch sử làm bài?")) { store.set("history", []); pageProgress(); } };
  }

  function notFound() {
    app.innerHTML = `<div class="card"><h2>Không tìm thấy trang</h2><a href="#/">← Về trang chủ</a></div>`;
  }

  /* ================= Router ================= */
  function route() {
    runCleanups();
    tts.stop();
    const parts = (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean);
    const [p0, p1, p2] = parts;
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#/" + (p0 || "")));
    $(".nav").classList.remove("open");
    $(".menu-btn").setAttribute("aria-expanded", "false");
    if (!p0) pageHome();
    else if (p0 === "reading") p1 ? pageReadingTest(p1) : pageReadingList();
    else if (p0 === "listening") p1 ? pageListeningTest(p1) : pageListeningList();
    else if (p0 === "writing") p1 ? pageWritingTask(p1) : pageWritingList();
    else if (p0 === "speaking") p1 === "p1" ? pageSpeakingP1(p2) : p1 === "p2" ? pageSpeakingP2(p2) : pageSpeaking();
    else if (p0 === "vocab") pageVocab();
    else if (p0 === "progress") pageProgress();
    else notFound();
    window.scrollTo(0, 0);
  }

  /* ================= Theme & menu ================= */
  const savedTheme = store.get("theme", null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $(".theme-btn").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
  };
  $(".menu-btn").onclick = (e) => {
    const open = $(".nav").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  };

  window.addEventListener("hashchange", route);
  window.addEventListener("beforeunload", runCleanups);
  route();
})();
