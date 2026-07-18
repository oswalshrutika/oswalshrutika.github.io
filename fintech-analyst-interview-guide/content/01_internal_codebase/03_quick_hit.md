# Quick-Hit Q&A — Internal OMS Codebase

25 must-know one-paragraph Q&A. Memorization-ready.

---

### Q1. What is the end-to-end wire flow of an order through the OMS?
An order enters from the client via iGate FIX, then hits `fixtags.lua` on the inbound side for tag translation and routing. From there it flows into the OM rule engine where `OnClient*` events fire, then into the C++ Core OMS. On the way out, `OnStreet*` OM rules fire, `fixtags.lua` runs outbound transformations, and the message is dispatched via Expressway or DCA to the destination venue or broker. Both `fixtags.lua` invocations and the OM rule engine sit on either side of Core to shape the FIX message without touching the C++ core.

### Q2. What does `fixtags.lua` actually do?
It is the FIX-tag translation and routing layer that runs on both inbound and outbound hops. Responsibilities include connection-based routing, tag suppression via `rem_tag`, translating a routing alias to a CompID using tag 30056, splitting compound ID tag 109 in APAC, appending MERGE/ISO/IRST compliance-ID suffixes, stripping hash suffixes, and stamping event timestamps into tag 21220. It is essentially the boundary translator between external FIX dialects and the internal canonical form the OMS expects.

### Q3. How are OM rules built and deployed?
OM rules are event-driven `.rule` files that respond to lifecycle hooks such as `OnClientNew`, `OnStreetAck`, `OnStreetFill`, etc. They are compiled by the rulebuilder into a shared object named `LOADER.so.default` which the OMS loads at startup. This lets business logic live outside the C++ core and be updated by editing rule files, rebuilding the loader, and restarting — no core rebuild is required for behavioral changes gated behind rules.

### Q4. What language and platform is Core OMS built on?
Core OMS is C++ on Linux. It exposes a set of connection classes for the different downstream and upstream flows: `OMConnection`, `OexConnection`, `DacsConnection`, `DepthConnection`, `BarConnection`, `BboxConnection`, `NNOConnection`, and `CMosConnection`. Each connection encapsulates protocol handling for its counterparty type, and they are chosen at wire time based on the destination and product.

### Q5. What is `FLEX_REGION` and how is it used?
`FLEX_REGION` is an environment variable set to `EU`, `US`, or `HK` that tells the OMS instance which regulatory and market conventions to apply. It gates behavior in both the C++ core and the OM rules — for example APAC (HK) has its own tag 109 compound-ID split logic, EU enforces MiFID compliance suffixes, and US has its own market-hours and settlement conventions. It is one of the first things to check when debugging region-specific behavior.

### Q6. What is custom tag 5000, and what is 5011?
Tag 5000 carries the trading account and tag 5011 carries the account type. Together they identify the book an order lands in and how it should be treated for capital/PnL purposes. These are checked by rules like `PropAcctAssign` and the account-assignment logic when deciding between agency and principal legs of a cross.

### Q7. What is tag 30056?
Tag 30056 is the routing alias — a short string that `fixtags.lua` maps to a downstream CompID at wire time. It lets rules and clients express intent (which venue/broker/desk) without hard-coding session identifiers, and it centralizes routing decisions in the Lua layer.

### Q8. What is tag 31284?
Tag 31284 identifies the desk that owns the order. It is one of the primary keys used by alerting subscriptions, entitlement checks, and downstream reporting to fan orders out to the correct group of traders and supervisors.

### Q9. What is tag 99040 and what does 13 mean?
Tag 99040 is the internal system order type. A value of 13 means `AgencyMerged` — a synthetic parent order that consolidates multiple client child orders into one street-facing agency order. This is the tag to look at when reasoning about merged DMA behavior or when investigating why a parent looks different from its children on replaces.

