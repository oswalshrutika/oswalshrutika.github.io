# 05 — FIX Red Flags (Wrong Answers to Avoid)

## Contents
1. "FIX runs over UDP."
2. "MsgSeqNum resets on every disconnect."
3. "OrderID is the same as ClOrdID."
4. "PossDupFlag is set on original messages."
5. "Heartbeats prove the counterparty received your last app message."
6. "TestRequest is just for latency measurement."
7. "ExecType F=Fill in FIX 4.4 works the same as 1/2 in 4.2."
8. "FIX 5.0 replaces 4.4 everywhere."
9. "SendingTime is local time."
10. "Checksum guarantees the message content is correct."
11. "SequenceReset always sets sequence numbers to 1."
12. "Drop copy is a real-time balance mechanism."
13. "Two OMSs on the same session can share credentials."
14. "Gap fill and sequence reset are the same."
15. "Cancel replace with a bad OrigClOrdID is silently applied."

---

## How to read this
Each item is a **wrong statement** a candidate might blurt out under pressure. The interviewer is listening for whether you understand the protocol as it is actually deployed on a real trading desk, not as it appears in a summary blog post. If you say any of these unchallenged, expect the follow-up to get sharper.

Format:
- **Wrong:** the tempting incorrect answer
- **Why it's wrong:** the mechanic that breaks it
- **Correct:** what to say instead

---

### 1. "FIX runs over UDP."
- **Wrong:** FIX is a lightweight protocol so it runs over UDP.
- **Why it's wrong:** FIX session layer requires an ordered, reliable, in-sequence byte stream. Losing a message silently would break MsgSeqNum invariants and force constant ResendRequests. UDP gives you none of that.
- **Correct:** FIX session (FIX 4.x, FIXT.1.1) runs over TCP. Some venues layer FIX over TLS or use FAST/SBE for market data on UDP multicast, but order flow sessions are TCP. Cite that TCP's in-order delivery is what makes MsgSeqNum tracking meaningful.

---

### 2. "MsgSeqNum resets on every disconnect."
- **Wrong:** Every time the session drops, both sides start again at 1.
- **Why it's wrong:** Sequence numbers persist across disconnects within a trading day. Resetting on every reconnect would destroy the entire replay / gap-fill mechanism. That is the whole point of persistent sequence numbers.
- **Correct:** Sequence numbers persist for the session (typically a trading day). A reset happens only on an agreed session boundary — usually end-of-day, or via an explicit Logon with ResetSeqNumFlag=Y (141=Y) that both sides have contractually agreed to. Some counterparties reset at start-of-day, some run rolling sequences across days — always confirmed via rules of engagement.

---

### 3. "OrderID is the same as ClOrdID."
- **Wrong:** They are two names for the same identifier.
- **Why it's wrong:** ClOrdID (11) is assigned by the client (the OMS sending the order) and must be unique per session per day on the client side. OrderID (37) is assigned by the exchange or broker and is what the venue uses internally.
- **Correct:** ClOrdID is client-generated and changes on every cancel/replace (the prior one goes into OrigClOrdID (41)). OrderID is broker/venue-assigned and typically stays stable across the chain. When troubleshooting a stuck order I search by both — ClOrdID for the client's view, OrderID for the broker's view.

---

### 4. "PossDupFlag is set on original messages."
- **Wrong:** You send PossDupFlag=Y so the counterparty knows the message is fresh.
- **Why it's wrong:** PossDupFlag=Y (43=Y) means "this may be a duplicate of a message you already saw." It is set on resent messages during a ResendRequest, not originals.
- **Correct:** PossDupFlag=Y flags a retransmission where the seq num matches an already-processed message. PossResend=Y (97=Y) is a different beast — it means the business content may be a duplicate even though the seq num is new (e.g., resending an order from a fresh session). Mixing these up is a classic support-team error.

---

### 5. "Heartbeats prove the counterparty received your last app message."
- **Wrong:** If I see a Heartbeat, my last NewOrderSingle definitely made it.
- **Why it's wrong:** A Heartbeat (35=0) proves only that the TCP session is alive and the counterparty's FIX engine is running. It says nothing about whether your application message was accepted, routed, or acknowledged by the business layer.
- **Correct:** Application-level acknowledgement comes from an ExecutionReport (35=8) with ExecType=0 (New) or 8 (Rejected). Heartbeats and TestRequest/Heartbeat exchanges are strictly session-layer keepalives. In prod support I never say "the order went through" just because heartbeats are ticking — I look for the matching 35=8.

---

