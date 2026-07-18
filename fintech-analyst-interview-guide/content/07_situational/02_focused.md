# 07 — Situational: 20 Focused STAR Stories

Tight cut of the strongest 20 stories from `01_comprehensive.md`. Every Action bullet is one line, Result is one line. Use this the night before an interview: read straight through in ~15 minutes and every story is delivery-length (90–120s spoken).

## Contents

| # | Story | Category | Best question fit |
|---|-------|----------|-------------------|
| 1 | ATDL checkbox 15-char truncation | Sev-2 incident | "Tell me about a bug that survived UAT" |
| 2 | Commission tag 12/13 leak on 2nd replace | Sev-1 incident | "Time a fix worked in test but broke prod" |
| 3 | Alerts silently missing for one trader | Sev-2 incident | "Time you found a bug no one else could reproduce" |
| 4 | Half-agency-half-principal IOBX cross | Sev-2 incident | "Explain a subtle state-management bug" |
| 5 | EOD purge basket cascade | Sev-2 incident | "Time you had to reverse-engineer legacy logic" |
| 6 | FIX SessionQualifier collision on failover | FIX / connectivity | "Time you owned a Sev-1 end-to-end" |
| 7 | Missed MsgSeqNum reset after venue holiday | FIX / connectivity | "Time you were on call at 3am" |
| 8 | Colo latency spike traced to NIC coalescing | Performance | "Time you cut latency" |
| 9 | Order-book memory growth on GTC roll | Performance | "Time you found a memory leak" |
| 10 | ATDL panel design pushback with trader | Design / conflict | "Time you disagreed with a stakeholder" |
| 11 | Refused a hotfix on illiquid day | Conflict | "Time you said no to the business" |
| 12 | Trader yelling on the floor | Escalation | "Time you handled an angry user" |
| 13 | Explained OMS purge to head-of-trading | Escalation | "Explain a technical topic to non-technical audience" |
| 14 | Wrong root cause called in a war room | Learning | "Time you were wrong publicly" |
| 15 | Prod deploy of vendor patch broke commissions | Learning | "Time UAT missed a regression" |
| 16 | Mentored junior through first Sev-1 | Mentoring | "Time you developed someone" |
| 17 | Runbook for new market connectivity | Leadership | "Time you improved a team process" |
| 18 | Cut scope on ATDL rewrite | Design | "Time you cut scope to hit a date" |
| 19 | Refactored duplicated purge logic | Design | "Time you paid down tech debt" |
| 20 | Cross-team RCA: OMS vs allocations system | Cross-functional | "Time you led without authority" |

---

## Story 1 — ATDL checkbox 15-char truncation

**Situation:** PT desk raised: outbound FIX on Multi-Cross showed tag `21283=IOBX-CROSS-PRE-` — 3 chars missing. UAT and prod both wrong; only affected the "Post" leg of pre/post crosses.
**Task:** Root-cause a 15-char truncation on a value that was clearly configured as 19 chars in ATDL.
**Action:**
- Traced outbound repair to `DtagParam_Checkbox` in `utl/include/DtagParam.h:199-200`.
- Found `char[16]` fixed buffer — 15 usable chars + null — regardless of ATDL `maxLength`.
- Confirmed `maxLength` only widens `TextField_t`, never `CheckBox_t`.
- Presented two fixes to the vendor: widen buffer to `char[64]`, or in the meantime revert to `constValue`+`StateRule`.
- Deployed the `StateRule` workaround same afternoon; vendor patch tracked for the next release.

**Result:** Correct tag `21283=IOBX-CROSS-PRE-POST` on the wire within 4 hours; zero broken crosses next session.
**Reflection:** ATDL widget type dictates the C++ buffer type — `maxLength` is not a universal knob.

---

## Story 2 — Commission leak on 2nd replace of merged DMA order

**Situation:** A European sell-side broker rejected a replace: tag 12/13 commission fields were missing. Only reproduced on the *second* replace of a DMA order that had been merged with another parent.
**Task:** Explain why the override that always ran on `NewOrder` and first-replace silently skipped on second-replace.
**Action:**
- Read `FLEX_ORDER_COMMISSION_OVERRIDE` and saw `if (!get_comm_type())` guard.
- On 2nd replace, incoming order already carried `_comm_type` from replace-1 → guard false → override skipped.
- Merged parent path in `OMS.cpp:5123-5125` cleared `_comm_type` on the parent but left it set on the child snapshot.
- Fix: remove the `!get_comm_type()` guard for merged-parent DMA replaces; commission is always re-derived from the parent rule.

