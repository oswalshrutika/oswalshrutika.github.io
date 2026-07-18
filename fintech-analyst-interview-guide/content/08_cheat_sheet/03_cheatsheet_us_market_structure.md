# US Market Structure — One-Page Reference

> Everything a T/A supporting US equities/options flows should recognize by name and give a 2-sentence explanation for.

---

## Contents

- [1. NBBO](#1-nbbo)
- [2. SIP vs direct feeds](#2-sip-vs-direct-feeds)
- [3. Reg NMS](#3-reg-nms)
- [4. LULD](#4-luld-limit-up-limit-down)
- [5. MOO / MOC / LOO / LOC](#5-moo--moc--loo--loc)
- [6. Sub-Penny Rule](#6-sub-penny-rule-reg-nms-rule-612)
- [7. ISO — Intermarket Sweep Order](#7-iso--intermarket-sweep-order)
- [8. ATS list — where the shares hide](#8-ats-list--where-the-shares-hide)
- [9. Rule 605 / 606](#9-rule-605--606)
- [10. T+1 settlement](#10-t1-settlement)
- [11. Halts & auctions](#11-halts--auctions)
- [12. Options exchange list](#12-options-exchange-list)
- [13. SSR — Short Sale Restriction](#13-ssr--short-sale-restriction-reg-sho-rule-201)
- [14. Odd lots](#14-odd-lots)

---

## 1. NBBO

- **National Best Bid and Offer** — the highest displayed bid and lowest displayed offer across all **protected** exchanges (round-lot only, historically; odd-lot info now visible on SIP).
- Published by the SIP (Securities Information Processor) — one for tape A/B (CTA / NYSE), one for tape C (UTP / Nasdaq).
- **Protected quote** = automated (immediately executable). Manual quotes are unprotected under Rule 611.

## 2. SIP vs direct feeds

| | SIP (CTA/UTP) | Direct exchange feed |
|---|---|---|
| Latency | ~500 μs–2 ms consolidation | 10–50 μs |
| Depth | Top-of-book only | Full order book |
| Cost | Low (regulated tariff) | High (per-exchange) |
| Use | Retail brokers, compliance, small firms | HFT, market-makers |
| Reg | Reg NMS Plan | Bilateral / SIFMA |

**Watch-out:** never say "SIP is slow because of geography" — the reason is **aggregation + consolidation** in the SIP processor, not just distance.

## 3. Reg NMS

Adopted 2005, effective 2007. Key rules:

| Rule | Name | Summary |
|------|------|---------|
| **610** | Access Rule | Fair access & fee cap (**$0.003/share** on displayed liquidity). Bans locked/crossed markets. |
| **611** | **Order Protection Rule** (Trade-Through) | Cannot trade at price inferior to a protected quote on another exchange. Enforced by ISOs & auto-routing. |
| **612** | Sub-Penny Rule | See §6. |
| **603(a)** | Fair Access to Market Data | Requires distribution of quotes/trades. |
| **NMS Plan** | Governance | CT / UTP plans manage the SIPs. |

**Rule 611 exceptions (memorize a few):** ISO exception, self-help, benchmark trade (VWAP), stopped order, single-price opening/closing auction, block trade (>= 10,000 shares OR >= $200,000).

## 4. LULD (Limit Up-Limit Down)

- **Bands** set as % away from a reference price (5-min rolling avg trade):
  - Tier 1 (S&P 500, R1000, select ETPs, > $3): **5%** during regular hours, **10%** in first/last 15 min.
  - Tier 2 (other NMS securities, > $3): **10%** / **20%**.
  - Securities $0.75–$3.00: **20%** / **40%**.
  - Securities <$0.75: lesser of **$0.15** or **75%**.
- **Limit state:** trading only within the bands; a "straddle state" if BBO is at the edge.
- **Trading pause:** 5 min if a limit-state persists 15 sec.
- Applies during regular hours only (9:30–16:00 ET).

## 5. MOO / MOC / LOO / LOC

| Type | Full name | Cutoff (NYSE / Nasdaq) | Purpose |
|---|---|---|---|
| **MOO** | Market-On-Open | NYSE: 9:29 / Nasdaq: 9:28 | Trade in opening auction, market px. |
| **LOO** | Limit-On-Open | Same | Marketable only if within limit. |
| **MOC** | Market-On-Close | 3:50 pm ET (both) | Trade at closing print. |
| **LOC** | Limit-On-Close | 3:50 pm (with tightening rules 3:50–3:58) | Limit variant. |
| **IO / OIO** | Imbalance-Only / On-Close Imbalance Only | 3:50–4:00 | Cross-side liquidity for the auction. |

**Watch-out:** in 4.2 you send these as `59=2` (OPG) or `40=5` (MOC). In 4.4 use `40=B/C` (LOC/LOO) plus `59=2/7`.

## 6. Sub-Penny Rule (Reg NMS Rule 612)

- **Displayed quotes** for stocks priced >= $1.00 must be in whole penny increments.
- Stocks priced < $1.00 may be quoted in sub-penny increments ($0.0001).
- **Prints** (executions) can be in sub-penny (e.g. midpoint fills in dark pools) — the ban is on **quoting**, not trading.
- Under review — SEC proposed variable tick sizes 2022; adopted a rule 2024 for a tier of stocks trading tight to allow half-penny quoting.

## 7. ISO — Intermarket Sweep Order

- Marked `18=6` (ExecInst) with a specific meaning under Reg NMS.
- Broker/router asserts it has **simultaneously routed** enough shares to satisfy all better-priced protected quotes on other exchanges.
- Allows an execution that would otherwise "trade through" — a 611 exception.
- Used heavily by liquidity-taking algos, HFT, and dark-pool routers.

## 8. ATS list — where the shares hide

**ATS = Alternative Trading System.** FINRA Rule 4552 requires weekly volume reporting. Top by volume (rotating leaderboard):

| ATS | Operator | Character |
|---|---|---|
| UBS ATS | UBS | Retail internalizer + block. |
| CrossFinder | Credit Suisse (now UBS) | Continuous crossing. |
| MS Pool | Morgan Stanley | Sell-side franchise flow. |
| Bank-affiliated ATS | large US bank | Prime & institutional. |
| Level ATS | Level ATS LLC | Independent. |
| Sigma X | Goldman Sachs | Institutional. |
| Instinet CBX | Nomura Instinet | Continuous block. |
| IEX (now exchange) | IEX Group | 350 μs speed bump (was ATS; became exchange 2016). |
| Liquidnet | Liquidnet | Block-only for institutions. |

**Watch-out:** "dark pool" is colloquial. Regulatorily they are ATSs. IEX is no longer an ATS.

## 9. Rule 605 / 606

| Rule | Reporter | Content |
|------|----------|---------|
| **605** (formerly 11Ac1-5) | **Market centers** (exchanges, MMs, ATSs) | Monthly execution quality: effective/realized spread, price improvement, fill rates by order type & size buckets. |
| **606** (formerly 11Ac1-6) | **Broker-dealers** | Quarterly + on-demand: order routing venues, PFOF disclosure, net PFOF per 100 shares. |

Interview trap: "Which one is the broker report?" → **606**.

## 10. T+1 settlement

- **Effective May 28, 2024** for US equities, corporate bonds, munis, unit investment trusts.
- Was T+2 before. Options remain T+1 (unchanged). US treasuries: T+1 (unchanged). Mutual funds: varies by fund.
- Trade date T; cash & securities settle **the next business day**.
- Squeeze on operations: **affirmation by 9:00 pm ET on T** (was noon ET T+1) — DTCC ITP rule.
- Impacts FX for foreign investors buying US equities — must pre-fund USD.

## 11. Halts & auctions

| Halt type | Trigger | Duration |
|---|---|---|
| **LULD** trading pause | 15 sec in limit-state | 5 min. |
| **News-pending** (T1) | Corporate news | Until dissemination + 5 min or news-non-pending. |
| **Volatility** (T5, single-stock circuit breaker) | Replaced by LULD in 2013. | — |
| **Regulatory** (T12) | SEC / SRO action | Indefinite. |
| **Market-Wide Circuit Breaker (MWCB)** | S&P 500 drop vs prior close: **Level 1 −7%**, **L2 −13%**, **L3 −20%**. | L1/L2: 15 min; L3: rest of day. Not triggered after 3:25 pm (except L3). |

## 12. Options exchange list

**16 US options exchanges** (as of 2026):

- CBOE (Cboe Options Exchange / C1), C2, EDGX Options (EDG), BZX Options (BZX)
- NYSE Arca Options (AMEX), NYSE American Options
- Nasdaq PHLX (XPHL), Nasdaq ISE (XISE), Nasdaq GEMX, Nasdaq MRX, Nasdaq BX Options (XBX), Nasdaq Options Market (XNDQ)
- BOX Options (BOX)
- MIAX, MIAX Pearl, MIAX Emerald

**PFOF (Payment For Order Flow)** heavy on options — retail brokers route to wholesalers (Citadel, Susquehanna, Wolverine, Virtu) with rebate schedules.

## 13. SSR — Short Sale Restriction (Reg SHO Rule 201)

- Triggered when a stock drops **>= 10%** from prior day's close.
- Once triggered, **short sales can only execute at a price above the current NBB** ("uptick" style) for the rest of the day and the next full trading day.
- Signaled on the SIP with the "SSR flag."
- FIX: reflected in `54=5` (short) with additional handling; some venues expect `54=6` (short-exempt) when using an exemption (e.g. market-maker riskless principal).

## 14. Odd lots

- **Odd lot** = order/quote < 100 shares (< 1 round lot).
- Historically excluded from SIP top-of-book — reforms mean odd-lot best bid/offer (**OLBBO**) is now disseminated.
- Reg NMS Rule 611 protection was extended to odd-lot quotes for high-priced stocks in 2020 amendments (odd-lot orders that add to top of book get some protection).

---

## Rapid-fire trivia (memorize)

- **Regular hours:** 9:30 am – 4:00 pm ET.
- **Extended hours:** premarket 4:00–9:30; after-hours 4:00–8:00 pm ET.
- **13 US equities exchanges + several ATSs.**
- **Tape A** = NYSE-listed, **Tape B** = regional, **Tape C** = Nasdaq-listed.
- **Locked market** = bid = ask cross-venue; **crossed** = bid > ask. Reg NMS bans exchanges from displaying such quotes.
- **PFOF** legal in US (SEC has debated banning) — not legal in UK, Netherlands.
- **Consolidated tape:** trades from all venues published in near-real-time.
- **Access fee cap:** **$0.003/share** for stocks >= $1.00; **0.3%** for stocks < $1.00.
- **Maker-taker** vs **taker-maker** (inverted) fee models.
- **Reg SCI** — systems compliance & integrity, governs exchange/ATS tech resilience.