### 6. "TestRequest is just for latency measurement."
- **Wrong:** You send TestRequest (35=1) to time the round trip.
- **Why it's wrong:** TestRequest is a session-layer probe used when you have not heard from the counterparty within HeartBtInt + a small buffer. It forces the counterparty to send a Heartbeat with the TestReqID echoed back, so you can decide whether to disconnect and reconnect.
- **Correct:** TestRequest is a liveness check triggered when the counterparty is silent longer than expected. If no Heartbeat comes back within a reasonable window, the session is considered dead and you disconnect. Latency is measured out-of-band (e.g., timestamp diffs on ExecutionReports, or dedicated MD monitoring).

---

### 7. "ExecType F=Fill in FIX 4.4 works the same as 1/2 in 4.2."
- **Wrong:** ExecType=F in 4.4 is just the newer name for ExecType=1 (Partial) and ExecType=2 (Fill) in 4.2.
- **Why it's wrong:** In FIX 4.4, ExecType=F (Trade) is used for both partial and full fills. You distinguish them by comparing LeavesQty (151) — non-zero means partial, zero means fully filled. In FIX 4.2, ExecType=1 was Partial Fill and ExecType=2 was Fill — two distinct values.
- **Correct:** 4.2: ExecType 1 = partial, 2 = full. 4.4: ExecType F = trade (either), read LeavesQty/CumQty to tell them apart. OrdStatus (39) is separate and tells you the order's aggregate state. Getting this wrong causes fill-counting bugs in downstream reporting.

---

### 8. "FIX 5.0 replaces 4.4 everywhere."
- **Wrong:** Everyone is on FIX 5.0 SP2 now.
- **Why it's wrong:** FIX 5.0 split the session layer (FIXT.1.1) from the application layer. Uptake for order flow has been slow — the majority of sell-side / buy-side sessions in equities and FX are still on FIX 4.2 or 4.4. FIX 5.0 is common for post-trade / regulatory (MiFID II TR, SBE market data, etc.), not the front-office order book.
- **Correct:** FIX 4.2 and 4.4 still dominate execution flow. FIX 5.0 / FIXT.1.1 is a transport-independent redesign; adoption is patchy and version negotiation is per counterparty. Never assume the version — check the DefaultApplVerID or the rules of engagement doc.

---

### 9. "SendingTime is local time."
- **Wrong:** SendingTime (52) is the sender's wall-clock time in local timezone.
- **Why it's wrong:** SendingTime is required to be UTC, formatted as YYYYMMDD-HH:MM:SS.sss (or with microsecond precision in newer specs). Sending local time causes clock-skew rejects (35=3 SessionReject reason 10, SendingTime accuracy) and breaks regulatory timestamping (MiFID II, CAT).
- **Correct:** SendingTime is UTC, always. Most engines validate it is within a configurable window (commonly 2 minutes) of the receiver's clock. In production I have seen sessions rejected end-to-end because a host's NTP drifted — timestamp discipline is not optional.

---

### 10. "Checksum guarantees the message content is correct."
- **Wrong:** CheckSum (10) validates that the business content of the message is correct.
- **Why it's wrong:** CheckSum is a simple modulo-256 sum of the ASCII byte values up to (not including) the checksum field itself. It catches transmission corruption at the framing level. It does not validate business content, tag values, field ordering, or required-field presence — those are FIX engine validations that produce SessionReject (35=3) or BusinessMessageReject (35=j).
- **Correct:** CheckSum is a framing / integrity check for byte-level corruption. Semantic validation is done by the FIX engine against the DataDictionary. TCP already covers most transport corruption, so CheckSum is a belt-and-braces check inherited from FIX's serial-line origins.

---

### 11. "SequenceReset always sets sequence numbers to 1."
- **Wrong:** SequenceReset (35=4) resets the counter to 1.
- **Why it's wrong:** SequenceReset has two modes. GapFillFlag=Y (123=Y) is Gap Fill mode — it advances the incoming sequence to NewSeqNo (36) to skip administrative messages during a resend; it must not go backwards. GapFillFlag=N (or absent) is Reset mode — it can set the incoming sequence to a new value but should be used only in extraordinary recovery and typically only after out-of-band agreement.
- **Correct:** Gap Fill mode is common during ResendRequest handling — the responder skips admin messages (Logon, Heartbeat, TestRequest) that should not be replayed. Reset mode is dangerous and used sparingly. Neither mode automatically means "start at 1" — that is the ResetSeqNumFlag on Logon.

---

