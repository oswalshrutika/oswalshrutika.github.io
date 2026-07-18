# Mock Interview Dialogues

Three full mock interview transcripts for the Technical Analyst / OMS support role. All names, tickers, brokers, and identifiers below are anonymized.

---

## Dialogue 1 — Walk Me Through a Day in the Life

**Setup:** Screening round with the hiring manager for a peer team. She wants to understand what the candidate actually *does* day-to-day — is this a support/ops role or an engineering role? 30 minutes, video call, mostly behavioral with light technical probing.
**Duration:** ~30 min

**Interviewer:** Thanks for making time. Before we dive in, can you just walk me through what a normal day looks like for you? Assume I have zero context on your team.

**Candidate:** Sure. So I sit on the OMS engineering side supporting the program-trading desk — that's the desk that runs multi-name basket flow, algos on top of baskets, cross-listed strategies, that kind of thing. My day basically has three layers. First layer is production support: I'm on rotation to watch the queue that fires when anything on the trading path misbehaves — a FIX session dropping, a rule short-circuiting, an order stuck in a weird state, a purge failing. Second layer is enhancements — I pick up user stories from the desk that come in through our intake, spec them, code them, get them through review, promote them. Third layer is the slower stuff — regulatory work, tag additions when a venue changes their spec, cleanup of dead code paths.

**Interviewer:** What's the split roughly? Support vs. project work?

**Candidate:** In a calm week, maybe sixty-forty project. In a rough week — end of quarter, a venue certification, or when we've just promoted — it flips to eighty-twenty support. The support work is what I can't schedule. If a trader pings at 09:34 saying "why did this order get rejected," project work stops.

**Interviewer:** Give me a concrete example of a morning.

**Candidate:** Yesterday. I logged in around 06:45 local, checked overnight logs on the Asia session because our platform is region-partitioned — we run separate instances per region driven by an environment variable, and Asia trades while I sleep. Nothing red overnight. Then at open, one of the traders pinged that a fill on a merged parent order wasn't showing the right commission on the drop copy. That took me until about 11:00 to trace. Then I had a design review at 11:30 for a new order type we're adding for a specific venue. Afternoon was code review on a colleague's change plus writing the fix for the commission thing.

**Interviewer:** Let's pause on the commission issue. What did the trace look like?

**Candidate:** So the flow is: order comes in over FIX from the client, hits our inbound routing layer, gets normalized, goes into the core order manager, our event-driven rules fire on the client-side hook, then again on the street-side hook when we send out, then out through the outbound transformer to the venue. Commission override lives in a rule on the street-side hook. That rule has a guard — it only sets the commission if the commission type isn't already set. On a first-time new order that works. On this one it was a *replace* on an already-merged parent, and the replace came in with the commission type already populated by the client. So the guard evaluated false, and we sent our side out with the client's commission attached — which for this particular relationship should always be zero because it's a DMA arrangement.

**Interviewer:** How did you find that? Walk me through the debugging.

**Candidate:** I started with the outbound tag stream on the session — that's where I saw tags 12 and 13 populated when they shouldn't be. Then I walked backwards. Checked the rule log for that order ID — the override rule *did* fire, but I could see from the trace it hit the guard and skipped. Then I checked the inbound message, and sure enough the replace came in with the commission type field populated. Then I checked the merged parent's state in memory — the merge logic clears the commission type when it creates the merged order, so the *parent* has it blank. But the incoming replace doesn't inherit that; it comes in fresh from the client with their side's value. So the guard was checking the wrong thing.

**Interviewer:** What's the fix?

**Candidate:** Loosen the guard for this override to always overwrite for the specific broker relationship, or add a preprocessing step before the rule to null out the commission fields on inbound replaces when the target is one of our DMA counterparties. I went with the second because it's more surgical and doesn't touch the general rule that other flows depend on.

**Interviewer:** OK. Different question — how much of your job is talking to non-engineers?

**Candidate:** A lot. Probably a third. The desk sits maybe thirty feet from us. Traders will just walk over when something surprises them. I've learned to answer their question first in trader-language — "your order didn't go because the venue rejected the settle date" — and only then, if they want it, go into "and the reason is the portfolio field on the principal leg was still holding the agency value from the parent copy." Most of the time they don't want the second half. Compliance and ops also come to us — they'll ask why a report shows a particular value, and that's usually a tag mapping question.

**Interviewer:** What do you find hardest about the role?

