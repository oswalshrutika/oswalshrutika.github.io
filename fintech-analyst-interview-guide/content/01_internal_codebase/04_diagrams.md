# Whiteboard Diagram Set — OMS Internal Codebase

Practice each of these until you can draw them on a whiteboard from memory in under 3 minutes. The caption under each block is what an interviewer wants to hear you *say* while pointing at the diagram — not just what to draw.

---

## 1. End-to-End Order Wire Flow

**Title:** Client order → downstream venue, showing every transform hop.

```mermaid
flowchart LR
    Client([Buy-side Client])
    iGate[iGate FIX Gateway]
    LuaIn[fixtags.lua<br/>inbound]
    OmClient[OM Rules<br/>OnClientNew / OnClientReplace / OnClientCancel]
    Core[(Core OMS<br/>C++ / Linux<br/>OMConnection, OexConnection,<br/>DacsConnection, DepthConnection,<br/>BarConnection, BboxConnection,<br/>NNOConnection, CMosConnection)]
    OmStreet[OM Rules<br/>OnStreetNew / OnStreetAck / OnStreetFill]
    LuaOut[fixtags.lua<br/>outbound]
    Expressway[Expressway]
    DCA[DCA / Broker Venue]

    Client -->|FIX 4.2/4.4| iGate
    iGate --> LuaIn
    LuaIn -->|strip 30056 alias,<br/>rem_tag suppression,<br/>split compound 109 APAC,<br/>stamp 21220 eventTS| OmClient
    OmClient -->|LOADER.so.default<br/>event-driven .rule files| Core
    Core --> OmStreet
    OmStreet --> LuaOut
    LuaOut -->|add MERGE/ISO/IRST suffix,<br/>region tags per FLEX_REGION,<br/>DCA-specific tag mapping,<br/>drop hash suffix| Expressway
    LuaOut --> DCA

    classDef lua fill:#fef3c7,stroke:#d97706,color:#000
    classDef rules fill:#dbeafe,stroke:#2563eb,color:#000
    classDef core fill:#e0e7ff,stroke:#4338ca,color:#000
    class LuaIn,LuaOut lua
    class OmClient,OmStreet rules
    class Core core
```

**Caption:** Walk the interviewer left-to-right and name the layer's *job*: iGate terminates the FIX session, `fixtags.lua` is a scriptable transform layer that does connection routing, tag suppression, alias→CompID resolution via 30056, and stamps event timestamps in 21220. OM rules are the business layer — event-driven `.rule` files (`OnClient*` inbound, `OnStreet*` outbound) that compile to `LOADER.so.default` via rulebuilder. Core OMS is the C++ state machine that owns the order book across the OMConnection/OexConnection/DacsConnection/etc. family of connection classes.

---

## 2. Order State Machine

**Title:** Full FIX-39 lifecycle a single order can traverse.

```mermaid
stateDiagram-v2
    [*] --> PendingNew: NewOrderSingle<br/>received
    PendingNew --> New: 35=8, 39=0<br/>venue ack
    PendingNew --> Rejected: 35=8, 39=8<br/>OM rule veto or<br/>venue rejects

    New --> PartiallyFilled: 35=8, 39=1<br/>first partial fill
    New --> Filled: 35=8, 39=2<br/>full fill
    New --> Cancelled: 35=8, 39=4<br/>user cancel
    New --> Replaced: 35=8, 39=5<br/>replace ack
    New --> Expired: 35=8, 39=C<br/>TIF elapsed
    New --> DoneForDay: 35=8, 39=3<br/>EOD, GTC/GTD roll

    PartiallyFilled --> PartiallyFilled: subsequent<br/>partial fills
    PartiallyFilled --> Filled: last fill
    PartiallyFilled --> Cancelled: cancel<br/>remaining qty
    PartiallyFilled --> Replaced: replace<br/>leaves qty
    PartiallyFilled --> DoneForDay: EOD with<br/>leaves qty

    Replaced --> New: new ClOrdID<br/>chain

    Filled --> [*]
    Cancelled --> [*]
    Expired --> [*]
    Rejected --> [*]
    DoneForDay --> [*]: purged EOD<br/>if IsPurgeable
```

**Caption:** Emphasize that `PendingNew` and `Replaced` are transient — the interviewer wants to hear you name the terminal states (`Filled`, `Cancelled`, `Expired`, `Rejected`, `DoneForDay`) and the fact that `Replaced` re-enters `New` under a fresh ClOrdID, which is the whole reason our merged-parent commission bug on the 2nd replace was subtle. Also call out that `DoneForDay` is where the EOD purge cascade decides who dies vs. who rolls (GTC/GTD survive).

---

## 3. IRST Cross Flow (Agency Parent → Principal Leg)

**Title:** Interlisted retail-flow cross — the two-leg dance where non-std settle bit us.

