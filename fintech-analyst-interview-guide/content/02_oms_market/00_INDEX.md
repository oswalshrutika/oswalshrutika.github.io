# 02 — OMS / EMS / Market Knowledge

Domain knowledge for **Technical Analyst / Production Support** roles at investment banks, hedge funds, prime brokerages, and market-making firms. Content is grounded in what buy-side and sell-side interviewers actually probe on Glassdoor, LeetCode Discuss, industry blogs, and public HL commentary. Candidate profile assumed: ~5 years supporting our OMS vendor, covering PT traders and production incident response.

## Files

| File | Purpose | Depth |
|------|---------|-------|
| `00_INDEX.md` | This file — navigation, glossary, study plan | Meta |
| `01_comprehensive.md` | 100+ Q&A covering OMS/EMS/PMS, US equities, options, futures, FX, fixed income, compliance, reference data | Deep |
| `02_focused.md` | 50 focused questions on highest-signal topics (SOR, Reg NMS, MOC/LULD, algos, capacity) | Medium |
| `03_quick_hit.md` | 25 rapid-fire questions with 1–3 sentence answers | Screening |
| `05_red_flags.md` | 15 things NOT to say in an OMS interview | Anti-patterns |
| `06_mock_interview.md` | 3 dialogue transcripts (buy-side BA, sell-side prod-support, quant fund trader) | Simulation |

Note: `04_*` is deliberately skipped — reserved for a future scenario-drill file.

## Study Plan

**Day 1** — Read `01_comprehensive.md` sections 1–4 (OMS/EMS taxonomy, order types, US equity structure, Reg NMS/SHO).
**Day 2** — Sections 5–8 (SOR, algos, cross types, capacity, settlement).
**Day 3** — Sections 9–12 (options, futures, FX, fixed income, compliance, reference data).
**Day 4** — `02_focused.md` cover-to-cover; drill weak spots.
**Day 5** — `03_quick_hit.md` timed at 30 sec/question; read `05_red_flags.md`.
**Day 6** — `06_mock_interview.md` — read out loud, self-critique.

## Signal Density (What Interviewers Actually Ask)

| Weight | Topic | Rationale |
|-------:|-------|-----------|
| **HIGH** | OMS vs EMS, order types, Reg NMS OPR, MOC mechanics, SOR routing, capacity (agency vs principal), settlement (T+1) | Every prod-support interview |
| **MEDIUM** | LULD/halts, algo families (VWAP/TWAP/POV/IS), reference data (ISIN/CUSIP/FIGI/SEDOL), compliance basics | Asked when candidate claims equities depth |
| **LOWER** | Options complex orders, futures roll, FX NDF, TRACE reporting | Asked only if resume mentions them |

## Master Glossary — One-Liners

### Systems

| Term | One-liner |
|------|-----------|
| **OMS** | Order Management System. System of record for the *parent order*. Holds compliance, positions, allocations, blotter. |
| **EMS** | Execution Management System. Handles *child orders in the market* — algos, DMA, SOR, quote monitoring. |
| **PMS** | Portfolio Management System. Model portfolios, weights, NAV. Upstream of the OMS. |
| **TMS** | Trade Management System. Post-trade — matching, confirmation, affirmation, SSIs. |
| **SOR** | Smart Order Router. Splits and routes across lit and dark venues. |
| **DMA** | Direct Market Access — client's order to the exchange over the broker's MPID. |
| **SA** | Sponsored Access — client's own connection, broker's MPID; broker's 15c3-5 controls are the guardrail. |
| **Charles River (CRD)** | State Street. Buy-side OMS standard for investment managers. |
| **Aladdin** | BlackRock's integrated OMS/PMS/risk. |
| **Eze OMS** | SS&C. Hedge fund / mid-tier buy-side. |
| **Fidessa** | ION-owned. Sell-side global equities OMS/EMS. |
| **Bloomberg TOMS** | Terminal-integrated sell-side OMS; dominant in fixed income. |
| **Our OMS vendor** | Multi-asset EMS/OMS across buy- and sell-side; algos + SOR. |
| **Broadridge (BPS / Impact)** | Post-trade heavyweight for US brokers. |

### Order Types