**Result:** Broker rejects went to zero; ~600 replaces/day now clean.
**Reflection:** Idempotency guards ("only run if empty") are landmines when upstream state can be non-empty *and stale*.

---

## Story 3 — Alerts silently missing for one trader

**Situation:** One PT trader stopped receiving fill alerts. Every other trader on the same book was fine. Subscription row in DB looked identical.
**Task:** Find why a matching subscription didn't fire.
**Action:**
- Confirmed the DB `AlertSubscriptions` row matched — key, filter, active flag all correct.
- Followed the generic-alert short-circuit at line 356 — it required an entry in the in-memory `m_subscriptions` multimap, not the DB row.
- Reproduced: trader had reconnected earlier; `RemoveSubscriptions` cleared the multimap; DB re-add path missed re-populating it.
- Patched the reconnect handler to rebuild `m_subscriptions` from DB on every login.

**Result:** Alerts restored inside one session; added a startup consistency check that would have caught it in 30s.
**Reflection:** "The row is there" is not the same as "the runtime cache knows about the row" — always check both sides.

---

## Story 4 — Half-agency-half-principal IOBX cross

**Situation:** Ops flagged an IOBX cross where FIX tag `528=P` (principal) shipped but tag `99376` (portfolio) still carried the agency parent's value. Downstream booking blew up.
**Task:** Explain a cross that was principal on one field and agency on another on the same wire message.
**Action:**
- Traced `Order::Copy()` — it copied `_portfolio` verbatim from the agency parent, which was non-empty.
- Followed `FirmOrder::ActionStageNew()`: the `if (_portfolio.empty())` reset never triggered because it was already set.
- `PropAcctAssign` later flipped `_trading_acct` to principal — but never touched `_portfolio`.
- Prod config had `ft_mm_rule_acct_assign` empty, so the reassignment rule that would have re-derived portfolio never ran.
- Fix: force `_portfolio.clear()` in `ActionStageNew` for prop legs before the reassignment rule, and validated the rule is loaded on startup.

**Result:** Zero mixed-mode crosses since; added a startup assert on the missing rule so it fails loud, not silent.
**Reflection:** State that spans two systems (trading account + portfolio) must be reset together or the invariant is a lie.

---

## Story 5 — EOD purge basket cascade

**Situation:** Post-EOD, a basket with 500 legs was still fully in memory next morning. Half the legs were terminal; one was late-trade-pending.
**Task:** Explain why a single non-purgeable leg kept 499 terminal siblings alive.
**Action:**
- Read `IsActive`/`IsPurgeable` — basket parent's `IsPurgeable` returns false if *any* child returns false.
- Confirmed the blockers: GTC/GTD rollover, late-trade-pending, pending-fill, open child, booking-not-fully-done.
- Documented the cascade with a decision-tree diagram for the ops runbook.
- Proposed splitting the check: purge terminal legs individually, keep only the non-terminal ones plus their parent link.

**Result:** Memory footprint after EOD dropped ~40% on basket-heavy days; ops now has a printable "why is this order still here" flowchart.
**Reflection:** Coarse "all or nothing" purge rules waste memory; per-leg eligibility with a parent-link marker is cheap and correct.

---

## Story 6 — FIX SessionQualifier collision on failover

**Situation:** Overnight failover of the FIX gateway; sessions to two venues both used the same `SessionQualifier`. Only one came up.
**Task:** Diagnose during the pre-open window (~90 minutes) with the desk on the phone.
**Action:**
- Pulled the QuickFIX log — second session's logon was rejected with "duplicate qualifier".
- Confirmed the primary and DR configs had drifted: DR kept the same qualifier for both endpoints.
- Patched the DR config with distinct qualifiers, restarted the second session, verified logon + heartbeat.
- Filed a config-drift ticket and added a diff-check between primary and DR configs to the deploy pipeline.

**Result:** Both venues up 20 minutes before open; drift check now catches this class of bug pre-deploy.
**Reflection:** DR configs must be diff-checked against primary — "eventually consistent" DR is a myth.

---

## Story 7 — Missed MsgSeqNum reset after venue holiday

**Situation:** 3am page: session to a venue wouldn't log on the morning after a market holiday. Venue expected `MsgSeqNum=1`; we sent whatever we had.
**Task:** Get the session up before the desk logs in at 7am.
**Action:**
- Read the venue holiday notice — they reset sequence numbers on non-trading-day boundaries.
- Manually zeroed the store file, forced `ResetSeqNumFlag=Y` on next logon.
- Session came up on the first attempt; heartbeats stable.
- Added a holiday-aware pre-open script that clears store files for venues on their reset list.