### Q10. What is tag 99376?
Tag 99376 is the portfolio identifier that pairs with the trading account (5000). Once set on an order it flows through copies and stages, which is why cross-leg mismatches can arise if the principal leg inherits an agency portfolio and later steps only rewrite the trading account.

### Q11. What is tag 21220?
Tag 21220 is the event timestamp stamped in by `fixtags.lua`. It marks the moment the OMS observed a given wire event and is invaluable for timeline reconstruction during production investigations, since it is independent of client-supplied sending times and of any downstream clock skew.

### Q12. What are tags 31101 and 31102?
These are the delayed-reporting tags used to mark and time trades that are reported to the tape with a delay per regulatory rules. They are set by rules that recognize eligible large-in-scale or block prints and are honored downstream by the reporting pathway rather than by the core matching logic.

### Q13. What is tag 27800?
Tag 27800 is the strategy identifier — used to tag an order with the algo or execution strategy chosen by the client or trader. It flows through to venues that support strategy-tagged routing and is used internally for TCA and post-trade grouping.

### Q14. What is tag 21283?
Tag 21283 is the IOBX Cross Pre/Post indicator, typically carrying string values such as `IOBX-CROSS-PRE-POST`. It is an ATDL-driven checkbox on the client blotter and famously suffered a 15-character truncation bug because the underlying `DtagParam_Checkbox` used a `char[16]` buffer (see Q22).

### Q15. What are tags 30865, 7865, 7801, and 99063?
Tag 30865 flags a PRINC-CROSS (principal cross), 7865 flags a DIRECTED-CROSS, 7801 identifies IOBX orders, and 99063 marks IRST (internal-routing/compliance suffix) orders. Together with 21283 they form the cross-and-routing tag family that determines eligibility for internal matching and compliance-suffix application.

### Q16. Walk through the ATDL checkbox truncation incident.
On a Multi-Cross blotter, a checkbox meant to send `21283=IOBX-CROSS-PRE-POST` was silently truncated to 15 characters on the wire. Root cause was in `utl/include/DtagParam.h` lines 199-200 where `DtagParam_Checkbox` stored the value in a `char[16]` buffer, capping any string at 15 chars plus null terminator. The ATDL `maxLength` attribute only extends `TextField_t`, not `CheckBox_t`, so widening it in schema had no effect. Fix: widen the buffer to `char[64]` in the header, or bypass the checkbox path entirely by reverting to a `constValue` combined with a `StateRule`.

### Q17. Walk through the commission-leak incident (tags 12/13).
On the second replace of a merged DMA order routed to a European sell-side broker, commission tags 12/13 leaked outbound when they should have been suppressed. Root cause: the `FLEX_ORDER_COMMISSION_OVERRIDE` rule is guarded by `if(!get_comm_type())`, meaning it only sets commission fields when `_comm_type` is empty. The incoming replace already carried a non-empty `_comm_type`, so the override was skipped and the raw commission passed through. The merged parent itself had `_comm_type='\0'` because it is explicitly cleared at `OMS.cpp:5123-5125`, so the first send was clean but the replace path did not re-clear it.

### Q18. Walk through the alert-not-firing incident.
A trader had a subscription that matched an alert but never received it. `AlertSubscriptions` matching logic looked correct on paper, and the generic-alert short-circuit at line 356 should have applied. Actual root cause: the subscription was never registered in the `m_subscriptions` multimap after the trader's login. On reconnect, `RemoveSubscriptions` cleared the in-memory map, and the DB re-add path missed re-inserting this particular subscription — so the runtime match found nothing to fire against. The fix path is to audit the login/reconnect re-registration and ensure DB-loaded subscriptions repopulate `m_subscriptions`.

