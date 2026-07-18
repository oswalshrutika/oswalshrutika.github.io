# Fintech Analyst Role Prep — Static Site

A static, dependency-free study + quiz site built from the interview-prep markdown kit in the parent directory. **1,171 Q&A entries + 105 red-flag distractors** across 8 modules.

Deploys to GitHub Pages at `https://oswalshrutika.github.io/fintech_analyst_role_prep/`.

## What's in here

- `index.html` — landing page (reading plans, module grid, quick actions)
- `study.html` — markdown viewer with sidebar TOC, mermaid + syntax highlighting, collapsible Q blocks
- `quiz.html` — quiz builder (pick modules/topics/count) + flashcard & MCQ runners
- `content/` — snapshot of the 8 module directories (`01_internal_codebase` → `08_cheat_sheet`)
- `data/modules.json` — module + topic taxonomy (hand-authored)
- `data/questions.json` — parsed Q&A bank (generated)
- `scripts/build_questions.py` — Python 3 stdlib parser
- `assets/vendor/` — pinned marked, mermaid, highlight.js (no CDN at runtime)

## Run locally

```bash
cd site
python3 -m http.server 8000
open http://localhost:8000/
```

Any static file server works — `npx serve`, `caddy file-server`, VS Code Live Server, etc.

## Refresh the question bank

Whenever the source `.md` files change:

```bash
# 1. Sync content/ from the source directories
rsync -av --delete \
  --include='*/' --include='*.md' --exclude='*' \
  ../0*_*/ ./content/

# 2. Rebuild questions.json
python3 scripts/build_questions.py
```

The parser uses no external packages — just Python 3.

## Publish to GitHub Pages

One-time setup:

```bash
# Create a new repo on GitHub named 'fintech_analyst_role_prep' under 'oswalshrutika'.
cd site
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin git@github.com:oswalshrutika/fintech_analyst_role_prep.git
git push -u origin main
```

Then in the repo settings → **Pages** → set **Source** to `main` branch, `/` (root). GitHub serves it at `https://oswalshrutika.github.io/fintech_analyst_role_prep/` within a minute.

The `.nojekyll` file in this directory disables Jekyll processing (needed so files starting with `_` and directories like `assets/vendor/` are served as-is).

## Updating after publish

```bash
# Refresh content, rebuild, commit, push.
rsync -av --delete --include='*/' --include='*.md' --exclude='*' ../0*_*/ ./content/
python3 scripts/build_questions.py
git add -A
git commit -m "Refresh content"
git push
```

## Keyboard shortcuts (quiz)

- **Space / Enter** — reveal answer (flashcard) or advance to next (MCQ)
- **1** / **2** — mark flashcard correct / missed
- **A / B / C / D** or **1–4** — pick MCQ option
- **← / →** — previous / next question (flashcard mode)

## Not included (v1)

- Full-text search across content
- Progress persistence beyond theme + last-used filters
- Spaced-repetition scheduling
- Anki export