**Result:** Session up by 3:35am; the script has prevented 4 similar pages since.
**Reflection:** Venue behavior on holidays is per-venue policy, not FIX spec — encode it in a script, not tribal memory.

---

## Story 8 — Colo latency spike traced to NIC coalescing

**Situation:** p99 tick-to-order latency drifted from 180µs to 900µs after a routine kernel patch. Desk noticed within a day.
**Task:** Bring latency back inside SLO within the week.
**Action:**
- Ran `perf` + `ethtool -c` — NIC interrupt coalescing had reverted to distro default (adaptive on).
- Compared to golden config: coalescing pinned off, IRQ affinity on isolated cores.
- Reapplied the tuning script the patch had wiped, verified with a synthetic load.
- Added the tuning script to the post-patch hook so it re-runs automatically.

**Result:** p99 back to 175µs; post-patch hook has prevented one more regression since.
**Reflection:** Vendor kernel patches quietly reset NIC tuning — bake the tuning into the boot path, not a one-shot script.

---

## Story 9 — Order-book memory growth on GTC roll

**Situation:** Prod OMS RSS grew ~800MB per day. Traced to GTC orders after the overnight roll.
**Task:** Find the leak without a full heap dump on a live server.
**Action:**
- Sampled `pmap` snapshots across the roll window; the growth was in the order-cache arena, not thread stacks.
- Read the roll path — old-day GTC entries were re-inserted into the new-day map without removing the old-day key.
- Patched the roll to `erase()` old-day key before insert; validated with a soak test.

**Result:** RSS flat across a 5-day soak; process no longer needs a weekly restart.
**Reflection:** "Insert-or-replace" that isn't actually `replace` is a slow leak — grep for every insert into a long-lived map.

---

## Story 10 — ATDL panel design pushback with trader

**Situation:** Senior PT trader asked for a new ATDL checkbox with a 30-char value. I knew from Story 1 that `CheckBox_t` truncates at 15.
**Task:** Push back without sounding obstructive to a very senior stakeholder.
**Action:**
- Showed the trader the buffer trace and the on-the-wire evidence from a lab replay.
- Offered two alternatives: constrained dropdown (`Control_t=TextField` with enum) or split into two shorter checkboxes.
- Trader picked the dropdown; delivered same week.

**Result:** No truncation risk; trader now pings me first on new ATDL asks.
**Reflection:** Trust from a trader comes from being right *and* offering a viable alternative in the same breath.

---

## Story 11 — Refused a hotfix on illiquid day

**Situation:** Business asked for an overnight hotfix on a low-volume Friday before a long weekend. The fix touched the commission engine.
**Task:** Say no to a Managing Director without burning the relationship.
**Action:**
- Explained the exact code path: shared between DMA and cross flows; only reproducible under prod-scale load.
- Proposed: deploy Tuesday after the holiday when I can roll back inside a 15-min window.
- MD agreed once he saw the code paths listed on paper.

**Result:** Deployed Tuesday cleanly; no weekend break-fix.
**Reflection:** "No" backed by a specific code path lands very differently from "no" backed by process.

---

## Story 12 — Trader yelling on the floor

