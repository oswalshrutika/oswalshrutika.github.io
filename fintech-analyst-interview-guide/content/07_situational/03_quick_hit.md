# Quick-Hit Openers — Top 12 Behavioral Questions

| # | Question | Story |
|---|----------|-------|
| 1 | Fixed something under pressure | Commission leak on merged DMA replace |
| 2 | Biggest production incident owned | ATDL 15-char truncation on Multi-Cross |
| 3 | Conflict with a trader / stakeholder | Trader insisting alert was broken |
| 4 | Disagreed with your manager | Buffer-widen vs. StateRule revert on ATDL |
| 5 | Made a mistake in production | Half-agency-half-principal cross order |
| 6 | Mentored a junior | Onboarding a new hire onto OMS purge logic |
| 7 | Missed a deadline | EOD purge cascade regression |
| 8 | Learned a new technology quickly | ATDL / FIXatdl XML on the fly |
| 9 | Handled ambiguity | Alert-not-firing for one trader |
| 10 | Went above expectations | Root-caused cross non-std settle end-to-end |
| 11 | Difficult teammate | Vendor engineer pushing back on our patch |
| 12 | Delivered without complete requirements | Portfolio field copy in cross workflow |

---

### Q1. "Tell me about a time you fixed something under pressure"
**Story to use:** Commission leak on 2nd replace of merged DMA order
**Opener (memorize):** "Mid-session, a European sell-side broker flagged that commission was leaking through on the second replace of a merged DMA order. I had roughly forty minutes before the next batch of child orders would go out with the wrong economics. I traced it live to a guard clause in the commission-override path that was never re-firing because the replace already carried a populated commission type."
**Punchline:** Identified the `if(!get_comm_type())` short-circuit at OMS.cpp:5123-5125 where the merged parent had `_comm_type='\0'`, patched the guard to force-refresh on replace, and stopped the leak before the next fill cycle — zero economic impact.

---

### Q2. "Biggest production incident you owned"
**Story to use:** ATDL 15-char truncation on tag 21283 IOBX-CROSS-PRE-POST
**Opener (memorize):** "Traders on the Multi-Cross flow were seeing tag 21283 arrive at the broker truncated to fifteen characters — 'IOBX-CROSS-PRE-' instead of 'IOBX-CROSS-PRE-POST'. Every cross ticket for that day was mis-tagged downstream. I owned the incident from first ticket through vendor patch."
**Punchline:** Root-caused it to a `char[16]` buffer in `DtagParam_Checkbox` at `utl/include/DtagParam.h:199-200` — `maxLength` only widens `TextField_t`, not `CheckBox_t` — and pushed the vendor fix (widen to `char[64]`) plus a same-day workaround using `constValue` + `StateRule` so trading continued uninterrupted.

---

### Q3. "Tell me about a conflict with a trader or stakeholder"
**Story to use:** Trader insisting his alert was broken when subscription looked fine
**Opener (memorize):** "A senior trader was convinced the alerting system was silently dropping his notifications, and he wanted the whole subscription module rolled back before the open. His alert subscription looked correct in the UI, and other traders on the same rule were fine, so I pushed back on the rollback and asked for fifteen minutes to prove where the break actually was."
**Punchline:** Found that on his last reconnect, `RemoveSubscriptions` had cleared his entry from the `m_subscriptions` multimap and the DB re-add missed — so the generic-alert short-circuit at line 356 never applied to him. Fixed the re-registration path, alert fired within one cycle, and I earned his trust for the rest of the year.

---

### Q4. "Tell me about a time you disagreed with your manager"
**Story to use:** ATDL fix approach — widen buffer vs. revert to StateRule
**Opener (memorize):** "On the ATDL truncation incident, my manager wanted to push the vendor to widen the buffer immediately and hold until they cut a patched build. I disagreed — the vendor turnaround was at least a week and traders needed the flow the same day. I proposed a two-track approach and made the case with the code path in hand."
**Punchline:** We shipped the same-day workaround — revert tag 21283 to `constValue` + `StateRule` — while the vendor produced the widened `char[64]` buffer fix in parallel. Traders never lost a session, and the permanent patch landed cleanly the following week.

---

### Q5. "Tell me about a mistake you made in production"
**Story to use:** Cross order going out half-agency, half-principal
**Opener (memorize):** "An IOBX cross went out with the principal leg tagged `528=P` but the portfolio field `99376` still holding the agency parent's value. Downstream booking rejected on mismatch, and I had signed off on the release that included the touched code path. I owned that miss."
**Punchline:** I'd assumed `Order::Copy()` was safe because `_portfolio.empty()` guarded the reassignment in `FirmOrder::ActionStageNew()` — but the copy from the agency parent meant the field was never empty, so the guard never fired. I added a targeted regression, filed a rule-check for `ft_mm_rule_acct_assign` being empty in prod, and rewrote our sign-off checklist to include copy-path audits for cross flows.

---