**Candidate:** Two things. The codebase is old and there are entire classes of bug that only reproduce in production because the shape of the flow matters — you need a merged parent, a specific broker, and a specific replace sequence. You can't unit-test your way to safety. So I've had to get good at reading production logs, at reasoning about what *state* an order was in when the rule fired, and at building mental models of the ordering of events. The second hard thing is that when the desk is losing money because of a bug, they need it fixed *now*, and you have to keep a clear head about not making it worse.

**Interviewer:** Tell me about a time you made it worse.

**Candidate:** Early in the role I pushed a hotfix for a purge bug — orders weren't getting cleaned up at end of day because of a cascade check on baskets, if any child is active the whole basket stays. I "fixed" it by removing the cascade, which promptly killed working orders overnight. We caught it in the pre-open smoke test the next morning. Rolled back. What I learned: the cascade wasn't a bug, it was there for a reason I hadn't understood. Now before I change anything in the purge or lifecycle code I write down what invariants I think it's holding, then go verify each one against the code and against the desk's expectations before I touch a line.

**Interviewer:** Do you write tests?

**Candidate:** Yes, but with caveats. Unit tests for pure logic — tag mapping, string parsing, math. Integration tests are harder because our test rig doesn't perfectly replicate production; it doesn't have the same rulebook loaded, it doesn't have all the venue mocks. So for anything touching the rule engine I write a scripted replay: capture a real production FIX stream, sanitize it, replay it into a test instance, diff the outbound. That's slow to set up but it's the only way I trust the result.

**Interviewer:** How do you keep up with what the desk actually needs? Reactive is easy — they tell you when it breaks. Proactive is harder.

**Candidate:** I try to sit with a trader for a couple of hours every few weeks. Just watch them work. It's amazing what you learn — a workflow that our software makes take four clicks that they've been quietly hating for a year, and no one thought to tell us because it's not broken, it's just annoying. A lot of my better user stories come from that.

**Interviewer:** Last question — what's the boundary between your team and the pure quant/algo team?

**Candidate:** They own the algorithms — the parent-child slicing logic, the schedule shapes, the signals. We own the plumbing — how the order gets from the client to the algo, and from the algo to the market, cleanly. When an algo misbehaves and the question is "did our parent even reach the algo container with the right parameters," that's my side. When the question is "why did the algo choose to send now instead of waiting," that's theirs. We overlap on the parameter surface — the strategy ID field, the routing alias, the desk field, the portfolio field. Any change there needs both teams.

**Interviewer:** Good. Thanks — this was helpful.

**Candidate:** Appreciate it. Happy to go deeper on any of it if the next round wants.

**Debrief:** The interviewer's real question was "is this candidate an operator or an engineer, and can they explain trading systems to a non-trading-systems person?" The candidate scored well on both. The morning-story pivot into a concrete production trace showed they can code and reason about state, not just triage tickets. The "made it worse" answer demonstrated humility and a specific learning — always a green flag. The "sit with a trader" answer showed they treat the desk as a user, not an adversary. Weak point: no metric of impact — no "reduced end-of-day purge failures by X%" or "median time-to-diagnose down to Y minutes." A stronger candidate would have quantified.

---

## Dialogue 2 — Deep Dive on Your Most Recent Nasty Production Incident

**Setup:** Second-round technical with a senior engineer who owns a comparable system at another firm. Hostile-friendly — he will keep asking "and then what" until the candidate either hits bedrock or shows a gap. 45 minutes.
**Duration:** ~45 min

**Interviewer:** Pick your worst incident from the last six months. Not the one that was easiest to explain — the nastiest one. Give me the whole thing.

**Candidate:** OK. This one shipped a silent truncation bug through a UI-driven configuration file, and I want to be upfront that the root cause was in code I'd written and reviewed, so this is a "how I found my own mistake" story. It's a checkbox tag on a multi-strategy cross-order form. The tag identifies whether the cross was an internalization type — call it a pre/post-book cross — and the value is a fixed identifier string. On the form it's a checkbox: if checked, we emit the identifier as the value of the tag. If unchecked, we don't emit the tag at all.

**Interviewer:** What language is the form defined in?

**Candidate:** It's an XML-based description language for algorithmic trading order forms — an industry standard for defining strategy parameters — that renders into a native widget on the trader's blotter. The definition maps checkbox states to output tag values.

**Interviewer:** OK, keep going.

**Candidate:** The desk reported that the cross was rejecting downstream because the value of that tag was arriving truncated. The full value is longer than fifteen characters. What was arriving on the wire was the first fifteen characters. Nothing on our side logged an error. The form looked fine. The trader could tick and un-tick the box.

