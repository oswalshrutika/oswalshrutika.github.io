---BEGIN HEADER CONTENT---
# 07 — Situational (STAR) Comprehensive

> 40 anonymized STAR stories with triggering-question hints and quantified results.

Format for each story:
### Story <n>. <label>
**When it's the right story:** <question>
**Category:** <production incident | perf | escalation | conflict | learning | design | mentoring>
**Situation** ...
**Task** ...
**Action** ...
**Result** (quantified)
**Reflection** ...

---

---END HEADER CONTENT---
## Situational — Production War Stories (STAR)

> Every story below is presented as **Situation / Task / Action / Result / Lessons**. Stories 1–5 are real production incidents (anonymized); 6–14 are representative synthetic scenarios I would expect to handle in the same seat.

---

### Story 1. ATDL 15-character truncation on a Multi-Cross checkbox tag
**Interviewer signal:** Can you own a nasty low-level bug end-to-end — trader complaint → C++ header → fix → regression?

**Situation.**
A senior program-trading desk raised a P2: on the Multi-Cross ticket, the checkbox for a custom instruction (a strategy identifier we sent on FIX tag 21283) was silently being truncated to the first 15 characters. Downstream broker was rejecting the parent because the instruction string was malformed. It only reproduced on *long* checkbox values; short ones were fine — which is why it slipped UAT.

**Task.**
Isolate why a boolean-shaped ATDL control was clipping a 20-character payload, get a fix in for the next release, and give ops a workaround for the morning.

**Action.**

1. Reproduced in dev by sending the exact strategy label the desk used and captured the outgoing FIX — tag 21283 stopped at exactly char 15. That "exactly 15" was the tell.
2. Traced the ATDL binding for `CheckBox_t` back into the OMS vendor's utility layer, and found the offending declaration in `utl/include/DtagParam.h` around lines 199-200:

   ```cpp
   class DtagParam_Checkbox : public DtagParam {
       char m_checkedValue[16];    // 15 chars + NUL
       char m_uncheckedValue[16];
       // ...
   };
   ```

   The buffer was hard-coded to `char[16]`. The ATDL `maxLength` attribute *was* being honoured but only on the `TextField_t` binding — the `CheckBox_t` path bypassed it entirely and blindly `strncpy`'d into the 16-byte buffer.
3. Verified the same pattern in `RadioButton_t` and `RadioButtonList_t` — same fixed 16-byte buffers. Filed a defect with the OMS vendor with the diff:

   ```cpp
   char m_checkedValue[64];    // widen; ATDL spec allows arbitrary-length enumIDs
   char m_uncheckedValue[64];
   ```

4. **Workaround for the desk that morning:** got them to switch to the abbreviated 12-char strategy code in the checkbox until the patched binary shipped. Documented in the desk runbook.
5. Wrote a regression: an ATDL blob with a 40-character `checkedValue`, asserted the outgoing FIX tag matched exactly.

**Result.**
Vendor accepted the patch in the next fortnightly release. Zero repeats. I ran a grep across the vendor's `DtagParam*` headers for any other `char[16]`/`char[32]` fixed buffers on ATDL controls and got two more preemptive fixes bundled with mine.

**Lessons.**

- "Exactly N characters" truncation is almost always a fixed C-buffer, not a config limit. `strlen(output) == 15` on a value that *should* be 20 → start grepping `char[16]`.
- ATDL controls are not uniform. `maxLength` only binds on the controls the vendor chose to wire it to. Test *every* control type, not just text fields.
- Get a same-day workaround out before you go hunting the root cause; traders don't care about your header file.

---

### Story 2. Tag 12/13 commission leak on the second replace of a merged DMA parent
**Interviewer signal:** Do you understand *stateful* commission handling across replace chains — and do you read the code, not the doc?

**Situation.**
A European sell-side broker reported that on a particular DMA flow, commission (FIX tag 12 `Commission` and tag 13 `CommType`) was being leaked to the counterparty on the **second** replace of a merged parent. Client contract said "no commission on DMA" — this was a compliance issue. First replace was clean; second replace on the same parent showed populated 12/13. Only reproduced when the parent had been formed by **merging** two upstream tickets.

**Task.**
Root-cause why the commission override was skipping only on the second replace of a merged order, ship a hotfix, and reconcile the seven days of leakage the broker had spotted.

**Action.**

1. Pulled the FIX logs for the offending ClOrdID chain and confirmed: `Replace #1` correctly stripped tag 12/13; `Replace #2` did not.
2. Diffed OMS state between the two replaces. `_comm_type` on the parent order was `\0` before Replace #1 (correct, cleared during merge) and `'B'` (Broker default) before Replace #2 — something between the two replaces was **repopulating** it.
3. Walked the code path in `OMS.cpp` around the merge sink (roughly lines 5123–5125):

   ```cpp
   // Merge parent: clear commission — DMA contract
   merged->_comm_type = '\0';
   merged->_commission = 0.0;
   ```

   That runs at merge time — good. But the `FLEX_ORDER_COMMISSION_OVERRIDE` handler that fires on inbound replace had a guard:

   ```cpp
   if (!get_comm_type()) {
       apply_dma_override();   // strips tag 12/13
   }
   ```

   Replace #1 arrived with `_comm_type` empty → override applied → outgoing FIX clean. On Replace #2, the *incoming* replace message from the upstream trader UI **already carried** `_comm_type='B'` (the UI re-computed it from the client's default profile). So `get_comm_type()` was truthy → override skipped → tag 12/13 flowed through.
4. Fix: change the guard from "commission not yet set" to **"is this a DMA route"** — key off the routing tag, not the state of the commission field:

   ```cpp
   if (route_is_dma()) {
       apply_dma_override();       // always strip for DMA, regardless of inbound state
   }
   ```

5. Reconciled the seven days of leakage from the OMS audit tables against the broker's confirms — 43 orders affected, total leaked commission was in the low four figures GBP. Ops handled the rebate.

**Result.**
Hotfix in that Friday evening, broker signed off Monday. Wrote a synthetic FIX replay covering "merged parent + inbound replace carrying its own commission state" that now lives in the CI suite.

**Lessons.**

- "Override if empty" guards are a landmine when the *field itself* can be repopulated by an upstream message you didn't write. Key off intent (the route), not state.
- Merge parents have surprising provenance — anything that reads state on them needs to think about what got cleared at merge time and what might come back.
- Always reconcile the historical blast radius before you close the ticket. The broker will ask "how many, how much" and if you can't answer that in the same conversation, you look sloppy.

---

### Story 3. Alert not firing for one trader despite a matching subscription
**Interviewer signal:** Can you debug an in-memory data structure that disagrees with the database?

**Situation.**
One trader on a busy cash desk stopped getting the "large order" pop-alert. Subscription was configured, other traders on the same rule were getting it fine, DB `AlertSubscriptions` row for him looked identical to his colleagues. Standard "log in, log out, restart the client" didn't fix it.

**Task.**
Find why a valid subscription in the DB was being ignored at runtime — for one user only.

**Action.**

1. Attached to the alerts service and hit the generic-alert dispatch (around line 356 in the alerts handler):

   ```cpp
   auto range = m_subscriptions.equal_range(rule_id);
   if (range.first == range.second) return;   // short-circuit: nobody subscribed
   ```

   For this trader's `rule_id`, the multimap `m_subscriptions` returned an empty range. So the code correctly short-circuited — nobody was "subscribed" from the in-memory view, even though the DB row was there.
2. Diffed the login/reconnect path. Found the trader had a socket reconnect earlier in the day (his laptop dropped Wi-Fi). On reconnect the service ran `RemoveSubscriptions(userId)` which purges the multimap for that user; then it kicked off an async DB re-read to repopulate. The DB call **completed** but the callback that inserts into `m_subscriptions` silently swallowed one row on this user because the alert type was a newly-added enum value the running binary didn't recognise (unknown-enum branch fell to `return;` instead of `LOG_ERROR + skip`).
3. The colleagues were on older, well-known alert types → their re-adds succeeded → multimap correctly rebuilt. This trader's only subscription happened to be the new alert type → nothing re-added → silent miss.
4. Two fixes:
   - Immediate: bounced the alerts service so all subscriptions loaded from DB via the *cold-start* path (which handles unknown enums differently), which unblocked the trader.
   - Permanent: patched the reconnect re-load to log and skip on unknown enum rather than swallow, and added a metric `alerts.subscriptions.dropped_on_reconnect` with a Splunk alert.

**Result.**
Trader was back on alerts within 20 minutes. The metric fired twice in the following month on other users — same root cause, different alert types — and we caught both before the users noticed.

**Lessons.**

- "DB says yes, runtime says no" always means the in-memory index is stale. Don't reprove the DB — attach and dump the structure.
- Silent `return` on unknown enum values is one of the worst bugs you can ship in a stateful service. Every unknown-enum branch needs a log line and a metric.
- Reconnect paths are different from cold-start paths and get one-tenth the testing. That's where these bugs live.

---

### Story 4. IOBX cross principal leg carrying an agency portfolio tag
**Interviewer signal:** Do you understand cross-order legs, custody flags, and how order-copy semantics leak state?

**Situation.**
On an internal-book cross (IOBX), the principal leg was going out with `528=P` (principal) but `99376` (portfolio identifier — a custom tag we used for allocation routing) still had the **agency parent's** portfolio value. Downstream custody rejected because a principal booking cannot reference an agency portfolio. Only reproduced on non-standard-settlement crosses in prod; UAT was fine.

**Task.**
Explain why the principal-leg copy inherited an agency-only field, get the cross re-booked manually, and fix the copy path.

**Action.**

1. Confirmed the FIX outbound: `35=D, 528=P, 99376=<agency-portfolio>` — nonsense combination.
2. Traced `Order::Copy()` on the cross-generation path. The copy function copied `_portfolio` from the agency parent unconditionally. Then on `FirmOrder::ActionStageNew()` the sanitisation was:

   ```cpp
   if (_portfolio.empty()) {
       _portfolio = lookup_from_rule("ft_mm_rule_acct_assign");
   }
   ```

   In UAT, `ft_mm_rule_acct_assign` was populated → the check *sometimes* fired when `Copy()` had cleared portfolio → things looked fine. In prod, `ft_mm_rule_acct_assign` was **empty** (nobody had migrated the rule to prod), AND `_portfolio` from `Copy()` was non-empty (agency parent had one), so `if (_portfolio.empty())` never fired → agency portfolio flowed straight through to the principal leg.
