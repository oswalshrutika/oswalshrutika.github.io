# STAR Openers & Versatile Stories

> 10 opener sentences you can drop into any behavioral question, plus 5 versatile stories condensed to 3-sentence form (each expandable into full STAR on request).

---

## Contents

- [1. 10 opener sentences](#1-10-opener-sentences)
- [2. Story 1 — The 15-char truncation](#2-story-1--the-15-char-truncation)
- [3. Story 2 — The tag-12 commission override](#3-story-2--the-tag-12-commission-override)
- [4. Story 3 — The missing alert routing](#4-story-3--the-missing-alert-routing)
- [5. Story 4 — The end-of-day purge cascade](#5-story-4--the-end-of-day-purge-cascade)
- [6. Story 5 — The stale IRST portfolio](#6-story-5--the-stale-irst-portfolio)
- [7. How to pick a story from the question](#7-how-to-pick-a-story-from-the-question)

---

## 1. 10 opener sentences

Use as the *first sentence* to buy 5 seconds and frame the story. Then move to STAR.

1. **Debug story:** "The clearest example was a Sev-2 last quarter where a trader at a US buy-side client saw orders getting rejected only for specific tickers — let me walk you through how I isolated it."
2. **Client-facing pressure:** "I'll share one where a European sell-side broker paused trading during pre-market and I had 40 minutes before their open — the story is instructive because the root cause wasn't where we started looking."
3. **Ambiguity / not enough info:** "One that stands out was an incident where the initial ticket said 'orders slow' — that's a five-word symptom for a problem that turned out to be at the sub-tag level."
4. **Disagreement with a senior:** "There was a case where the trading desk lead was convinced the problem was on our side and I was pretty sure it was upstream — I want to be careful how I tell this because he was right about half of it."
5. **Owning a mistake:** "Early in my time supporting the OMS I pushed a fix in a rush that satisfied the symptom but re-broke a downstream flow the next morning — I still use the lesson from that day."
6. **Under pressure / short deadline:** "Twenty minutes before the New York open, a global bank OMS client called saying no crosses were routing — that constraint shaped how I approached triage."
7. **Learning something new fast:** "When I inherited the ATDL/checkbox module I had zero prior exposure — I had to become a specialist in a couple of days because a Sev-3 ticket landed on it."
8. **Cross-team collaboration:** "A cross-team fix involving the OMS team, the FIX gateway team, and the client's own tech ops is the one I'd point to for coordination — it took three time zones to close."
9. **Data / SQL story:** "There was a reconciliation gap where the trade DB showed 1,200 fills but the FIX log showed 1,205 — I want to walk you through the query I wrote and what it uncovered."
10. **Positive proactive:** "One of the changes I'm most proud of started as a monitoring gap I noticed on my own — no one had asked for it, but three months later it caught a live production issue in staging."

---

## 2. Story 1 — The 15-char truncation

**Handle:** ATDL / IOBX / DtagParam_Checkbox.

3-sentence version:
> **A US buy-side client was routing IOBX cross orders through a European sell-side broker, and the broker was silently truncating a critical custom tag (tag 21283) at 15 characters, causing rejects during pre-market when the parameter value exceeded 15 chars.** I traced through the ATDL layer, found a hard-coded `char[16]` buffer in `DtagParam_Checkbox` on the broker's build, wrote a repro FIX-msg unit test showing the truncation, and pushed the client to switch to a numeric-encoded flag until the broker patched the build. **Result: order rejects dropped from ~40/day to zero within 24 hours; the broker patched in the next release and we added a length-validation lint check to our own outbound-tag layer to catch this bilaterally.**

**Best for questions on:**
- Debugging an obscure bug.
- Working across two organizations.
- Cross-vendor integration.
- Ownership of a tricky root cause.

**Watch-out:** never name the real client. "US buy-side client" and "European sell-side broker" are sufficient.

## 3. Story 2 — The tag-12 commission override

**Handle:** Cancel-replace commission drop.

3-sentence version:
> **A large European broker filed a Sev-3 that commissions (tag 12) were disappearing on cancel-replace chains for a small set of accounts.** I reproduced with a two-step DR: original order carried the commission, but the cancel-replace merged from a template that overrode tag 12 to zero because the account-config layer prioritized "template" over "inherit" for that account class. **Fix was a config change plus a code path that treats commission as inheritance-required unless explicitly reset; I wrote regression FTests for both directions and confirmed the invoice reconciliation gap closed for that broker.**

**Best for questions on:**
- Root-cause analysis on a subtle bug.
- Config-vs-code distinction (a favorite interviewer probe).
- Owning a data-integrity issue.

## 4. Story 3 — The missing alert routing

**Handle:** AlertSubscriptions AH1 not matching.

3-sentence version:
> **A US buy-side desk expected reject-alerts to reach their after-hours (AH1) team, but the AH1 desk was silent while the primary desk was drowning in alerts.** I read the AlertSubscriptions match logic and found that the match required *all* filter columns (client + strategy + product + severity), and the AH1 rows in config had a NULL strategy — the SQL match dropped them on the inner join, so AH1 never matched a live alert. **Fix was to introduce a coalesce for NULL-means-wildcard on strategy at the match layer, backfill the config to remove ambiguity, and add a startup validation that flags any subscription row that would never match.**

**Best for questions on:**
- SQL / joins with NULLs.
- Config-driven routing bugs.
- Being proactive after fixing (validation on startup).

## 5. Story 4 — The end-of-day purge cascade

**Handle:** EOD purge / basket cascade / DFD failure.

3-sentence version:
> **We started seeing sporadic overnight failures where the EOD purge job was leaving orphaned child orders because a parent basket had already been purged.** I mapped the purge cascade — parent → basket-children → tag-linked children — and found the sort order at purge time didn't guarantee parents-before-children when a `DoneForDay` (DFD) failure had left a child in an anomalous state. **We changed the purge to build a dependency graph up-front, purge in dependency order, and log any DFD-failed items into a "review" table instead of silently dropping — that reduced overnight tickets from 3-per-week to essentially zero.**

**Best for questions on:**
- Batch/job engineering.
- Cascading data models.
- Reliability improvement with measurable results.

## 6. Story 5 — The stale IRST portfolio

**Handle:** VENDOR-4885 / portfolio staleness.

3-sentence version:
> **A hedge-fund client on our IRST platform reported that their portfolio view was stale for two hours mid-day and no one had noticed until they tried to hedge.** Investigation showed the portfolio-refresh cron had silently died at 09:12 with a JVM OOM; the process supervisor had restarted the *service* but not re-scheduled the *job*, and there was no alert for "job hasn't published in N minutes." **The fix was two things: a heartbeat-based liveness alert on the publish topic ("no heartbeat for 90 s → page"), and a bounded-retry supervisor that treats jobs and services distinctly; we also added a synthetic canary trade every 5 minutes to detect staleness end-to-end.**

**Best for questions on:**
- Silent failures / lack of monitoring.
- Proactive observability improvements.
- Owning a client-visible outage.

## 7. How to pick a story from the question

| If the interviewer asks... | Reach for... |
|---|---|
| "Tell me about a time you debugged something hard" | Story 1 (truncation) — most complex root cause |
| "Tell me about a time you disagreed with someone senior" | Story 2 or 3 — both had a "not the config we thought" moment |
| "Tell me about handling ambiguity" | Story 3 (routing) — symptom was "our people aren't paged" |
| "Tell me about a time you made a mistake" | Any — pick the one where **the fix was too narrow first pass** (Story 1 or 4) |
| "Tell me about a time you were under time pressure" | Story 1 (pre-market window) |
| "Tell me about a time you improved something proactively" | Story 4 (purge) or Story 5 (portfolio) — both added monitoring |
| "How do you handle a client escalation?" | Story 1 or 5 — walk through comms + technical parallel |
| "Tell me about cross-team work" | Story 1 (broker + client + our team) |
| "Tell me about data reconciliation" | Story 2 (commission) or Story 4 (purge audit) |
| "Tell me about a monitoring gap" | Story 5 (staleness) |

**Universal rules for delivery:**
1. **Anonymize:** "A large European broker", "a US buy-side client", "a global bank OMS" — never a real name.
2. **STAR structure, but front-load the S+T in one sentence.** Interviewers get lost in long Situations.
3. **Numbers land.** "Zero rejects vs 40/day", "3 tickets/week to zero", "40-minute window before open."
4. **End with the learning or the systemic fix.** Interviewers want to see engineering-mindset, not just firefighting.
5. **Prep 3 stories cold; the other 2 warm.** For a 30-min behavioral loop, you likely use 2–3.