**Interviewer:** How did you know it was fifteen characters?

**Candidate:** The trader forwarded the reject message from the downstream side. Their side complained about an unknown value in that tag position. When I looked at the outbound FIX log on our side, the value ended mid-word at exactly fifteen characters. That was the first "huh" — because the constant string we intended to send is defined in the form as a longer value, and I could see the longer value in the XML.

**Interviewer:** Did you check the FIX layer first? Sometimes truncation is at the wire encoding.

**Candidate:** Yes, ruled that out immediately. The tag value we send for other similar tags with longer values goes through fine, so it's not the FIX serializer or the session config. So the truncation had to be upstream of the wire — inside the form parameter handling.

**Interviewer:** OK. What did you do next?

**Candidate:** I looked at the widget class that backs the checkbox. Our form parser instantiates one class per widget type — a text-field class for free-form text, a checkbox class for booleans, a dropdown class for enums, and so on. The checkbox class had an internal buffer for the "value when checked" string. That buffer was declared as a fixed-size char array of size sixteen. Fifteen characters plus a null terminator.

**Interviewer:** Why sixteen?

**Candidate:** Because — and this is the sin — years ago when the class was written, every use of a checkbox tag was for a short enumerated value. Y/N, 0/1, three-letter codes. Sixteen felt like plenty. No one revisited it when someone else added a use case with a longer value.

**Interviewer:** Compiler warning?

**Candidate:** No. The assignment path uses a bounded string copy that silently truncates rather than a checked one. And the parser fed the widget the value character by character with no length assertion. So the truncation was silent all the way through — parser, widget, form state, outbound wire.

**Interviewer:** How did you actually pinpoint the buffer size?

**Candidate:** I searched the widget header file for the fixed-size array declaration. Once I saw `char[16]` at the top of the class, the fifteen-character symptom clicked. Then I confirmed by writing a tiny test — a form that sends a twenty-character checkbox value — and saw it come out at fifteen. Reproduced deterministically in the test rig.

**Interviewer:** Interesting. The form definition — didn't it have a max-length attribute?

**Candidate:** Yes, and here's the trap. The standard supports a max-length attribute on parameters. But max-length only takes effect on the text-field widget, where the widget actively enforces it against user input. The checkbox widget ignores max-length because there's no user input to bound — the value is fixed by the form definition. So even if we'd set max-length on the parameter, it wouldn't have widened the internal buffer, because that buffer isn't sized from the parameter's max-length; it's a compile-time constant.

**Interviewer:** So max-length is a red herring for this widget type.

**Candidate:** Correct, and that surprised me because on the text-field side I'd internalized max-length as "the thing that governs buffer sizing." On the checkbox side it doesn't.

**Interviewer:** How did you decide on a fix?

**Candidate:** Two options. Option one, widen the buffer in the widget class from sixteen to sixty-four. Cheap, no schema changes, small blast radius but touches core widget code that every checkbox in every form goes through, so I'd need to prove no downstream code assumed a specific size. Option two, sidestep the widget entirely by redefining the parameter to use a constant-value plus a state-rule pattern instead of a checkbox — where the constant string lives outside the checkbox widget and the state-rule flips its inclusion on the boolean. Local change, doesn't touch shared code, but slightly ugly at the form level.

**Interviewer:** Which did you ship?

**Candidate:** Both, in sequence. Short-term I shipped option two — the local form-level workaround — because it was a one-file, one-form change and could go through the fast lane on the same day. The desk needed the cross flow working for the next session. Then behind it I opened a longer-cycle change for option one — widening the buffer to sixty-four in the widget class, with a code search to identify every caller and every downstream consumer, and a compile-time static assertion that the "value when checked" string fits in the buffer so this can't silently truncate again.

**Interviewer:** Any concern about widening the buffer everywhere?

**Candidate:** Yes. The class is used in a form that gets shipped as part of the trader UI, which is memory-sensitive when a trader has hundreds of orders open. Going from sixteen to sixty-four is forty-eight extra bytes per checkbox per order. With a few hundred orders and a few checkboxes per form, we're talking tens of kilobytes at worst — well within noise. But I still walked through the object graph to be sure.

**Interviewer:** How did the truncation get past pre-production testing?

**Candidate:** Because our UAT test cases for that form used the short values from the original enumerated set — Y, N, and so on. The longer value was only introduced when we added the new cross type, and the test author added a functional test for "the tag comes out when the box is checked" but didn't assert on the *value*, only on the presence. So the tag was present in the test, just with a truncated value that no assertion checked.

