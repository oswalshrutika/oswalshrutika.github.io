# FIX Protocol — Diagrams

## Table of Contents
1. [Session State Machine](#1-session-state-machine)
2. [Order Lifecycle Sequence](#2-order-lifecycle-sequence)
3. [Cancel/Replace Chain](#3-cancelreplace-chain)
4. [Gap Fill Sequence](#4-gap-fill-sequence)
5. [Drop Copy Topology](#5-drop-copy-topology)
6. [Reject Variants](#6-reject-variants)

---

## 1. Session State Machine

State transitions for a single FIX session from TCP connect through orderly logout. Every production incident involving "session down" maps to one of these transitions failing — most commonly stuck in `LogonSent` (credential/comp-ID mismatch) or bouncing out of `Established` on a heartbeat timeout.

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> Connecting: TCP connect
    Connecting --> LogonSent: send Logon (35=A)
    Connecting --> Disconnected: TCP refused / timeout
    LogonSent --> Established: recv Logon (35=A) ack
    LogonSent --> Disconnected: Logon rejected / timeout
    Established --> Heartbeats: idle > HeartBtInt
    Heartbeats --> Established: recv Heartbeat (35=0) / TestRequest (35=1)
    Heartbeats --> Disconnected: no response to TestRequest
    Established --> LogoutSent: send Logout (35=5)
    Established --> Disconnected: socket drop / seq error
    LogoutSent --> Disconnected: recv Logout ack / timeout
    Disconnected --> [*]
```

**Caption:** The `Heartbeats` sub-state is really a nested loop inside `Established` — every `HeartBtInt` seconds (35=108) the counterparty must send a Heartbeat (35=0) or respond to a TestRequest (35=1). Two missed intervals trigger disconnect. Clean shutdown always goes through `LogoutSent`; anything else is an abnormal termination and forces resend logic on reconnect.

---

## 2. Order Lifecycle Sequence

Happy-path new order from client to broker with two partial fills. Every ExecutionReport (35=8) carries `OrdStatus` (39) and `ExecType` (150) — the interview trap is knowing they can diverge (e.g. ExecType=Trade while OrdStatus=PartiallyFilled).

```mermaid
sequenceDiagram
    participant C as Client
    participant O as OMS
    participant B as Broker
    C->>O: 35=D NewOrderSingle (ClOrdID=NEW-1, 38=1000)
    O->>B: 35=D NewOrderSingle (ClOrdID=OMS-NEW-1, 38=1000)
    B-->>O: 35=8 ExecReport (150=A PendingNew, 39=A)
    O-->>C: 35=8 ExecReport (150=A, 39=A)
    B-->>O: 35=8 ExecReport (150=0 New, 39=0)
    O-->>C: 35=8 ExecReport (150=0, 39=0)
    B-->>O: 35=8 ExecReport (150=F Trade, 39=1 PartialFill, 32=400, 31=100.50)
    O-->>C: 35=8 ExecReport (150=F, 39=1)
    B-->>O: 35=8 ExecReport (150=F Trade, 39=2 Filled, 32=600, 31=100.55)
    O-->>C: 35=8 ExecReport (150=F, 39=2 Done)
```

**Caption:** `PendingNew` (150=A) is the broker's "I received it" ack — it is optional but common on regulated venues. The order is not working on the book until `New` (150=0). CumQty (14) and AvgPx (6) accumulate across fills; LastShares (32) and LastPx (31) describe only the current execution.

---

## 3. Cancel/Replace Chain

Cancel/Replace uses OrderCancelReplaceRequest (35=G) which atomically replaces the working order with a new one. `OrigClOrdID` (41) chains back to the prior ClOrdID — get that wrong and the broker sends OrderCancelReject (35=9) with reason `Unknown order`.

```mermaid
sequenceDiagram
    participant C as Client
    participant B as Broker
    C->>B: 35=D NewOrderSingle (11=NEW-1, 38=1000, 44=100.50)
    B-->>C: 35=8 ExecReport (11=NEW-1, 150=0 New, 39=0)
    C->>B: 35=G CancelReplaceRequest (11=NEW-2, 41=NEW-1, 38=1500)
    B-->>C: 35=8 ExecReport (11=NEW-2, 41=NEW-1, 150=5 Replaced, 39=5)
    C->>B: 35=F CancelRequest (11=CXL-1, 41=NEW-2)
    B-->>C: 35=8 ExecReport (11=NEW-2, 41=CXL-1, 150=4 Cancelled, 39=4)
```

**Caption:** After a replace, all future references must use the new ClOrdID (`NEW-2`) — using `NEW-1` will get rejected as unknown. The cancel's ExecReport echoes both the working order's ClOrdID (11=NEW-2) and the cancel request's ID (41=CXL-1) so the client can correlate. If the replace race-conditions against a fill, expect an OrderCancelReject (35=9) with `CxlRejReason=Too late to cancel`.

---

## 4. Gap Fill Sequence

Triggered when the receiver detects `MsgSeqNum` (34) higher than expected — meaning messages were lost or the counterparty skipped sequences. The sender responds with either real message replays or a SequenceReset-GapFill (35=4, 123=Y) for admin messages that must not be replayed.

```mermaid
sequenceDiagram
    participant A as Session A (receiver)
    participant B as Session B (sender)
    Note over A,B: Expected next seq = 100
    B->>A: 35=D NewOrder (34=105)
    Note over A: Gap detected: expected 100, got 105
    A->>B: 35=2 ResendRequest (7=100, 16=104)
    B->>A: 35=4 SequenceReset (34=100, 123=Y GapFill, 36=103)
    Note over A,B: 100-102 were Heartbeats/TestReq — safe to skip
    B->>A: 35=D NewOrder (34=103) — real business msg
    B->>A: 35=8 ExecReport (34=104) — real business msg
    Note over A: Now caught up, expected next = 105
    A->>A: Process previously buffered 34=105
    Note over A,B: Sequence resumed
```

**Caption:** GapFillFlag=Y (tag 123) tells the receiver "trust me, 100-102 were admin — jump straight to NewSeqNo (36)". Business messages (D, G, F, 8) must always be replayed with `PossDupFlag=Y` (43=Y), never gap-filled — this is the single most common source of trade breaks after an outage. If the receiver rejects the reset, the session terminates.

---

## 5. Drop Copy Topology

Drop copy is a read-only ExecutionReport (35=8) feed to a separate consumer — used for real-time P&L, compliance surveillance, and back-office reconciliation. The OMS is the primary session for order entry; drop copies are parallel one-way feeds from each broker.

```mermaid
graph LR
    subgraph Brokers
        BA[Broker A]
        BB[Broker B]
    end
    subgraph BuySide
        OMS[OMS<br/>bidirectional]
        DC1[DropCopy1<br/>P&L / Risk]
        DC2[DropCopy2<br/>Compliance]
    end
    BA -->|35=D orders| OMS
    OMS -->|35=D orders| BA
    BA -->|35=8 exec reports| OMS
    OMS -->|35=8 exec reports| BA
    BA -.->|35=8 read-only| DC1
    BB -->|35=D orders| OMS
    OMS -->|35=D orders| BB
    BB -->|35=8 exec reports| OMS
    OMS -->|35=8 exec reports| BB
    BB -.->|35=8 read-only| DC2
```

**Caption:** Dashed lines are drop copy — one-way, ExecutionReport-only, no order entry. Each drop copy has its own SenderCompID/TargetCompID pair and its own sequence numbers independent of the trading session. If the primary trading session goes down, drop copy typically stays up, giving support a real-time view of what the broker thinks is happening while OMS is dark.

---

## 6. Reject Variants

Three distinct reject messages, each for a specific failure class. Confusing them on a support ticket wastes hours — the sender ID, message type, and reason-code tag are all different.

```mermaid
flowchart TD
    Msg[Incoming FIX message] --> Q1{Session-level<br/>malformed?<br/>bad seq / bad tag /<br/>missing required field}
    Q1 -->|Yes| R1[35=3 Reject<br/>tag 45=RefSeqNum<br/>tag 373=SessionRejectReason<br/>tag 371=RefTagID]
    Q1 -->|No| Q2{Business-level<br/>NewOrder / Replace / Cancel?}
    Q2 -->|Cancel or Replace<br/>rejected| R2[35=9 OrderCancelReject<br/>tag 41=OrigClOrdID<br/>tag 102=CxlRejReason<br/>tag 434=CxlRejResponseTo]
    Q2 -->|Other business msg<br/>rejected app-side| R3[35=j BusinessMessageReject<br/>tag 380=BusinessRejectReason<br/>tag 372=RefMsgType<br/>tag 379=BusinessRejectRefID]
    R1 --> S1[Sequence number<br/>still advances]
    R2 --> S2[Order stays in prior<br/>state — no state change]
    R3 --> S3[Business-layer<br/>failure — inventory,<br/>credit, entitlement]
```

**Caption:** Session Reject (35=3) means the message was malformed at the FIX layer — parser could not even understand it, so it never reached business logic. OrderCancelReject (35=9) is specific to F/G rejects, and the original order remains in whatever state it was in. BusinessMessageReject (35=j) is the catch-all for well-formed messages that failed business validation — think risk limit breach, unknown symbol, or expired entitlement.

---
