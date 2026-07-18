# Red Flags: 15 Answers a Candidate Should Never Give

Product context: our vendor-core OMS at a global bank — C++/Linux core, iGate FIX ingress, fixtags.lua wire-layer, event-driven OM `.rule` files compiled to `LOADER.so.default`, deployed per `FLEX_REGION` (EU/US/HK). These are answers that would immediately signal a candidate has not actually operated in this codebase.

---

### 1. "Don't say: fixtags.lua is just a config file for FIX tags"
**Why it's wrong:** `fixtags.lua` is a live, executable Lua layer on both ingress and egress. It performs connection routing, `rem_tag` suppression, alias→CompID resolution via tag 30056, compound-ID 109 splitting for APAC, MERGE/ISO/IRST compliance-ID suffix stamping, hash suffix removal, and timestamp injection on 21220. Calling it "config" hides the fact that a bug there mutates the wire in ways OM rules cannot see.
**What to say instead:** "fixtags.lua is the wire-transform layer that runs before OM rules on inbound and after them on outbound — anything the counterparty sees is its final say."

---

### 2. "Don't say: OM rules run before fixtags.lua on inbound"
**Why it's wrong:** Inbound order flow is Client → iGate FIX → `fixtags.lua` inbound → OM rules (OnClient*) → Core OMS. If a candidate flips that order they will chase phantom bugs in `.rule` files that were actually caused by a tag being renamed, suppressed, or split in Lua before any rule ever fired.
**What to say instead:** "Lua touches the message first inbound and last outbound — I always diff the raw FIX log against the post-Lua payload before I blame a rule."

---

### 3. "Don't say: ATDL `maxLength` will protect any parameter from overflow"
**Why it's wrong:** `maxLength` only enforces on `TextField_t`. On `CheckBox_t`, the value is copied into `DtagParam_Checkbox`'s `char[16]` buffer in `utl/include/DtagParam.h:199-200`, so any checked value longer than 15 chars silently truncates regardless of what the ATDL says. This is exactly how tag 21283 shipped as `IOBX-CROSS-PRE-P` instead of `IOBX-CROSS-PRE-POST`.
**What to say instead:** "`maxLength` is a `TextField_t`-only knob. For checkboxes you either widen the C++ buffer or fall back to `constValue` + `StateRule`."

---

### 4. "Don't say: a merged parent inherits commission from its child orders"
**Why it's wrong:** In `OMS.cpp:5123-5125` the merged parent's `_comm_type` is explicitly cleared to `\0`. That's why `FLEX_ORDER_COMMISSION_OVERRIDE` — gated on `if(!get_comm_type())` — is the only thing that stamps commission on merges. Believing the child leaks commission upward leads you to hunt in the wrong place when tags 12/13 escape on a replace.
**What to say instead:** "Merged parents start with cleared commission; the override rule fills it on new-order path only, and a replace that already carries `_comm_type` will bypass the override — that's the actual leak vector."

---

### 5. "Don't say: `sysOrderType 99040=13` means the order is a normal agency order"
**Why it's wrong:** `99040=13` is `AgencyMerged` — a compliance flag telling every downstream stage (routing, comm override, DACS, drop-copy) that this order is a merged aggregate, not a plain agency single. Treating it as vanilla agency will cause you to route/report/settle it wrong.
**What to say instead:** "`99040=13` is AgencyMerged. Whenever I see it, I check merge-specific paths first: comm override on replace, portfolio propagation, and merge-ID suffix in Lua."

---

### 6. "Don't say: `Order::Copy()` gives you a clean slate for the child"
**Why it's wrong:** `Order::Copy()` carries fields forward from the parent — including `_portfolio`. On an IOBX principal leg, the agency parent's non-empty `_portfolio` is copied in, so `FirmOrder::ActionStageNew()`'s `if(_portfolio.empty())` guard never fires and the leg ships with 528=P but an agency `99376`. That's a half-agency-half-principal order in prod.
**What to say instead:** "`Copy()` inherits fields including `_portfolio`; for principal splits I explicitly clear or reassign portfolio before the empty-check, and I verify `ft_mm_rule_acct_assign` is actually populated in the target region."

---