**Interviewer:** That's the real bug.

**Candidate:** Agreed. And the fix I care about most, longer-term, is the test-writing convention that says every tag-value assertion has to check the value bit-for-bit, not just presence. I wrote that up as a proposal and it went into our team's test guidelines.

**Interviewer:** What about detection? If this happens again with a different tag, how do you catch it before the desk does?

**Candidate:** We now have an outbound-message linter that runs on every promoted release against a corpus of canonical orders. It compares expected tag values from the form definition against actual outbound tag values on a test session. Any silent truncation, any dropped tag, any value mismatch fails the promotion. It doesn't catch every bug but it catches this class of bug.

**Interviewer:** Did anyone lose money?

**Candidate:** Small — the crosses were rejecting outright, not filling wrong, so it was an availability incident not a correctness incident in the trading sense. The desk had to route those orders through an alternate flow for about ninety minutes. That's the number that goes into the write-up.

**Interviewer:** What would you have done differently in the original design?

**Candidate:** Two things. One — never fixed-size buffers for values that come from configuration. Either allocate from the config string's length, or size the buffer from a constant that's asserted against the source at compile time. Two — every widget class should have a single method that emits its outbound value, and that method should assert length-preservation. If those two conventions had been in place, this bug couldn't have happened.

**Interviewer:** How did you communicate this to the desk during the incident?

**Candidate:** First message inside five minutes of confirming the diagnosis: "We've reproduced the truncation. It's inside our form widget, not the wire. Workaround at trader level is [route via alternate flow]. ETA on fix is same day for the local workaround, plus a broader fix landing next release." Then updates every fifteen minutes with either progress or "no change." The desk cares about two things — is it fixed, and what do I do right now — so every update answered both.

**Interviewer:** Post-mortem?

**Candidate:** Yes. Written up, circulated to the two adjacent teams, and the "assert value not just presence" and "no fixed-size buffers for config-driven values" points went into our shared coding guidelines. I also went and audited the other widget classes for the same pattern. Found two more fixed-size buffers of the same era, neither actively bitten but both time bombs. Filed follow-ups.

**Interviewer:** How's your relationship with the person who originally wrote that widget class?

**Candidate:** They left before I joined. But the point I made in the post-mortem was that the original author made a reasonable decision for the requirements they had. What went wrong was that when we extended the use case, no one revisited the invariants. That's a team-level failure, not a person-level one.

**Interviewer:** Good answer. Last one — if I gave you a similar codebase tomorrow and said "find the next bug like this before it bites," how would you do it?

**Candidate:** Static grep for fixed-size character arrays in configuration-adjacent code paths, especially in widget and message-serialization code. Cross-reference against uses that read from external configuration or form definitions. For each hit, walk the assignment path and confirm either (a) the source is bounded by construction, or (b) there's an explicit length check. Anything that's neither goes on a remediation list, sorted by blast radius. It's a two-day job for a codebase this size and it's the kind of hygiene that's easy to justify after an incident and impossible to justify before one — which is why I'd do it now while the memory is fresh.

**Interviewer:** Very good. Thanks.

**Debrief:** The interviewer was probing three things. One: does the candidate actually understand what happened, or are they narrating from a runbook? The specificity — buffer size, why max-length doesn't apply to checkboxes, the bounded-copy behavior — closed that out. Two: do they understand the *class* of bug, not just the instance? The "audited other widget classes and found two more time bombs" and the coding-guideline changes hit that. Three: how do they handle the meta-questions — communication, test coverage, blame? The candidate handled all three cleanly, especially framing the original author's decision as reasonable-in-context. Only real gap: the incident dollar impact was fuzzy — "small" isn't a number. In a real interview at a bank the follow-up would be "give me an order of magnitude on notional at risk during the ninety minutes."

---

## Dialogue 3 — Whiteboard the Architecture of Your OMS

**Setup:** Third-round technical with a principal engineer. Whiteboard exercise. She's less interested in a pretty diagram than in whether the candidate can defend design choices under questioning. 30 minutes.
**Duration:** ~30 min

**Interviewer:** Draw me the wire path of an order through your OMS. Start at the client, end at the venue. Include everything an order touches.

