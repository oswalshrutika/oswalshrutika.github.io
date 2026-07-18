// quiz.js — builder + flashcard + MCQ runners + end screen.

const state = {
  modules: [],
  questionData: null,
  selectedModules: new Set(),
  selectedTopics: new Set(),   // keys of form `${moduleSlug}:${topicSlug}`
  quiz: null,                  // active quiz: { items, idx, results, format, order }
};

const FILTER_KEY = "quiz-filters";

onReady(async () => {
  renderHeader("quiz");
  try {
    state.modules = await loadModules();
    state.questionData = await loadQuestions();
    initBuilder();
    updatePool();
  } catch (e) {
    document.getElementById("quiz-builder").innerHTML =
      `<p>Failed to load data: ${esc(e.message)}. Serve the site with <code>python3 -m http.server</code>.</p>`;
  }

  // Apply preset from URL (index page shortcuts).
  const preset = getQueryParam("preset");
  if (preset === "flashcards") {
    // Uncheck everything, then select only 08_cheat_sheet.
    state.selectedModules.clear();
    state.selectedTopics.clear();
    state.selectedModules.add("08_cheat_sheet");
    for (const t of state.modules.find(m => m.slug === "08_cheat_sheet")?.topics || []) {
      state.selectedTopics.add(`08_cheat_sheet:${t.slug}`);
    }
    document.querySelector('input[name="source"][value="flashcards"]').checked = true;
    const n = parseInt(getQueryParam("n") || "20", 10);
    if (!isNaN(n)) {
      const clamped = Math.max(5, Math.min(100, n));
      document.getElementById("qty-slider").value = clamped;
      document.getElementById("qty-display").textContent = clamped;
    }
    renderModulePicker();
    updatePool();
  }
});

function initBuilder() {
  // Default: all modules + all topics selected.
  for (const m of state.modules) {
    state.selectedModules.add(m.slug);
    for (const t of m.topics || []) {
      state.selectedTopics.add(`${m.slug}:${t.slug}`);
    }
  }
  // Also mark general/section_* topics selected by seeding from the question bank.
  for (const q of state.questionData.questions) {
    state.selectedTopics.add(`${q.module}:${q.topic}`);
  }

  renderModulePicker();

  document.querySelectorAll('input[name="source"], input[name="format"], input[name="order"]').forEach(el => {
    el.addEventListener("change", updatePool);
  });
  const slider = document.getElementById("qty-slider");
  slider.addEventListener("input", () => {
    document.getElementById("qty-display").textContent = slider.value;
    updatePool();
  });
  document.getElementById("start-quiz").addEventListener("click", startQuiz);
  document.getElementById("abort-btn").addEventListener("click", () => {
    if (confirm("Exit this quiz? Progress will be lost.")) {
      state.quiz = null;
      showBuilder();
    }
  });
}

function renderModulePicker() {
  const picker = document.getElementById("module-picker");
  picker.innerHTML = state.modules.map(m => {
    const modChecked = state.selectedModules.has(m.slug) ? "checked" : "";
    // Collect all topic slugs actually observed for this module in the bank.
    const topicSlugs = new Set();
    for (const q of state.questionData.questions) {
      if (q.module === m.slug) topicSlugs.add(q.topic);
    }
    // Merge with taxonomy topics.
    const topics = [];
    for (const t of m.topics || []) {
      if (!topicSlugs.has(t.slug)) continue;
      topics.push({ slug: t.slug, label: t.label });
      topicSlugs.delete(t.slug);
    }
    // Add residual topics not in taxonomy (e.g. `general`).
    for (const s of topicSlugs) {
      topics.push({ slug: s, label: labelForSlug(s) });
    }
    const topicItems = topics.map(t => {
      const key = `${m.slug}:${t.slug}`;
      const count = state.questionData.questions.filter(q => q.module === m.slug && q.topic === t.slug).length;
      const chk = state.selectedTopics.has(key) ? "checked" : "";
      return `<li>
        <label style="flex:1; cursor:pointer;">
          <input type="checkbox" data-topic="${esc(key)}" ${chk}> ${esc(t.label)}
        </label>
        <span class="topic-count">${count}</span>
      </li>`;
    }).join("");
    return `
      <details ${modChecked ? "open" : ""}>
        <summary>
          <input type="checkbox" data-module="${esc(m.slug)}" ${modChecked}>
          <strong>${esc(m.label)}</strong>
        </summary>
        <ul>${topicItems || '<li class="text-muted small">No topics</li>'}</ul>
      </details>`;
  }).join("");

  // Wire checkboxes.
  picker.querySelectorAll('input[data-module]').forEach(el => {
    el.addEventListener("change", () => {
      const slug = el.dataset.module;
      if (el.checked) state.selectedModules.add(slug);
      else state.selectedModules.delete(slug);
      // Cascade to all topic checkboxes in this module.
      picker.querySelectorAll(`input[data-topic^="${slug}:"]`).forEach(t => {
        t.checked = el.checked;
        const k = t.dataset.topic;
        if (el.checked) state.selectedTopics.add(k);
        else state.selectedTopics.delete(k);
      });
      updatePool();
    });
    // Prevent details toggle when clicking the checkbox.
    el.addEventListener("click", e => e.stopPropagation());
  });
  picker.querySelectorAll('input[data-topic]').forEach(el => {
    el.addEventListener("change", () => {
      const k = el.dataset.topic;
      if (el.checked) state.selectedTopics.add(k);
      else state.selectedTopics.delete(k);
      updatePool();
    });
  });
}