### Q19. Walk through the IOBX cross non-standard settle / portfolio-mismatch incident.
An IOBX cross generated a principal leg carrying `528=P` but with `99376` (portfolio) still holding the agency parent's value — a "half-agency-half-principal" order. Root cause: `Order::Copy()` unconditionally copies `_portfolio` from parent to child; because the agency parent's portfolio was non-empty, `FirmOrder::ActionStageNew()`'s guard `if(_portfolio.empty())` never fired to set the correct principal portfolio. The later `PropAcctAssign` rewrote `_trading_acct` but left `_portfolio` untouched. Compounding it, `ft_mm_rule_acct_assign` was empty in production so no downstream corrective mapping ran. Fix: either clear `_portfolio` in `Order::Copy()` for cross-leg children, or add explicit portfolio rewrite in `PropAcctAssign`.

### Q20. Explain the EOD purge cascade in one paragraph.
End-of-day purge iterates orders and asks `IsActive` / `IsPurgeable`. A basket keeps *all* its member orders alive if *any* one member is still active — the cascade goes parent-through-children and blocks purge on the whole set. GTC and GTD orders roll to the next day rather than purge. Purge is blocked by any of: a late-trade-pending flag, pending fills not yet acknowledged, an open child order, or a booking that is not fully done. Only when every one of these gates is clear does an order become purgeable.

### Q21. What does `Order::Copy()` do and why is it dangerous?
`Order::Copy()` produces a new `Order` populated from a source order — used when spawning street children, generating cross legs, or building replaces. It is dangerous because it copies fields unconditionally, so state that should be leg-specific (like `_portfolio`, `_comm_type`, or account fields) can inherit values from a semantically different parent. Several production incidents (portfolio bleed into principal leg, commission leak on replace) trace back to `Order::Copy` copying a field that a downstream rule then failed to overwrite because its guard checked `empty()` or `!set`.

### Q22. Where does `DtagParam_Checkbox` live and what is its size trap?
It lives in `utl/include/DtagParam.h` around lines 199-200. The checkbox stores its emitted string value in a `char[16]` buffer, so any value longer than 15 characters is silently truncated on serialization. Critically, the ATDL `maxLength` attribute is honored only by `TextField_t`, not by `CheckBox_t`, so schema-level fixes appear to work but do nothing at runtime. The remediation is either to widen the buffer (`char[64]`) or to avoid `DtagParam_Checkbox` entirely and use a `constValue` plus `StateRule` combination.

### Q23. What is `FLEX_ORDER_COMMISSION_OVERRIDE` and its subtle bug pattern?
It is the rule that sets commission tags (12/13) on outbound orders when the OMS should be the authoritative source. Its subtle failure mode is the guard `if(!get_comm_type())`: on the very first send the parent's `_comm_type` is null (cleared at `OMS.cpp:5123-5125`) so the override fires, but on a replace the incoming message already sets `_comm_type`, the guard evaluates false, and the override is skipped — leaking the client-supplied commission out to a broker that should never see it. The lesson is that "override" rules must not depend on `empty()` guards when the underlying field can be repopulated by the wire message.

### Q24. What is `m_subscriptions` and why does it matter for alerts?
`m_subscriptions` is the in-memory multimap that the alert engine consults on every event to find matching subscribers. Alerts route only to subscriptions present in this map — so the DB is not consulted at fire time. On reconnect, `RemoveSubscriptions` clears the map for the disconnecting client and the login handler must repopulate from the DB; if the repopulate path silently skips a row, the trader looks "subscribed" in the DB but receives nothing at runtime. This is why alert-not-firing bugs almost always trace back to the login/reconnect registration path rather than the matcher logic.

### Q25. What is `ft_mm_rule_acct_assign` and when does its emptiness bite?
`ft_mm_rule_acct_assign` is the market-maker account-assignment rule that, when populated, remaps trading account and related fields on cross legs after they are generated. In production it was empty, meaning no corrective mapping ran on the principal leg of an IOBX cross — leaving the leg with an inherited agency portfolio and a mismatched account/portfolio pair. The lesson: rules that are optional-by-config can silently disable a whole class of corrections, so any incident involving cross-leg field mismatches should verify the rule table is populated for the relevant desk and region.