3. Two-part fix:
   - `Order::Copy()` for a cross leg now **conditionally** copies `_portfolio` — only if the target leg's custody flag (`528`) matches the source's. Principal-from-agency = drop the field.
   - Populated `ft_mm_rule_acct_assign` in prod so the fallback lookup works even if a future bug re-introduces empty portfolio.
4. For the desk: pulled the affected cross, cancelled the bad principal leg, re-booked manually with the correct principal portfolio.

**Result.**
Custody accepted the re-booked leg same day. Wrote a targeted test — "agency parent → principal cross leg on non-std settle" — that would have caught this in UAT if we'd had it.

**Lessons.**

- `Order::Copy()` is a giant footgun in an OMS. Every field it copies needs to be justified against the *target* order's semantics, not just the source. Custody, portfolio, commission, and account fields are the usual suspects.
- "The rule is empty in prod" is a config drift bug that will bite you six months after go-live. Config parity between UAT and prod is not optional.
- The two bugs (Copy semantics + empty rule) *masked each other in UAT*. When one bug hides another, that's a strong signal your test env is not representative.

---

### Story 5. EOD purge stuck — one basket kept keeping all its members alive
**Interviewer signal:** Do you understand cascade-liveness rules and why "clean up at EOD" is a lot harder than it sounds?

**Situation.**
Overnight batch alert: EOD purge job ran for 4× its normal duration and left ~1,800 stale orders in the working tables. Morning traders came in to an OMS blotter cluttered with yesterday's fills, and the risk feed to downstream systems was double-counting. The blast radius traced back to a single basket order the desk had traded the afternoon before.

**Task.**
Get the residue purged before market open, and diagnose why one basket blocked the sweep.

**Action.**

