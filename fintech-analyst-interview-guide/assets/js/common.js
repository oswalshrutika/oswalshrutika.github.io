// common.js — shared across index / study / quiz pages

const THEME_KEY = "site-theme";
const PROGRESS_KEY = "site-progress-v1";

// --- Study progress (localStorage, per-file completion) ---
function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveProgress(p) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {}
}
function isFileCompleted(file) {
  return !!loadProgress()[file];
}
function setFileCompleted(file, done) {
  const p = loadProgress();
  if (done) p[file] = { at: new Date().toISOString() };
  else delete p[file];
  saveProgress(p);
}
function resetAllProgress() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch {}
}
function progressStats(modules) {
  const p = loadProgress();
  const total = modules.reduce((n, m) => n + (m.files?.length || 0), 0);
  const done = modules.reduce((n, m) =>
    n + (m.files || []).filter(f => p[`${m.slug}/${f.name}`]).length, 0);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    updateThemeButton(btn);
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next);
      updateThemeButton(btn);
      // Re-init mermaid with new theme (if present).
      if (window.mermaid && window.mermaidInitTheme) {
        window.mermaidInitTheme(next);
      }
    });
  }
}

function updateThemeButton(btn) {
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  btn.textContent = theme === "dark" ? "☾ Dark" : "☀ Light";
  btn.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
}

// Renders the shared site header. Pass the id of the currently-active nav item.
function renderHeader(activeId) {
  const header = document.getElementById("site-header");
  if (!header) return;
  header.innerHTML = `
    <a class="brand" href="index.html">📊 Fintech Analyst Prep</a>
    <nav>
      <a href="index.html" data-nav="home">Home</a>
      <a href="study.html" data-nav="study">Study</a>
      <a href="quiz.html" data-nav="quiz">Quiz</a>
    </nav>
    <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle theme">☾ Dark</button>
  `;
  if (activeId) {
    const link = header.querySelector(`a[data-nav="${activeId}"]`);
    if (link) link.classList.add("active");
  }
  initTheme();
}

// Fetch helper. Falls back gracefully on file:// (which browsers refuse for fetch).
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.text();
}

// Load and cache modules taxonomy.
let _modulesCache = null;
async function loadModules() {
  if (_modulesCache) return _modulesCache;
  const data = await fetchJson("data/modules.json");
  _modulesCache = data.modules;
  return _modulesCache;
}

// Load and cache question bank.
let _questionsCache = null;
async function loadQuestions() {
  if (_questionsCache) return _questionsCache;
  const data = await fetchJson("data/questions.json");
  _questionsCache = data;
  return _questionsCache;
}

// Escape HTML for safe innerText → innerHTML.
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Fisher-Yates shuffle (mutating).
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Deep copy via structuredClone with fallback.
function clone(obj) {
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

// Sample N distinct items from an array.
function sample(arr, n) {
  const copy = arr.slice();
  shuffle(copy);
  return copy.slice(0, Math.min(n, copy.length));
}

// URL query helpers.
function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Wait for the DOM to be ready.
function onReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn);
  } else {
    fn();
  }
}