**Candidate:** OK. Let me lay it out horizontally. On the far left, client — that's whatever originating system the order came from, either an internal blotter or an external customer over a FIX session. Order comes in over a FIX gateway — call it the inbound session layer. That layer terminates the session, does basic session-level acking, and hands the parsed message off to an inbound transformation module. That module does a bunch of things — routing based on connection identity, tag suppression for tags we don't want propagated, remapping of aliased routing identifiers into internal counterparty IDs, and splitting of compound identifier fields where a single incoming field carries multiple semantics that we handle separately internally.

**Interviewer:** What language is that module in?

**Candidate:** It's scripted. Not compiled — it's loaded at startup and hot-reloadable during a maintenance window without restarting the FIX engine. That's deliberate: we want to be able to change routing behavior without a full deploy.

**Interviewer:** Continue.

**Candidate:** After inbound transformation, the message enters the core order manager. This is the stateful heart — orders are objects here, with a lifecycle. Every order transition — new, replace, cancel, fill, done — is an event. Every event triggers the rule engine on the "client-side hook" — meaning rules that see the message as it arrived from the client and can act before the order goes to street. Rules are event-driven and written in a domain-specific rule language, then compiled to a shared object that the OMS loads at startup.

**Interviewer:** Compiled from what?

**Candidate:** Source is a rule file — declarative, event-and-condition based. There's a rule-builder tool that reads the rule files and generates the compilable output. Then the linker produces the shared object. The OMS loads that at startup and dispatches events into it.

**Interviewer:** Why not just write the rules directly in C++?

**Candidate:** Because rules change often — new tag mappings, new venue quirks, new compliance requirements — and rules are written and reviewed by people who aren't necessarily C++ engineers. The DSL is narrower, safer, easier to review, and prevents whole classes of foot-gun. The cost is another layer to debug, but the tradeoff is clearly worth it at our team size and change rate.

**Interviewer:** Keep going with the flow.

**Candidate:** After the client-side rules fire, the order is either handed to an internal algorithm container — for algo orders — or routed toward the street. Either way, when it's ready to leave, it triggers another rule engine pass on the "street-side hook." Those rules do things like commission overrides, routing alias to counterparty resolution, adding compliance-related suffixes to identifiers, populating event timestamps. Then the message goes through the outbound transformation module — same scripted layer, but on the outbound side — which does its own tag transformations, and finally out through the outbound FIX gateway to the venue or DMA broker.

**Interviewer:** You have two transformation layers, both scripted. Why not one?

**Candidate:** Because the inbound layer runs before the order exists as a stateful object — its job is to make the message digestible for the core. The outbound layer runs after the core has decided what to send and needs to reshape it for the destination. Different concerns, different available state. Merging them would either lose access to order state in one direction or duplicate the state everywhere. Also, the inbound layer needs to be defensive against malformed input; the outbound layer trusts the core.

**Interviewer:** OK. Where does the rule engine's state live?

**Candidate:** State that survives across events lives in the order object in the core. Rules don't hold state themselves — they read and write order fields, and the order is what persists. There's a separate slower store for anything that needs to survive process restart, but the hot path is all in-memory.

**Interviewer:** What survives restart?

**Candidate:** Open orders, their fills so far, their working state on venues. On restart the OMS reads that back and rebuilds the in-memory picture. Historical data — completed orders, closed sessions — goes to a longer-term store for reporting and doesn't need to be resident.

**Interviewer:** How do you handle the region split?

**Candidate:** Three separate instances of the whole stack — one per region. An environment variable at startup tells the process which region it's in, and that gates region-specific behavior: which venue connections come up, which compliance rules apply, which trading calendar is active. Regions don't talk directly. When there's a genuinely cross-regional flow, one region routes the order across via a specific counterparty session, and to the receiving region it just looks like another client. Simple, robust, but it means we can't naturally handle a truly follow-the-sun order that changes regional home mid-life — those are handled by convention with human intervention.

**Interviewer:** What connection types does the OMS support?

**Candidate:** Several. The main one is the order-manager-to-client session for taking orders in. Then there's a separate session type for order-execution reports out. Then there's a market-data-in session, and a depth-of-book session, and a bars session for aggregated pricing, and a session for post-trade booking, and one for entitlements. Each has its own class and connection lifecycle. They're separated because they have different reliability characteristics, different message rates, and different failure semantics. Losing market data isn't the same emergency as losing the order session.

**Interviewer:** How are they instantiated? Static or dynamic?

**Candidate:** Configured at startup from a config file that lists which sessions to bring up, with what counterparty settings. Once up they stay up until shutdown or explicit action. Reconnection on drop is automatic with backoff.