function labelForSlug(s) {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// --- Pool filter logic ---

function filterPool() {
  const source = document.querySelector('input[name="source"]:checked')?.value || "quickhit_flashcards";
  const allowedSources = sourceFilter(source);
  return state.questionData.questions.filter(q => {
    if (!state.selectedModules.has(q.module)) return false;
    if (!state.selectedTopics.has(`${q.module}:${q.topic}`)) return false;
    if (allowedSources && !allowedSources.has(q.source_type)) return false;
    return true;
  });
}

function sourceFilter(mode) {
  switch (mode) {
    case "quickhit_flashcards": return new Set(["quick_hit", "flashcards"]);
    case "quick_hit":           return new Set(["quick_hit"]);
    case "focused":             return new Set(["focused"]);
    case "comprehensive":       return new Set(["comprehensive"]);
    case "flashcards":          return new Set(["flashcards"]);
    case "exercises":           return new Set(["exercises"]);
    case "all":                 return null;
    default:                    return new Set(["quick_hit", "flashcards"]);
  }
}

function updatePool() {
  const pool = filterPool();
  const requested = parseInt(document.getElementById("qty-slider").value, 10);
  const info = document.getElementById("pool-info");
  const start = document.getElementById("start-quiz");
  if (pool.length === 0) {
    info.className = "pool-info warn";
    info.textContent = `Pool size: 0. Loosen filters — no questions match.`;
    start.disabled = true;
  } else if (pool.length < requested) {
    info.className = "pool-info warn";
    info.textContent = `Pool size: ${pool.length}. Requested: ${requested}. You'll get ${pool.length} questions (fewer than requested).`;
    start.disabled = false;
  } else {
    info.className = "pool-info";
    info.textContent = `Pool size: ${pool.length} · Requested: ${requested}`;
    start.disabled = false;
  }
}

// --- Quiz runner ---

function startQuiz() {
  const pool = filterPool();
  const requested = parseInt(document.getElementById("qty-slider").value, 10);
  const format = document.querySelector('input[name="format"]:checked').value;
  const order = document.querySelector('input[name="order"]:checked').value;

  let items = pool.slice();
  if (order === "random") shuffle(items);
  else items.sort((a, b) => (a.module + a.source_file).localeCompare(b.module + b.source_file) || a.qnum - b.qnum);
  items = items.slice(0, Math.min(requested, items.length));

  // Pre-compute MCQ options for each item if MCQ mode.
  if (format === "mcq") {
    for (const it of items) {
      it._options = buildMcqOptions(it, pool);
    }
  }

  state.quiz = {
    items,
    idx: 0,
    format,
    results: items.map(() => null),   // null | "correct" | "wrong"
  };
  showRunner();
  renderCurrentQuestion();
}

function showBuilder() {
  document.getElementById("quiz-builder").classList.remove("hidden");
  document.getElementById("quiz-runner").classList.add("hidden");
  document.getElementById("quiz-end").classList.add("hidden");
}
function showRunner() {
  document.getElementById("quiz-builder").classList.add("hidden");
  document.getElementById("quiz-runner").classList.remove("hidden");
  document.getElementById("quiz-end").classList.add("hidden");
}
function showEnd() {
  document.getElementById("quiz-builder").classList.add("hidden");
  document.getElementById("quiz-runner").classList.add("hidden");
  document.getElementById("quiz-end").classList.remove("hidden");
}

function renderCurrentQuestion() {
  const q = state.quiz.items[state.quiz.idx];
  document.getElementById("cur-num").textContent = state.quiz.idx + 1;
  document.getElementById("total-num").textContent = state.quiz.items.length;
  const pct = ((state.quiz.idx) / state.quiz.items.length) * 100;
  document.getElementById("progress-bar").style.width = `${pct}%`;

  const container = document.getElementById("quiz-card-container");
  if (state.quiz.format === "flashcard") {
    container.innerHTML = renderFlashcard(q);
    wireFlashcardEvents(q);
  } else {
    container.innerHTML = renderMcq(q);
    wireMcqEvents(q);
  }

  // Highlight code inside the answer if visible.
  container.querySelectorAll("pre code").forEach(el => {
    try { window.hljs.highlightElement(el); } catch {}
  });
}

// --- Flashcard rendering ---

function renderFlashcard(q) {
  return `
    <div class="quiz-card">
      <span class="tag">${esc(q.module_label)}${q.topic_label && q.topic_label !== "General" ? " · " + esc(q.topic_label) : ""}</span>
      <p class="question">${esc(q.question)}</p>
      ${q.interviewer_signal ? `<p class="signal">Interviewer signal: ${esc(q.interviewer_signal)}</p>` : ""}
      <div id="answer-slot" class="hidden">
        <div class="answer">${window.marked.parse(q.answer_md || "*(no answer text)*")}</div>
        ${q.watch_outs ? `<div class="watch-outs"><strong>Watch-outs:</strong> ${esc(q.watch_outs)}</div>` : ""}
      </div>
      <div class="quiz-actions" id="fc-actions">
        <button class="btn btn-primary" id="reveal-btn">Reveal answer</button>
      </div>
    </div>
  `;
}

function wireFlashcardEvents(q) {
  document.getElementById("reveal-btn").addEventListener("click", () => {
    document.getElementById("answer-slot").classList.remove("hidden");
    document.getElementById("fc-actions").innerHTML = `
      <button class="btn grade-btn got-it" id="got-it">✓ Got it</button>
      <button class="btn grade-btn missed" id="missed">✗ Missed</button>
    `;
    document.getElementById("got-it").addEventListener("click", () => grade("correct"));
    document.getElementById("missed").addEventListener("click", () => grade("wrong"));
    // Re-highlight code that just became visible.
    document.querySelectorAll("#answer-slot pre code").forEach(el => {
      try { window.hljs.highlightElement(el); } catch {}
    });
  });
  // Keyboard: space/enter reveals, 1/2 grade.
  keyHandler = (e) => {
    if (e.key === " " || e.key === "Enter") {
      const btn = document.getElementById("reveal-btn");
      if (btn) { btn.click(); e.preventDefault(); }
    } else if (e.key === "1") {
      document.getElementById("got-it")?.click();
    } else if (e.key === "2") {
      document.getElementById("missed")?.click();
    } else if (e.key === "ArrowRight") {
      next();
    } else if (e.key === "ArrowLeft") {
      prev();
    }
  };
  refreshKeyHandler();
}

// --- MCQ rendering ---

function buildMcqOptions(q, pool) {
  const truncate = s => {
    const t = String(s || "").replace(/\s+/g, " ").replace(/[*_`]/g, "").trim();
    return t.length > 220 ? t.slice(0, 217) + "…" : t;
  };
  const correct = { text: truncate(q.answer_md), correct: true };
  const distractors = [];
  const usedTexts = new Set([correct.text]);

  // 1. Try to grab a red-flag entry from the same module.
  const rf = (state.questionData.red_flags || []).filter(r => r.module === q.module);
  if (rf.length) {
    const pick = rf[Math.floor(Math.random() * rf.length)];
    const text = truncate(pick.wrong);
    if (text && !usedTexts.has(text)) {
      distractors.push({ text, correct: false });
      usedTexts.add(text);
    }
  }

  // 2. Other answers from same topic, then module, then module_pool.
  const sameTopic = pool.filter(x => x.id !== q.id && x.module === q.module && x.topic === q.topic);
  const sameModule = pool.filter(x => x.id !== q.id && x.module === q.module);
  const anywhere = state.questionData.questions.filter(x => x.id !== q.id && x.module !== q.module);

  for (const source of [sameTopic, sameModule, anywhere]) {
    const shuffled = shuffle(source.slice());
    for (const cand of shuffled) {
      if (distractors.length >= 3) break;
      const text = truncate(cand.answer_md);
      if (!text || usedTexts.has(text)) continue;
      distractors.push({ text, correct: false });
      usedTexts.add(text);
    }
    if (distractors.length >= 3) break;
  }

  const options = shuffle([correct, ...distractors]);
  return options;
}

function renderMcq(q) {
  const letters = "ABCD";
  const options = q._options.map((opt, i) => `
    <li data-idx="${i}" data-correct="${opt.correct ? '1' : '0'}">
      <span class="letter">${letters[i]}</span>
      <span>${esc(opt.text)}</span>
    </li>
  `).join("");
  return `
    <div class="quiz-card">
      <span class="tag">${esc(q.module_label)}${q.topic_label && q.topic_label !== "General" ? " · " + esc(q.topic_label) : ""}</span>
      <p class="question">${esc(q.question)}</p>
      <ul class="mcq-options" id="mcq-options">${options}</ul>
      <div id="mcq-reveal" class="hidden">
        <div class="answer"><strong>Full answer:</strong> ${window.marked.parse(q.answer_md || "*(no answer text)*")}</div>
        ${q.watch_outs ? `<div class="watch-outs"><strong>Watch-outs:</strong> ${esc(q.watch_outs)}</div>` : ""}
      </div>
      <div class="quiz-actions" id="mcq-actions">
        <span class="text-muted small">Pick an answer</span>
      </div>
    </div>
  `;
}

function wireMcqEvents(q) {
  const options = document.getElementById("mcq-options");
  options.querySelectorAll("li").forEach(li => {
    li.addEventListener("click", () => {
      if (li.classList.contains("disabled")) return;
      const isCorrect = li.dataset.correct === "1";
      // Reveal correctness on all options.
      options.querySelectorAll("li").forEach(opt => {
        opt.classList.add("disabled");
        if (opt.dataset.correct === "1") opt.classList.add("correct");
        else if (opt === li && !isCorrect) opt.classList.add("wrong");
      });
      document.getElementById("mcq-reveal").classList.remove("hidden");
      document.querySelectorAll("#mcq-reveal pre code").forEach(el => {
        try { window.hljs.highlightElement(el); } catch {}
      });
      document.getElementById("mcq-actions").innerHTML = `
        <button class="btn btn-primary" id="next-btn">Next →</button>
      `;
      document.getElementById("next-btn").addEventListener("click", () => grade(isCorrect ? "correct" : "wrong"));
    });
  });
  keyHandler = (e) => {
    if (["1", "2", "3", "4", "a", "b", "c", "d", "A", "B", "C", "D"].includes(e.key)) {
      const idx = "1234".indexOf(e.key) !== -1 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
      if (idx !== -1) options.querySelectorAll("li")[idx]?.click();
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      document.getElementById("next-btn")?.click();
    }
  };
  refreshKeyHandler();
}

function grade(verdict) {
  state.quiz.results[state.quiz.idx] = verdict;
  next();
}
function next() {
  if (state.quiz.idx < state.quiz.items.length - 1) {
    state.quiz.idx++;
    renderCurrentQuestion();
  } else {
    finish();
  }
}
function prev() {
  if (state.quiz.idx > 0) {
    state.quiz.idx--;
    renderCurrentQuestion();
  }
}

// Global key handler — swapped per-question.
let keyHandler = null;
function refreshKeyHandler() {
  window.onkeydown = (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    keyHandler?.(e);
  };
}

function finish() {
  const total = state.quiz.items.length;
  const correct = state.quiz.results.filter(r => r === "correct").length;
  const missed = state.quiz.items.filter((_, i) => state.quiz.results[i] === "wrong");

  // Per-module breakdown.
  const byModule = {};
  state.quiz.items.forEach((item, i) => {
    const m = item.module_label;
    if (!byModule[m]) byModule[m] = { correct: 0, total: 0 };
    byModule[m].total++;
    if (state.quiz.results[i] === "correct") byModule[m].correct++;
  });

  const pct = total ? Math.round((correct / total) * 100) : 0;
  document.getElementById("quiz-end").innerHTML = `
    <h1>Quiz complete</h1>
    <div class="score">${correct} / ${total}</div>
    <div class="pct">${pct}% correct</div>

    <h3 class="section-heading" style="margin-top:1.5rem;">By module</h3>
    <div class="breakdown">
      ${Object.entries(byModule).map(([m, v]) => `
        <div class="cell"><span>${esc(m)}</span><span class="m-count">${v.correct}/${v.total}</span></div>
      `).join("")}
    </div>

    ${missed.length ? `
      <h3 class="section-heading">Missed questions</h3>
      <ul class="missed-list">
        ${missed.map(m => `<li><strong>[${esc(m.module_label)}]</strong> ${esc(m.question)}</li>`).join("")}
      </ul>
    ` : `<p class="text-muted">Nothing missed. 🎉</p>`}

    <div class="cta-row" style="justify-content:center; margin-top:1.5rem;">
      ${missed.length ? `<button class="btn btn-primary" id="retry-missed">🔁 Retry missed (${missed.length})</button>` : ""}
      <button class="btn" id="new-quiz">Build a new quiz</button>
      <a class="btn" href="index.html">Home</a>
    </div>
  `;
  showEnd();

  document.getElementById("retry-missed")?.addEventListener("click", () => {
    state.quiz = {
      items: missed.map(m => ({...m})),
      idx: 0,
      format: state.quiz.format,
      results: missed.map(() => null),
    };
    if (state.quiz.format === "mcq") {
      for (const it of state.quiz.items) {
        it._options = buildMcqOptions(it, state.questionData.questions);
      }
    }
    showRunner();
    renderCurrentQuestion();
  });
  document.getElementById("new-quiz").addEventListener("click", () => {
    state.quiz = null;
    window.onkeydown = null;
    showBuilder();
  });
}
