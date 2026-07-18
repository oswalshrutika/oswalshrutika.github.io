// study.js — markdown viewer with sidebar, mermaid, hljs, collapsible Q blocks.

const DEFAULT_FILE = "08_cheat_sheet/00_INDEX.md";

// Whitelist of files we know exist (avoid trying to fetch anything that's not content).
function isValidFile(path) {
  return /^[0-9]{2}_[a-z_]+\/[0-9]{2}_[A-Za-z0-9_]+\.md$/.test(path);
}

// Slugify for anchors.
function slug(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Configure mermaid with the current theme.
function mermaidInitTheme(theme) {
  if (!window.mermaid) return;
  window.mermaid.initialize({
    startOnLoad: false,
    theme: theme === "light" ? "default" : "dark",
    securityLevel: "loose",
    fontFamily: "inherit",
  });
}
window.mermaidInitTheme = mermaidInitTheme;

onReady(async () => {
  renderHeader("study");

  // Lazy-load mermaid.
  await loadMermaid();
  mermaidInitTheme(document.documentElement.getAttribute("data-theme") || "dark");

  let file = getQueryParam("file") || DEFAULT_FILE;
  file = file.replace(/^\/+/, "");
  if (!isValidFile(file)) file = DEFAULT_FILE;

  try {
    const modules = await loadModules();
    renderSidebar(modules, file);
    await renderMarkdown(file, modules);
  } catch (e) {
    document.getElementById("markdown-body").innerHTML =
      `<div class="text-muted"><p>Failed to load content: ${esc(e.message)}</p>
       <p>If you opened this file directly, serve the <code>site/</code> directory with <code>python3 -m http.server</code>.</p></div>`;
  }

  // Handle in-page anchor clicks (query-param aware).
  document.addEventListener("click", (ev) => {
    const link = ev.target.closest("a");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href) return;
    // Same-page anchor.
    if (href.startsWith("#")) return;
    // Leave already-formed page links alone (sidebar, breadcrumb, etc.).
    if (/^(study|index|quiz)\.html($|[?#])/.test(href)) return;
    // Skip absolute URLs and anything with a query string.
    if (/^[a-z]+:\/\//i.test(href)) return;
    if (href.includes("?")) return;
    // Cross-doc markdown link inside content: rewrite to study.html?file=
    if (/\.md($|#)/.test(href)) {
      ev.preventDefault();
      const [pathPart, hashPart = ""] = href.split("#");
      const currentDir = file.split("/").slice(0, -1).join("/");
      const target = pathPart.startsWith("/") ? pathPart.slice(1) :
                     (currentDir ? `${currentDir}/${pathPart}` : pathPart);
      const normalized = normalizePath(target);
      const hash = hashPart ? `#${hashPart}` : "";
      window.location.href = `study.html?file=${encodeURIComponent(normalized)}${hash}`;
    }
  });
});

function updateMarkDoneButton(btn, done) {
  if (!btn) return;
  btn.classList.toggle("done", done);
  btn.querySelector(".check-icon").textContent = done ? "✓" : "○";
  btn.querySelector(".label").textContent = done ? "Completed" : "Mark as complete";
}

function normalizePath(p) {
  const parts = p.split("/");
  const out = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

async function loadMermaid() {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "assets/vendor/mermaid.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load mermaid"));
    document.head.appendChild(s);
  });
}

function renderSidebar(modules, activeFile) {
  const [activeSlug] = activeFile.split("/");
  const progress = loadProgress();
  const stats = progressStats(modules);

  const modulesHtml = modules.map(m => {
    const isActive = m.slug === activeSlug;
    const modDone = (m.files || []).filter(f => progress[`${m.slug}/${f.name}`]).length;
    const modTotal = m.files?.length || 0;
    const items = m.files.map(f => {
      const path = `${m.slug}/${f.name}`;
      const current = path === activeFile ? "current" : "";
      const done = progress[path] ? "done" : "";
      const mark = progress[path] ? "✓ " : "";
      return `<li><a class="${current} ${done}" href="study.html?file=${encodeURIComponent(path)}"><span class="check">${mark}</span>${esc(f.label)}</a></li>`;
    }).join("");
    return `
      <details ${isActive ? "open" : ""}>
        <summary>
          <span>${esc(m.short_label || m.label)}</span>
          <span class="mod-count">${modDone}/${modTotal}</span>
        </summary>
        <ul>${items}</ul>
      </details>`;
  }).join("");

  document.getElementById("study-sidebar").innerHTML = `
    <div class="progress-panel">
      <div class="progress-header">
        <strong>Progress</strong>
        <button id="reset-progress" class="link-btn" title="Reset all completion marks" type="button">Reset</button>
      </div>
      <div class="progress-count"><span id="progress-done">${stats.done}</span> / ${stats.total} lessons</div>
      <div class="progress-bar-outer"><div class="progress-bar-inner" id="progress-bar-inner" style="width:${stats.pct}%"></div></div>
      <div class="progress-pct" id="progress-pct">${stats.pct}%</div>
    </div>
    ${modulesHtml}
  `;

  document.getElementById("reset-progress").addEventListener("click", () => {
    if (confirm("Reset all study progress? This clears the ✓ marks on every lesson.")) {
      resetAllProgress();
      renderSidebar(modules, activeFile);
      const marker = document.getElementById("mark-done-btn");
      if (marker) updateMarkDoneButton(marker, false);
    }
  });
}

function refreshProgressUI(modules, activeFile) {
  const stats = progressStats(modules);
  document.getElementById("progress-done").textContent = stats.done;
  document.getElementById("progress-bar-inner").style.width = `${stats.pct}%`;
  document.getElementById("progress-pct").textContent = `${stats.pct}%`;
  // Rebuild sidebar list items so ✓ marks update in place.
  renderSidebar(modules, activeFile);
}

async function renderMarkdown(file, modules) {
  const [modSlug, fileName] = file.split("/");
  const module = modules.find(m => m.slug === modSlug);
  const fileMeta = module?.files.find(f => f.name === fileName);
  const isQuickHit = fileName === "03_quick_hit.md";

  // Breadcrumb + mark-done control.
  const done = isFileCompleted(file);
  document.getElementById("breadcrumb").innerHTML = `
    <div class="crumb-trail">
      <a href="index.html">Home</a> ·
      ${module ? `<a href="study.html?file=${encodeURIComponent(modSlug + '/00_INDEX.md')}">${esc(module.label)}</a> · ` : ""}
      <span>${esc(fileMeta?.label || fileName)}</span>
    </div>
    <button id="mark-done-btn" class="mark-done ${done ? 'done' : ''}" type="button">
      <span class="check-icon">${done ? '✓' : '○'}</span>
      <span class="label">${done ? 'Completed' : 'Mark as complete'}</span>
    </button>
  `;
  document.title = `${fileMeta?.label || fileName} — Fintech Analyst Prep`;

  document.getElementById("mark-done-btn").addEventListener("click", () => {
    const nowDone = !isFileCompleted(file);
    setFileCompleted(file, nowDone);
    updateMarkDoneButton(document.getElementById("mark-done-btn"), nowDone);
    refreshProgressUI(modules, file);
  });

  // Fetch raw markdown.
  const md = await fetchText(`content/${file}`);
  const html = renderMarkdownToHtml(md, isQuickHit);

  const body = document.getElementById("markdown-body");
  body.innerHTML = html;

  // Highlight code.
  body.querySelectorAll("pre code").forEach(el => {
    // Skip mermaid — it's not real code.
    if (el.classList.contains("language-mermaid")) return;
    try { window.hljs.highlightElement(el); } catch {}
  });

  // Render mermaid.
  const mermaidBlocks = body.querySelectorAll("pre code.language-mermaid, code.language-mermaid");
  let idx = 0;
  const toRender = [];
  mermaidBlocks.forEach(el => {
    const container = document.createElement("div");
    container.className = "mermaid";
    container.id = `mermaid-${++idx}`;
    container.textContent = el.textContent;
    // Replace the <pre><code> or bare <code> with the container.
    const target = el.closest("pre") || el;
    target.replaceWith(container);
    toRender.push(container);
  });
  if (toRender.length) {
    try {
      await window.mermaid.run({ nodes: toRender });
    } catch (e) {
      console.warn("Mermaid render failed:", e);
    }
  }

  // Add anchor links & handle Q-block collapsing.
  body.querySelectorAll("h1, h2, h3, h4").forEach(h => {
    if (!h.id) {
      const text = h.textContent.trim();
      h.id = slug(text);
    }
    // Add a copy-link affordance.
    const a = document.createElement("a");
    a.href = `#${h.id}`;
    a.className = "anchor-link";
    a.textContent = "🔗";
    a.title = "Copy link to this section";
    a.setAttribute("aria-label", "Copy link");
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const url = window.location.origin + window.location.pathname + window.location.search + `#${h.id}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      history.replaceState(null, "", `#${h.id}`);
    });
    h.appendChild(a);
  });

  if (isQuickHit) {
    collapsibleQuestions(body);
  }

  // Jump to hash if present.
  if (window.location.hash) {
    const target = document.getElementById(window.location.hash.slice(1));
    if (target) target.scrollIntoView();
  }
}