### 12. "Drop copy is a real-time balance mechanism."
- **Wrong:** Drop copy sessions balance orders between two OMS instances in real time.
- **Why it's wrong:** Drop copy is a *read-only* feed of execution reports (and sometimes ack messages) sent from a broker or venue to a third party — usually risk, compliance, back office, or a redundant surveillance system. It does not participate in order flow; it does not accept NewOrderSingle. It cannot cancel or replace.
- **Correct:** Drop copy is a monitoring / regulatory / reconciliation feed. Common uses: independent P&L calc, MiFID II transaction reporting, prime-broker allocation, compliance surveillance. Load-balancing / failover between two OMS instances is handled at the primary session or venue level (hot-warm cutover, session steal, etc.), not via drop copy.

---

### 13. "Two OMSs on the same session can share credentials."
- **Wrong:** If we need redundancy we can log two OMS instances into the same session with the same SenderCompID.
- **Why it's wrong:** A FIX session is defined by the (SenderCompID, TargetCompID) pair. Only one logical connection can be logged in for that pair at a time. A second Logon typically forces a disconnect of the first (or is rejected), which corrupts sequence numbers and creates dueling reconnect storms. On top of that, sequence-number state cannot safely be shared across two processes without a shared, transactional store.
- **Correct:** Redundancy is done with hot-warm designs where only the active instance owns the session and holds the sequence-number lock. Standby watches state and takes over on failure through a coordinated handover (release the socket, replay state, log in). Some venues support multi-session accounts with separate SenderSubIDs for parallelism, but the (Sender, Target) pair is one session.

---

### 14. "Gap fill and sequence reset are the same."
- **Wrong:** Gap fill and sequence reset are two names for the same operation.
- **Why it's wrong:** They are two modes of the *same message type* (35=4 SequenceReset) but semantically different. Gap fill advances the counter forward to skip admin messages during a resend and must not go backwards. Reset can jump the counter to any value and is meant for out-of-band recovery only.
- **Correct:** Same message, different flag (GapFillFlag / 123). Gap fill is routine and part of normal resend handling; reset is an emergency lever. Confusing them causes support engineers to accept a reset when they should have insisted on a proper resend and reconciliation.

---

### 15. "Cancel replace with a bad OrigClOrdID is silently applied."
- **Wrong:** If the OrigClOrdID (41) on an OrderCancelReplaceRequest (35=G) doesn't match, the broker just applies the new values.
- **Why it's wrong:** A cancel/replace whose OrigClOrdID does not identify a live order must be rejected with an OrderCancelReject (35=9), CxlRejReason (102) typically 1 (Unknown order) or 6 (Duplicate ClOrdID), and CxlRejResponseTo (434) = 2 (response to a cancel/replace). Silently applying it would allow a client to overwrite arbitrary state — an integrity failure.
- **Correct:** Cancel/replace is idempotent and identity-checked. The (ClOrdID, OrigClOrdID) pair must trace an unbroken chain back to the original NewOrderSingle. Any break in the chain — wrong OrigClOrdID, duplicate new ClOrdID, wrong side/symbol — produces a 35=9 reject and the working order is untouched.

---

## Bonus: adjacent traps I have watched candidates walk into

- **"NewOrderSingle uses tag 55 for the account."** No — 55 is Symbol. Account is tag 1.
- **"BeginString identifies the application version in FIX 5."** No — BeginString is FIXT.1.1 for the session layer; ApplVerID / DefaultApplVerID identifies the application version.
- **"Rejects always come back as 35=3."** No — 35=3 is SessionReject (session-layer/malformed). 35=j is BusinessMessageReject (business-layer, e.g., unknown security). 35=8 with OrdStatus=8 is an order-level rejection (broker refused the order). Three different rejects, three different meanings.
- **"You always resend on any gap."** No — you send a ResendRequest (35=2) for the specific range. And if the other side sends messages with a higher-than-expected seq num, you queue them and request only the gap.
- **"NextExpectedMsgSeqNum on Logon means you should reset."** No — some engines (particularly FIX 4.4 with the optional 789 tag) use NextExpectedMsgSeqNum to negotiate resends on Logon. It is a recovery mechanism, not a reset trigger.

---

## Watch-out summary
If under pressure you catch yourself about to say any of the above, pause and disambiguate — session layer vs. application layer, client ID vs. broker ID, gap fill vs. reset, PossDup vs. PossResend, session ack vs. business ack. Interviewers love following up on these because they separate someone who has actually worked a stuck-order ticket at 4:00 pm on quarter-end from someone who has read the spec once.
