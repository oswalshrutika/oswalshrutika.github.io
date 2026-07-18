# Flashcards — 60 Q→A

> 2-column table. Cover the right column, answer aloud, then reveal. Rotate randomly. Time yourself: 15 seconds per card.

---

## Contents

- [FIX Protocol (1–15)](#fix-protocol-115)
- [Order Lifecycle & OMS (16–25)](#order-lifecycle--oms-1625)
- [US Market Structure (26–35)](#us-market-structure-2635)
- [SQL (36–43)](#sql-3643)
- [Linux (44–50)](#linux-4450)
- [Networking (51–56)](#networking-5156)
- [Behavioral & role-fit (57–60)](#behavioral--role-fit-5760)

---

## FIX Protocol (1–15)

| # | Q | A |
|---|---|---|
| 1 | What does tag 35 mean and give 3 common values? | MsgType. `D`=NewOrderSingle, `8`=ExecutionReport, `F`=OrderCancelRequest. |
| 2 | Difference between 39 (OrdStatus) and 150 (ExecType)? | 39 is the state of the order after the event; 150 is the event that caused this message. Multiple ExecTypes can map to the same OrdStatus. |
| 3 | Tag 11 vs tag 37 — who owns each? | 11 (ClOrdID) is client-generated, unique per session/day. 37 (OrderID) is broker-assigned and stable across cancel/replace chain. |
| 4 | Which tag chains cancel/replace across a ClOrdID? | Tag 41 (OrigClOrdID) points to the previous ClOrdID in the chain; tag 11 is the new one. |
| 5 | What is the checksum tag and how is it computed? | Tag 10 — sum of every byte in the message up to (not including) the checksum field, mod 256, formatted as 3 digits. Always the last field. |
| 6 | 35=3 vs 35=j — what's the difference? | 35=3 is a session-level reject (malformed / bad tag). 35=j is a business-message reject (well-formed but app rejected it). |
| 7 | What triggers a ResendRequest (35=2)? | A gap in received MsgSeqNum (tag 34). Requester sends 35=2 with BeginSeqNo (7) and EndSeqNo (16). |
| 8 | Tag 43 meaning? | PossDupFlag. Set to `Y` on resent messages so receiver can dedupe by ClOrdID/ExecID. |
| 9 | Two tags that carry a fill price and fill qty? | 31 (LastPx) and 32 (LastQty). Cumulative are 6 (AvgPx) and 14 (CumQty). |
| 10 | Which FIX version merges partial-fill and fill into one ExecType, and what letter? | FIX 4.4+; both become `150=F` (Trade). Distinguish via 39 or 151. |
| 11 | What tag carries a reject reason code on a NewOrder rejection? | Tag 103 (OrdRejReason). Free-text in tag 58. |
| 12 | Tag for TimeInForce and 3 values? | Tag 59. `0`=Day, `3`=IOC, `4`=FOK. |
| 13 | Tag 60 vs tag 52 — subtle difference? | 52 is SendingTime (when this message was sent). 60 is TransactTime (when the business event occurred). May differ on retransmits. |
| 14 | How is a bust indicated in FIX 4.4? | `150=H` (TradeCancel) with tag 19 (ExecRefID) pointing to the busted ExecID. |
| 15 | What's `35=A` and 4 tags in it? | Logon. 98 (EncryptMethod), 108 (HeartBtInt), 141 (ResetSeqNumFlag), 553/554 (Username/Password). |

## Order Lifecycle & OMS (16–25)

| # | Q | A |
|---|---|---|
| 16 | State the invariant that ties OrderQty / CumQty / LeavesQty. | Pre-cancel: `OrderQty = CumQty + LeavesQty`. Post-cancel: `LeavesQty=0` and `CancelledQty = OrderQty − CumQty`. |
| 17 | What happens to LeavesQty after 39=2 (Filled)? | `LeavesQty = 0`. |
| 18 | Difference between an ACK and a Fill? | ACK = broker confirms receipt/working (150=0, 39=0). Fill = an execution happened (150=1/2 or F, 39=1/2). |
| 19 | What does "PendingCancel" mean and can fills still arrive during it? | Broker acknowledged a cancel request but hasn't confirmed. Yes — a fill can race in from the venue before the cancel takes effect. |
| 20 | Buy-side vs sell-side OMS in one sentence each. | Buy-side OMS manages the portfolio manager's investment decisions and compliance. Sell-side OMS manages broker execution and routing for external client orders. |
| 21 | What's an EMS and how does it relate to OMS? | Execution Management System — trader-facing routing/algo layer. OMS handles order state + compliance; EMS handles execution/venue selection. Modern platforms fuse them. |
| 22 | What is a "cross" order? | An order that matches a buy and sell side, often for the same firm's clients or internally, submitted as a single ticket (35=s in FIX). |
| 23 | What is `HandlInst` and its 3 values? | Tag 21 in FIX 4.2. `1`=auto-execution, `2`=auto-with-broker-intervention, `3`=manual. Deprecated in 5.0. |
| 24 | What's the difference between agency and principal trading? | Agency: broker acts on behalf of client, earns commission, no principal risk. Principal: broker trades from own book, earns spread, takes market risk. FIX tag 528 (OrderCapacity). |
| 25 | Give one example of a Restatement (150=D) reason. | 378=1 (GT Corporate Action), 378=3 (Broker Option) for commission restatement, 378=8 (MarketOption). |

## US Market Structure (26–35)

| # | Q | A |
|---|---|---|
| 26 | What is NBBO? | National Best Bid & Offer — highest displayed protected bid and lowest displayed protected offer across all US equities exchanges, published by the SIP. |
| 27 | Reg NMS Rule 611 in one line. | Order Protection Rule — brokers/exchanges must not trade through a better-priced protected quote on another exchange. |
| 28 | What is an ISO? | Intermarket Sweep Order — marked `18=6`; broker asserts simultaneous routing of sufficient shares to satisfy better-priced protected quotes elsewhere, allowing a trade-through under a 611 exception. |
| 29 | Sub-Penny Rule — quote or trade? | Bans **quoting** in sub-penny for stocks >= $1.00. Prints (executions) may be sub-penny (e.g. midpoint fills). |
| 30 | LULD Tier 1 band during regular hours? | 5% for S&P 500, R1000, select ETPs > $3. Widened to 10% in first & last 15 min. |
| 31 | When did US equities move to T+1? | May 28, 2024. |
| 32 | Difference between Rule 605 and Rule 606? | 605: market centers report execution quality monthly. 606: broker-dealers report order-routing venues + PFOF quarterly. |
| 33 | What is SSR? | Short Sale Restriction under Reg SHO 201; triggered when a stock drops 10% intraday; short sales restricted to prices > NBB for rest of day and next full day. |
| 34 | Name 3 US options exchanges. | Cboe, NYSE Arca Options, MIAX, Nasdaq PHLX, Nasdaq ISE — any 3. |
| 35 | What are the MWCB levels? | Level 1: S&P −7% (15 min pause); L2: −13% (15 min); L3: −20% (rest of day). Not triggered after 3:25 pm except L3. |

## SQL (36–43)

| # | Q | A |
|---|---|---|
| 36 | Difference between RANK() and DENSE_RANK()? | RANK skips numbers after ties (1,1,3,4). DENSE_RANK does not (1,1,2,3). |
| 37 | Default window frame if you omit it? | `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. Trap: `LAST_VALUE` returns current row unless you extend the frame. |
| 38 | LEFT JOIN vs LEFT SEMI JOIN? | LEFT JOIN keeps left rows and projects right cols (NULL if no match). LEFT SEMI keeps only left rows that have >= 1 match, no right cols. Equivalent to `WHERE EXISTS`. |
| 39 | What isolation level does Oracle default to? | Read Committed. |
| 40 | What anomaly does Serializable prevent that Repeatable Read (in MySQL) may not? | Phantom reads (in classic RR). In Postgres, RR uses SSI and prevents phantoms + write-skew. |
| 41 | Compute VWAP in SQL sketch. | `SELECT symbol, SUM(qty*price)/NULLIF(SUM(qty),0) AS vwap FROM fills GROUP BY symbol;` |
| 42 | Why does `NOT IN (SELECT col FROM t)` where col has NULLs return empty? | Because `x <> NULL` is NULL, not TRUE; the ALL-NOT-EQUAL fails for every row. Use `NOT EXISTS`. |
| 43 | When is a hash join preferred over nested-loop? | Big × Big equi-join with no useful index — build a hash table on the smaller side and probe with the larger. Nested loop wins when outer is small and inner is indexed. |

## Linux (44–50)

| # | Q | A |
|---|---|---|
| 44 | How do you tail a rotating log without losing across rotation? | `tail -F` (capital F) reopens the file on rotation. `tail -f` won't. |
| 45 | Command to list all TCP sockets to port 9878 with per-socket RTT? | `ss -tin '( sport = :9878 or dport = :9878 )'` |
| 46 | Two files: which lines are unique to a? | `comm -23 <(sort a) <(sort b)` |
| 47 | tcpdump filter for TCP resets only? | `sudo tcpdump -nn 'tcp[tcpflags] & tcp-rst != 0'` |
| 48 | What's `CLOSE_WAIT` and what does its accumulation indicate? | Peer sent FIN, our app hasn't called close(). Accumulation = application file-descriptor leak. |
| 49 | Take a JVM thread dump non-destructively. | `jstack <pid>` — or `jcmd <pid> Thread.print`. Take 3 within ~10s to spot true deadlock. |
| 50 | Awk to sum column 3 of a whitespace file? | `awk '{s+=$3} END{print s}' file` |

## Networking (51–56)

| # | Q | A |
|---|---|---|
| 51 | Name the 11 TCP states. | CLOSED, LISTEN, SYN_SENT, SYN_RCVD, ESTABLISHED, FIN_WAIT_1, FIN_WAIT_2, CLOSE_WAIT, LAST_ACK, CLOSING, TIME_WAIT. |
| 52 | What does `TCP_NODELAY` do and why matters for FIX? | Disables Nagle's algorithm, so small writes ship immediately. Critical for FIX to avoid 40–200 ms coalescing latency on small tags. |
| 53 | Multicast — how does a host tell the network it wants a group? | Sends IGMP Join (IGMPv2 Membership Report, IGMPv3 group-and-source report) — periodically re-sent to keep the switch's snooping table warm. |
| 54 | What's PTP and why do banks care? | Precision Time Protocol (IEEE 1588). Sub-µs hardware-timestamped clock sync — required for MiFID II clock accuracy rules and for latency-sensitive tick analysis. |
| 55 | Roughly how many µs for NYC ↔ Chicago microwave? | About 4.1 ms one-way — beats fibre by ~2 ms. |
| 56 | What does BBR replace in TCP and what's its edge? | Congestion-control algorithm. Models bandwidth-delay product instead of reacting to packet loss; performs better on lossy long-haul (transatlantic) links. |

## Behavioral & role-fit (57–60)

| # | Q | A |
|---|---|---|
| 57 | "Why do you want this role?" — one-sentence answer. | I've built a specialization supporting FIX and OMS internals for five years and I want to bring that pattern-recognition into a firm where the trading-day pressure and volume expose the interesting failures. |
| 58 | "What do you do when the trader is escalating and you have no idea what's wrong?" | Acknowledge the impact in one sentence, start a written incident channel so we build history, and split into two parallel tracks: quick mitigation (unblock the trader) and root cause. |
| 59 | "How do you avoid making the same mistake twice?" | Every incident I close with a systemic follow-up: a linter, a startup validation, an alert, or a doc. If the fix is only in my head, I haven't actually fixed it. |
| 60 | "How would you rate yourself on FIX 1–10 and why?" | Seven. I've read the 4.2 and 4.4 specs cover-to-cover, live-debugged session-layer and app-layer issues across 4 counterparties, but I've done less with 5.0 SP2 in derivatives-heavy flows — that's the next area I'd deepen. |
