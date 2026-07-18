# FIX Protocol — Interview Prep Index

Section 03 of the Technical Analyst / Production Support interview pack. FIX is the lingua franca of every OMS/EMS/broker/venue interaction and interviewers probe it harder than any other topic.

## Files in this section

| File | Purpose | Depth |
|------|---------|-------|
| [01_comprehensive.md](./01_comprehensive.md) | 100+ Q&A across versions, session layer, message anatomy, session messages, application messages, execution reports, order chain, instrument, parties, handling, quantity, fills, custom tags, drop copy, order flow, cancel/replace, rejects, TLS, gateway, engines, conformance, multi-hop, gap-fill | Deep — read cover to cover |
| [02_focused.md](./02_focused.md) | 50 Q&A on the sharp edges — session recovery, PossDupFlag semantics, ExecType vs OrdStatus matrix, cancel-replace race, drop copy topology | Sharp — for a second pass |
| [03_quick_hit.md](./03_quick_hit.md) | 25 rapid-fire tag/definition drills — the "what is tag 41?" pattern | Rapid — 30 sec each |
| [04_diagrams.md](./04_diagrams.md) | Mermaid diagrams — session state machine, D→8 sequence, cancel/replace chain, gap-fill, drop copy topology | Visual reference |
| [05_red_flags.md](./05_red_flags.md) | 15 wrong-answer patterns that get candidates rejected on FIX rounds | Anti-patterns |
| [06_mock_interview.md](./06_mock_interview.md) | 3 full mock dialogues — L1 support screen, senior TA round, on-call scenario | Roleplay |

## How to use

1. Read `01_comprehensive.md` first — it is the base layer. Everything else references its terminology.
2. Drill `03_quick_hit.md` daily until every tag number is muscle memory (11, 37, 41, 39, 150, 17, 19, 55, 54, 38, 44, 40, 59, 60, 21, 18, 6, 14, 151, 32, 31).
3. Use `04_diagrams.md` as a whiteboard prompt — recreate each diagram from memory.
4. Rehearse `06_mock_interview.md` out loud before every phone screen.
5. Before submitting answers in a live interview, mentally check `05_red_flags.md`.

## What interviewers actually test

Based on published bank interview patterns (sell-side and buy-side prop, and prime brokerage / OMS vendor roles):

- **Tag literacy** — can you recite the tag number and datatype of the 40 core tags without looking?
- **Session vs application separation** — do you know why Logon (A) is session-layer and NewOrderSingle (D) is application-layer, and why that separation matters for gap-fill?
- **Order lifecycle** — walk from ClOrdID `ABC123` on a NewOrderSingle to the final Filled ExecutionReport, including OrigClOrdID chain on replace, LeavesQty going to zero, CumQty accumulating.
- **Recovery scenarios** — session drops mid-fill; do you send ResendRequest or Logon with ResetSeqNumFlag? What does PossDupFlag=Y guarantee and NOT guarantee?
- **Reject taxonomy** — session Reject (3) vs BusinessMessageReject (j) vs OrderCancelReject (9). CxlRejReason 102 values (0=too late, 1=unknown order, 2=broker option, 3=already pending).
- **Drop copy** — why it needs its own session, why PossDupFlag=Y is expected on replays, why sequence numbers there are independent of the trading session.
- **Production instincts** — how do you diagnose "orders stuck" from raw FIX logs at 3am? What does BodyLength (9) mismatch mean? What is CheckSum (10) computing?

## Reference materials

- FIX 4.2 spec (most sell-side production still runs 4.2 or 4.4)
- FIX 4.4 spec (parties block, NestedParties)
- FIX 5.0 SP2 + FIXT 1.1 (transport separation — session over FIXT, app over FIX 5.0)
- FIX Trading Community `www.fixtrading.org` — canonical tag dictionary
- OnixS FIX Dictionary Browser — searchable tag reference
- QuickFIX/J source — reference implementation for engine internals
