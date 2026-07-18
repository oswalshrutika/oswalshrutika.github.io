# 07 — Situational / STAR Stories: Index

Behavioral prep for Technical Analyst / Production Support interviews at investment banks and trading firms. Every story below is anonymized: real client names redacted, real broker names abstracted (Broker X = a large European sell-side; the OMS is a large third-party OMS platform).

## Files in this folder

| # | File | Purpose | Use when |
|---|------|---------|----------|
| 00 | `00_INDEX.md` | This file. Navigation. | Landing page. |
| 01 | `01_comprehensive.md` | 40+ full STAR stories with Situation/Task/Action/Result/Reflection. | Deep prep, ~2 weeks out from interview. |
| 02 | `02_focused.md` | 20 tightest stories re-cut for a 45-min behavioral loop. | The night before. |
| 03 | `03_quick_hit.md` | 12 one-paragraph openers for classic HR questions ("tell me about a time…"). | Screening call, coffee chat. |
| 05 | `05_red_flags.md` | 15 answers that will end an interview, and their fixes. | Self-audit before you speak. |
| 06 | `06_mock_interview.md` | 4 full dialogue transcripts: HR/hiring-mgr behavioral, senior technical deep-dive, ex-trader conflict scenario, skip-level head-of-trading-support. | Rehearsal aloud. |

## Story categories

| Category | Count in `01_comprehensive.md` | Signals it demonstrates |
|----------|-------------------------------|-------------------------|
| Production incident (Sev-1/2) | 12 | MTTR, calm under fire, RCA rigor |
| FIX / market connectivity | 6 | Protocol depth, session recovery |
| Performance / capacity | 3 | Metrics-driven, colo/network sense |
| Escalation / trader-facing | 5 | Communication, tone, PT floor presence |
| Design / architecture | 4 | Judgment, scoping, systems thinking |
| Conflict / pushback | 4 | Backbone, principled disagreement |
| Learning / growth | 4 | Curiosity, self-awareness |
| Mentoring / leadership | 4 | Impact beyond own tickets |

## How to use these stories

1. **Learn 8–10 by heart** — don't memorize the words, memorize the beats (Situation → the one metric → the one action that unlocked it → the number in Result).
2. **Tag them to questions.** Every story here has "When it's the right story" — that is the question it answers best. When an interviewer opens with "tell me about a time you disagreed with a stakeholder", you should already know which two stories fit.
3. **Cut ruthlessly.** Live delivery is 2 minutes, not 8. `02_focused.md` shows the cut. Practice both.
4. **Anonymize aloud.** The muscle memory to say "a European sell-side broker" instead of the real name has to be trained; it doesn't happen automatically under stress.
5. **Own the "Reflection".** Interviewers weight what you learned more than what you did. Every story ends with a lesson you can articulate in one sentence.

## Common trap questions this folder covers

- Tell me about a Sev-1 you owned end-to-end.
- Time you were wrong and had to admit it publicly.
- Time you pushed back on a trader (or PM, or head of desk).
- Time a fix worked in UAT and blew up in prod.
- Time you had to explain a technical failure to a non-technical audience.
- Time you didn't have the answer at 3am.
- Time you disagreed with a more senior engineer.
- Time a junior on the team made a prod mistake — what did you do?
- Time you cut scope because the deadline was real.
- Time you refused to do something the business asked for.

## Style rules (must-follow)

- **Anonymize aggressively.** No real bank names. Real clients become "a US buy-side client" / "an EU asset manager" / "a hedge fund". Real brokers become "Broker X". The internal OMS is "the OMS vendor's platform" or "our OMS".
- **First person** for the candidate answer; **third person** ("the interviewer is probing for X") for signal hints.
- **Numbers matter.** MTTR in minutes, number of orders affected, notional in USD/EUR ranges, not "a lot".
- **Show the actual tag / file / line** when it strengthens the story. Trading interviewers respect specificity (`tag 21283`, `OMS.cpp:5123`, `FLEX_ORDER_COMMISSION_OVERRIDE`) far more than adjectives.
- **Reflection is mandatory.** Every story ends with the lesson in ≤ 3 sentences.