```mermaid
flowchart TD
    Client([Client sends<br/>agency order])
    ParentIn[Agency Parent<br/>528=A, 5000=agency_acct,<br/>99376=agency_portfolio]
    OMS[Core OMS<br/>Order::Copy]
    Prop[PropAcctAssign<br/>ft_mm_rule_acct_assign]
    PrincLeg[Principal Leg<br/>528=P, 109=PARP,<br/>99063=IRST]
    OutParent[Outbound agency parent<br/>to street]
    OutPrinc[Outbound principal leg<br/>to firm book]
    Bug{{Bug: _portfolio<br/>copied from agency parent<br/>FirmOrder::ActionStageNew<br/>if empty check never fires}}

    Client --> ParentIn
    ParentIn --> OMS
    OMS -->|copy fields to<br/>child leg| Prop
    Prop -->|assigns _trading_acct<br/>but NOT _portfolio| PrincLeg
    Prop -.->|if mapping table<br/>empty in prod| Bug
    PrincLeg --> OutPrinc
    ParentIn --> OutParent

    classDef bug fill:#fecaca,stroke:#dc2626,color:#000
    class Bug bug
```

**Caption:** Frame it as a two-leg workflow: the agency parent (528=A) triggers a principal offset leg (528=P) tagged with 109=PARP counterparty and 99063=IRST as the compliance suffix. The failure the interviewer will drill into: `Order::Copy()` propagates `_portfolio` from the agency parent, so `FirmOrder::ActionStageNew()`'s `if(_portfolio.empty())` guard never fires, and `PropAcctAssign` only rewrites `_trading_acct` — leaving a half-agency-half-principal record when the mapping rule table is empty in that region.

---

## 4. EOD Purge Cascade

**Title:** Who lives, who dies, who rolls — end-of-day housekeeping.

```mermaid
flowchart TD
    Start([EOD tick])
    Baskets[Baskets]
    Client[ClientOrders]
    Firm[FirmOrders]

    B_Check{Any member<br/>IsActive?}
    C_Check{IsPurgeable?<br/>- no pending fills<br/>- no open child<br/>- booking fully done<br/>- not late-trade-pending}
    F_Check{Parent still<br/>alive?}

    B_Keep[Keep basket +<br/>ALL members alive]
    Roll[GTC / GTD<br/>roll to next day]
    Purge[Purge from<br/>active tables]
    F_Purge[Cascade purge<br/>firm children]

    Start --> Baskets
    Baskets --> B_Check
    B_Check -->|yes| B_Keep
    B_Check -->|no| Client
    Client --> C_Check
    C_Check -->|no| B_Keep
    C_Check -->|GTC/GTD<br/>and terminal| Roll
    C_Check -->|day order<br/>and terminal| Purge
    Purge --> Firm
    Firm --> F_Check
    F_Check -->|no| F_Purge
    F_Check -->|yes| B_Keep

    classDef keep fill:#dcfce7,stroke:#16a34a,color:#000
    classDef kill fill:#fecaca,stroke:#dc2626,color:#000
    classDef roll fill:#fef3c7,stroke:#d97706,color:#000
    class B_Keep keep
    class Purge,F_Purge kill
    class Roll roll
```

**Caption:** The key insight for the interviewer is the *cascade direction* — baskets hold the whole tree alive if even one leg is active, so a single stuck child (booking-not-fully-done, pending fill, open street child, late-trade-pending) protects the entire basket from purge. GTC/GTD orders roll on their own axis independent of the basket check. Firm orders are dependent leaves — they only get purged after their client parent is confirmed dead, otherwise you orphan them.

---

## 5. Alert Subscription Match Flow

**Title:** How a fill event finds the right traders to notify.

```mermaid
flowchart TD
    Event([Fill / event<br/>arrives])
    Range[m_subscriptions.equal_range key]
    Loop{For each<br/>subscription<br/>in bucket}
    Generic{Is generic-alert?<br/>line 356 short-circuit}
    Match[isMatchTradingAccount<br/>+ desk / region / symbol<br/>predicate chain]
    Gate{Publish gates:<br/>- user online?<br/>- channel enabled?<br/>- quiet hours?}
    Dedup[Dedup cache<br/>alertId + traderId + windowSec]
    Publish[Publish to<br/>trader channel]
    Skip[Skip]

    Bug{{Bug: subscription<br/>never re-registered in<br/>m_subscriptions multimap<br/>after RemoveSubscriptions<br/>on reconnect}}

    Event --> Range
    Range --> Loop
    Loop --> Generic
    Generic -->|yes| Publish
    Generic -->|no| Match
    Match -->|hit| Gate
    Match -->|miss| Skip
    Gate -->|pass| Dedup
    Gate -->|fail| Skip
    Dedup -->|new| Publish
    Dedup -->|seen| Skip

    Range -.->|empty bucket for<br/>this trader's key| Bug

    classDef bug fill:#fecaca,stroke:#dc2626,color:#000
    class Bug bug
```

