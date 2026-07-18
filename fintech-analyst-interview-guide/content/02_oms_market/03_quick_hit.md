# Quick-Hit Market Knowledge — 25 Q&A

## Table of Contents

1. [Q1. OMS vs EMS](#q1-oms-vs-ems-in-one-paragraph)
2. [Q2. NBBO](#q2-what-is-nbbo)
3. [Q3. SIP vs direct feed](#q3-sip-vs-direct-feed)
4. [Q4. ISO (Intermarket Sweep Order)](#q4-what-is-an-iso-intermarket-sweep-order)
5. [Q5. LULD bands](#q5-luld-bands-limit-up-limit-down)
6. [Q6. T+1 settlement](#q6-t1-settlement)
7. [Q7. PFOF (Payment for Order Flow)](#q7-payment-for-order-flow-pfof)
8. [Q8. Rule 606 report](#q8-rule-606-report)
9. [Q9. Reg SHO locate](#q9-reg-sho-locate-requirement)
10. [Q10. Iceberg vs hidden orders](#q10-iceberg-vs-hidden-orders)
11. [Q11. Market-on-Close (MOC) cross](#q11-market-on-close-moc-cross)
12. [Q12. Agency vs principal](#q12-agency-vs-principal)
13. [Q13. Complex option order](#q13-complex-option-order)
14. [Q14. TCA (Transaction Cost Analysis)](#q14-tca-transaction-cost-analysis)
15. [Q15. TRACE reporting](#q15-trace-reporting)
16. [Q16. Dark pool ATS categories](#q16-dark-pool-ats-categories)
17. [Q17. Reg NMS Rule 611 (order protection)](#q17-reg-nms-rule-611-order-protection-rule)
18. [Q18. Odd lot vs round lot vs mixed lot](#q18-odd-lot-vs-round-lot-vs-mixed-lot)
19. [Q19. Locked and crossed markets](#q19-locked-and-crossed-markets)
20. [Q20. Short sale circuit breaker (Rule 201)](#q20-short-sale-circuit-breaker-rule-201)
21. [Q21. Consolidated tape vs proprietary tape](#q21-consolidated-tape-vs-proprietary-tape)
22. [Q22. Halts — LULD vs regulatory vs news](#q22-halts--luld-vs-regulatory-vs-news-pending)
23. [Q23. IOI (Indication of Interest)](#q23-ioi-indication-of-interest)
24. [Q24. Auction types — opening, closing, halt](#q24-auction-types--opening-closing-halt-re-open)
25. [Q25. Clearing vs settlement](#q25-clearing-vs-settlement)

---

### Q1. OMS vs EMS in one paragraph
**Interviewer signal:** they want to know you understand where you sit in the trade lifecycle and can talk about it without buzzwords.
**Answer:**
An OMS is the system of record for the order — it captures the parent order from the PM or client, enforces compliance and pre-trade risk, tracks state through fills, and hands off to allocation, booking, and downstream settlement. An EMS is the execution surface — it slices the parent into child orders, applies algos or DMA, routes to venues, and manages microstructure decisions like passive-vs-aggressive posting. In practice at a sell-side desk the OMS holds the client order and audit trail while the EMS drives the wire; in some vendor stacks (including our OMS) the two are fused into a single platform with an OMS layer and an EMS layer sharing one order object. Our OMS is really an O/EMS — the order book, algos, and FIX routing all live in the same core.
**Watch-outs:** don't say "OMS routes to exchanges" — that's the EMS. The OMS routes to the EMS or to brokers.

---

### Q2. What is NBBO?
**Interviewer signal:** basic market structure literacy — can you define the reference price that every US equity order is measured against.
**Answer:**
NBBO is the National Best Bid and Offer — the highest displayed bid and the lowest displayed offer across all US equity exchanges and any protected quote venues, published by the SIPs (CTA/UTP). It's the reference price for Reg NMS order protection (Rule 611), for best execution measurement, and for midpoint pegs in dark pools. NBBO only reflects lit protected quotes — odd lots below 100 shares historically didn't count, though the odd-lot rule is changing under the new Reg NMS amendments to include odd-lot quotes in the NBBO calculation for tick-constrained names.
**Watch-outs:** NBBO is not the same as "best price available" — hidden liquidity, odd lots, and dark pools can price inside the NBBO.

---

### Q3. SIP vs direct feed
**Interviewer signal:** do you understand the latency arbitrage debate and why HFTs pay for direct feeds.
**Answer:**
The SIP (Securities Information Processor) is the consolidated public feed — CTA for tape A/B, UTP for tape C — that aggregates quotes and trades from all exchanges into the NBBO. Direct feeds are the raw proprietary feeds from each exchange (Nasdaq TotalView, NYSE OpenBook, etc.) that you subscribe to individually. Direct feeds are faster because you skip the aggregation hop and see venue-level depth, but you have to consolidate the NBBO yourself. HFTs and serious algo shops always run direct feeds and compute a proprietary NBBO; the SIP is fine for retail and slower institutional flow. The gap has been ~500 microseconds historically, which was the basis for Michael Lewis's "Flash Boys" latency arb argument.
**Watch-outs:** don't say "the SIP is slow" as if it's broken — it's slower by design because it aggregates.

---

### Q4. What is an ISO (Intermarket Sweep Order)?
**Interviewer signal:** understanding of Reg NMS trade-through exceptions.
**Answer:**
An ISO is an order type that lets you trade at a price worse than the NBBO on one venue as long as you simultaneously send orders to sweep every better-priced protected quote on other venues. It's the primary Rule 611 exception — you take responsibility for satisfying the trade-through rule yourself instead of relying on the receiving venue. ISOs are marked with a specific FIX tag (18=f or ExecInst flag) so the receiving exchange knows to accept the trade even if a better price shows on another venue. Practically, ISOs are used for aggressive fills — you don't want to wait for the venue to route out, so you sweep in parallel and take the local price.
**Watch-outs:** ISOs are the sender's responsibility — if you mark ISO and didn't actually sweep, that's a Reg NMS violation.

---

### Q5. LULD bands (Limit Up / Limit Down)
**Interviewer signal:** post-2010-flash-crash market structure awareness.
**Answer:**
LULD is a price band mechanism introduced after the May 2010 flash crash to prevent runaway prints. Every NMS stock has a reference price and upper/lower bands (5%, 10%, or 20% depending on tier and time of day) — trades outside the bands are rejected. If the NBBO bid hits the upper band or the NBBO offer hits the lower band, the stock enters a 15-second limit state; if it doesn't recover, a 5-minute trading pause is triggered. LULD replaced the old single-stock circuit breakers and works alongside the market-wide circuit breakers (MWCB) at 7%, 13%, and 20% index moves.
**Watch-outs:** LULD bands widen in the first and last 15 minutes of the trading day — 10% instead of 5% for tier 1 names.

---

### Q6. T+1 settlement
**Interviewer signal:** are you current on the May 2024 US settlement cycle change and its operational implications.
**Answer:**
T+1 is the US equity and corporate bond settlement cycle that took effect May 28, 2024, cutting settlement from two business days to one. The order flow doesn't change but everything downstream compresses — affirmation deadlines moved from T+1 9pm to T 9pm ET, allocations must be locked same day, FX for foreign investors has to happen intraday. For OMS/EMS work the impact is on the post-trade side: allocation timing, CTM/OASYS affirmation, and stock loan recall windows. Failures are more expensive because you have less time to fix breaks. Canada and Mexico moved to T+1 the same day; Europe and UK are targeting Oct 2027.
**Watch-outs:** don't confuse T+1 with T+0 (same-day) — T+1 is one business day after trade date.

---

### Q7. Payment for Order Flow (PFOF)
**Interviewer signal:** do you understand retail wholesaling economics and current regulatory scrutiny.
**Answer:**
PFOF is the practice where retail brokers (Robinhood, Schwab, etc.) route their marketable customer orders to wholesalers (Citadel Securities, Virtu, Susquehanna) in exchange for a per-share rebate. The wholesaler internalizes the flow — filling the retail order at or slightly inside the NBBO — and keeps the spread. Retail gets price improvement vs displayed NBBO, the broker gets paid, the wholesaler captures the residual edge. The SEC under Gensler pushed hard on this with Regulation Best Execution and Order Competition Rule proposals, arguing retail could get better prices in an open auction. The rules haven't landed in final form as of 2026 but scrutiny remains high.
**Watch-outs:** PFOF is legal in the US and banned in the UK and Canada — don't say it's illegal.

---

### Q8. Rule 606 report
**Interviewer signal:** compliance and best-execution reporting awareness.
**Answer:**
SEC Rule 606 requires broker-dealers to publish quarterly public reports disclosing where they route customer orders and any payment arrangements (PFOF, rebates) with those venues. 606(a) covers non-directed retail orders — routed venues, percentages, average net PFOF per share. 606(b)(3) is the institutional side — on request, a broker must give a customer a report of exactly where their specific orders were routed and filled, including venue-level fill rates and PFOF details. Buy-side firms use 606(b) reports to audit their brokers' execution quality and compare across counterparties.
**Watch-outs:** 606 is routing disclosure, not execution quality — that's Rule 605 (venue-level execution stats).

---

### Q9. Reg SHO locate requirement
**Interviewer signal:** short sale mechanics — critical for anyone supporting a sell-side OMS.
**Answer:**
Reg SHO Rule 203(b)(1) requires a broker-dealer, before accepting a short sale order, to have "reasonable grounds to believe the security can be borrowed" and to document that locate. In practice the securities lending desk provides a locate list — a batch of stock available to borrow — and the OMS validates every short-marked order against that list before releasing to the wire. Failure to have a locate is a naked short. Market makers hedging bona-fide market-making activity have a limited exemption. The locate has to be recorded (broker name, quantity, timestamp) and preserved for regulatory review.
**Watch-outs:** locate ≠ borrow — a locate is a pre-trade indicative availability, the actual borrow happens at settlement.

---

### Q10. Iceberg vs hidden orders
**Interviewer signal:** order type nuance and venue-specific behavior.
**Answer:**
An iceberg (or reserve order) shows a small visible quantity on the book and refreshes the visible slice from a hidden reserve as it's hit — the market sees, say, 500 shares displayed while 50,000 wait behind. A hidden order is fully non-displayed — it sits inside the book at a specific price and only executes when an incoming order interacts with it. Icebergs have display priority for the visible slice; hidden orders yield time priority to displayed orders at the same price under Reg NMS display-priority rules. Both are lit-venue features — most exchanges support them (Nasdaq's Reserve, NYSE's Reserve/Hidden) — separate from dark pools which are entirely non-displayed venues.
**Watch-outs:** "hidden" on a lit exchange is different from "dark" — dark = separate venue, hidden = non-displayed order type on a lit venue.

---

### Q11. Market-on-Close (MOC) cross
**Interviewer signal:** understanding of the closing auction and how index rebalancing works.
**Answer:**
The closing cross is the auction that determines the official closing price on Nasdaq and NYSE. MOC orders are unconditional market orders that participate only in the close; LOC (limit-on-close) participate with a limit. On Nasdaq the imbalance is published starting at 3:50pm ET and MOC entry closes at 3:55pm; NYSE closes MOC entry at 3:50pm with imbalance feeds throughout. Index funds and passive rebalancers use the close because tracking-error is minimized against benchmarks that mark at the close. On index reconstitution days (Russell reconstitution in June, S&P quarterly rebalancing) closing volumes explode — 20-30% of the day's volume can print in the last minute.
**Watch-outs:** MOC orders can't be cancelled after the cutoff — that's a common ops issue when a client wants to pull one late.

---

### Q12. Agency vs principal
**Interviewer signal:** do you understand how a broker fills an order and who bears market risk.
**Answer:**
Agency execution means the broker acts as intermediary — the broker routes the client order to the market, and the client faces the market price with the broker taking a commission. The broker never takes principal risk. Principal (or "risk") execution means the broker takes the other side of the client's trade onto its own book — the client faces the broker, and the broker then works out of the position in the market. Principal trades are usually for illiquid names or large blocks where the client wants immediacy and is willing to pay a spread instead of commission. Sell-side desks quote a bid-ask on principal trades; the client picks yes or no on that price.
**Watch-outs:** riskless principal is a middle case — broker crosses two client orders back-to-back through its own book, no real principal risk taken.

---

### Q13. Complex option order
**Interviewer signal:** options market structure literacy — multi-leg strategies and their execution mechanics.
**Answer:**
A complex order is a multi-leg options strategy priced as a package — vertical spreads, straddles, butterflies, condors, and combos with the underlying stock. The order is submitted with a single net debit or credit price and the exchange's complex order book (COB) or auction mechanism executes all legs atomically or not at all — no leg risk to the client. CBOE's COB, ISE's COB, and Nasdaq PHLX's COLA all work this way, with auction responses from market makers competing to fill the package. FIX-wise complex orders use the MultiLegReporting fields and require a strategy definition (usually via tag 55=strategy symbol or explicit leg group).
**Watch-outs:** "leg" risk is exactly what complex orders prevent — don't confuse a complex order with legging in each side separately.

---

### Q14. TCA (Transaction Cost Analysis)
**Interviewer signal:** best-execution measurement and buy-side vs sell-side use cases.
**Answer:**
TCA is the framework for measuring execution quality against benchmarks — how much did the trade "cost" beyond the mid-price at some reference time. Common benchmarks are arrival price (mid at parent order arrival), VWAP over the execution horizon, and implementation shortfall (Perold's decision-price-to-fill slippage). Buy-side firms use TCA to grade brokers and algos; sell-side desks use TCA to defend their own execution to clients and to tune algo parameters. Post-trade TCA is offline reporting; pre-trade TCA estimates expected cost from historical models before you send the order. Vendors like Abel Noser (now Trading Analytics), Virtu Analytics, and ITG (now Virtu) are the big players.
**Watch-outs:** TCA is only as good as the benchmark — VWAP is easy to game by trading with the volume profile, so implementation shortfall is preferred for real quality measurement.

---

### Q15. TRACE reporting
**Interviewer signal:** fixed-income market structure — the equivalent of consolidated tape for bonds.
**Answer:**
TRACE (Trade Reporting and Compliance Engine) is FINRA's post-trade reporting system for OTC secondary trades in US corporate bonds, agency debt, agency MBS, and Treasuries. Broker-dealers must report qualifying trades within 15 minutes of execution (moving to 1 minute for corporates under recent FINRA amendments) and TRACE disseminates the trade data publicly — price, size, time, sometimes capped for large trades to protect market makers. TRACE brought transparency to the historically opaque bond market post-2002 and is the reason you can now see corporate bond prints on Bloomberg or FINRA's public site. There are size caps ("5MM+" for investment grade, "1MM+" for high yield) to prevent front-running of large positions.
**Watch-outs:** TRACE is post-trade reporting only — there's no pre-trade quote consolidation for bonds like the SIP for equities.

---

### Q16. Dark pool ATS categories
**Interviewer signal:** off-exchange venue landscape and their operational differences.
**Answer:**
Dark pools are ATSs (Alternative Trading Systems) registered with the SEC. They fall into three rough categories: (1) **Broker-dealer owned** — internalization pools like UBS ATS, Barclays LX, JPM-X, Goldman Sigma X, matching client orders against the broker's own flow and other clients. (2) **Agency / consortium pools** — Liquidnet, Instinet's BlockCross, POSIT — buy-side-only or agency-only, focused on block liquidity with no HFT participation. (3) **Exchange-owned or independent** — MEMX-Dark, IEX (technically a lit exchange but famous for its 350μs speed bump), CBOE's dark books. All ATSs file Form ATS-N publicly with the SEC disclosing matching logic, participant tiers, and conflict-of-interest disclosures — that's how you audit them.
**Watch-outs:** IEX is a lit exchange with a speed bump, not a dark pool — common mixup.

---

### Q17. Reg NMS Rule 611 (Order Protection Rule)
**Interviewer signal:** the fundamental rule that shapes all US equity routing logic.
**Answer:**
Rule 611 — the trade-through rule — prohibits execution at a price inferior to a protected quote (top-of-book displayed automated quote) on any other US equity exchange. Every executing venue has to either match the best protected quote itself, route out to the venue displaying it, or use the ISO exception (sender sweeps in parallel). This is why every OMS/EMS in US equities maintains real-time NBBO tracking and every route decision checks trade-through compliance. The rule protects only top-of-book — depth-of-book is not protected, which is a subject of ongoing debate.
**Watch-outs:** manual quotes and non-automated venues are not protected — Rule 611 only applies to fast, automated protected quotes.

---

### Q18. Odd lot vs round lot vs mixed lot
**Interviewer signal:** basic terminology plus awareness of the recent Reg NMS odd-lot rule changes.
**Answer:**
A round lot is historically 100 shares — the traditional unit for displayed quotes on US equity exchanges. An odd lot is anything less than 100. A mixed lot is any quantity that isn't a whole multiple of 100 (e.g., 250 shares = one round lot plus an odd lot). Odd-lot quotes historically didn't count in the NBBO, which meant institutional-priced high-nominal names (BRK.A, AMZN pre-split, GOOG pre-split) could have massive hidden odd-lot liquidity inside the displayed spread. The SEC's Reg NMS amendments introduced a variable round-lot definition — for high-priced names the round lot is smaller (10, 40, or 1 share depending on price tier) — and odd-lot quotes now contribute to NBBO calculation for tick-constrained names.
**Watch-outs:** "round lot" isn't always 100 anymore under the new tiered definition.

---

### Q19. Locked and crossed markets
**Interviewer signal:** market microstructure understanding and Reg NMS compliance.
**Answer:**
A locked market is when the best bid equals the best offer across venues (e.g., Nasdaq bid $10.00, NYSE offer $10.00). A crossed market is when the bid is higher than the offer ($10.01 bid on one venue, $10.00 offer on another). Reg NMS Rule 610(d) prohibits exchanges from displaying quotes that lock or cross another protected quote — the venue receiving a locking order must reprice or route it out. Locked and crossed conditions typically resolve within milliseconds via routing; sustained locks are a sign of a market data issue or a slow venue.
**Watch-outs:** locked/crossed happens intraday all the time briefly — the rule prohibits *displaying* the locking quote, not the transient state itself.

---

### Q20. Short sale circuit breaker (Rule 201)
**Interviewer signal:** post-2010 short sale regulation.
**Answer:**
Reg SHO Rule 201 — the alternative uptick rule — triggers when a stock's price drops 10% or more from the prior day's close. Once triggered, short sales in that stock are restricted for the rest of that day and all of the next day: short sales can only be entered at a price above the current NBB (national best bid). This replaced the old uptick rule (which required a plus-tick on the last sale) removed in 2007. OMS-wise you have to check the short sale circuit breaker status on every short order in a triggered name and mark it as "short exempt" only for allowed exemptions like market maker hedging.
**Watch-outs:** Rule 201 is a price restriction, not a ban — you can still short, just at a higher price than the current bid.

---

### Q21. Consolidated tape vs proprietary tape
**Interviewer signal:** market data economics — a growing regulatory topic.
**Answer:**
The consolidated tape is the SIP-produced public feed carrying all NBBO quotes and trade prints across US equity venues, split into three tapes — Tape A (NYSE-listed), Tape B (Amex/regional-listed), Tape C (Nasdaq-listed). Revenue from consolidated tape sales is redistributed to exchanges via a formula based on quotes and trades they contribute — this is why exchanges care about market share of quoting. Proprietary tape refers to each exchange's own direct feed with full depth, order-by-order data, and lower latency, sold separately at much higher prices. The SEC's Market Data Infrastructure Rule (2020) is meant to modernize the SIP with competing consolidators and richer content — still being litigated and rolled out.
**Watch-outs:** SIP fees are cheap, direct feed fees are enormous — the market data revenue debate is really about the gap.

---

### Q22. Halts — LULD vs regulatory vs news-pending
**Interviewer signal:** operational awareness of what to do when a name stops trading.
**Answer:**
Three main halt categories: **LULD volatility halts** (5-minute pause, auto-triggered by price band excursion, described in Q5). **Regulatory / news halts** (SEC or primary listing exchange halts the stock pending material news — earnings surprises, M&A announcements, restatements — usually T1 news-dissemination halts that last until news is out plus a resumption process, or T2 for regulatory concerns). **Market-wide circuit breakers** (Level 1: 7% S&P drop, 15-min halt; Level 2: 13%, 15-min; Level 3: 20%, market closes for the day). During a halt, an OMS should reject new orders in the halted name (or queue for post-halt release), and existing orders on the wire should be cancelled by the venue but the OMS state has to match.
**Watch-outs:** halted stocks don't mean cancelled orders on your books — you need to reconcile with the venue on resumption.

---

### Q23. IOI (Indication of Interest)
**Interviewer signal:** block-trading workflow understanding.
**Answer:**
An IOI is a non-binding advertisement from a broker to buy-side clients that the broker has natural liquidity (a genuine client interest or inventory position) on one side of a name. IOIs used to be sent via Bloomberg or emails but now flow electronically through platforms like Bloomberg's IB and via FIX (MsgType=6, natural/super-natural flag). "Natural" IOIs represent real client orders; "super-natural" means the broker is committing capital; "opportunistic" or non-natural IOIs are basically fishing and are the reason the whole IOI space has trust issues. FINRA scrutinizes deceptive IOIs — falsely marking capital availability is enforceable.
**Watch-outs:** IOIs are not orders — a client responding to an IOI still has to send an actual order that the broker then commits against.

---

### Q24. Auction types — opening, closing, halt re-open
**Interviewer signal:** auction mechanics understanding.
**Answer:**
Every major venue runs three main auction types. **Opening auction** matches overnight order flow at 9:30am ET, determining the official opening print; Nasdaq starts imbalance publication at 9:28am, NYSE opens with a DMM-assisted auction. **Closing auction** (Q11) at 4:00pm ET, the highest-volume moment of the day, determining official close. **Halt re-opening auction** after any halt (LULD, news) — imbalance messages are published, the price discovery process runs 5-15 minutes, and the stock resumes with a fresh auction print. All three are single-price auctions maximizing matched volume at the clearing price.
**Watch-outs:** venue-specific — Nasdaq closing cross and NYSE closing auction have different order type support (Nasdaq accepts LOC after 3:50pm at the near/far indicative for offsetting the imbalance; NYSE has D-orders).

---

### Q25. Clearing vs settlement
**Interviewer signal:** post-trade lifecycle understanding.
**Answer:**
Clearing is the process of confirming, netting, and novating a trade — DTCC's NSCC is the central counterparty for US equity trades, stepping between buyer and seller so both face NSCC instead of each other. Netting compresses hundreds of trades in the same name to a single net position per broker. Settlement is the actual exchange of cash for securities — DTC (Depository Trust Company) moves the shares from seller's account to buyer's account, and the Fed wire moves the money. Under T+1 (Q6) settlement happens one business day after trade date. Between trade date and settlement date, the trade is "clearing" — netted, novated, and awaiting final delivery.
**Watch-outs:** clearing ≠ settlement — clearing is the guarantee and netting step, settlement is the actual asset transfer.