### 7. "Don't say: `PropAcctAssign` fixes both trading account and portfolio for principal legs"
**Why it's wrong:** `PropAcctAssign` mutates `_trading_acct` but not `_portfolio`. On an IOBX principal leg the copied-in agency portfolio survives PropAcctAssign untouched — which is exactly how 528=P legs escaped with agency 99376 in prod.
**What to say instead:** "PropAcctAssign only touches trading account. Portfolio has to be cleared or reassigned in `ActionStageNew` or an explicit rule — otherwise a copied agency value rides through."

---

### 8. "Don't say: an EOD purge just deletes anything older than today"
**Why it's wrong:** Purge is gated by `IsActive`/`IsPurgeable` cascades. GTC/GTD orders roll, baskets keep every member alive if any single member is active, and late-trade-pending, pending-fills, open-child, or booking-not-fully-done all block purge. A "delete by date" mental model will have you explaining to a trader why yesterday's basket is still on their blotter.
**What to say instead:** "Purge walks the active/purgeable state cascade — GTC/GTD roll, baskets are all-or-nothing, and any pending downstream event (booking, fills, child open) pins the order."

---

### 9. "Don't say: on reconnect, alert subscriptions are preserved automatically"
**Why it's wrong:** `RemoveSubscriptions` clears `m_subscriptions` on reconnect and the DB re-add path can miss a row, leaving `AlertSubscriptions` matching in one place but the multimap empty. The generic-alert short-circuit at line 356 then never fires for that trader even though their subscription "exists." Assuming reconnect is transparent will make you blame the alert engine instead of the subscription store.
**What to say instead:** "Reconnect tears down `m_subscriptions` and rebuilds from DB — I always dump the multimap post-login before I trust that a subscription is live."

---

### 10. "Don't say: base-code and client-code are effectively the same build"
**Why it's wrong:** Base-code is the shared vendor core; client-code holds per-desk overrides — `.rule` files, Lua branches, custom `DtagParam` subclasses. They compile into different `LOADER.so.default` artifacts and diverge across `FLEX_REGION=EU/US/HK`. Treating them as one product will get you to patch base for something client-code overrides two lines later.
**What to say instead:** "Base-code is the shared platform; client-code is the desk-specific overlay per region. I always check both, and I check the region — an EU-only override won't reproduce on HK."

---

### 11. "Don't say: DACS is a downstream compliance system"
**Why it's wrong:** In this stack `DACS` is a market-data entitlements connection class (`DacsConnection`) — it gates data access, not trade compliance. Confusing it with a compliance system will send you to the wrong team and the wrong logs when a trader loses a feed.
**What to say instead:** "`DacsConnection` handles market-data entitlements. Compliance suffixes on order IDs (MERGE/ISO/IRST) come from `fixtags.lua`, not DACS."

---

### 12. "Don't say: tag 21220 is the exchange execution timestamp"
**Why it's wrong:** 21220 is an internal event timestamp stamped by `fixtags.lua`, not a venue timestamp. Reasoning about latency or venue behavior from 21220 will be wrong because it reflects when Lua touched the message, not when the exchange did anything.
**What to say instead:** "21220 is our Lua-stamped event time — useful for internal hop analysis, not for venue latency."

---

### 13. "Don't say: OM rules are hot-reloaded, so a `.rule` change is live immediately"
**Why it's wrong:** `.rule` files are compiled by `rulebuilder` into `LOADER.so.default`. Nothing is picked up until the shared object is rebuilt and the process reloads it. A candidate who thinks edits are live will spend an hour wondering why their fix "isn't running" when they simply never rebuilt.
**What to say instead:** "Rules go through rulebuilder into `LOADER.so.default` — I rebuild and confirm the .so timestamp before I test."

---

### 14. "Don't say: tag 30056 is a client-provided routing hint we can trust"
**Why it's wrong:** 30056 is a routing alias that `fixtags.lua` resolves to a real CompID inbound. Trusting the raw value as final routing skips the alias→CompID lookup and misses cases where the alias is unmapped in one region (`FLEX_REGION`) but not another.
**What to say instead:** "30056 is an alias — Lua resolves it to a CompID via the alias table for the current region. If a route looks wrong, I check the alias map for that region first."

---

### 15. "Don't say: drop-copy is the client's authoritative confirmation"
**Why it's wrong:** Drop-copy is an observer feed — it's a copy, not the contract. The client's authoritative confirmation is the primary execution report on their OMConnection. Treating drop-copy as canonical will let you sign off on a reconciliation where the client's real session was actually gapped.
**What to say instead:** "Drop-copy mirrors the flow for a third party or internal observer; the client's own ExecReports on their OM session are the source of truth for that client."
