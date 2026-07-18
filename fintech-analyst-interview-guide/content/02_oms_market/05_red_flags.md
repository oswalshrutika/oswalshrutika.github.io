# 05 — Red Flags: 15 Things a Candidate Must Not Say About Markets

## Contents
1. [OMS and EMS are the same](#1-oms-and-ems-are-the-same)
2. [IOC and FOK are the same](#2-ioc-and-fok-are-the-same)
3. [T+1 hasn't changed anything](#3-t1-hasnt-changed-anything)
4. [Dark pools don't publish quotes because they're illegal](#4-dark-pools-dont-publish-quotes-because-theyre-illegal)
5. [SOR is just round-robin](#5-sor-is-just-round-robin)
6. [The SIP is real-time and same as direct feed](#6-the-sip-is-real-time-and-same-as-direct-feed)
7. [PFOF is illegal in the US](#7-pfof-is-illegal-in-the-us)
8. [Sub-penny prices are always disallowed](#8-sub-penny-prices-are-always-disallowed)
9. [ISO overrides the OPR](#9-iso-overrides-the-opr)
10. [Halted stock can still trade in the dark](#10-halted-stock-can-still-trade-in-the-dark)
11. [Complex option orders trade like single-leg](#11-complex-option-orders-trade-like-single-leg)
12. [Riskless principal is the same as agency](#12-riskless-principal-is-the-same-as-agency)
13. [MiFID II applies to US](#13-mifid-ii-applies-to-us)
14. [T+1 means settlement is instant](#14-t1-means-settlement-is-instant)
15. [Buy-side and sell-side OMS have identical requirements](#15-buy-side-and-sell-side-oms-have-identical-requirements)

---

## 1. OMS and EMS are the same

**Wrong statement:** "OMS and EMS are basically the same system — they both manage orders."

**Why wrong:** OMS is the system of record — it owns positions, allocations, compliance, P&L, and lifecycle from order creation to settlement. EMS is the execution layer — low-latency routing, algo wheel, venue connectivity, real-time market data. An OMS holds state for hours to days; an EMS holds state in milliseconds. Confusing them tells the interviewer you have never actually worked a production ticket where the boundary matters (e.g., a fill drop between EMS and OMS staging that leaves position stale).

**What to say instead:** "OMS is the book of record — parent orders, allocations, compliance, position keeping. EMS handles child order execution — SOR, algo containers, venue FIX sessions. They talk over FIX or an internal bus. On our OMS, the staging tables between them are the first place I check when a fill looks missing or duplicated."

---

## 2. IOC and FOK are the same

**Wrong statement:** "IOC and FOK are both immediate — same thing."

**Why wrong:** IOC (Immediate-Or-Cancel) allows partial fills — whatever can execute now fills, the rest cancels. FOK (Fill-Or-Kill) requires the entire quantity to fill in one shot or nothing fills. Different TimeInForce values (FIX tag 59 = 3 for IOC, 4 for FOK). Different downstream behavior — a 10,000-share IOC against 3,000 available prints 3,000 and cancels 7,000; a FOK prints zero.

**What to say instead:** "Both are immediate, but IOC accepts partials and cancels the residual, FOK is all-or-none. FIX tag 59 = 3 vs 4. In production I see FOK mostly on block liquidity-seeking flows where the PM doesn't want a small print leaking intent."

---

## 3. T+1 hasn't changed anything

**Wrong statement:** "T+1 was just a compliance change, operationally nothing changed."

**Why wrong:** T+1 (effective May 28, 2024 in US/Canada, October 2027 in EU/UK) compresses affirmation from T+1 morning to T+0 evening (9pm ET DTCC cutoff). It forced allocation and confirmation processes to move intraday, killed batch overnight allocation windows, pressured FX funding for non-USD investors, and increased CNS fail rates in the first months. If your OMS still runs an overnight alloc batch, you have a problem.

**What to say instead:** "T+1 collapsed the affirmation window to same-day — DTCC cutoff at 9pm ET. Our alloc and confirm flows had to shift from T+1 morning batch to intraday. It also strained non-USD investors on FX funding and drove up early fail rates. Any OMS still doing overnight allocation is out of compliance."

---

## 4. Dark pools don't publish quotes because they're illegal

**Wrong statement:** "Dark pools are shady — they don't publish quotes because they operate outside regulation."

**Why wrong:** Dark pools (ATS — Alternative Trading Systems) are fully regulated by the SEC under Reg ATS. They legally do not display pre-trade quotes — that is their design purpose, to let institutions trade blocks without moving the lit market. Post-trade prints are reported to the TRF (Trade Reporting Facility) within seconds and appear on the SIP. Calling them illegal reveals you don't understand Reg NMS.

**What to say instead:** "Dark pools are ATSs regulated under Reg ATS and Reg NMS. They intentionally don't display quotes pre-trade so institutions can move size without signaling — but every execution is reported to a TRF and appears on the consolidated tape post-trade. They're a legitimate 40%+ of US equity volume."

---

## 5. SOR is just round-robin

**Wrong statement:** "Smart Order Router just rotates through venues in order."

**Why wrong:** SOR ranks venues in real time by displayed liquidity, expected fill probability, fees/rebates (maker-taker vs taker-maker vs inverted), latency, historical fill rates, and adverse selection. It slices parent orders, uses IOCs to sweep the top of book, respects OPR (Order Protection Rule), and often has separate strategies for lit vs dark. Round-robin routing would violate best execution.

**What to say instead:** "SOR is a decision engine — it ranks venues by displayed size, fee structure, historical fill rate, latency, and toxicity. On a marketable order it typically sweeps protected quotes with IOCs across all lit venues at the NBBO simultaneously, then posts residual to the highest-rebate venue. Some SORs pre-check dark pools with pings. Round-robin would fail Reg NMS 611 and best-ex."

---

## 6. The SIP is real-time and same as direct feed

**Wrong statement:** "The SIP is real-time market data — same as a direct exchange feed."

**Why wrong:** The SIP (Securities Information Processor — CTA/UTP) consolidates quotes and trades from all exchanges but has aggregation latency (historically hundreds of microseconds to milliseconds versus single-digit microseconds on direct feeds). HFTs use direct feeds; retail brokers and many OMSs use SIP. This latency delta is the entire premise of several well-known market structure lawsuits (Katsuyama / IEX).

**What to say instead:** "The SIP is the consolidated tape — CTA for NYSE-listed, UTP for Nasdaq-listed. It aggregates every exchange's BBO into a national best. But direct exchange feeds are always faster because SIP has aggregation latency. That's why co-located HFT firms subscribe to direct feeds — the latency arbitrage is real and it's what IEX was designed around."

---

## 7. PFOF is illegal in the US

**Wrong statement:** "Payment for Order Flow is illegal in the US."

**Why wrong:** PFOF is legal in the US and disclosed under Rule 606. It is banned in the UK and Canada, and effectively banned in the EU by MiFIR from 2026. In the US it is how zero-commission retail brokers (Robinhood, etc.) monetize. The SEC has proposed but not enacted a ban. Best execution obligations still apply.

**What to say instead:** "PFOF is legal and disclosed in the US under Rule 606 — it's how zero-commission retail brokers monetize. The UK, Canada, and EU (from 2026 under MiFIR) prohibit it. The SEC has proposed reforms — order-by-order auctions — but hasn't enacted a ban. Best-ex obligation under Rule 605 still applies to the wholesaler."

---

## 8. Sub-penny prices are always disallowed

**Wrong statement:** "Sub-penny pricing is banned — everything is in one-cent increments."

**Why wrong:** Rule 612 (the sub-penny rule) prohibits displaying or accepting orders in sub-penny increments only for stocks priced $1.00 or higher. Stocks below $1.00 quote in $0.0001 increments. Also, price improvement inside the spread at sub-penny prices is allowed on executions (wholesalers do this constantly on retail flow). The SEC's Reg NMS amendments in 2024 introduced sub-penny tick sizes ($0.005) for certain tick-constrained NMS stocks starting November 2025.

**What to say instead:** "Rule 612 bans sub-penny quoting for stocks over $1 — but sub-$1 stocks quote in $0.0001, and sub-penny price improvement on executions has always been allowed. The 2024 Reg NMS amendments actually introduced half-penny tick sizes for tick-constrained names as of late 2025, so 'always one cent' is now factually wrong."

---

## 9. ISO overrides the OPR

**Wrong statement:** "An Intermarket Sweep Order overrides the Order Protection Rule — you can trade through protected quotes."

**Why wrong:** ISO does not override OPR — it satisfies it. When a firm marks an order ISO, they are attesting they have simultaneously routed IOCs to every protected quote at better prices. The venue then executes the ISO at the specified price without further checking. ISO is a compliance mechanism, not a bypass. Sending a bare ISO without the accompanying sweep is a Reg NMS violation.

**What to say instead:** "ISO doesn't override Rule 611 — it satisfies it. Marking an order ISO is an attestation that you've simultaneously sent IOCs to every protected quote at better prices. The receiving venue can then trade through those quotes because the router is on the hook for the sweep. It's a compliance shift, not a bypass."

---

## 10. Halted stock can still trade in the dark

**Wrong statement:** "If a stock is halted on the primary, dark pools can keep trading it."

**Why wrong:** A regulatory halt (SSCB / LULD / news pending / regulatory concern) applies market-wide. All venues — lit and dark, ATSs and exchanges — must stop trading. OTC market-maker venues also stop. The only cross-venue exceptions are certain non-US listings during a US halt. Trading in the dark during a halt is a serious compliance violation.

**What to say instead:** "Regulatory halts — LULD, SSCB, news pending — apply market-wide. Every US venue including all ATSs and dark pools has to stop. There's no dark carve-out. Only manual reopens on the primary listing exchange can restart trading. Our OMS should be blocking new orders on the symbol until the reopen message arrives."

---

## 11. Complex option orders trade like single-leg

**Wrong statement:** "A vertical spread is just two option orders — they route like any single-leg."

**Why wrong:** Complex orders (spreads, straddles, butterflies, condors) trade on the Complex Order Book (COB) as a package, priced on net debit/credit, and must be filled at the requested net price or better as a single unit. Legs can leg out against individual leg markets but the package respects a separate best-ex regime. Priority rules, allocation, and market-maker obligations differ from single-leg. Routing them as separate legs risks partial fills that break the strategy risk profile.

**What to say instead:** "Complex option orders trade on the COB — they're priced on net premium and must fill as a package. Legs can execute against individual leg markets if the net price is met, but priority and allocation follow different rules. You never want to route a spread as two separate legs unless the client explicitly asks — you'd risk one side filling and leaving the strategy naked."

---

## 12. Riskless principal is the same as agency

**Wrong statement:** "Riskless principal and agency capacity are the same thing."

**Why wrong:** In agency, the broker never takes principal position — the client's order is matched at market and reported once. In riskless principal, the broker takes the other side of the client order after having already sourced an offsetting fill from the street — so the broker briefly holds the position but at zero market risk. Reporting differs: two prints (street + client) versus one. Best-ex, capacity marking (FIX tag 29), and regulatory reporting (CAT, TRACE) all differ. Confusing them causes trade break reconciliation nightmares.

**What to say instead:** "Agency means the broker matches street to client without taking the position — one print. Riskless principal means the broker sources the street fill first, then facelifts it to the client at the same price — two prints, brief principal capacity but zero market risk. FIX tag 29 marks capacity — 1 for agent, 3 for riskless. CAT and TRACE reporting differ, which is why capacity mismatches cause reconciliation breaks."

---

## 13. MiFID II applies to US

**Wrong statement:** "MiFID II applies to US trading."

**Why wrong:** MiFID II is EU legislation — it applies to trading in EU venues, EU counterparties, and EU-domiciled firms. US firms trading purely US equities for US clients are not subject to it. However, if a US firm has an EU branch, executes on EU venues, or transacts with EU counterparties, portions apply (best-ex, transaction reporting, research unbundling). Also note UK MiFIR post-Brexit is diverging. Saying MiFID II applies to US blanket-wise reveals you don't understand jurisdictional scope.

**What to say instead:** "MiFID II is EU — it applies when you trade on EU venues, with EU counterparties, or through an EU-authorized entity. A pure US-to-US flow isn't in scope. But US banks with EU branches or global buy-side clients absolutely have to support it — transaction reporting under RTS 22, LEI enrichment, best-ex reporting under RTS 27/28, research unbundling. Post-Brexit UK MiFIR is diverging on some of these."

---

## 14. T+1 means settlement is instant

**Wrong statement:** "T+1 means the trade settles instantly."

**Why wrong:** T+1 means settlement occurs one business day after trade date — not instant, not real-time. Instant settlement is atomic DvP / DLT — a different concept (some experimental platforms, tokenized securities). T+1 still uses CNS netting at DTCC; positions settle in a batch cycle overnight T+0 into T+1 morning. Confusing T+1 with instant settlement suggests you don't understand clearing.

**What to say instead:** "T+1 is one business day post-trade — trades on Monday settle Tuesday. It's still CNS-netted at DTCC through NSCC and settled through DTC in the T+1 overnight cycle. Instant / atomic settlement is a different concept — DLT platforms and tokenized securities — and it's not what the SEC's T+1 rule requires."

---

## 15. Buy-side and sell-side OMS have identical requirements

**Wrong statement:** "A buy-side OMS and a sell-side OMS have basically the same requirements."

**Why wrong:** Buy-side OMS priorities: portfolio-level compliance (concentration, sector, ESG), IBOR / ABOR position keeping, allocation across many funds pre-trade, PM workflow, order staging to multiple brokers, TCA. Sell-side OMS priorities: client order management from many buy-sides, capacity marking, riskless/principal handling, algo container, SOR, market-making book, regulatory reporting (CAT, TRACE, OATS successor, Rule 606), venue connectivity at scale. Different data models (fund/account vs client/desk), different latency profiles, different reg regimes. Saying they're the same is a giveaway you've never worked one side or the other.

**What to say instead:** "Different worlds. Buy-side OMS is portfolio-first — pre-trade compliance across funds, allocation, IBOR/ABOR, PM workflow, staging to multiple brokers. Sell-side is client-and-execution-first — capacity handling, algo containers, SOR, market-making, CAT/TRACE reporting, venue connectivity. Different data models, different latency requirements, different regulatory surface. On the sell-side OMS I support, capacity marking and Rule 606 reporting are core concerns that don't exist on the buy-side."

---

## Meta-rules for the interviewer

- **Never speak in absolutes** — "always", "never", "illegal", "impossible" — regulation has exceptions.
- **Cite the rule number** when you can — Rule 611 (OPR), Rule 612 (sub-penny), Rule 606 (routing disclosure), Rule 605 (execution quality), Reg ATS, Reg NMS.
- **Distinguish jurisdictions** — US vs EU vs UK vs APAC regs diverge.
- **Ground answers in production experience** — "on our OMS I see..." beats textbook definitions every time.
- **Admit uncertainty** — "I'd have to check the current rule text" is better than confident wrongness.
