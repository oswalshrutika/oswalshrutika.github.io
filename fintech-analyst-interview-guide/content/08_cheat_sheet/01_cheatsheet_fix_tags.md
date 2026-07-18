# FIX Tags — One-Page Reference

> High-frequency tags a Technical Analyst is expected to recognize instantly. Focus: **FIX 4.2/4.4** — the versions still dominant in equities & options plumbing at investment banks.

---

## Contents

- [1. Header / session tags](#1-header--session-tags)
- [2. Order routing — NewOrderSingle (35=D)](#2-order-routing--newordersingle-35d)
- [3. Execution report (35=8)](#3-execution-report-358)
- [4. Cancel / replace (35=F / 35=G)](#4-cancel--replace-35f--35g)
- [5. Cross orders (35=s)](#5-cross-orders-35s)
- [6. Options-specific](#6-options-specific)
- [7. Allocation & post-trade](#7-allocation--post-trade)
- [8. Session admin messages](#8-session-admin-messages)
- [9. Common custom-tag ranges](#9-common-custom-tag-ranges)
- [10. Message-type letter cheat sheet](#10-message-type-letter-cheat-sheet)

---

## 1. Header / session tags

| Tag | Name | Msg types | Typical values | Notes |
|-----|------|-----------|----------------|-------|
| 8 | BeginString | All | `FIX.4.2`, `FIX.4.4`, `FIXT.1.1` | Always first field. `FIXT.1.1` for FIX 5.0. |
| 9 | BodyLength | All | integer | Char count from tag 35 to end of body (excl. tag 10). |
| 35 | MsgType | All | `D`, `8`, `F`, `G`, `A`, `0`, `1`, ... | Msg type letter. |
| 49 | SenderCompID | All | e.g. `CLIENT-BUY` | Firm identifier — sender. |
| 56 | TargetCompID | All | e.g. `BROKER-SELL` | Receiver. |
| 34 | MsgSeqNum | All | 1..N monotonic | Per-session; resend gap trigger. |
| 52 | SendingTime | All | `20260718-14:30:00.123` | UTC. |
| 10 | CheckSum | All | 3-digit `%03d` | Sum of bytes mod 256; **always last**. |
| 43 | PossDupFlag | All | `Y`/`N` | `Y` on resent messages. |
| 97 | PossResend | All | `Y`/`N` | Application-level duplicate (rare). |
| 50 | OnBehalfOfCompID | All | | Third-party routing (rare in modern OMS). |
| 128 | DeliverToCompID | All | | Companion to 50. |
| 115 | OnBehalfOfSubID | All | | Sub-user routing. |

## 2. Order routing — NewOrderSingle (35=D)

| Tag | Name | Typical values | Notes |
|-----|------|----------------|-------|
| 11 | ClOrdID | client-generated string, unique per session/day | Primary correlation key. |
| 21 | HandlInst | `1`=auto, `2`=auto-with-intervention, `3`=manual | Deprecated in FIX 5, still required 4.2/4.4. |
| 55 | Symbol | `AAPL`, `MSFT` | Root symbol. |
| 65 | SymbolSfx | `WI`, `CD` | When-issued, called. |
| 48 | SecurityID | CUSIP/ISIN | Paired with tag 22. |
| 22 | IDSource | `1`=CUSIP, `4`=ISIN, `5`=RIC, `8`=Exchange | Ident type. |
| 167 | SecurityType | `CS`, `OPT`, `FUT`, `MF`, `BOND` | Common Stock, Option, etc. |
| 54 | Side | `1`=buy, `2`=sell, `5`=sell-short, `6`=sell-short-exempt | `5` requires uptick historically; SHO now regulates. |
| 38 | OrderQty | integer | Shares/contracts. |
| 40 | OrdType | `1`=Mkt, `2`=Lmt, `3`=Stop, `4`=StopLmt, `5`=MktOnClose, `P`=Peg | 40=1 with 44 set is a red flag. |
| 44 | Price | decimal | Limit price. |
| 99 | StopPx | decimal | For stop / stop-limit. |
| 59 | TimeInForce | `0`=Day, `1`=GTC, `2`=OPG, `3`=IOC, `4`=FOK, `5`=GTX, `6`=GTD, `7`=ATC | GTX = Good-Till-Crossing. |
| 60 | TransactTime | UTC | Time of the order event. |
| 100 | ExDestination | `XNAS`, `ARCA`, `EDGX`, `BATY` | MIC or router code. |
| 15 | Currency | `USD`, `EUR` | |
| 47 | Rule80A (2001)/OrderCapacity(528) | `A`=agency, `P`=principal, `R`=riskless-principal | FIX 4.2 uses 47; FIX 4.4+ uses 528/529. |
| 528 | OrderCapacity | `A`,`P`,`R`,`G` | Agent/Principal/Riskless/Proprietary. |
| 529 | OrderRestrictions | space-delimited codes | Reg-M etc. |
| 18 | ExecInst | `1`=NotHeld, `6`=Participate-Dont-Init, `9`=CrossOnClose, `f`=CleanCross, `M`=MidPoint | Space-delimited multi-value. |
| 111 | MaxFloor | qty | Display size for iceberg. |
| 210 | MaxShow | qty | Alternative display size. |
| 126 | ExpireTime | UTC | Required when 59=6. |
| 6 | AvgPx | decimal | Rounded avg fill price. |
| 76 | ExecBroker | | Deprecated; use Parties block. |
| 1 | Account | account code | Buy-side account. |

## 3. Execution report (35=8)

| Tag | Name | Values | Notes |
|-----|------|--------|-------|
| 37 | OrderID | broker-assigned | Set by receiver, mirrored back. |
| 17 | ExecID | unique per execution | Every fill/ack gets a new one. |
| 20 | ExecTransType | `0`=New, `1`=Cancel, `2`=Correct, `3`=Status | 4.2 only. |
| 19 | ExecRefID | prior ExecID | For bust/correct. |
| 150 | **ExecType** | `0`=New, `1`=PartialFill, `2`=Fill, `3`=DoneForDay, `4`=Cancelled, `5`=Replaced, `6`=Pending-Cancel, `7`=Stopped, `8`=Rejected, `9`=Suspended, `A`=Pending-New, `B`=Calculated, `C`=Expired, `D`=Restated, `E`=Pending-Replace, `F`=Trade, `G`=Trade-Correct, `H`=Trade-Cancel | **Event-driven**. In 4.4+, `1` and `2` collapse into `F`. |
| 39 | **OrdStatus** | `0`=New, `1`=PartialFill, `2`=Filled, `3`=DoneForDay, `4`=Cancelled, `5`=Replaced, `6`=Pending-Cancel, `7`=Stopped, `8`=Rejected, `9`=Suspended, `A`=Pending-New, `B`=Calculated, `C`=Expired, `D`=AcceptedForBidding, `E`=Pending-Replace | **State snapshot** at time of msg. |
| 14 | CumQty | integer | Total filled to date. |
| 151 | LeavesQty | integer | Remaining open. Invariant: `14 + 151 = 38` (pre-cancel). |
| 32 | LastQty | integer | Just-filled qty (0 on ack/reject). |
| 31 | LastPx | decimal | Just-filled price. |
| 30 | LastMkt | MIC | Where the print happened. |
| 6 | AvgPx | decimal | Cumulative avg. |
| 58 | Text | free text | Reject/reason free-form. |
| 103 | OrdRejReason | 0..99 | `0`=BrokerOption, `1`=UnknownSymbol, `3`=OrderExceedsLimit, `11`=UnsupportedOrderChar, `13`=IncorrectQty. |
| 378 | ExecRestatementReason | 0..8 | Used when 150=D. |
| 12 | Commission | decimal | Per-order commission. |
| 13 | CommType | `1`=$/share, `2`=%, `3`=absolute, `4`=%-of-fill, `5`=bps | Paired with 12. |
| 381 | GrossTradeAmt | decimal | 32×31 for the fill. |

## 4. Cancel / replace (35=F / 35=G)

| Tag | Name | Notes |
|-----|------|-------|
| 41 | OrigClOrdID | The `ClOrdID` you're cancelling/replacing. |
| 11 | ClOrdID | New ID for this cancel/replace. |
| 37 | OrderID | Broker's ID (echo). |
| 434 | CxlRejResponseTo | On 35=9: `1`=CxlReq, `2`=CxlRepl. |
| 102 | CxlRejReason | `0`=TooLate, `1`=Unknown, `2`=BrokerOption, `3`=OrderAlreadyInPending, `6`=Duplicate ClOrdID | |
| 39 | OrdStatus | Present on cancel reject too. |

**Rule:** every replace becomes a *new* order chain (`41`→`11`). Do not lose the chain when reconstructing state.

## 5. Cross orders (35=s)

| Tag | Name | Values | Notes |
|-----|------|--------|-------|
| 548 | CrossID | firm-unique | The cross ticket. |
| 549 | CrossType | `1`=CrossAON, `2`=CrossIOC, `3`=CrossOneSide, `4`=CrossSamePrice | |
| 550 | CrossPrioritization | `0`=None, `1`=BuyPrio, `2`=SellPrio | |
| 552 | NoSides | 1 or 2 | Repeating group. |

## 6. Options-specific

| Tag | Name | Values | Notes |
|-----|------|--------|-------|
| 200 | MaturityMonthYear | `YYYYMM` | Expiry month/year. |
| 205 | MaturityDay | 1–31 | |
| 541 | MaturityDate | `YYYYMMDD` | Preferred in 4.4+. |
| 201 | PutOrCall | `0`=Put, `1`=Call | |
| 202 | StrikePrice | decimal | |
| 207 | SecurityExchange | `XCBO`, `XISE`, `XNAS` (BX Options) | |
| 461 | CFICode | ISO 10962 | e.g. `OCASPS` = call, American, stock, physical. |
| 555 | NoLegs | integer | Multi-leg block (spreads). |
| 600 | LegSymbol | | Inside NoLegs group. |
| 624 | LegSide | | |
| 623 | LegRatioQty | | |

## 7. Allocation & post-trade

| Tag | Msg | Name | Notes |
|-----|-----|------|-------|
| 70 | 35=J | AllocID | Allocation instruction. |
| 71 | 35=J | AllocTransType | `0`=New, `1`=Replace, `2`=Cancel. |
| 626 | 35=J | AllocType | `1`=Calculated, `2`=Preliminary, `5`=Ready-to-book. |
| 78 | 35=J | NoAllocs | Repeating group. |
| 79 | 35=J | AllocAccount | Sub-account per line. |
| 80 | 35=J | AllocQty | |
| 87 | 35=P | AllocStatus | `0`=Accepted, `4`=Received, `5`=Reject. |
| 88 | 35=P | AllocRejCode | If 87=5. |

## 8. Session admin messages

| MsgType | 35= | Purpose | Key tags |
|---|---|---|---|
| Logon | `A` | Open session | 98 (EncryptMethod), 108 (HeartBtInt), 141 (ResetSeqNumFlag), 553/554 (Username/Password), 789 (NextExpectedMsgSeqNum, 4.4+). |
| Logout | `5` | Close session | 58 (Text). |
| Heartbeat | `0` | Keep-alive | 112 (TestReqID) echoed if in response to a Test. |
| TestRequest | `1` | Force heartbeat | 112. |
| ResendRequest | `2` | Gap fill | 7 (BeginSeqNo), 16 (EndSeqNo, 0=infinity). |
| SequenceReset | `4` | Reset/GapFill | 36 (NewSeqNo), 123 (GapFillFlag, `Y`=GapFill / `N`=Reset). |
| Reject | `3` | Session-level reject | 45 (RefSeqNum), 371 (RefTagID), 372 (RefMsgType), 373 (SessionRejectReason). |
| BusinessMessageReject | `j` | App-level reject | 380 (BusinessRejectReason: 0=Other, 1=UnknownID, 3=UnsupportedMsgType, 5=ConditionallyRequiredFieldMissing). |

**Session reject (35=3) vs Business reject (35=j):** session = malformed framing / bad tag; business = well-formed but rejected by app logic. Never confuse the two in an interview.

## 9. Common custom-tag ranges

| Range | Owner | Notes |
|-------|-------|-------|
| 1..4999 | FIX standard | Well-known. |
| 5000..9999 | Reserved for FIX | |
| **5000..9999** in older docs | User-defined | Grandfathered. |
| **10000..19999** | Buy-side / vendor | Often used by OMS vendors. |
| **20000..39999** | User-defined per counterparty | e.g. tag **21283** used at one broker for a checkbox param; **20015** as `MarkupBps`. |
| **>39999** | Free-for-all | Vendor-vs-vendor bilateral. |

**Watch-out:** custom tags are bilaterally agreed. Never assume a value across counterparties — always cite the rules-of-engagement document.

## 10. Message-type letter cheat sheet

| Letter | Msg | Direction |
|---|---|---|
| `0` | Heartbeat | either |
| `1` | TestRequest | either |
| `2` | ResendRequest | either |
| `3` | Reject (session) | either |
| `4` | SequenceReset | either |
| `5` | Logout | either |
| `A` | Logon | either |
| `D` | NewOrderSingle | client→broker |
| `E` | NewOrderList | client→broker |
| `F` | OrderCancelRequest | client→broker |
| `G` | OrderCancelReplaceRequest | client→broker |
| `8` | ExecutionReport | broker→client |
| `9` | OrderCancelReject | broker→client |
| `s` | NewOrderCross | either |
| `J` | AllocationInstruction | client→broker |
| `P` | AllocationInstructionAck | broker→client |
| `AK` | Confirmation | broker→client |
| `AB` | NewOrderMultileg | options combos |
| `j` | BusinessMessageReject | either |

**Watch-out:** `35=8` is **ExecutionReport** — everything from ACK to Fill to Reject. Do not say "35=8 is a fill" — that betrays inexperience.