**Interviewer:** Draw the failure story. What breaks first, what breaks worst?

**Candidate:** First-to-break is usually a venue-side session — DMA broker cycling their gateway, market volatility triggering their session-level throttles. That's handled by reconnect logic and by the fact that we don't lose orders — they sit in the core with a working state marked as "gateway down" and we resume when it comes back. Second failure class is a rule bug — a bad rule sends a malformed message to a venue, or fires on the wrong event. That's what the rule engine's constrained DSL is supposed to make unlikely, and mostly does. Worst-to-break is a data corruption in the core order state — an inconsistent order, a merge that half-completed, a lifecycle transition that fired twice. Those are rare but ugly, because the core is trusted downstream and by the time anyone notices, the bad state has been propagated.

**Interviewer:** How do you detect that last class?

**Candidate:** Invariants on the order object, checked at every state transition. If an invariant fails we log loudly and refuse the transition. That doesn't prevent the invariant being wrong — sometimes the invariant is the bug — but it catches most of the mechanical corruptions.

**Interviewer:** Give me an example of an invariant.

**Candidate:** An order's filled quantity can never exceed its order quantity. A cancelled order can never receive further fills. A merged parent order's aggregate must equal the sum of its constituents. Those kinds. Some are cheap, some are expensive to check on every transition, and there's a debug mode that turns on the expensive ones during testing and off in production.

**Interviewer:** Talk to me about the end-of-day purge. That's usually where I find bugs in an OMS.

**Candidate:** Correct, and we have plenty. Purge is a walk over every order in the store, asking two questions: is this order still active, and is it purgeable. "Still active" is straightforward — is its terminal state reached or not. "Purgeable" is where the sharp edges are. Baskets keep every member alive if any single member is still active. Time-in-force types like good-till-cancel and good-till-date roll over rather than purge. Anything pending — a late-trade correction waiting to be applied, an unbooked fill, an open child that hasn't reported terminal, a booking that hasn't fully confirmed — blocks purge. The design is conservative: err on the side of keeping alive. The cost is that stuck-state orders can accumulate; the benefit is we never accidentally kill a working order.

**Interviewer:** Where would you improve this architecture if you had a year?

**Candidate:** Two areas. First, the rule engine — right now rules are compiled and loaded at startup; you can't deploy a rule change without a restart on that region. The rule-language itself is fine but the deployment loop is slow. I'd invest in either hot-reload of rule shared objects with signal-safe swap-in, or in migrating a subset of rules to an interpreted form that can be redeployed live. Second, the region split is very static — three instances, three configs, effectively three deployments. I'd invest in unifying more of the config and letting the region variable drive behavior at runtime rather than at build. Reduces the ways we can drift across regions.

**Interviewer:** What wouldn't you touch?

**Candidate:** The core order model. It's decades old, well-understood, and every attempt I've seen to modernize it in similar systems has produced a subtly-different-and-therefore-broken replacement. The interfaces are stable, the invariants are stable, and adding a field is cheap. It's boring and I mean that as a compliment.

**Interviewer:** Good answer.

**Candidate:** Thanks.

**Interviewer:** One more. Where's the biggest risk that would keep me up at night?

**Candidate:** The transformation layer being scripted and hot-reloadable is a double-edged sword. It's flexible, which we need. But a bad script change deployed at the wrong moment can misroute an order stream in a way that a compiled system with strong typing would catch. We mitigate with review, but honestly the mitigation is "we're careful." If I wanted to sleep better, I'd add a schema-and-type check to the script loader that runs on load and refuses to load a script whose outputs don't match a declared contract with the core.

**Interviewer:** Good. That's what I'd have said too.

**Debrief:** The interviewer was checking for three things. One, can the candidate hold the whole system in their head, or do they only know their local corner. The tour from client through core to venue was fluent enough to answer that. Two, can they defend design decisions when pushed — the "why two transformation layers" and "why scripted DSL not C++" questions were the trap, and the candidate did not fall for either. Three, do they understand the *risk surface* of the system. The "what would keep me up at night" answer landed because it identified a real, specific weakness rather than a generic one, and paired it with a concrete mitigation. Strongest moment: "the core order model — I wouldn't touch it, it's boring and I mean that as a compliment." That's the mark of someone who's been burned by a well-intentioned rewrite and knows what stability is worth. Weakest moment: the failure story could have been more specific about detection latencies — "how long from bad state to detection" is the metric that matters, and the candidate gestured at it without naming it.