### Q6. "Tell me about a time you mentored a junior"
**Story to use:** Onboarding a new hire onto OMS purge logic
**Opener (memorize):** "A new analyst joined the desk and got dropped straight into an EOD purge incident on day three — baskets weren't purging, GTC orders were rolling wrong, and he was drowning. Rather than solve it for him, I walked him through the `IsActive` / `IsPurgeable` cascade on a whiteboard and had him narrate the state transitions back to me."
**Punchline:** By the end of that session he could identify the four blocking conditions — late-trade-pending, pending fills, open child, booking-not-fully-done — and he owned the next two EOD purge incidents solo. Cut his ramp time from an expected quarter to about five weeks.

---

### Q7. "Tell me about a time you missed a deadline"
**Story to use:** EOD purge cascade regression didn't ship on original ETA
**Opener (memorize):** "I committed to a Friday deploy for the basket-cascade purge fix and I missed it by a full sprint. What I underestimated was how tightly `IsActive` on a basket depended on every single member — one active child kept the whole basket alive, and my initial patch broke GTC/GTD rollover in UAT."
**Punchline:** I flagged the slip on Tuesday of that week, not Friday morning — gave PT and ops runway to plan a manual purge script for month-end — and shipped the correct fix the next Friday with full basket, GTC/GTD, and pending-fill coverage. The lesson I use now: surface the slip the moment I see it, not the day it's due.

---

### Q8. "Tell me about a time you learned a new technology quickly"
**Story to use:** ATDL / FIXatdl XML during the truncation incident
**Opener (memorize):** "Before the Multi-Cross truncation ticket, I had never touched ATDL — FIXatdl XML wasn't part of my day-to-day. But the fix lived in the boundary between the XML definition, the vendor's C++ parameter classes, and the FIX tag output, so I had to get fluent inside a trading day."
**Punchline:** I read the FIXatdl spec sections on `CheckBox_t` vs `TextField_t`, mapped every attribute to the vendor's `DtagParam_*` classes, and by end-of-day I could explain to the vendor engineer exactly why `maxLength` was being ignored for checkboxes — which is what unlocked the real fix.

---

### Q9. "Tell me about a time you had to handle ambiguity"
**Story to use:** Alert not firing for one specific trader
**Opener (memorize):** "One trader's alerts stopped firing. His subscription row looked identical to five other traders whose alerts worked. There was no error log, no exception, no failed publish — just silence. I had to figure out where a message disappears when nothing throws."
**Punchline:** I diffed his session lifecycle against a working trader's and caught that his last reconnect had triggered `RemoveSubscriptions`, which cleared his multimap entry — the DB re-add path missed on reconnect, so the runtime lookup at line 356 never matched. Fixed the re-registration and closed the ambiguity with a log line so the next occurrence would be one-look-and-done.

---

### Q10. "Tell me about a time you went above expectations"
**Story to use:** Cross non-std settle root cause traced end-to-end
**Opener (memorize):** "The desk raised a ticket asking why one cross ticket booked wrong. The ask was small — 'confirm the portfolio field'. But something about the shape of the bug — principal tag correct, portfolio wrong — didn't add up, so I kept pulling."
**Punchline:** I traced it through `Order::Copy()` copying `_portfolio` from the agency parent, the `FirmOrder::ActionStageNew()` guard never firing, `PropAcctAssign` updating `_trading_acct` but not `_portfolio`, and an empty `ft_mm_rule_acct_assign` table in prod. One ticket became a four-defect fix, and the desk stopped seeing half-agency-half-principal orders entirely.

---

### Q11. "Tell me about a difficult teammate"
**Story to use:** Vendor engineer pushing back on the ATDL buffer fix
**Opener (memorize):** "The vendor engineer initially rejected my ATDL patch — his position was that `maxLength` should handle it and the truncation must be on our side. He was senior, remote, and not motivated to hunt through his own header file. Meanwhile my traders were mis-tagged."
**Punchline:** I sent him the exact line — `DtagParam.h:199-200`, `char[16]` on `DtagParam_Checkbox` — plus a two-line repro showing `maxLength` is only honored on `TextField_t`. He acknowledged it within an hour, and we shipped the widened `char[64]` fix in his next patch build. Lesson: when someone pushes back, meet them with the artifact, not the argument.

---

### Q12. "Tell me about a time you delivered without complete requirements"
**Story to use:** Portfolio-field behavior on the cross workflow — never spec'd
**Opener (memorize):** "The cross workflow spec didn't say what should happen to the `_portfolio` field when a principal leg is spun off an agency parent — the doc predated the principal-leg feature. Trading needed the fix same-week, and there was no product owner available to arbitrate."
**Punchline:** I derived the intended behavior from the booking-side contract — principal legs must carry the prop account's portfolio, not the agency parent's — codified it in the `FirmOrder::ActionStageNew()` guard, wrote the rule down in our runbook, and sent it to PT as the definition-of-record. The desk signed off, the fix shipped, and that runbook entry became the spec.