**Caption:** Sell the flow as three phases: (1) `equal_range` on the subscription multimap keyed by whatever fired the event, (2) predicate match per subscription — `isMatchTradingAccount` plus desk/region/symbol filters, with a fast-path for generic alerts that short-circuits the match, and (3) publish gates + dedup so the trader doesn't get spammed. The specific incident to have ready: one trader's subscription looked correct in the DB but never made it back into `m_subscriptions` after a reconnect — `RemoveSubscriptions` cleared the in-memory map and the DB re-add path missed re-registering, so `equal_range` returned an empty bucket.

---

## 6. FIX Tag Transform Pipeline

**Title:** What `fixtags.lua` does on the inbound and outbound sides.

```mermaid
flowchart LR
    subgraph Inbound["fixtags.lua — inbound"]
        In1[Receive raw FIX from iGate]
        In2[Suppress internal tags<br/>via rem_tag]
        In3[Resolve routing<br/>30056 alias → CompID]
        In4[Split compound 109<br/>counterparty ID<br/>APAC only]
        In5[Stamp 21220<br/>eventTS]
        In6[Drop hash suffix<br/>on client IDs]
        In1 --> In2 --> In3 --> In4 --> In5 --> In6
    end

    subgraph Rules["OM Rules"]
        R1[OnClientNew / Replace / Cancel]
        R2[Core OMS state transitions]
        R3[OnStreetNew / Ack / Fill]
        R1 --> R2 --> R3
    end

    subgraph Outbound["fixtags.lua — outbound"]
        Out1[Add compliance ID suffix<br/>MERGE / ISO / IRST]
        Out2[Add region tags<br/>per FLEX_REGION env<br/>EU / US / HK]
        Out3[DCA-specific tag mapping<br/>7801 IOBX,<br/>30865 PRINC-CROSS,<br/>7865 DIRECTED-CROSS]
        Out4[Custom tag stamps<br/>5000 tradingAcct,<br/>5011 acctType,<br/>31284 desk,<br/>99040 sysOrderType,<br/>99376 portfolio]
        Out5[Route to<br/>Expressway / DCA]
        Out1 --> Out2 --> Out3 --> Out4 --> Out5
    end

    Inbound --> Rules --> Outbound
```

**Caption:** Frame `fixtags.lua` as the seam between "wire format" and "domain model" — inbound it strips things the OM shouldn't see, resolves aliases to real CompIDs, and normalizes edge cases like APAC's compound 109 tag. Outbound it decorates orders with compliance suffixes (MERGE for merged parents, ISO for intermarket sweeps, IRST for interlisted retail), region-specific tags driven by `FLEX_REGION`, and DCA-only tags like 7801 IOBX / 30865 PRINC-CROSS / 7865 DIRECTED-CROSS. This is where a lot of production bugs live because it's easy to forget to strip an internal tag or double-add a suffix on replaces.

---

## 7. Merged Order Parent/Child Relationship

**Title:** Agency-merged DMA — one parent, many client legs, one street child.

```mermaid
flowchart TD
    C1([Client A order<br/>_comm_type=X])
    C2([Client B order<br/>_comm_type=Y])
    C3([Client C order<br/>_comm_type=Z])
    Merge[MergeEngine<br/>groups same-symbol<br/>same-side legs]
    Parent[Merged Parent<br/>99040=13 AgencyMerged<br/>_comm_type=\\0 cleared<br/>OMS.cpp:5123-5125]
    Street[Street Child<br/>single order to venue]
    Rep{Replace<br/>arrives}
    Bug{{Bug: 2nd replace already has<br/>_comm_type set upstream →<br/>FLEX_ORDER_COMMISSION_OVERRIDE<br/>if !get_comm_type is FALSE →<br/>tags 12/13 leak to broker}}

    C1 --> Merge
    C2 --> Merge
    C3 --> Merge
    Merge --> Parent
    Parent --> Street
    Street --> Rep
    Rep -->|allocations pushed<br/>back to client legs| C1
    Rep -->|fills| C2
    Rep -->|fills| C3
    Rep -.-> Bug

    classDef bug fill:#fecaca,stroke:#dc2626,color:#000
    class Bug bug
```

**Caption:** Explain the fan-in / fan-out shape: multiple client legs collapse into one merged parent (`99040=13 AgencyMerged`), which spawns a single street child so we get one execution and better price improvement, then fills are allocated back down to the original client legs on the return path. The commission bug lives on replace — the merged parent explicitly clears `_comm_type` at `OMS.cpp:5123-5125` to prevent leaking client commission tags outbound, but on the 2nd replace the incoming message already carries `_comm_type` set upstream, so `FLEX_ORDER_COMMISSION_OVERRIDE`'s `if(!get_comm_type())` guard evaluates false and tags 12/13 escape to the sell-side broker.

---

## Whiteboard Practice Tips

- Draw each diagram cold, no reference, in under 3 minutes.
- Say the *caption* out loud while drawing — that's the muscle you're building for the actual interview.
- When you narrate a bug, follow the pattern: **symptom → suspect code path → line-level root cause → the guard/check that failed → the fix**.
- Anchor every diagram to at least one real production incident from your history — makes the story stick and shows you've owned prod, not just read the code.