**Situation:** Cross rejected mid-market; trader lost the print and was audibly upset in a full trading room.
**Task:** Calm the trader, restore trading, RCA later.
**Action:**
- Walked to the desk (didn't take it on chat); acknowledged the miss and gave a 5-min ETA.
- Repointed his ticket to a working alternate flow; he was trading again in 6 minutes.
- Sent the RCA in writing that afternoon with the fix ETA.

**Result:** Trader was on my side by end of day; still one of my strongest internal references.
**Reflection:** Under stress, presence beats a chat message — go stand at the desk.

---

## Story 13 — Explained OMS purge to head-of-trading

**Situation:** Head of trading asked why "closed" orders were still showing on the blotter next day.
**Task:** Explain `IsPurgeable` cascade without any code jargon.
**Action:**
- Drew basket-and-legs on a whiteboard; used the "one open leg keeps the basket in the room" analogy.
- Named the 4 real blockers in business terms (late trade, unbooked, GTC roll, pending fill).
- Followed up with a one-page runbook.

**Result:** Head of trading now debugs level-1 himself before escalating; my inbox lightened noticeably.
**Reflection:** Teach the model, not the code — non-technical stakeholders need the *why*, not the `if`.

---

## Story 14 — Wrong root cause called in a war room

**Situation:** Sev-1 war room; I confidently called it a FIX out-of-sequence issue. It wasn't.
**Task:** Recover credibility after being publicly wrong.
**Action:**
- As soon as the counter-evidence landed, I said "I was wrong, actual RCA is X" in the same call.
- Wrote the corrected RCA post-incident naming my earlier mis-call explicitly.
- Added the log signature I'd missed to my personal triage checklist.

**Result:** Peers cited that call as *why* they trust me now — the correction, not the miss.
**Reflection:** Retracting cleanly in the same forum you claimed in preserves credibility better than being right slower.

---

## Story 15 — Vendor patch broke commissions in prod

**Situation:** Vendor patch passed UAT; in prod, tag 12/13 disappeared on a specific flow UAT never exercised (see Story 2).
**Task:** Root-cause and prevent the class of regression.
**Action:**
- RCA'd the guard clause; deployed the targeted fix.
- Audited UAT scenarios and found the "2nd replace of merged parent" case was missing.
- Added it as a required regression scenario, and got vendor to add it to their pre-ship suite too.

**Result:** No repeat of this class of miss in 18 months; UAT catches it now.
**Reflection:** A prod bug that UAT missed is a UAT bug too — fix both or expect the sequel.

---

## Story 16 — Mentored junior through first Sev-1

**Situation:** New joiner (3 months in) was on-call the night of a FIX gateway crash.
**Task:** Keep him lead on the ticket without letting the desk suffer.
**Action:**
- Stayed on the call muted; let him drive the diagnosis, prompted only when he was stuck for >2 min.
- After MTTR, walked through the log signatures he'd missed and why they mattered.
- Handed him the RCA write-up as his ticket to sign.

**Result:** MTTR was 42 min (target 60); junior is now our best on-call within a year.
**Reflection:** Presence + patience > taking over — juniors grow on the ticket, not from the postmortem.

---

## Story 17 — Runbook for new market connectivity

**Situation:** Adding a new APAC venue; existing setup was tribal knowledge with 3 people.
**Task:** Make the onboarding repeatable so any on-call could execute it.
**Action:**
- Wrote a step-by-step runbook: cert exchange, session config, holiday-reset behavior, first-message rehearsal.
- Rehearsed it with a junior who'd never seen the venue; timed each step.
- Fed timing gaps back into the doc.

**Result:** Next venue onboarding took 2 days instead of the historical 2 weeks; runbook is now the team standard.
**Reflection:** Onboarding docs live or die on being rehearsed once by someone who *doesn't* know it.

---

## Story 18 — Cut scope on ATDL rewrite

**Situation:** Full ATDL rewrite scoped at 3 months; deadline moved to 6 weeks.
**Task:** Decide what to cut without missing the trader-facing wins.
**Action:**
- Ranked panels by daily use: top 5 delivered 90% of trader value.
- Cut the long tail to phase-2; held the shared framework work in phase-1.
- Communicated the cut with a per-panel priority sheet to the desk lead.

**Result:** Shipped top-5 on time; phase-2 landed 6 weeks later without incident.
**Reflection:** Cutting scope is a communication problem, not an engineering one — show the ranked list and stakeholders self-select.

---

## Story 19 — Refactored duplicated purge logic

**Situation:** Purge eligibility was checked in 4 places with slight variations; caused a Sev-2 when they drifted.
**Task:** Consolidate without a big-bang rewrite.
**Action:**
- Extracted `IsPurgeable(order, context)` as the single source; kept old callers as thin adapters.
- Migrated callers one per sprint over a quarter, each behind a feature flag.
- Deleted the last adapter after 3 months of clean logs.

**Result:** Zero drift-caused purge incidents since; ~600 LoC of duplicated logic gone.
**Reflection:** Strangler-fig migration beats big-bang for critical paths; feature flags earn their keep here.

---

## Story 20 — Cross-team RCA: OMS vs allocations

**Situation:** Bookings were failing in the allocations system; each team was pointing at the other.
**Task:** Lead an RCA across two teams I didn't own.
**Action:**
- Called a 30-min war room; forced both teams to share the exact FIX message and the exact rejection code side-by-side.
- Bug was in allocations' handling of `99376` when we sent principal (linked to Story 4).
- Both teams left with a fix each: OMS clears `_portfolio` on prop legs; allocations tolerates empty `99376` for prop.

**Result:** Bookings clean within 48h; the "side-by-side the messages" pattern is now our default RCA opener.
**Reflection:** Cross-team RCAs deadlock on narrative — force the artifacts (raw messages, raw logs) on screen and blame evaporates.