function renderMarkdownToHtml(md, isQuickHit) {
  // Configure marked. We disable mangle & headerIds because we handle IDs manually.
  window.marked.setOptions({
    gfm: true,
    breaks: false,
    headerIds: false,
    mangle: false,
  });
  return window.marked.parse(md);
}

// For quick-hit files, wrap each `### Qn.` and its following siblings up to the
// next `### Qn.` (or `<hr>`) inside a <details> element.
function collapsibleQuestions(body) {
  const headings = Array.from(body.querySelectorAll("h3"));
  headings.forEach(h => {
    const text = h.textContent.trim();
    if (!/^Q\d+\.\s/i.test(text)) return;

    const details = document.createElement("details");
    details.className = "q-block";
    const summary = document.createElement("summary");
    summary.textContent = text.replace(/🔗$/, "").trim();
    details.appendChild(summary);

    // Move siblings after h until next h3 with Q or <hr> or end.
    let sib = h.nextSibling;
    const toMove = [];
    while (sib) {
      if (sib.nodeType === Node.ELEMENT_NODE) {
        if (sib.tagName === "H3" && /^Q\d+\.\s/i.test(sib.textContent.trim())) break;
        if (sib.tagName === "H2" || sib.tagName === "H1") break;
        if (sib.tagName === "HR") { toMove.push(sib); break; }
      }
      toMove.push(sib);
      sib = sib.nextSibling;
    }
    toMove.forEach(node => details.appendChild(node));
    h.replaceWith(details);
  });
}
