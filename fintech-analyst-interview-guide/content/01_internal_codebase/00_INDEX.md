# 01 — Internal Codebase Walkthrough

> Interview prep kit for a Technical Analyst supporting a global-bank OMS built on our vendor's core, ~5 YOE.
> Focus: architecture wire flow, region routing, Lua tag layer, OM rules, Core OMS objects, lifecycle, IRST/DFD, EOD purge, alerts, DACS, DCA, ATDL, build & config, custom FIX tags.

## Contents

| File | Purpose | One-line hook |
|------|---------|--------------|
| [`00_INDEX.md`](./00_INDEX.md) | This index | Map of the whole section. |
| [`01_comprehensive.md`](./01_comprehensive.md) | 100+ Q&A, grouped by topic | The full drill — architecture, rules, tags, purge, alerts, ATDL, build. |
| [`02_focused.md`](./02_focused.md) | 50 highest-frequency Q&A | The ones you WILL be asked — ranked by likelihood. |
| [`03_quick_hit.md`](./03_quick_hit.md) | 25 must-know one-paragraph Q&A | Warm-up round, memorize these verbatim. |
| [`04_diagrams.md`](./04_diagrams.md) | Full mermaid set | Whiteboard-ready diagrams for architecture, lifecycle, IRST, purge, alerts, tag pipeline. |
| [`05_red_flags.md`](./05_red_flags.md) | 15 answers to NEVER give | Junior-sounding traps and factually wrong statements — with WHY. |
| [`06_mock_interview.md`](./06_mock_interview.md) | 3 full mock dialogues | Day-in-the-life, incident deep-dive (IOBX truncation-style), architecture whiteboard. |

## Reading order

1. **Skim** `03_quick_hit.md` — reset the fundamentals.
2. **Drill** `02_focused.md` — 50 questions, cover the sheet, answer aloud.
3. **Deep dive** `01_comprehensive.md` — read section by section, one per sitting.
4. **Whiteboard** `04_diagrams.md` — practice re-drawing each diagram from scratch.
5. **Pre-mortem** `05_red_flags.md` — burn in what NOT to say.
6. **Simulate** `06_mock_interview.md` — do each mock live, out loud, with a timer.

## Anonymization conventions (used across the kit)

To keep this kit shareable, all references to real vendors, banks, brokers, and clients are anonymized. The conventions used throughout:

- **OMS vendor / vendor core** — our OMS vendor's platform (the core product our bank builds on).
- **The bank / a global bank OMS** — our employer's OMS deployment.
- **A large sell-side broker / Broker X** — anonymized street-side counterparties.
- **A US buy-side client / a program-trading desk** — anonymized client-side counterparties.
- **CompID names** — LN/NY/HK prefix conventions preserved; actual IDs redacted.
- **Tickers** — MSFT and AUTOA.L only (already public).

The real-name → anonymized mapping is intentionally NOT included in this kit. It lives in a private notes file outside the interview deliverables.

## Ground rules for every answer

- Name the file, the class, or the tag. Vague answers get downranked.
- Draw the flow. Interviewers love a napkin diagram.
- Distinguish **client-side** vs **street-side** consistently.
- When in doubt: "I would `grep -R` the rulebase and check the OM log for the OnClient/OnStreet callback that fired."