| Term | One-liner |
|------|-----------|
| **Market / Limit / Stop / Stop-limit** | Basics — limit gives price certainty, market gives fill certainty. |
| **MOO / MOC** | Market-on-Open / Market-on-Close. Participate in the exchange auction only. |
| **LOO / LOC** | Limit-on-Open / Limit-on-Close. Auction with a price cap. |
| **IOC / FOK** | Immediate-or-Cancel (partials OK) / Fill-or-Kill (all-or-none *and* immediate). |
| **GTC / GTD** | Good-till-Cancel / Good-till-Date. Most US exchanges cap GTC at 90 days. |
| **VWAP / TWAP / POV / IS** | Algo families — volume-weighted, time-weighted, percent-of-volume, implementation-shortfall. |
| **Pegged** | Primary-peg / mid-peg / market-peg — order re-prices with the NBBO. |
| **Iceberg / Reserve** | Small displayed size, hidden reserve. |
| **Hidden** | Fully non-displayed. |
| **AON** | All-or-none. |
| **MinQty** | Won't execute against a print smaller than N shares. |
| **ISO** | Intermarket Sweep Order — attests you've swept other protected quotes; allowed to trade through the NBBO. |

### Venues (US Equities)

Lit: NYSE, NASDAQ, ARCA, IEX, Cboe BZX/BYX/EDGX/EDGA, MEMX, LTSE, MIAX Pearl Equities.
Dark: UBS ATS, MS Pool, JPM-X, LX (Barclays), Sigma X, Instinet CBX, Level ATS, Liquidnet, Luminex.
Retail wholesalers: Citadel Securities, Virtu, G1X, Two Sigma Securities, Jane Street.

### Regulations

| Term | One-liner |
|------|-----------|
| **Reg NMS** | 2005/2007. **OPR** (Rule 611 — no trade-through of protected quotes), sub-penny rule (Rule 612), Access Rule (Rule 610). |
| **Reg SHO** | Short-sale rules — Rule 200 (marking), Rule 201 (uptick / circuit-breaker), Rule 203 (locate + close-out). |
| **LULD** | Limit-up / Limit-down price bands (5/10/20% by tier). |
| **MWCB** | Market-Wide Circuit Breakers — Level 1 (7%), 2 (13%), 3 (20%) on S&P 500. |
| **MiFID II** | EU 2018. Best-ex, transaction reporting, LEI, dark caps, SIs. |
| **MAR** | EU Market Abuse Regulation. |
| **Dodd-Frank** | US 2010. Swaps → SEFs, Volcker, LEI. |
| **SEC 15c3-5** | Market Access Rule. Broker must have pre-trade risk controls on any market access it provides. |
| **CAT** | Consolidated Audit Trail — every US order lifecycle event reportable. |

### Post-trade

| Term | One-liner |
|------|-----------|
| **T+1** | US equities settle 1 business day after trade (since 2024-05-28). |
| **CNS** | Continuous Net Settlement at NSCC/DTCC. |
| **DVP / RVP** | Delivery-vs-Payment / Receive-vs-Payment. |
| **CCP** | Central Counterparty — NSCC (equities), OCC (options), CME/ICE (futures). |

### Reference Data

| Term | One-liner |
|------|-----------|
| **RIC** | Reuters Instrument Code (`IBM.N`). Vendor-proprietary. |
| **Bloomberg ticker** | `IBM US Equity`. Vendor-proprietary. |
| **ISIN** | ISO 6166. Global, 12 chars. `US4592001014`. |
| **CUSIP** | 9 chars, US/Canada. |
| **SEDOL** | 7 chars, UK/LSE. |
| **FIGI** | 12 chars, open, Bloomberg-issued. Instrument-level. |

## Cross-References

- FIX Protocol tags → `03_fix_protocol/`
- Order state machines & purge logic → `01_internal_codebase/`
- Post-trade DB layout & recon queries → `04_sql/`
- Splunk / grep on production logs → `05_linux/`
- SIP feed / multicast concepts → `06_networking/`

## Interviewer Personas to Prepare For

1. **Sell-side prod-support lead** — grills on FIX rejects, session recovery, MOC unwind, and "what would you do at 3:59 pm if the primary MOC feed dies".
2. **Buy-side technical analyst** — cares about allocation, blotter integrity, TCA, and pre-trade compliance blocks.
3. **HFT / low-latency SRE** — asks about SIP vs direct feeds, NBBO calc, and where microseconds hide.
4. **Compliance / market-abuse analyst** — MAR, layering/spoofing patterns, best-ex evidence.

## How the interviewer thinks

An APAC production-support lead is not asking "define VWAP". She is asking **"if a client's VWAP has slipped 40 bps at 14:55, what's the first place you look?"** The comprehensive file drills that muscle. Always answer the plumbing question — not the textbook question.
