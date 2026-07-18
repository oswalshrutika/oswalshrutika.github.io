# 05 — Red Flags: Things a Candidate Must Not Say

## Contents
1. [Why this matters](#why-this-matters)
2. [The 15 red flags](#the-15-red-flags)
3. [Meta-patterns to internalize](#meta-patterns-to-internalize)

---

## Why this matters

Production support interviewers at banks and trading firms are not just probing for technical depth — they are screening for **judgment, ownership, and controls-consciousness**. A single sentence that signals cowboy behavior, blame-shifting, or unawareness of change control can end a loop, even if every other answer was strong. What follows are 15 statements I have heard peers say in interviews (or almost say) that torpedoed the conversation, with the reframe that keeps the same story intact but shows maturity.

---

## The 15 red flags

### RF1. "I blame the vendor."
**Why it's a red flag:** Signals you outsource your thinking. Support engineers on OMS platforms are the escalation buffer — if you punt to the vendor, the desk sits blind. Interviewers hear "this person will file a ticket and wait" instead of "this person will triage, isolate, and hand the vendor a reproducible case."
**What to say instead:** "I isolated the failure to the vendor's matching engine by reproducing it in UAT with a stripped-down FIX log, then handed our vendor core team a minimal repro and stack trace. In parallel I applied a client-side workaround so the desk could keep trading while the vendor patched."

---

### RF2. "I bypassed change control because it was urgent."
**Why it's a red flag:** Change control exists precisely for urgent moments. Bypassing it in an audited environment is a compliance event, not a war story. Interviewers at regulated firms will flag this to the hiring manager.
**What to say instead:** "It was urgent, so I invoked the emergency change process — paged the on-call CAB approver, filed the retro-CR within the SLA window, and captured the diff and rollback in the ticket before the change went in."

---

### RF3. "I didn't tell anyone until it was fixed."
**Why it's a red flag:** Silent heroism is the opposite of what a trading floor needs. The desk, compliance, and downstream systems need to know an incident is in flight so they can gate their own actions. Hiding a live incident is a career-limiting move.
**What to say instead:** "The moment I confirmed impact, I opened the incident bridge and posted a one-liner to the trader chat: symptom, blast radius, ETA to next update. I gave updates every 15 minutes even when there was no news, because silence on a trading floor is worse than bad news."

---

### RF4. "I killed the process without checking who owned it."
**Why it's a red flag:** On a shared OMS box, killing an unknown PID can drop live orders, break a session mid-message, or take down a downstream drop-copy consumer. Interviewers hear "this person will cause the next Sev-1."
**What to say instead:** "Before killing anything I checked the process owner, the parent, and what FIX sessions or DB connections it held. I confirmed with the session owner on chat, drained gracefully where possible, and only force-killed after the drain window expired."

---

### RF5. "I merged the code without a review because prod was down."
**Why it's a red flag:** Same family as bypassing change control. Even a one-line hotfix needs a second pair of eyes — the graveyard of trading outages is full of one-line fixes that made things worse. "Prod was down" is a reason to move fast on process, not to skip it.
**What to say instead:** "Prod was down, so I paired with another support engineer over screen-share — they reviewed the one-line fix in real time while I prepped the rollback. We had a reviewed commit inside three minutes and a documented back-out plan before deploy."

---

### RF6. "I told the trader the number was wrong but couldn't explain why."
**Why it's a red flag:** Traders act on numbers. Telling a trader a P&L or position figure is wrong without a defensible reason invites them to either ignore you or panic-flatten a book. Either outcome is bad, and both are your fault.
**What to say instead:** "I told the trader the number looked off and gave them the specific reason — a missed drop-copy for the 09:32 fill on ticker X — plus the corrected figure and the timestamp I'd have full reconciliation. I never ask a trader to trust a claim without the underlying evidence."

---

### RF7. "I would have escalated but my manager was in a meeting so I made the call alone."
**Why it's a red flag:** Escalation paths in banks are multi-level for a reason. If your manager is unreachable, you go to their backup, the on-call lead, or the desk head — never "I decided alone." This answer says you don't know the escalation matrix.
**What to say instead:** "My manager was in a meeting, so I followed the escalation matrix — paged the secondary on-call lead, looped in the desk supervisor, and documented my recommendation in the bridge so the decision was made with three sets of eyes even though my direct manager wasn't in the room."

---

### RF8. "The compliance rule was slowing us down so I disabled it temporarily."
**Why it's a red flag:** Instant disqualifier at any regulated firm. Compliance rules — pre-trade checks, restricted lists, cross-limits — are not performance features. Disabling one, even for a minute, is a regulatory reportable event.
**What to say instead:** "The compliance check was adding latency on the critical path, so I raised it with the compliance officer and the risk team, ran a controlled measurement in UAT, and we agreed on a caching strategy that preserved the check semantics while cutting the latency. The rule stayed on the whole time."

---

### RF9. "I always work overtime to make up for delays."
**Why it's a red flag:** Sounds humble but reads as "I plan badly and cover it with hours." Banks have burned-out support engineers already — they want someone who scopes, prioritizes, and pushes back, not someone who silently absorbs slippage.
**What to say instead:** "When a delay is real I raise it early with a revised estimate and a re-prioritization proposal. I'll pull a late night when the desk genuinely needs it — a go-live weekend, an incident tail — but I don't use overtime to paper over planning gaps."

---

### RF10. "I never make mistakes in prod."
**Why it's a red flag:** Nobody with five years of production support has a clean record. This answer signals either dishonesty or lack of self-awareness — both fatal for a role where post-mortems and blameless retros are core rituals.
**What to say instead:** "I've made prod mistakes — the one I still think about is when I ran a purge script against the wrong environment config and dropped a batch of parked orders in UAT. I wrote up the RCA, added a pre-flight environment check to the script, and the pattern is now standard across the team's utilities."

---

### RF11. "That was the DBA's problem not mine."
**Why it's a red flag:** On a trading floor, "not my problem" is the phrase that ends careers. The desk doesn't care whose problem it is — they care that their orders are working. Interviewers use this exact framing to test ownership.
**What to say instead:** "The root cause was on the DBA side — a stats job locking the orders table during the London open — but I owned the coordination. I paged the DBA on-call, gave them the query plan and the lock trace, and I stayed on the bridge until the desk was trading cleanly again."

---

### RF12. "The developer wrote bad code so we had to hotfix."
**Why it's a red flag:** Publicly blaming a named function (or by extension a named colleague) shows you'll do the same in a real post-mortem. Blameless culture is table stakes at mature firms — this line marks you as someone who'll poison retros.
**What to say instead:** "The change had a defect that our pre-prod gates didn't catch. In the retro we agreed the gap was in our test coverage for the FIX rejection path, not in the individual — we added the missing scenario to the regression suite, and I owned wiring it into the pre-release checklist."

---

### RF13. "I don't have any conflicts on my team."
**Why it's a red flag:** Reads as "I don't push back, I don't have opinions, I don't engage." Support work is full of legitimate conflict — priorities between desks, timing of a fix versus a rollback, whether to bounce a session mid-day. Zero conflict means zero contribution.
**What to say instead:** "We disagree regularly — most recently on whether to hot-patch a matching-engine bug during market hours or wait for the weekend. I argued for waiting and documented the exposure so the desk could make an informed call. We waited, patched cleanly, and the retro validated the trade-off."

---

### RF14. "I don't have failure stories, everything I've owned has been a success."
**Why it's a red flag:** Same family as RF10, but worse — it explicitly refuses the question. Interviewers ask for failure stories to see how you metabolize them. No failure = no learning = no growth trajectory.
**What to say instead:** "The one that taught me the most was a migration where I underestimated the FIX session cutover window — we exceeded the maintenance window by 40 minutes and the desk in Asia opened late. I ran the RCA, we rebuilt the cutover runbook with hard time-boxed checkpoints, and the next three migrations all landed inside their windows."

---

### RF15. "It wasn't my responsibility so I let it burn."
**Why it's a red flag:** The single most disqualifying line on this page. On a trading floor, letting something burn because it's not your box is a firing offense. Interviewers include this framing specifically to catch the candidates who think support has a scope boundary during an incident.
**What to say instead:** "It wasn't formally my system, but I was the one who noticed, so I owned the initial triage — captured the symptom, paged the right team, and stayed on the bridge until the primary owner picked it up cleanly. On a trading floor, the person who sees it first owns the coordination until they've handed it off."

---

## Meta-patterns to internalize

Look at the fifteen reframes side by side and the same five instincts show up:

1. **Ownership over scope** — I saw it, so I owned the coordination, even if I didn't own the box.
2. **Communicate early, communicate often** — silence during an incident is worse than partial information.
3. **Follow the process, especially when it's urgent** — emergency change, escalation matrix, blameless retro. The process is faster than improvising in a regulated environment.
4. **Evidence, not assertions** — never tell a trader "the number is wrong" or a peer "your code is bad" without the specific timestamp, log line, or trace to back it.
5. **Failure is a story about the fix, not the fault** — every mistake becomes a checklist item, a new test, or a pre-flight check. That's the arc interviewers listen for.

If every answer you give lands on at least one of these five, none of the fifteen red flags will slip out.