1. Ran `IsPurgeable` interactively against the basket parent: `false`. Walked into `IsActive` on each of the basket's ~120 members. **One** child was still `IsActive=true`. That child had a **pending fill booking** — the confirms handler had a bad tag and had NACKed the booking, leaving the child in a limbo state (`FillPending=true`).
2. The basket's purge rule was correctly conservative: "if any member is active, keep the whole basket alive; if the basket is alive, keep all members alive." That cascade meant one stuck child pinned 120 members which pinned the basket which cascaded back to the members — self-reinforcing, would never clear on its own.
3. The full liveness matrix for that OMS at that time (from the code):
   - `LateTradePending` → active
   - `PendingFills` (booking not ack'd) → active
   - `OpenChild` (any child still working) → active
   - `BookingNotFullyDone` → active
   - `GTC`/`GTD` and not expired → active (rolled to next day)
   - Any of the above on a basket member → basket active → all members active

4. Fixed the stuck child by force-booking the fill via the ops tool (we had a "book-and-force-ack" utility for exactly this kind of confirms-drop), which flipped `FillPending=false` on that child. Re-ran `IsPurgeable` on the basket → `true`. Kicked the purge job manually — cleared in ~11 minutes.
5. Root cause on the NACK: the counterparty's confirms message had a new optional tag we hadn't whitelisted; the confirms handler rejected the whole message rather than logging-and-continuing. Patched the confirms parser to be forgiving on unknown optional tags (log + skip, not reject).

**Result.**
Blotter was clean by 07:45, an hour before open. Follow-up: added a Splunk alert `oms.eod_purge.duration > 90m` that would have paged us at 02:00 instead of the desk finding out at 07:00.

**Lessons.**

- Basket cascade + one bad member = infinite loop of "keep alive." Any global sweep needs a **stuck-order detector** that logs which specific atom is blocking, so you don't have to walk 120 members by hand.
- EOD jobs need duration alerts. "It usually takes 30 minutes" is not a monitor.
- Confirms parsers should be **liberal in what they accept** — reject-on-unknown-tag is a self-inflicted outage waiting to happen.

---

### Story 6. FIX session down and gap-fill rejected by the counterparty
**Interviewer signal:** Do you know FIX session-level recovery cold?

**Situation.**
09:47 ET: our primary FIX session to a top-5 US broker dropped. Reconnect fired, logon `35=A` succeeded, but the resend request `35=2` we sent for the gap (seqnums 48211–48477) came back with a stream of `35=4` SequenceReset-GapFill messages that the broker's side generated, and 12 of our previously-sent orders were **never acknowledged**. We didn't know if they had filled, half-filled, or never left.

**Task.**
Get the session healthy, reconcile the 12 orders against the broker's book, and decide per-order whether to cancel/replace or leave.

**Action.**

1. Verified the raw disconnect cause — TCP RST from the broker side, not our end. Their side had rebooted a gateway box.
2. On reconnect, we sent `35=A ResetSeqNumFlag=N` (never reset in production without a phone call — you lose the audit trail). Their side replayed. Their `35=4 GapFillFlag=Y NewSeqNo=48478` told us they were skipping over an admin-message range — that's fine for heartbeats but I had to verify none of our 12 pending `35=D` sat inside their skip range. Two did.
3. Called the broker's ops line and asked them to confirm out-of-band which of the 12 ClOrdIDs they had received and worked. Six had filled and their ExecReports had been lost in the gap — we would recover those from their drop copy replay. Four they had never seen — safe to re-send with a new ClOrdID. Two were in the "sent but no exec yet" state — we cancelled and re-sent.
4. Wrote up the reconciliation: matched broker drop-copy ExecIDs against our internal `oms_orders` table by `ClOrdID` for the recovered six.

**Result.**
Full recovery by 10:20. No client harm. Post-mortem action: added a **positive session-recovery check** — after any reconnect, if the resend produces gap-fills that cover any of our outbound `35=D`, page ops and freeze new sends on that session until the pending set is reconciled.

**Lessons.**

- `ResetSeqNumFlag=Y` in prod is a last resort. It's a way to destroy your ability to prove what you sent.
- GapFill on your outbound orders is *the* dangerous case. GapFill on heartbeats is fine.
- Always have the broker ops phone number stickied to the monitor. FIX-layer reconciliation is table stakes; the trust decision ("did they see it?") has to be human-verified.

---

### Story 7. Drop copy silently stale — monitoring missed a 2-hour gap
**Interviewer signal:** Do you understand *silent* failure and staleness monitoring?

**Situation.**
Ops noticed at 14:30 that the drop-copy session from a broker (used to feed our reconciliation warehouse) showed a "last message" timestamp of 12:24. Session was `LoggedOn`, heartbeats were flowing — but no `35=8` execution reports for over two hours. Our monitoring only alerted on session-down, not on data-staleness.

**Task.**
Confirm whether we were missing real fills, get the flow back, and fix the monitor.

**Action.**

1. Called the broker — they confirmed activity had continued; execution reports had been generated but their drop-copy publisher had gotten wedged on a bad message and had stopped emitting to us specifically (their primary trading session was fine).
2. They restarted their publisher; the session immediately caught up with a burst of ~4,000 messages spanning the gap. All backfilled to reconciliation with correct timestamps.
3. Cross-checked against our own trading session — we had received all fills on the primary path in real time, so there was no client impact, but our T+0 recon report would have been wrong overnight.
4. Fixed the monitor: added a per-session **application-message freshness** check, not just heartbeat freshness. Rule: drop-copy sessions during market hours must see an `35=8` at least every 15 minutes; page if not.

**Result.**
Recon warehouse fully caught up. Since the fix the same alert has fired three times and caught real staleness twice.

**Lessons.**

- Session `LoggedOn` + heartbeats OK is a *transport-layer* claim, not an *application-layer* claim. Monitor the payload, not the pipe.
- Drop-copy is often the *only* view compliance has of fills. Silent staleness there is a regulatory reporting problem, not just an ops problem.

---

### Story 8. Fat-finger order at 10× market — compliance intercept
**Interviewer signal:** Do you know how pre-trade controls actually work, and what to do when one fires?

**Situation.**
09:14: a trader keyed an order for 500,000 shares of a mid-cap at a limit price approximately 10× the current NBBO ask. Our OMS pre-trade fat-finger check (price-collar rule, currently ±20% of NBBO for that liquidity band) intercepted it before FIX-out. The order sat in a `PendingCompliance` state and a compliance officer got a pop-alert. Trader called the desk screaming that his order "wasn't going out."

**Task.**
Explain to the trader what happened, get the correct order out fast if legitimate, and audit whether the collar band was correctly calibrated.

**Action.**

1. Pulled the order from the compliance queue. Confirmed with the trader by phone (recorded line) — he'd typed the price with an extra zero. Cancelled the intercepted order.
2. He re-entered at the intended price; passed all checks; went out at 09:15:47.
3. Post-hoc: pulled last 30 days of price-collar intercepts. Confirmed the ±20% band was catching genuine fat-fingers (this trader's error was the 4th intercept of the month, all confirmed operator errors) with zero false positives on legitimate volatile-name orders. Left the band as-is.

**Result.**
No adverse trade. Trader mildly embarrassed; desk relieved the control worked. I used the audit as evidence in a quarterly control-effectiveness review.

**Lessons.**

- Pre-trade controls exist to catch exactly this. When they fire, don't just override — verify.
- Every price-collar override needs a phone-confirmed reason recorded to the audit trail. That's your defence in a Rule 15c3-5 examination.
- Band calibration must be reviewed periodically — too tight and traders bypass; too loose and it's a rubber stamp.

---

### Story 9. Runaway algo hitting the SEC 15c3-5 throttle at 09:31
**Interviewer signal:** Do you understand market-access risk controls at the gateway layer?

**Situation.**
09:31: our order-throughput monitor tripped — a single algo instance was firing ~800 child orders per second at the FIX gateway, well above its 200/sec cap. The gateway's Rule 15c3-5 throttle correctly rejected the excess with `35=8 39=8 58="Rate limit exceeded"`, but the algo was in a tight retry loop, so the reject-rate was climbing and it was starving other algos on the same session.

**Task.**
Stop the runaway, protect the shared session, and understand why the algo went hot.

**Action.**

1. Killed the specific algo instance from the algo container (targeted, not the whole engine — we didn't want to blow away other traders' algos).
2. Verified the gateway session stabilised — order rate on that session dropped back to ~40/sec baseline within 15 seconds.
3. Root-caused the algo: it was a mean-reversion strategy that had a bug where a bad `Price=0` tick from the market data feed made it think a huge dislocation existed → fired sweep orders → every reject triggered an immediate retry with no backoff.
4. Two fixes for the algo team: (a) sanity-check market data — ignore ticks with price ≤ 0, and (b) add an exponential backoff on gateway rejects.
5. On our side (gateway/OMS): added per-algo-instance auto-throttle — if any instance sustains reject rate > 50% for 3 seconds, we pause it and page ops. Don't rely on the algo owner's backoff.

**Result.**
Contained in under a minute. No client fills lost. No regulatory notification triggered because the 15c3-5 controls did their job.

**Lessons.**

- Rule 15c3-5 controls are broker-dealer liability — they *will* fire, and they must fire in the gateway not the OMS. The OMS is too far upstream to bound the wire rate.
- One misbehaving algo can DOS a shared FIX session. Per-instance throttles, not just per-session throttles.
- Every retry loop needs backoff. Every one. This is not negotiable.

---

### Story 10. Client complaining fills are missing — full ClOrdID trace
**Interviewer signal:** Can you walk an order end-to-end across systems, in the right order, without floundering?

**Situation.**
A US buy-side client called at 15:20: "we sent you 8 orders this morning, we only see fills for 5, where are the other 3?" Their OMS showed the 3 orders in `Sent` state on their side. Ours had no matching parent for those 3 ClOrdIDs.

**Task.**
Prove whether we ever received them, and if we did, where they went.

**Action.**

1. Grep'd the FIX inbound log for the 3 client ClOrdIDs. Found 2 of them in the inbound log — timestamps 09:32:14 and 09:32:15 — both had produced `35=3 Reject` (Session-level reject, `SessionRejectReason=5`, "Value is incorrect for this tag"). Third ClOrdID was **not** in the inbound log at all.
2. Two of them we could explain. The `35=3` reason field pointed to tag 1 `Account` — the client had rolled out a new account code that morning that we hadn't been notified about; our OMS did strict enum validation on `Account` and rejected unknown values at the session layer. Called the client — they confirmed the new account code was legitimate and had been miscommunicated.
3. Third one: I traced the client's session logs (they shared over screen-share) — their side had NEVER actually sent it. They had it queued locally in a "pending FIX-out" state due to an unrelated issue in their OMS. Not our problem to fix, but I helped them find it.
4. Whitelisted the new account code on our side (with compliance sign-off, since it needed a new risk-limit config too), and asked the client to resend the 2 rejected orders.

**Result.**
Two orders resent and filled by 16:00. Third one the client fixed on their side. Client relationship intact; they appreciated the same-hour trace.

**Lessons.**

- The **inbound FIX log** is source of truth for "did we receive it." Not the OMS DB, not the audit trail — the raw wire log. Everything else is derived.
- `35=3` session-level reject is easy to miss because it doesn't create an order object in the OMS. You have to grep the log.
- Client-side "we sent it" ≠ "we sent it." Their outbound log is the tie-breaker.

---

### Story 11. Market open cross rejection — LULD band violation
**Interviewer signal:** Do you understand market-open microstructure and why some rejects are unavoidable?

**Situation.**
09:30:02 on a volatile earnings-day: a limit order to buy 200,000 shares of a mid-cap at a price well outside the pre-open LULD reference band was rejected by the primary listing exchange with `35=8 39=8 Text="Order price outside LULD band"`. Trader claimed the order should have gone into the opening auction.

**Task.**
Explain the reject, confirm the OMS did the right thing, and improve the pre-open UX so this stops happening.

**Action.**

1. Pulled the LULD reference band the SIP had published at 09:29:45 — the trader's limit price was ~7% above the upper band. The opening auction cross would not cross above that band; the exchange correctly rejected.
2. Confirmed the OMS had no pre-trade guard against LULD bands (we had price collars against NBBO but at 09:29 there is no NBBO, only the pre-open indicative). So the OMS happily sent it and the exchange caught it.
3. Two changes:
   - **Immediate:** desk got a wiki note explaining LULD bands are enforced at the primary during the auction, and pre-open indicative prices should be checked before submitting aggressive limits.
   - **Longer-term:** wired the OMS pre-trade check to also consume the SIP LULD band feed and warn (not block) if the order price sits outside the current band. Warn-not-block was deliberate — sometimes traders genuinely want to sit at the band edge and let the auction come to them.

**Result.**
Trader re-priced inside the band and filled in the opening cross. Zero further LULD auction rejects on our desk that quarter after the pre-trade warning was live.

**Lessons.**

- Pre-open is a special microstructure regime. NBBO-based collars are useless before there's an NBBO.
- Not every reject is a bug. Sometimes the exchange did exactly the right thing and your job is to educate.
- Warnings > blocks for pre-trade controls that have legitimate edge cases. Blocks train traders to route around you.

---

### Story 12. Options expiry weekend — pin risk on a heavily-shorted single-name
**Interviewer signal:** Do you understand options ops around expiry and the OMS's role in position management?

**Situation.**
Third Friday of the month, ~30 minutes to expiry. Our OMS positions blotter showed a client short 8,000 contracts of a call struck at 145 on a stock trading at 144.97 — classic pin risk. If it pinned at 145 the client's exercise/assignment exposure over the weekend would be enormous depending on whether the calls were exercised.

**Task.**
Make sure ops, the client, and the risk desk all knew, and the OMS didn't do anything stupid at the close.

**Action.**

1. Flagged the position to the risk desk and the client's ops team. Both were already aware — the client had a specific plan to either close the short via a spread or accept assignment.
2. Confirmed the OMS auto-exercise settings for the client's account — the OCC does contrary-instruction handling but we needed to know if the client had left standing instructions to exercise/not-exercise near-the-money options. They had explicit instructions filed with the clearing firm.
3. Monitored the OMS through the close for any late fills on hedges (they were spreading out at ~15:55). All hedges booked correctly.
4. Weekend on-call was warned: any early-Monday assignment notification from the OCC needs immediate booking to the client's account and margin recalc.

**Result.**
Stock closed at 144.92, calls expired worthless, no assignment. But had it closed at 145.01 we would have been ready. Client's ops team followed up Monday to confirm no notices — clean.

**Lessons.**

- Pin risk is not a bug, it's a scheduled event. Anticipate it on the third Friday.
- Auto-exercise / DNE (do-not-exercise) instructions live at the clearing firm, not always in the OMS. Know where the source of truth is.
- Weekend on-call handovers need explicit "watch this position on Monday" notes. Don't rely on the OMS to page you.

---

### Story 13. T+1 settlement failure due to a timezone bug
**Interviewer signal:** Do you understand post-trade cutoffs and how a timestamp error can cause a real fail?

**Situation.**
Post T+1 go-live, a client's US-equity trades executed at 15:45 ET on trade day were failing to affirm by the 21:00 ET deadline and getting flagged as at-risk for T+1 settlement. Our OMS was generating the affirmation batch file with a timestamp on it, and the client's custodian was rejecting some batches as "past cutoff" when we thought we'd sent them well within the window.

**Task.**
Find why the custodian's clock and ours disagreed by exactly 5 hours.

**Action.**

1. Grep'd our outbound affirmation batches and the custodian's reject notices. The custodian's clock said 21:34; our outbound batch header said 16:34 (our local ET time). Not the same field.
2. Root cause: the batch file's timestamp header was being emitted in **ET local time without a timezone offset**, and the custodian's parser was interpreting a bare `16:34` as UTC. UTC 16:34 ≠ ET 21:34, so their system thought our file arrived hours *before* our actual clock time — but their file-arrival log used server-side receipt time which was correctly ET, and *that* was past cutoff for one batch that had queued behind another.
3. Two fixes: (a) emit the batch timestamp as ISO-8601 with an explicit `-05:00` offset (or in UTC with `Z`) — no more ambiguity, and (b) fixed our internal queue so affirmation batches are prioritised over less-time-critical files at the end of day.
4. Reconciled the at-risk trades — one had actually failed to settle T+1 and was being repaired via CNS; the rest affirmed once the timestamp issue was clarified.

**Result.**
Zero further affirmation cutoff issues. One CNS fail cost about $80 in interest — trivial, but the near-miss was the point. Wrote a "timezones in outbound files" checklist for the engineering team.

**Lessons.**

- Never emit a naive timestamp across a system boundary. Always include an explicit offset or use UTC with `Z`. This is a T+1 world; sloppy timestamps cause fails.
- End-of-day file queues need explicit priorities. Affirmation files are not equal to reference-data files.
- One CNS fail is the visible tip. The near-miss volume is the real story.

---

### Story 14. Colo NIC packet drops during volatility
**Interviewer signal:** Do you know that "the app is fine" doesn't mean "the network is fine"?

**Situation.**
Fed announcement day. 14:00 ET, spike in market data volume. Our colocated market-data handler (in the exchange's colo cage) started logging occasional `sequence number gap` warnings — implying packets from the exchange multicast feed were being dropped before our app saw them. Algos using that feed started to skew slightly.

**Task.**
Confirm whether it was app-layer, NIC-layer, or exchange-layer, and stop the drops.

**Action.**

1. First check — the exchange's status page and the sequence-gap alerts from other colo tenants (via a shared ops channel). Nobody else reporting drops. That ruled out an exchange-side issue.
2. Ran `ethtool -S <interface>` on the colo NIC — `rx_missed_errors` was climbing. The NIC's hardware ring buffer was overflowing during microbursts; the CPU wasn't draining fast enough because IRQ affinity was pinned to a CPU also handling a chatty logging thread.
3. Two fixes, coordinated with the network engineering team: (a) increased NIC ring buffer size (`ethtool -G rx 4096`), and (b) moved the logging thread off the same core as the NIC IRQ handler. Rebooted the market-data process during a low-volatility window later that afternoon.
4. Ran a synthetic multicast replay against the fixed configuration — zero drops at 3× the peak burst rate we'd seen.

**Result.**
Post-fix, no further sequence gaps for the rest of the announcement cycle. Algos back on trusted data. Added `rx_missed_errors > 0` to the Splunk telemetry as a first-class alert — previously we only watched sequence gaps at the app layer, which is one layer too late.

**Lessons.**

- App-layer gap alerts tell you *there was a problem*. NIC counters tell you *where*.
- Colo NICs are tuning-critical. Ring buffer + IRQ affinity + isolcpus is not "premature optimisation"; it's the baseline configuration.
- Microbursts don't show up in per-second bandwidth graphs. You have to look at per-millisecond queue depth.

---
## Situational — Production, People, Process (Stories 15–27)

STAR = **Situation / Task / Action / Result**. Answers below are written as if I lived them on our OMS vendor's platform at a global bank. Names anonymized per house style.

---

### Q15. Multicast A-feed lagging B-feed — how did you diagnose and resolve?
**Interviewer signal:** Do you understand redundant market-data feeds, sequence gaps, and how to fail over without corrupting the book?
**Answer:**
- **Situation:** On our OMS, top-of-book for NYSE-listed names comes over two identical UDP multicast groups (A and B) from the exchange direct feed. Around 09:35 ET, an EQ trader complained that his synthetic pairs P&L was ticking one leg late. Our internal ticker plant showed A-feed roughly 40–120 ms behind B, and A had a rising `gap_count` metric.
- **Task:** Confirm it's A-feed only (not our consolidator), keep the trader hedged, and cut over cleanly without double-counting prints.
- **Action:**
  1. `tcpdump -i eth2 -nn 'udp and net 233.54.12.0/24'` on both feed handlers — A was receiving, but every ~2 s a burst of packets was dropped by the NIC. `ethtool -S eth2` showed `rx_missed_errors` climbing on the A NIC only.
  2. Compared seq numbers to B — B was clean and current. So this was a **local receive** problem, not an exchange publication problem.
  3. Told the arb desk to trust B until further notice, and disabled A as the primary in the feed arbiter (our arbiter takes lower-latency of A/B per message, but if A is gap-heavy it poisons the composite).
  4. Root cause with infra: IRQ affinity on the A NIC had drifted after a kernel patch the night before — it was pinned to a CPU that was also running the ticker-plant recorder. Re-pinned IRQs, bumped `net.core.rmem_max`, requested exchange retransmit for the gap window via TCP recovery channel.
- **Result:** A-feed clean within 20 minutes, arbiter re-enabled to A/B composite, zero bad prints made it into the OMS book. Wrote a runbook item: "if A lags B by >2 messages sustained → arbiter to B-only, page infra." Later added a Splunk alert on `rx_missed_errors` delta.

**Watch-outs:** Don't just "switch to B and forget" — you must confirm the gap didn't already corrupt VWAPs the algo desk had cached. Also: never fail over silently; the arb desk needs to know which feed the P&L is coming from.

---

### Q16. Late trade / cross print confusing EOD — how did you handle it?
**Interviewer signal:** Do you understand T+0 EOD flow, out-of-sequence executions, position vs P&L, and coordinating with middle office?
**Answer:**
- **Situation:** At 17:42 (well after 16:00 close), the exchange booked a **late cross print** against one of our resting orders — a 40k-share block in a mid-cap. Our EOD position file had already been generated at 17:15 and shipped to the risk system and to the prime broker. The trader's blotter now showed a fill that risk didn't know about.
- **Task:** Re-reconcile the position, make sure the trade is booked into the correct T-date (not T+1), and prevent risk / middle office from seeing a stale snapshot.
- **Action:**
  1. Pulled the ExecutionReport (35=8) — `LastPx`, `LastQty`, `TransactTime`, `ExecType=F`, and critically `TrdMatchID` and the exchange's `TradeDate` tag. `TradeDate` was T, not T+1 → it belongs to today's session.
  2. Verified the exchange leg via the drop-copy session — same fill, same TrdMatchID, so it was legitimate, not a duplicate.
  3. Cancelled the previously-shipped EOD position file with middle office, regenerated it after the OMS booked the fill, re-shipped with a version bump. Made sure the trader's blotter, our internal position service, and the prime broker's file all matched.
  4. Pinged the trader — his intraday P&L now moved by ~$12k because that block was included; better he sees it from me at 17:50 than from a risk email at 08:00 next morning.
- **Action-technical detail:** In our OMS the ExecReport went into a "late-fill" queue when it arrived post-cutoff; the queue was processed but the EOD hook didn't refire. I opened a ticket with our OMS vendor to add a `late-fill triggers EOD-rebuild` config flag.
- **Result:** Positions rec'd clean by 18:15, no break on T+1 open, and I owned the vendor enhancement request through to delivery.

**Watch-outs:** Never re-date a late print to T+1 to make your life easier — that breaks tax lots, corporate-action alignment, and regulatory reporting.

---

### Q17. Compliance blocks a trader's order — trader calls in a panic
**Interviewer signal:** Can you stay calm, keep the trader informed, and honor the compliance boundary without becoming a bottleneck?
**Answer:**
- **Situation:** Head of EQ trading calls me at 14:58 — "my order for 500k shares just got rejected, market's moving, fix it." Our pre-trade compliance layer (position-limit + restricted-list check) had rejected on `Text=57` — restricted list hit.
- **Task:** Diagnose fast, tell the trader the *truth* (I can't override compliance), route them to the right approver, and make sure the reject reason was legit not a bug.
- **Action:**
  1. Pulled the reject in the OMS message log by ClOrdID — confirmed compliance service returned `RESTRICTED_LIST` for that symbol. Cross-checked the symbol against today's restricted-list feed — yes, it was added at 08:30 by the control room (research embargo).
  2. Told the trader in one sentence: "Symbol X is on today's restricted list — I can't lift it, only control room can. Their number is <ext>, I'll conference you now." Conferenced control room in.
  3. In parallel confirmed there was no bug — the reject fired the first time the order was submitted, the reject text was propagated back to the trader's GUI (some older reject paths swallow tag 58, which is a real bug we've fixed).
  4. Logged the incident: who called, what symbol, what time, what the resolution was.
- **Result:** Control room granted a same-day exception in ~4 minutes, order re-entered, executed. Trader P&L intact, compliance boundary respected, my hands stayed clean.

**Watch-outs:** Never, ever, "just resubmit with the compliance flag off" — that's a firing offense at any bank. Your job is to route, not to override.

---

### Q18. New broker onboarding — FIX conformance testing
**Interviewer signal:** Do you know what "conformance" actually means, and can you run it methodically?
**Answer:**
- **Situation:** Onboarding a new US-based sell-side broker as a DMA destination on our OMS. They gave us their FIX 4.2 spec + a UAT endpoint. Goal: certify we can send NewOrderSingle / Cancel / Replace and correctly parse their ExecReports, before any real flow.
- **Task:** Run a conformance matrix covering session-level, application-level happy path, and edge cases; produce a signed-off cert doc.
- **Action:**
  1. **Session layer** — Logon (35=A) with HeartBtInt, sequence number reset behavior, ResendRequest, TestRequest, Logout, and disconnect-during-heartbeat.
  2. **App layer positive** — new market, limit, stop, IOC, FOK, GTC, GTD; each acknowledged and filled/cancelled.
  3. **App layer negative** — invalid symbol, missing required tag (e.g., drop tag 55), bad enum (`OrdType=Z`), price > tick-size mismatch, qty=0, past ExpireTime.
  4. **Amend/cancel** — cancel unknown ClOrdID → expect `35=9 CxlRejReason`; replace after partial fill → check LeavesQty semantics; replace during pending-new.
  5. **Recovery** — kill session mid-flow, reconnect, replay via ResendRequest, verify GapFill (35=4).
  6. Recorded every case with a request/response pair, timestamped, into a matrix. Anything failing → raised with counterparty and re-tested.
  7. Final step: two-way UAT run with the broker's trader hitting our test book, our trader hitting theirs.
- **Result:** Signed conformance sheet, they went live the following Monday with 100 shares as a first live order, ramped over 3 days. Zero prod issues in the first month attributable to FIX.

**Watch-outs:** People forget the *negative* cases. If you can't articulate exactly what the counterparty does on `OrdType=Z`, you haven't conformance-tested — you've smoke-tested.

---

### Q19. Post-mortem for a Sev-1 — running the RCA
**Interviewer signal:** Do you run blameless, structured post-mortems, and can you drive actions to closure?
**Answer:**
- **Situation:** A Sev-1 where our order-router dropped ~200 child orders for ~90 seconds during a burst from a VWAP algo. Traders had to manually resubmit; small realized slippage.
- **Task:** Run the RCA within 48h, deliver a written post-mortem to the TA head and to the biz sponsor, and lock in fixes.
- **Action:**
  1. **Timeline** — pulled logs from OMS, router, FIX engine, and exchange gateway. Timestamped every event to millisecond. Reconstructed exactly when queue depth built up.
  2. **Root cause** — router had a bounded internal queue (10k msgs). VWAP burst combined with a slow downstream broker session (their ack latency spiked) filled the queue; new messages were dropped silently, only warned in log.
  3. **Contributing factors** — (a) drop was a WARN not an ERROR, so no page fired; (b) no back-pressure to the algo — it kept firing; (c) monitoring on queue depth existed but threshold was 90%, we hit 100% in one sample window.
  4. **Blameless framing** — "the system permitted this failure mode," not "person X shipped bug." Named the algo team, the router team, and ops as joint owners.
  5. **Actions with owners + dates** — (i) drop → hard ERROR + page, (ii) queue-depth alert at 60% + 80%, (iii) back-pressure protocol to algo, (iv) load-test the router at 3x observed peak.
  6. Reviewed the doc with everyone before publishing, and tracked actions weekly until all closed.
- **Result:** All 4 actions closed within 6 weeks, no recurrence. The alerting change caught a similar burst 3 months later at 62% — we throttled proactively, zero drops.

**Watch-outs:** Post-mortems that name people rot the culture and don't fix the system. Also: "TBD" as an owner is the same as "not done."

---

### Q20. Junior teammate makes a mistake in prod — how do you handle it?
**Interviewer signal:** Leadership signal — do you protect people while still fixing the problem and preventing recurrence?
**Answer:**
- **Situation:** A junior TA on my team, on-call for the first week, executed a manual OMS trade correction on the wrong ClOrdID during a live session. It cancelled a resting parent order that shouldn't have been touched. Trader noticed within 60 seconds.
- **Task:** Fix the trade impact, protect the junior from being publicly torched, and make sure this doesn't happen again — to them or anyone.
- **Action:**
  1. **Fix first, blame never.** Got on the phone with the trader, reinstated the parent order, apologized, reported the ~$800 slippage. Trader was annoyed but fine.
  2. Pulled the junior aside — not on the group channel — asked him to walk me through what he did. He'd copied a ClOrdID from a chat message and pasted; the chat had two IDs on adjacent lines and he grabbed the wrong one.
  3. Told him: "This is a system that lets you make this mistake. That's what we're fixing." Wrote up the incident myself, took ownership as on-call lead.
  4. Actions: (i) added a confirm-dialog on manual cancel that shows symbol + side + qty + client, (ii) any manual op above N shares now requires a second TA to approve, (iii) updated the runbook.
  5. In our next 1:1 with his manager, I framed it as a systems learning, not a performance issue.
- **Result:** Junior stayed confident, stayed on the team, is now a senior himself. The confirm-dialog has caught at least three other near-misses since.

**Watch-outs:** Public blame kills a team's willingness to touch production. Never do it. Fix the system, coach the human privately.

---

### Q21. Trader disagrees with your reject reason
**Interviewer signal:** Can you hold your ground on facts without being a jerk?
**Answer:**
- **Situation:** Trader submits a limit order, OMS rejects with `Text=Price outside price-band`. Trader IMs: "your system is broken, my price is fine, fix it." He's senior, loud, and P&L-facing.
- **Task:** Verify the reject is correct, communicate factually, and either fix the bug or defend the reject.
- **Action:**
  1. Pulled his ClOrdID from the log. His `Price=48.20`, the reference midpoint at submit time was `41.10`, our price-band tolerance for that name was ±10%. So the band was ~[37.0, 45.2]. His 48.20 was legitimately outside.
  2. Replied in one message: "ClOrdID X was rejected because price 48.20 was outside the ±10% band around ref 41.10. That's working as designed — the band is set by risk. If you believe the band is wrong for this name, I can raise it with risk. Do you want me to?"
  3. Sent him the log excerpt (times, tags) as evidence. Didn't argue tone-for-tone.
  4. He accepted, said "ok yeah I meant 41.20," resubmitted, filled.
- **Result:** No escalation, no bug filed. I did open a small enhancement — put the reference price and band boundaries *into the reject text* itself (`Price 48.20 outside band [37.00,45.20]`) so future traders self-diagnose without pinging me.

**Watch-outs:** Two failure modes: (a) capitulating to seniority and turning off a real safeguard, (b) getting defensive and turning a factual reply into an argument. Neither wins.

---

### Q22. On-call rotation — 03:00 APAC issue
**Interviewer signal:** Do you have discipline around waking up, triage, and escalation?
**Answer:**
- **Situation:** 03:12 local, PagerDuty fires — Tokyo session on the OMS is disconnecting and reconnecting every ~30 seconds. APAC desk is trading the open.
- **Task:** Restore stable connectivity fast; loop the right people; don't guess.
- **Action:**
  1. **Acknowledge within 5 minutes** — that's the SLA. Standard: even if I'm groggy, ack first, then think.
  2. Opened the runbook for "FIX session flap." Checked the session log — Logon → Heartbeat → disconnect → reconnect loop. Counter-party log (via drop-copy) showed our side sending Logout with `Text=SendingTime accuracy`.
  3. Ran `ntpstat` on our Tokyo gateway box — clock had drifted ~2.5 seconds. NTP daemon had died.
  4. Restarted `ntpd`, forced a step via `ntpdate`, brought clock back within 50 ms. Session stabilized on the next Logon.
  5. Sent Slack update to APAC desk head + APAC TA lead: "Tokyo session stable as of 03:26. Root cause NTP daemon died on gw-tok-01. Monitoring. Full RCA in the morning."
  6. Didn't go back to sleep for another 20 minutes — watched the session, confirmed no re-flap.
- **Result:** APAC lost ~14 minutes of the open on that broker but had alternate routes; no material P&L. Next-day action: added a monit rule to auto-restart `ntpd` and alert on clock skew > 500ms. This later became a standard for every gateway box.

**Watch-outs:** Don't try to be a hero and fix without a runbook when you're half-asleep. Also, always update the desk in writing — a phone call at 3am they'll forget by 9am.

---

### Q23. Pushing back on a business shortcut fix
**Interviewer signal:** Can you say "no" (or "not yet") to the business with technical reasoning, without being obstructionist?
**Answer:**
- **Situation:** Head of algo trading wanted us to hardcode a special routing exception for one high-value client — bypass our normal broker-selection logic and pin their flow to one broker's algo suite. He wanted it live "by Friday."
- **Task:** Deliver the business outcome (that client's flow gets that broker) but not via a hardcode.
- **Action:**
  1. Asked him: what's the real requirement? He said "that client's PM asked for it and they're worth $Xm in commissions."
  2. Explained the risk of a hardcode: (a) client-specific `if` branches accumulate and become impossible to audit, (b) compliance can't see why the flow went where it did, (c) if that broker has an outage, we now have a special code path with no fallback.
  3. Proposed the alternative: add a **broker-preference config** on the client account object — a data change, not a code change. Same behavior for that client, but visible to compliance, reversible without a release, and reusable for the next client with the same ask. Timeline: same Friday, because it's config work not code work.
  4. Wrote the config, tested end-to-end in UAT, released Friday afternoon in a controlled window.
- **Result:** Client happy, algo head happy, and we now use that broker-preference mechanism for four other accounts. No hardcode ever entered the codebase.

**Watch-outs:** "No" alone loses the argument. "Not that way, but here's how, on your timeline" wins it.

---

### Q24. Sybase → Oracle migration — analyst role
**Interviewer signal:** Real DB migration experience — do you understand the analyst deliverables (mapping, data-type gotchas, cutover plan)?
**Answer:**
- **Situation:** Bank was migrating the OMS backend from Sybase ASE to Oracle 19c. I was the TA on the trading-analytics slice — order history, exec reports, and reconciliation queries.
- **Task:** Own the data mapping, catalog the T-SQL vs PL/SQL differences that hit our queries, and run parallel-run validation.
- **Action:**
  1. **Schema mapping** — Sybase `datetime` → Oracle `TIMESTAMP(6)` (Sybase is 1/300s precision, Oracle configurable), `text` → `CLOB`, `image` → `BLOB`, `numeric(18,4)` → `NUMBER(18,4)` (safe). Watched for `identity` → Oracle sequences.
  2. **Query-level gotchas I catalogued** — `isnull()` → `NVL()`; `top N` → `FETCH FIRST N ROWS ONLY` (12c+) or ROWNUM; `getdate()` → `SYSDATE` or `SYSTIMESTAMP`; `+` string concat → `||`; temp tables `#tmp` → global temp tables `ON COMMIT PRESERVE`; `IF @@rowcount` → `SQL%ROWCOUNT`.
  3. **Parallel-run** — for 2 weeks, every OMS write went to both DBs. Nightly job compared row counts and checksums by trading date on Order, ExecReport, Allocation tables. Found and fixed a rounding difference — Sybase was truncating a `price * qty` computed column at 4 dp, Oracle at 6. Aligned by adding an explicit `ROUND(...,4)`.
  4. **Cutover** — Saturday, single window. Snapshot Sybase, apply CDC delta to Oracle, redirect app, smoke-test with a synthetic order flow before Monday open.
- **Result:** Cutover clean, no data breaks, one week of heightened monitoring, then business as usual. My migration doc became the template for the next two subsystems.

**Watch-outs:** Don't skip parallel-run. And don't trust `SELECT COUNT(*)` alone as validation — you need row-level checksums for tables you actually care about.

---

### Q25. New algo — production sign-off
**Interviewer signal:** Do you know what "production sign-off" actually entails for a new trading algo?
**Answer:**
- **Situation:** Quant/algo team built a new liquidity-seeking algo. Wanted to release to production for two internal desks.
- **Task:** As TA lead on the OMS integration side, sign off (or not) on the release.
- **Action:** My sign-off checklist:
  1. **Functional** — algo tested in UAT against a simulator + against live UAT market data replay. Behaves within spec for order sizes 100 → 1M shares, across at least 20 symbols spanning cap ranges.
  2. **Risk gates** — max order size, max notional, max child-order rate, kill-switch — all wired to firm-wide limits, not algo-local ones. Tested by *exceeding each limit* in UAT and confirming rejection.
  3. **Compliance** — algo respects restricted list, respects short-sale locate flow, generates correct `Handling Instruction` and `Algo ID` tags on child orders (regulatory).
  4. **Observability** — child orders tagged with parent algo ID + version, so we can trace any child back. Metrics: fill rate, slippage vs arrival, cancel/replace count per parent — all in the dashboard.
  5. **Kill switch** — tested: can the desk halt the algo mid-execution? Does halt cancel resting children or leave them working? Documented.
  6. **Rollout plan** — start with one trader, one symbol, small size, one day. Then widen.
  7. **Rollback plan** — feature-flag off, revert to previous algo version. Tested.
- **Result:** Signed off after two open items were closed (one metric missing, one kill-switch corner case). Algo went live small, ramped over two weeks. First month: within performance spec, zero risk breaches.

**Watch-outs:** Sign-off is not a rubber stamp. If you sign and something blows up, it's your name on the doc. Also — never sign off without a tested rollback.

---

### Q26. Custom broker requests a tag rename mid-day
**Interviewer signal:** Do you understand FIX rigor and refuse to hot-patch production for one counterparty's convenience?
**Answer:**
- **Situation:** 11:15 on a normal trading day. A small broker (custom FIX dialect) emails: "please rename tag 6001 to tag 6002 on your outbound orders to us, our system just changed." No advance notice.
- **Task:** Politely refuse a same-day change; provide the correct path.
- **Action:**
  1. Replied within 15 minutes: "We can't change an outbound FIX field mapping mid-session without change control. The correct process is: (a) you send the updated spec, (b) we schedule a UAT round, (c) minimum 5-business-day change window. Meanwhile your inbound handler needs to accept 6001 as it did yesterday. If you can't, we'll have to route your flow to a different broker until you're ready."
  2. Escalated internally to my team lead + the sales-trading rel manager for that broker, so they knew about the ask and the risk.
  3. Broker came back within an hour saying yes they could accept 6001 for now, and they filed a proper change request for the following week.
- **Result:** No trades lost, no rushed change went into prod, broker was slightly embarrassed but respected the discipline. The following week we did the change properly with UAT sign-off.

**Watch-outs:** "It's just a tag number" — no, it isn't. Any mid-session change to a FIX field mapping can break parsing on either side and mis-book real trades. There is no such thing as a small FIX change during market hours.

---

### Q27. Regulatory audit request for a specific ClOrdID
**Interviewer signal:** Do you understand audit trails, chain-of-custody, and how to respond to a regulator/compliance query precisely?
**Answer:**
- **Situation:** Compliance forwarded a regulator inquiry: "Provide the complete lifecycle of ClOrdID ABC-2026-07-11-000123, including all messages sent and received, timestamps, and the identity of the human trader who submitted it. Deadline: 48 hours."
- **Task:** Produce a defensible, timestamped, immutable extract.
- **Action:**
  1. **Do not query prod DB with ad-hoc SQL and paste into email.** Use the archival/audit store — that's the version compliance considers authoritative.
  2. Pulled the full FIX message log for that ClOrdID from the archive: NewOrderSingle (35=D) → Ack (35=8 ExecType=0) → Partial Fills (ExecType=F) → CancelReplace (35=G) → Final Fill / DFD. Each with `SendingTime`, `TransactTime`, MsgSeqNum, sender/target CompIDs.
  3. Correlated to the parent order in the OMS (parent OrderID → children ClOrdIDs). Included the parent → child mapping so the regulator can see the tree.
  4. Pulled the login audit — which OMS user session created the parent order, from which workstation IP, at what time. That gives them the human identity.
  5. Packaged as: (a) executive summary — one paragraph describing what happened to that order, (b) FIX message log — chronological, one message per line, (c) parent/child tree, (d) user identity + login evidence, (e) chain-of-custody statement — I extracted, timestamped, hash of the file.
  6. Sent to compliance, not directly to the regulator. Compliance owns the external comms.
- **Result:** Delivered in ~6 hours, compliance forwarded, no follow-ups from the regulator on that ClOrdID. Kept a copy in an audit folder with retention.

**Watch-outs:** Never send a raw query result. Never send to the regulator directly — compliance is the gatekeeper. And never edit the extract — if a value looks weird, explain it, don't clean it.

---
## Situational — Production War Stories (STAR), continued

> Stories 28-40 continue the STAR set. All scenarios are representative of the seat: OMS production support for program trading, DMA, cross flow, and market-access.

---

### Story 28. Client asking why fills came out-of-order
**Interviewer signal:** Do you know that FIX ExecReport ordering across a session is not a guarantee, and can you defend that fact to a client?

**Situation.**
A US buy-side client called at 10:12: "your ExecReports for ClOrdID `X-4471` came in with `LastQty` timestamps out of order — we see a partial fill at 10:07:22.014 landing *after* a partial at 10:07:22.031. Our EMS is complaining and marking the trade for review." Two exec reports on the same order, arriving at the client in TransactTime-descending order.

**Task.**
Prove whether we sent them out of order, whether the exchange did, or whether it was a client-side reassembly issue — and get the client's EMS unblocked.

**Action.**

1. Pulled our outbound FIX log for the session. The two `35=8` messages went out on the wire in `MsgSeqNum` order: `SeqNum=88214, TransactTime=10:07:22.014`; `SeqNum=88215, TransactTime=10:07:22.031`. That is correct — ascending sequence, ascending TransactTime.
2. Pulled the raw pcap from the colo — packets left our NIC in that same order, 3.4 ms apart.
3. Asked the client to share their inbound log. Theirs showed sequence numbers arriving in order (88214 then 88215) but their **application-layer processing thread** had a per-ClOrdID work queue that farmed fills out to two workers, and worker 2 finished before worker 1 due to a DB write contention. Their EMS was displaying rows by *processing-complete* timestamp, not by `TransactTime`.
4. Wrote up the trace with the pcap timestamps, sequence numbers, and `TransactTime` values side by side, and sent it to the client. Recommended they sort their fills view by `TransactTime` server-side, not by their internal enqueue time.

**Result.**
Client acknowledged their side. No adverse impact — the two fills were both legitimate and the total quantity matched. I saved the pcap and the reconciliation table to the client-facing runbook for the next time this comes up (it always does).

**Lessons.**

- FIX guarantees per-session sequence ordering on the wire. It does **not** guarantee that a multi-threaded consumer processes them in that order. Always ask the counterparty how they're reading their inbound.
- `TransactTime` on the exchange-generated `35=8` is the tie-breaker, not the arrival timestamp at any hop. Educate clients on this.
- For any "fills out of order" complaint, the pcap is the arbiter. Have it ready.

---

### Story 29. Sudden spike in message throughput saturating gateway
**Interviewer signal:** Can you diagnose a saturation event live and shed load without breaking client flow?

**Situation.**
15:47 ET: our order-out gateway to a top-3 US venue crossed 92% of its licensed message-rate budget for three consecutive one-minute windows. Latency on the outbound session climbed from a p99 of 800 µs to 14 ms. Two algo desks started to see fills lagging their theoretical send-time by measurable amounts. No obvious "one bad algo" — a broad cross-desk elevation.

**Task.**
Bring latency back inside SLA within minutes, without unilaterally killing traffic.

**Action.**

1. Split the throughput by algo container in Argus — top four contributors were all elevated 2-3× their normal 15:00-15:45 rate, but none in a runaway pattern. It was **legitimate** end-of-day rebalancing traffic that happened to cluster.
2. Confirmed with the trading desks over the shared line that all four flows were expected — nothing to kill.
3. Two-step mitigation:
   - **Immediate:** flipped the gateway's per-session outbound message-batching from "1 msg per TCP write" to "coalesce up to 10 msgs per TCP write with a 200 µs deadline." This is a config knob we tune quarterly. Latency dropped back to p99 ~1.2 ms within 90 seconds because we were no longer syscall-bound.
   - **Follow-up (day+1):** provisioned a second outbound gateway session with the venue and load-balanced non-latency-critical algos onto it, freeing headroom on the primary.
4. During the event I sent a real-time note to the four desks: "elevated latency in effect, coalescing enabled, no action needed on your side."

**Result.**
No missed fills. p99 back inside SLA within 2 minutes. Post-mortem action: added an Argus panel plotting `(licensed_rate_budget - observed_rate)` and paged at <15% headroom instead of waiting for latency to blow.

**Lessons.**

- Saturation is not always a bug. Sometimes it's the market. Load-shedding by killing legitimate flow is the wrong first move.
- TCP-level batching (Nagle-adjacent) is a huge lever if your session's message shape allows it. Know which knobs are safe to flip live and which need a change window.
- Alert on headroom, not on the failure mode. Latency-blowing is a symptom; running out of budget is the cause.

---

### Story 30. Symbol reference data missing on halt reopen
**Interviewer signal:** Do you understand the interaction between listing-level halts, LULD auctions, and the OMS's static ref-data lifecycle?

**Situation.**
10:04: a mid-cap single-name was halted by the primary listing exchange under a LULD Volatility pause. At 10:09 the halt cleared and the reopen auction was scheduled for 10:14. At 10:13:52 we tried to route a limit order into the reopen and the OMS rejected internally with `NoRefData` — our symbol master had the RIC as `Halted` and no updated auction reference band, and the pre-trade check failed with no way to override. Trader (rightly) livid — this was a legitimate reopen order.

**Task.**
Get the order into the reopen auction (< 90 seconds), and fix the ref-data pipeline so halts don't lock us out of reopens.

**Action.**

1. Manually toggled the symbol's `TradingStatus` in the OMS admin console from `Halted` to `Auction` — we had a controls-approved fast-path for exactly this. Trader's order sent through, hit the reopen at 10:14:01.
2. Root-caused the ref-data lag. Our symbol-master feed subscribed to the exchange's `SecurityStatusMessage` — a `35=f`. When the halt fired, we received `SecurityTradingStatus=2 (Halted)` and updated the master. When the halt lifted, the exchange sent `SecurityTradingStatus=17 (Ready to trade)` at 10:09:11 — but our subscriber was filtering on `SecurityStatusReqID` and dropping status messages without a matching request ID (a bug in the subscriber). So we saw the halt but not the resume.
3. Fixed the subscriber: process unsolicited `35=f` messages (no `SecurityStatusReqID` correlation required) as first-class updates, and add a metric on the count of unsolicited status messages received vs. processed.
4. Added a manual auction-window admin override in the OMS: if the exchange has published a resume time via the `SecurityStatusMessage`, allow the pre-trade check to route auction orders even if `TradingStatus` is stale.

**Result.**
Trader's order filled in the reopen at the auction cross price. No further reopen lockouts for the rest of the quarter. The metric caught two more subscribers doing the same filter-and-drop.

**Lessons.**

- Unsolicited `35=f` from an exchange is the norm, not the exception. Any subscriber that ignores messages without a request ID correlation is broken.
- Halt-to-reopen is a scheduled event that always has time pressure. The OMS needs an admin fast-path for it, gated by controls, not a code deploy.
- Ref-data lag is silent until it isn't. Instrument the pipeline as a stream, not just at the endpoints.

---

### Story 31. Duplicate order — two sessions with same ClOrdID
**Interviewer signal:** Do you know why ClOrdID uniqueness is a *session-scoped* invariant, and how to unpick it when a client violates it?

**Situation.**
09:22: a US buy-side client reported that their internal PMS had double-sent the same order under the same `ClOrdID=CLI-778812` on **two different FIX sessions** — their primary and their backup — because a fault-tolerance script had failed over during a session blip. The order fired on both sessions. Both hit our OMS. Both routed to the same broker. Broker filled both. Client's target quantity: 50,000. Filled quantity: 100,000.

**Task.**
Reconcile the double-fill, decide who eats the overfill, and prevent the recurrence.

**Action.**

1. Traced both parents in our OMS. Two separate `oms_orders` rows, same `ClOrdID`, different session IDs, different internal order IDs. The FIX spec's ClOrdID uniqueness is scoped per (Sender, Target, Session) — so from our OMS's point of view both were valid distinct orders. No dedupe was going to catch this at the wire.
2. Confirmed with the client's ops that their fault-tolerance script had **no ClOrdID rewrite** on failover. Standard practice is to append a session-discriminator suffix (e.g., `CLI-778812-A` on primary, `CLI-778812-B` on backup) so that even if both fire, the second is not a strict duplicate.
3. Immediate action: client absorbed the 50k overfill (their control failure, their P&L). We helped them work out at VWAP-plus-spread by routing a discretionary sell over the next 90 minutes.
4. Longer-term:
   - Added an OMS-side heuristic: if two orders arrive on distinct sessions from the same client entity within a 500 ms window with matching `Symbol/Side/Quantity/Price`, hold the second in a `PendingDedupeReview` state and page ops. Not a hard block (legit iceberg strategies can look similar), just a human check.
   - Client updated their failover script to prepend a session tag to `ClOrdID`.

**Result.**
Overfill worked out with ~$18k slippage cost, absorbed by the client. Since the dedupe heuristic went live it has fired 6 times — 5 real client failover doubles caught, 1 false positive (a legitimate cross-session iceberg).

**Lessons.**

- ClOrdID is unique per session, not per client. Any client architecture that fails over between sessions must rewrite `ClOrdID` on failover, full stop.
- Cross-session dedupe on the broker side is a safety net, not a primary control. Primary control is at the client's OMS.
- "Both sessions filled" is a scenario every client architecture should have wargamed. If they haven't, that's a conversation to have proactively, not after the incident.

---

### Story 32. Trader claims their algo is not respecting POV limits
**Interviewer signal:** Do you understand VWAP/POV algo mechanics well enough to arbitrate a trader-vs-algo dispute?

**Situation.**
14:20: a program-trading desk complained that their 15% POV algo on a small-cap name was aggressive — the OMS trade blotter showed we were participating at 34% of primary-market volume over a 10-minute window. Trader wanted the algo killed and re-parented.

**Task.**
Verify whether the algo was actually misbehaving before killing it (killing a working algo in the middle of a schedule has its own P&L cost), and if so, why.

**Action.**

1. Pulled the algo's own decision log: it was targeting 15% POV against **consolidated tape volume**, not primary-market volume. The trader's blotter was showing primary-only because his UI was misconfigured.
2. Recomputed against consolidated tape for the same 10-minute window: we were at 14.7% of consolidated. Inside the target band.
3. But this raised a legitimate question — the trader's *intent* was 15% of primary volume (his benchmark was a primary-market execution study). The algo's *config* said "consolidated tape." Nobody had reconciled that at parenting time.
4. Actions:
   - Left the algo running (it was doing what it had been told).
   - Reset the trader's blotter view to show consolidated-tape participation so his live picture matched the algo's view of the world.
   - After the algo finished, sat down with the desk to review the "volume definition" field in the algo parent ticket. Half the desk didn't know it existed. Rolled out a mandatory pop-up on POV algo tickets that forces the trader to acknowledge the volume-definition choice.

**Result.**
Algo completed inside its stated POV. Trader accepted the reconciliation. The pop-up caught 4 misalignments in the following month before they went live.

**Lessons.**

- Before killing an algo, verify the alleged violation against the algo's own definition of "volume" — trader intent and algo config diverge more often than you'd think.
- POV algos are a definition minefield: consolidated vs. primary vs. lit-only vs. lit+dark. Every desk needs a documented default and a way to override at parent time.
- UI configuration drift ("my blotter shows X, the algo sees Y") is a real, quiet source of production noise. Include UI config in your onboarding checklists.

---

### Story 33. Session goes down at 09:29:55 — how you handle open
**Interviewer signal:** Under maximum time pressure, can you make correct triage choices in seconds?

**Situation.**
09:29:55 — five seconds before US equities open. Our primary FIX session to a top-5 broker heartbeated fine at 09:29:50 and then went silent. Logon-out at 09:29:56. Two program-trading desks had ~180 open child orders queued to fire in the opening cross via that broker.

**Task.**
Decide in under 30 seconds: reconnect and risk sending duplicates into the auction, or fail over to the backup broker and abandon the auction fill on those 180 children?

**Action.**

1. Snap decision at 09:30:02: **do not attempt session reconnect for the auction window**. Even a fast reconnect would land us with an ambiguous "did they receive it, did it hit the auction, was it acknowledged" state on 180 orders, exactly at the moment we can least afford ambiguity.
2. At 09:30:04 flipped the two desks to the backup broker session. That broker's session was healthy, but of course we had missed the auction — those 180 orders would now hit the continuous market post-open, not the cross.
3. Called the primary broker ops line by 09:30:20. They confirmed a network-side blip; their side had never accepted a logon after 09:29:55, meaning our 180 pending FIX-outs **had not left our gateway** — they were still queued locally. Good — no ambiguity.
4. Once confirmed unsent, restored the primary session at 09:31:40 and re-routed the still-unfilled portion to it. Post-open continuous market absorbed them over the next 12 minutes.
5. For the desks: computed the missed-auction slippage vs. the continuous execution. Two of the 180 saw material slippage (~5 bps each on illiquid names); the rest were fine.

**Result.**
No duplicate orders (the killer scenario), no client fills lost, ~4 bps aggregate slippage on the affected block. Post-mortem action: added an explicit "pre-open session-health check" at 09:29:00 that forces a manual attest before we allow auction routing on that session.

**Lessons.**

- The wrong action in an opening-cross session-drop is to reconnect and blast. Duplicate exposure at the open is worse than missed exposure at the open, every single time.
- Get the "were our messages ever actually sent?" answer from the broker before you make the retry decision. The answer changes everything.
- Pre-open session health is a special case. Standard monitoring cadence is too slow for the 09:29-09:30 window.

---

### Story 34. Options complex order rejected by exchange for margin
**Interviewer signal:** Do you understand multi-leg options mechanics and margin/collateral interaction at the exchange level?

**Situation.**
11:05: a client submitted a 4-leg iron condor via our OMS. The order was assembled correctly, routed to the options exchange, and rejected with `35=8 39=8 Text="Insufficient margin at clearing"`. Trader escalated — the client's margin should have been ample.

**Task.**
Explain the reject, get the trade in if the margin genuinely was there, or flag to risk if it wasn't.

**Action.**

1. Pulled the outbound multileg `35=AB` message. All four legs correctly bound with `LegRatioQty` and correct `LegSide`. Nothing wrong at the OMS layer.
2. Called the exchange ops line. Their reject was sourced from the OCC / clearing firm's pre-trade margin check, not from the exchange itself. The clearing firm had a lag on updating the client's overnight margin file — this morning the client had wired collateral to top up, but the file used for the 11:05 pre-trade check was the previous evening's stale snapshot.
3. The trade *was* good on current margin, but the clearing firm's check was reading yesterday's number.
4. Coordinated with the clearing firm ops to push a refreshed margin update. They took about 8 minutes. Re-submitted the iron condor at 11:14 — accepted.
5. Rolled out a post-mortem checklist item for the desk: on any morning with a same-day margin top-up, confirm the clearing firm has ingested the update *before* submitting new complex orders. It's not on the OMS to know when the top-up landed — it's on the desk to sequence correctly.

**Result.**
Trade filled at 11:14, well inside the client's price band. Client mildly grumpy about the delay but understood the clearing-side lag.

**Lessons.**

- Options margin rejects are almost never an OMS problem. They're a clearing firm / OCC data-freshness problem. Know the escalation path.
- Multi-leg margin ≠ sum of single-leg margins. The clearing firm calculates portfolio margin holistically, which is why a stale snapshot can miss a wire that would legitimately unlock the trade.
- Same-day collateral wires and same-day complex orders need to be sequenced deliberately. This is a workflow concern, not a bug.

---

### Story 35. TIME_WAIT exhaustion after connection pool bug
**Interviewer signal:** Do you know the Linux TCP state machine at the level where operational problems live?

**Situation.**
Overnight, a bulk-reload job that pulls reference data from an internal service started failing intermittently around 03:00 with `EADDRNOTAVAIL` (cannot assign requested address). By morning, a downstream data-quality report was 40% stale. Sysadmin flagged that the host was showing ~28,000 sockets in `TIME_WAIT` state via `ss -s`.

**Task.**
Get ref-data current before the desk opened, and root-cause why TIME_WAIT was ballooning.

**Action.**

1. Immediate: killed the bulk-reload job, waited ~60 seconds for TIME_WAIT to drain enough to allow new outbound connects (default 2MSL is 60s on that kernel), then ran a targeted single-threaded reload for the missing rows. Ref-data caught up by 07:30.
2. Root cause: the bulk-reload had recently been "optimised" to open a new HTTP/1.1 short-lived connection per row rather than reuse a keep-alive pool. At 300+ rows/sec, we were burning ~300 ephemeral source ports per second, each of which sat in TIME_WAIT for 60 seconds — 18,000 in flight steady-state, well inside the ephemeral port range (~28,000 by default on that box).
3. When another cron kicked at 03:00 and opened its own connections, we exhausted the ephemeral port pool. `EADDRNOTAVAIL` is the kernel telling you it has no source port to bind to.
4. Two fixes:
   - Restored the keep-alive connection pool in the bulk-reload client. One connection reused for all rows. TIME_WAIT count on that host now sits at <200 during the reload window.
   - Widened the ephemeral port range on the host (`net.ipv4.ip_local_port_range = 10000 65535`) as a defence-in-depth measure. Did **not** enable `tcp_tw_reuse` — it has correctness caveats on NAT'd networks and I wasn't going to bet on our topology.

**Result.**
Ref-data now completes in 4 minutes instead of the previous 40. Zero `EADDRNOTAVAIL` since the fix. Added an Argus alert on `TIME_WAIT count > 5000` per host.

**Lessons.**

- TIME_WAIT is not garbage collection you can wish away; it's part of the TCP correctness model. If you're generating tens of thousands, you're doing something structurally wrong.
- Connection pooling is not a micro-optimisation. It's the default posture for any client that talks to the same server more than a few times.
- `tcp_tw_reuse` and `tcp_tw_recycle` are tempting knobs. Do not turn them on without understanding your NAT topology. `tcp_tw_recycle` was removed in newer kernels for a reason.

---

### Story 36. FX NDF fixing date wrong
**Interviewer signal:** Do you know NDF product mechanics, and where OMS ref-data assumptions can silently go wrong for exotic currency pairs?

**Situation.**
An FX ops team reported that on a batch of INR/USD 1-month NDF (non-deliverable forward) trades booked the day before, the OMS-generated confirmation showed a fixing date of **T+30 calendar** instead of the correct **two business days before value date**, using the RBI fixing calendar. Downstream matching with the counterparty was breaking.

**Task.**
Fix the offending trades in the OMS, correct the confirms, and repair the ref-data logic so it stops doing this.

**Action.**

1. Traced the confirm-generation path. The OMS had a generic FX-forward confirm builder that computed fixing date via a simple lookup: `value_date - 2_business_days` using the **standard settlement calendar** (USD holidays, weekends). For deliverable G10 forwards this is correct. For NDFs on emerging-market pairs, the fixing calendar is the *fixing source's* calendar — for INR, the RBI-published fixing calendar, which has different holidays.
2. Two example dates that went wrong: an RBI-only holiday fell between the trade date and the value date; our confirm skipped the RBI holiday because our calendar didn't have it, giving a fixing date that RBI would not publish a fixing on.
3. Fix:
   - Loaded the RBI fixing calendar (and CNY PBOC, BRL BCB, and half a dozen other EM fixing sources) into the OMS ref-data.
   - Extended the confirm builder to key the fixing-calendar lookup off the **fixing source** on the trade (`FX-INR-RBIB` etc.) rather than off the settlement currency.
4. Ops re-issued corrected confirms to the counterparty. Matched cleanly on the second submission.

**Result.**
All 11 affected NDF trades corrected same day. Wrote a fixing-calendar regression test using a known 12-month calendar snapshot per source, so any future change to the confirm builder would fail loudly on the first EM date it got wrong.

**Lessons.**

- NDFs are not vanilla forwards. Fixing date, fixing source, fixing calendar, and settlement calendar are four independent inputs and getting any of them wrong will fail matching.
- OMS date logic for FX is often written by someone who tested against USD/EUR/GBP and shipped. Emerging-market pairs are where the corner cases live.
- Any date computation should be keyed off the *product's* declared calendar, not off a defaulted currency calendar.

---

### Story 37. Broker reject reason mapping breaks after their upgrade
**Interviewer signal:** Do you understand how upstream FIX-tag changes can silently break your parsing, and how to detect that?

**Situation.**
A European sell-side broker rolled out a FIX gateway upgrade over a weekend. Monday morning, their reject reasons started coming through as `Text="Reject: 47"` and similar numeric-only strings in our OMS, whereas previously we'd been getting human-readable strings like `Text="Price outside allowed collar"`. Our trader-facing blotter showed `Reason: Unknown` on every reject. Traders had no idea why their orders were bouncing.

**Task.**
Restore the human-readable reject reason on the blotter within the trading day, and coordinate with the broker on the actual format change.

**Action.**

1. Compared Friday's and Monday's outbound `35=8 39=8` messages from the broker. Friday: `Text="Price outside allowed collar"`. Monday: `Text="47"`, with a new tag `58` (Text field) being replaced by a code + separate `DeskID/OrdRejReason` numeric tag.
2. Called the broker. Their upgrade had switched reject text to a *code-based* format — the numeric codes mapped to strings via a code list they'd published to counterparties. We had missed the memo (or more likely, the memo went to a distribution list nobody on our side read).
3. Got their code list — approximately 60 mappings, e.g., `47 = Price outside allowed collar`, `12 = Symbol not permissioned`, `88 = Session throttle exceeded`.
4. Implemented a config-driven lookup in the OMS's reject-decoder for that specific broker's SenderCompID: numeric code → human string, backed by a YAML file we could update without a code deploy. Fell back to the raw code with a `[unmapped]` marker if the code list was ever incomplete.
5. Deployed the mapping to production at lunchtime under the emergency-change process. Traders' blotters showed correct reasons on all rejects by 13:00.

**Result.**
Restored trader-visible reject reasons within the trading day. Wrote a "broker-side format-change" checklist for the ops team: any counterparty upgrade note goes through a dedicated intake queue, not the general ops mailbox.

**Lessons.**

- Broker FIX-format changes are counterparty-notified but often quietly. Have a named owner for reading and triaging every FIX notice.
- Reject-reason decoding should be config-driven per-counterparty, never hardcoded. Codes and strings change; the decoder should be a lookup table.
- When you can't ship the correct fix in-day, at least ship a fallback that shows the trader *something* — `[unmapped code 47]` is infinitely more useful than `Unknown`.

---

### Story 38. Server clock drift causing SendingTime rejects
**Interviewer signal:** Do you know that FIX `SendingTime` is checked against a tolerance and what happens when NTP goes wrong?

**Situation.**
14:30: a broker's session started rejecting our outbound messages sporadically with `35=3 SessionRejectReason=10 Text="SendingTime accuracy problem"`. About 1 in 30 messages was being rejected. Some order flow was getting through, some wasn't — a nasty partial failure.

**Task.**
Find why our `SendingTime` was drifting outside the broker's tolerance, and fix it without a full session bounce.

**Action.**

1. Pulled our outbound log. The `52` (SendingTime) values were correct against the message's actual send time — no bug in the FIX encoder.
2. Ran `ntpdate -q <ntp-server>` on the OMS host — clock was 720 ms fast against the reference. FIX brokers typically enforce SendingTime within ±2 seconds, some tighter (this one was ±500ms). 720ms out was outside their tolerance.
3. Root cause: the host's `ntpd` had lost sync to the primary NTP source overnight (upstream server had gone into an unusable state) and had been running on its local clock, which drifted approximately linearly. By afternoon we were nearly a second off.
4. Immediate: forced a hard NTP resync via `ntpdate -u` (took the drift back to <5 ms). Rejects stopped immediately.
5. Follow-up:
   - Configured `ntpd` with three independent upstream sources so a single failure doesn't leave us on local-clock drift.
   - Added an Argus check on the host's `ntpq -p` output; page if `offset > 100 ms` for any sustained period.
   - Verified the fix on all OMS trading hosts, not just the one that had drifted.

**Result.**
Session healthy by 14:45. No further SendingTime rejects. The NTP drift alert has caught two more incipient problems since (both minor upstream flaps).

**Lessons.**

- FIX assumes correct time. Any counterparty enforces `SendingTime` tolerance — usually 2 seconds, sometimes as tight as 500 ms. NTP is not optional infrastructure for a trading host.
- One NTP source is one failure away from silent drift. Three independent sources is the standard.
- Partial rejects (some go through, some don't) with a session-level reject reason is almost always a time/sequence/checksum issue, not an application-layer issue.

---

### Story 39. UAT vs PROD config divergence discovered under fire
**Interviewer signal:** Can you handle a live incident whose root cause is that your test environment lied to you?

**Situation.**
09:55: a newly-deployed change to the OMS's routing rules — extensively tested in UAT — misrouted a batch of orders from a client. In UAT the change had routed correctly to Broker A; in prod it routed to Broker B (the historical default). About 30 orders had gone to the wrong broker before we killed the feed.

**Task.**
Stop the misrouting, get orders re-routed, and find the config divergence between UAT and prod.

**Action.**

1. Killed the client's routing-rule set in prod by reverting to the previous rule version — took about 90 seconds. Any queued orders were re-routed to Broker A manually.
2. For the 30 already-sent orders: called Broker B ops, confirmed they had received them but they had not yet executed. Cancelled them at the broker and re-sent to Broker A. Client saw about a 4-minute delay on those orders; no adverse fills.
3. Diffed the routing config in UAT vs. prod line by line. The new rule set was identical. But **the input to the rule set** — the client's routing profile — had a field called `preferred_broker_pool` that in UAT was set to `["A","B"]` and in prod was set to `["B","A"]`. The new rule I'd tested was "pick the first from `preferred_broker_pool`." In UAT the first was A; in prod the first was B.
4. Root cause of the divergence: someone had reordered the pool in prod six months ago for an unrelated purpose. UAT was never updated to match.
5. Fixes:
   - Immediate: aligned UAT to prod for that client's routing profile, added a signed-off deployment note.
   - Systemic: wrote a **UAT/prod config diff report** that runs nightly and emails delta rows for the client-routing tables. Config drift is now visible, not hunted.

**Result.**
Client accepted the resolution — 4-minute delay, no P&L impact. The nightly diff report has since caught 11 configuration drift instances, several of which would have caused similar routing surprises.

**Lessons.**

- "It worked in UAT" is a claim that is only as strong as your UAT-vs-prod config parity. If you don't measure the divergence, you don't know how strong the claim is.
- Every rules-based routing change needs to be tested against a **snapshot of prod config**, not against UAT's separately-maintained config. Ideally UAT reads a nightly copy of prod's routing tables.
- Config drift is a class of bug. Treat it with the same tooling seriousness as code — versioned, diffed, alerted.

---

### Story 40. Junior asked to fix hot prod issue with no runbook — you mentor
**Interviewer signal:** How you develop the team and act under pressure without hoarding the keyboard.

**Situation.**
16:45: a junior on my team, three months in, got paged for a P2 — a client-facing report was showing zero rows for the current business day, when it should have had thousands. No runbook existed for this specific report; it was a recent addition. The junior pinged me in a panic asking me to "just take it."

**Task.**
Get the P2 resolved before the client noticed, *and* use the incident to level up the junior — because next time I might not be online.

**Action.**

1. Told the junior over Slack: "I'll be your driver on comms, you're at the keyboard. Screen-share. Tell me what you think it could be, I'll help you check."
2. Walked her through the debug tree out loud, not by giving answers:
   - "What's the shape of a 'zero rows' report — is the query returning nothing, or is the output pipeline broken?" → she ran the underlying query, got zero rows, ruled out the pipeline.
   - "What's the query doing? Read it to me." → she read it aloud. Spotted a `WHERE trade_date = CURRENT_DATE` clause.
   - "Where does `CURRENT_DATE` come from?" → she checked the DB session's timezone. Server was in UTC; the report was supposed to key off ET business date. At 16:45 ET, UTC was already on the *next* calendar date, so `CURRENT_DATE` was pulling tomorrow's rows.
3. She proposed the fix herself: `WHERE trade_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date`. I confirmed the syntax against her dev DB and had her ship it to prod under the emergency-change process (with a peer review from me — I was her reviewer, not her doer).
4. Report populated at 17:05. Client got a heads-up note from me explaining the 20-minute delay and root cause. I asked the junior to write the runbook for this report, then and there while it was fresh — three paragraphs, exactly enough to help the next on-caller.

**Result.**
Issue resolved in 20 minutes with the junior driving. She wrote her first runbook, added it to the team wiki, and told me later that this was the incident where she stopped feeling like she needed to escalate everything. Six months later she was rotating as primary on-call.

**Lessons.**

- The fastest fix in the moment is not always the right fix for the team. If you always take the keyboard, your juniors never learn under pressure — which means the next 3 a.m. page will page you too.
- Structured questions ("what's the shape of the failure?", "read the query to me") transfer more than answers. You are teaching a debug pattern, not solving a specific bug.
- Every P2 without a runbook is a runbook waiting to be written. Write it while the pain is fresh — future-you will thank present-you.

---
