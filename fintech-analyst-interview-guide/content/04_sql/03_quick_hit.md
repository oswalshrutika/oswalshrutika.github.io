# SQL Quick-Hit Q&A — 25 Memorization-Ready

## Contents
- Q1–Q5: Joins & set operators
- Q6–Q10: Window functions & ranking
- Q11–Q14: NULL handling & predicates
- Q15–Q18: Subqueries, CTEs, EXISTS
- Q19–Q22: Transactions, isolation, locking
- Q23–Q25: Performance, indexes, plan reading

---

### Q1. What is the difference between LEFT JOIN and INNER JOIN?
**Interviewer signal:** does the candidate know join semantics cold — this is table stakes for anyone querying an OMS trade store.
**Answer:**
An INNER JOIN returns only rows where the join predicate matches on both sides. A LEFT JOIN returns every row from the left table and NULLs on the right where the predicate fails. In OMS work I use LEFT JOIN constantly — for example, orders LEFT JOIN executions to see unfilled orders, where an INNER JOIN would silently hide them. The subtle trap is putting a right-side filter in the WHERE clause of a LEFT JOIN; the moment you write `WHERE e.status = 'FILLED'`, you have converted the LEFT JOIN back into an INNER JOIN because NULLs fail the predicate. Push right-side filters into the ON clause to preserve the outer semantics.
**Watch-outs:** saying "LEFT JOIN is slower" — the optimizer picks the plan; the semantic difference is what matters.

---

### Q2. INNER JOIN vs CROSS JOIN vs FULL OUTER JOIN — one-line each.
**Interviewer signal:** vocabulary check; do you know the full join family.
**Answer:**
INNER = intersection on predicate. CROSS = Cartesian product, every left row paired with every right row, no predicate. FULL OUTER = union of LEFT and RIGHT outer — every unmatched row from either side is kept with NULLs on the missing side. CROSS JOIN is legitimate when generating date spines or expanding permutations; FULL OUTER is common in reconciliation queries where I compare our OMS book against a broker's fill file and want to see rows missing on either side.
**Watch-outs:** conflating CROSS JOIN with a bug — it is a tool, not always an accident.

---

### Q3. If a LEFT JOIN produces duplicates, what happened?
**Interviewer signal:** debugging instinct — most "why is my report doubled?" tickets are here.
**Answer:**
The right-side table has multiple rows matching a single left key. Classic case in OMS: joining orders to executions where one order has ten partial fills — the order row is duplicated ten times. Fix depends on intent. If you want one row per order, aggregate the right side first in a subquery or CTE (`SUM(qty)`, `MAX(exec_time)`), then join. If you want the latest fill only, use `ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY exec_time DESC)` and filter to rn=1. Never use SELECT DISTINCT to paper over the duplication — it hides the cardinality bug and destroys performance on large tables.
**Watch-outs:** reaching for DISTINCT instead of understanding the grain.

---

### Q4. UNION vs UNION ALL — when to use which?
**Interviewer signal:** do you know that UNION is expensive by default.
**Answer:**
UNION concatenates result sets and then performs a distinct sort to remove duplicates. UNION ALL concatenates and returns everything, duplicates included. UNION ALL is dramatically faster because it skips the sort and dedupe. My default is UNION ALL unless I have a specific reason to dedupe. For instance, when I stitch together today's live executions from the OMS with yesterday's settled trades from the warehouse, the two sources are disjoint by design, so UNION ALL is correct and cheap. Reach for UNION only when the sets genuinely overlap and duplicates would be wrong.
**Watch-outs:** using UNION by habit on a million-row query and paying the sort cost for nothing.

---

### Q5. What does an anti-join look like and when do you use one?
**Interviewer signal:** can you express "rows in A not in B" idiomatically.
**Answer:**
An anti-join returns rows from the left side that have no match on the right. Two common shapes: `WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.id = a.id)` or `LEFT JOIN b ON ... WHERE b.id IS NULL`. Prefer NOT EXISTS — it is null-safe and typically optimizes to the same plan as the LEFT JOIN / IS NULL pattern. Avoid `NOT IN` when the right-side column is nullable, because a single NULL on the right causes NOT IN to return zero rows silently. I use anti-joins to find orders in our OMS that never made it to the broker's ack file — a daily production check.
**Watch-outs:** using `NOT IN` on a nullable column and wondering why the query returns nothing.

---

### Q6. ROW_NUMBER vs RANK vs DENSE_RANK.
**Interviewer signal:** window function fluency — required for anything reporting- or analytics-adjacent.
**Answer:**
All three assign a number within a partition ordered by some key. ROW_NUMBER assigns 1, 2, 3, 4 with no ties — even equal ORDER BY values get distinct numbers, non-deterministically unless you add a tiebreaker. RANK assigns the same number to ties and then skips: 1, 2, 2, 4. DENSE_RANK assigns the same number to ties but does not skip: 1, 2, 2, 3. I use ROW_NUMBER for "latest fill per order" or "first execution per basket" — deduplication patterns. RANK and DENSE_RANK are for reporting when the business genuinely wants tied positions, like top-5 traders by PnL where two are tied at #2.
**Watch-outs:** using ROW_NUMBER without a stable tiebreaker in ORDER BY and getting non-deterministic results across runs.

---

### Q7. Give a concrete ROW_NUMBER example — latest execution per order.
**Interviewer signal:** can you write it, not just describe it.
**Answer:**
```sql
WITH ranked AS (
  SELECT
    order_id,
    exec_id,
    exec_qty,
    exec_time,
    ROW_NUMBER() OVER (
      PARTITION BY order_id
      ORDER BY exec_time DESC, exec_id DESC
    ) AS rn
  FROM executions
  WHERE exec_date = CURRENT_DATE
)
SELECT order_id, exec_id, exec_qty, exec_time
FROM ranked
WHERE rn = 1;
```
The `exec_id DESC` tiebreaker matters — two fills can share a millisecond timestamp in a high-throughput OMS.
**Watch-outs:** forgetting the tiebreaker; forgetting that PARTITION BY resets the counter per group.

---

### Q8. What is a window function frame and when does it matter?
**Interviewer signal:** deep-cut question; separates people who use windows from people who understand them.
**Answer:**
A frame is the subset of rows within a partition that an aggregate window function sees for each row. The default frame for aggregates with ORDER BY is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which produces a running total. Without ORDER BY, the frame is the entire partition. You override with `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` for, say, a 7-day rolling volume. Frames do not apply to ranking functions like ROW_NUMBER — those ignore any frame clause. In OMS reporting I use ROWS-based frames for moving averages of order flow and unbounded frames for cumulative fill quantity.
**Watch-outs:** assuming SUM() OVER (ORDER BY x) sums the whole partition — it does not, it accumulates.

---

### Q9. LAG and LEAD — what problem do they solve?
**Interviewer signal:** familiarity with row-to-row analysis without self-joins.
**Answer:**
LAG(col, n) returns the value of `col` from n rows earlier in the ordered partition; LEAD is symmetric forward. They eliminate the classic self-join-on-offset pattern. Example: for each execution, compute time since the previous fill on the same order — `exec_time - LAG(exec_time) OVER (PARTITION BY order_id ORDER BY exec_time)`. Or detect status transitions by comparing `status` to `LAG(status)`. Both accept a default value for the boundary row where no prior/next exists.
**Watch-outs:** forgetting PARTITION BY and getting values from the wrong order.

---

### Q10. Can you filter on a window function in the WHERE clause?
**Interviewer signal:** understanding of logical query processing order.
**Answer:**
No. Window functions are evaluated after WHERE, GROUP BY, and HAVING but before ORDER BY and the final SELECT. You cannot reference `ROW_NUMBER() OVER (...)` in WHERE because it does not exist yet. Wrap the query in a CTE or subquery and filter on the alias in the outer query. This is the single most common window-function mistake I see in code reviews.
**Watch-outs:** trying `WHERE ROW_NUMBER() OVER (...) = 1` and getting a syntax error.

---

### Q11. ISNULL vs COALESCE — what is the difference?
**Interviewer signal:** vendor-portability awareness; SQL Server vs ANSI SQL.
**Answer:**
COALESCE is ANSI standard, takes any number of arguments, and returns the first non-NULL. ISNULL is SQL Server proprietary, takes exactly two arguments. Beyond arity, three real differences matter. First, COALESCE's return type is the highest-precedence type among all arguments; ISNULL's return type is the type of the first argument, which can silently truncate — `ISNULL(CAST('abc' AS VARCHAR(3)), 'abcdef')` returns 'abc'. Second, COALESCE with a subquery may evaluate the subquery multiple times because it expands to a CASE expression; ISNULL evaluates once. Third, ISNULL is generally microseconds faster on SQL Server for the two-arg case. I default to COALESCE for portability across the OMS's SQL Server and the downstream Oracle warehouse.
**Watch-outs:** claiming they are identical — the type-precedence and multiple-evaluation gotchas are real.

---

### Q12. Why does `WHERE col = NULL` return no rows?
**Interviewer signal:** three-valued logic understanding.
**Answer:**
SQL uses three-valued logic: TRUE, FALSE, UNKNOWN. Any comparison with NULL yields UNKNOWN, and WHERE only keeps rows where the predicate is TRUE. So `col = NULL` is always UNKNOWN and filters everything out. Use `col IS NULL` — the IS operator is the only null-aware comparison. Same trap in joins and CHECK constraints. In OMS ticket triage, a broken predicate like `WHERE cancel_reason = @reason` silently drops rows when `@reason` is NULL — the fix is `WHERE cancel_reason = @reason OR (cancel_reason IS NULL AND @reason IS NULL)` or use `IS NOT DISTINCT FROM` where supported.
**Watch-outs:** forgetting NULL in NOT IN — `col NOT IN (1, 2, NULL)` returns no rows ever.

---

### Q13. What does NULLIF do and when is it useful?
**Interviewer signal:** breadth check on null-handling functions.
**Answer:**
`NULLIF(a, b)` returns NULL if a equals b, otherwise returns a. It is the inverse of COALESCE. The classic use is guarding against divide-by-zero: `SELECT total_fill_qty / NULLIF(order_qty, 0)` returns NULL instead of raising a division error when order_qty is zero. I also use it to normalize sentinel values — a legacy OMS column stores '' for unknown, so `NULLIF(field, '')` converts empties to real NULLs before downstream aggregation.
**Watch-outs:** none major — but combining NULLIF with COALESCE elegantly handles both zero-and-null cases.

---

### Q14. What is the difference between COUNT(*), COUNT(1), and COUNT(col)?
**Interviewer signal:** myth-busting — the "COUNT(1) is faster" folklore.
**Answer:**
COUNT(*) and COUNT(1) are identical in every mainstream engine — both count rows regardless of NULLs, and the optimizer treats them the same. There is no performance difference. COUNT(col) counts non-NULL values of that column, so it can return a smaller number. Practical impact: `COUNT(*)` says "how many orders today"; `COUNT(cancel_reason)` says "how many orders had a cancel reason populated". If you want distinct, `COUNT(DISTINCT col)` is a separate, more expensive operation because of the dedupe.
**Watch-outs:** claiming COUNT(1) is faster — that has not been true for two decades.

---

### Q15. What is a correlated subquery and when should you avoid one?
**Interviewer signal:** performance instinct.
**Answer:**
A correlated subquery references a column from the outer query, so it is logically re-evaluated for each outer row. Example: `SELECT o.*, (SELECT MAX(exec_time) FROM executions e WHERE e.order_id = o.order_id) AS last_fill FROM orders o`. On small outer sets it is fine and readable. On large outer sets it can explode — millions of subquery executions. Modern optimizers often rewrite correlated subqueries into joins or apply operators, but not always. My rule: if the outer set has more than a few thousand rows, rewrite as a LEFT JOIN with a GROUP BY, or use a window function. In an OMS reporting query I once cut runtime from 40 seconds to under one by replacing a correlated subquery with `MAX(exec_time) OVER (PARTITION BY order_id)`.
**Watch-outs:** assuming the optimizer will always save you — check the plan.

---

### Q16. EXISTS vs IN — semantic and performance differences.
**Interviewer signal:** null-safety and plan intuition.
**Answer:**
Semantically, `EXISTS (subquery)` is TRUE if the subquery returns any row, ignoring the columns' values. `IN (subquery)` compares the outer value to each returned value. Two practical differences. First, EXISTS is null-safe on the right side; IN is not — a NULL in the IN list contaminates the predicate. Second, EXISTS short-circuits — the engine stops at the first match — which is why it usually wins for existence checks. Use IN for a small literal list; use EXISTS for subquery membership tests, especially against nullable columns. Modern optimizers commonly plan them identically, but the null-safety difference is a correctness issue, not just performance.
**Watch-outs:** conflating IN with a join — `IN` deduplicates matches; a join can multiply rows.

---

### Q17. CTE vs subquery vs temp table — how do you choose?
**Interviewer signal:** engineering judgment on structure and performance.
**Answer:**
A subquery is inline, unnamed, single-use. A CTE (WITH clause) is named, can be referenced multiple times in the same statement, and improves readability — but in most engines it is still inlined and re-evaluated per reference. A temp table is materialized to tempdb, gets its own statistics, and is reused efficiently. My decision tree: use a subquery for simple one-off derivations; use a CTE for readability or recursive queries; use a temp table when the intermediate set is used multiple times, is large enough that stats matter, or when the optimizer keeps picking a bad plan on the inlined version. In OMS batch jobs I materialize the day's order universe into a temp table once and reuse it across a dozen downstream aggregations.
**Watch-outs:** believing CTEs are always faster — in SQL Server they are usually inlined; in Postgres older versions materialized them by default, which was often a pessimization.

---

### Q18. What is a recursive CTE and give one OMS-relevant example.
**Interviewer signal:** hierarchical query fluency.
**Answer:**
A recursive CTE has an anchor member and a recursive member joined by UNION ALL. The recursive member references the CTE itself, and the engine iterates until it produces no new rows. OMS use case: unwinding a basket-parent-child hierarchy. A program order spawns child orders, which spawn further child orders after splits. To fetch every descendant of a parent order:
```sql
WITH RECURSIVE tree AS (
  SELECT order_id, parent_order_id, 0 AS depth
  FROM orders WHERE order_id = @root
  UNION ALL
  SELECT o.order_id, o.parent_order_id, t.depth + 1
  FROM orders o
  JOIN tree t ON o.parent_order_id = t.order_id
)
SELECT * FROM tree;
```
Always cap depth or add a MAXRECURSION hint to guard against cycles from bad data.
**Watch-outs:** infinite recursion on cyclic data — the default MAXRECURSION in SQL Server is 100.

---

### Q19. Explain the standard isolation levels and their tradeoffs.
**Interviewer signal:** trading-firm-critical — concurrency errors cost real money.
**Answer:**
Four ANSI levels, from weakest to strongest:
- **READ UNCOMMITTED** — allows dirty reads; you see uncommitted changes from other transactions. Fastest, least safe. Use for approximate reporting only.
- **READ COMMITTED** — no dirty reads, but non-repeatable reads and phantoms possible. The default in SQL Server and Oracle. Fine for most OLTP.
- **REPEATABLE READ** — same row re-read returns the same value within the transaction, but new rows matching your predicate can still appear (phantoms).
- **SERIALIZABLE** — full isolation; the schedule is equivalent to some serial order. Safest, most locking, most deadlocks.
Additionally, **SNAPSHOT** (SQL Server, Postgres, Oracle) uses row versioning to give each transaction a consistent snapshot without shared locks — big throughput win, but writers can hit update conflicts. In OMS work I run reporting queries at READ COMMITTED SNAPSHOT to avoid blocking the trading path, and I only escalate to SERIALIZABLE for financial correctness paths like position reconciliation.
**Watch-outs:** using SERIALIZABLE by default and creating a deadlock storm.

---

### Q20. What is a deadlock and what causes it?
**Interviewer signal:** production support — every OMS engineer sees deadlocks.
**Answer:**
A deadlock is a cycle in the lock wait graph: transaction A holds lock X and waits for Y; transaction B holds Y and waits for X. The engine detects the cycle and picks a victim to roll back. Common causes I have seen in OMS: two sessions updating orders and executions in opposite order; a long-running reporting query holding shared locks that block writers; an index missing on a foreign-key column, forcing a table scan that grabs range locks. Fixes, in order of preference: acquire locks in a consistent order across code paths, keep transactions short, cover foreign keys with indexes, switch reporting workloads to a snapshot isolation level, and add retry-on-deadlock logic in the application because deadlocks in a busy OMS are a fact of life, not a bug.
**Watch-outs:** confusing deadlock with a plain lock wait — a lock wait resolves; a deadlock requires a victim.

---

### Q21. How do you diagnose a deadlock in production?
**Interviewer signal:** hands-on debugging.
**Answer:**
On SQL Server, capture the deadlock graph — either from the system_health extended event session (always on by default) or via trace flag 1222 writing to the error log. The XML shows both transaction sessions, the resources they held, the resources they waited on, the input SQL, and which one was chosen as victim. Read the graph in this order: identify the two resources in the cycle, note which lock modes are involved (usually X and U or S and X), map the input SQL to the code path, then check the plans for each statement to see whether an index would have avoided the range scan. On Oracle, the alert log records ORA-00060 with a trace file. In all cases, capture the graph immediately — deadlocks disappear from live views the moment they resolve.
**Watch-outs:** trying to reproduce by hand — deadlocks are timing-sensitive; rely on the captured graph.

---

### Q22. What is optimistic vs pessimistic concurrency?
**Interviewer signal:** system design vocabulary.
**Answer:**
Pessimistic concurrency takes locks up front — reading or writing a row blocks other conflicting operations until commit. Traditional two-phase locking. Optimistic concurrency skips locks on read; on write, it verifies that the row has not changed since it was read (usually via a version column or rowversion/timestamp). If the check fails, the update is rejected and the application retries. Pessimistic is simpler and safer under high contention on the same rows; optimistic scales better under low contention and read-heavy workloads. Snapshot isolation is the engine-level optimistic model — readers see a consistent version, writers detect conflicts at commit. Modern OMS designs I have worked with lean optimistic for reference data (symbols, accounts) and pessimistic for the order state machine itself.
**Watch-outs:** thinking optimistic means "no locks ever" — writes still take short locks; the optimism is about read-time conflict avoidance.

---

### Q23. When does an index help and when does it hurt?
**Interviewer signal:** performance-tuning fundamentals.
**Answer:**
An index helps read-side selectivity when the query filters, joins, or sorts on the leading columns and returns a small fraction of the table. It hurts write throughput because every INSERT, UPDATE on indexed columns, and DELETE must maintain the index — extra IO, extra locks, more logging. It also hurts if the optimizer picks it for a low-selectivity predicate and does thousands of key lookups instead of a scan. My rules for OMS tables: index every foreign key, index the columns you filter on in hot queries, do not over-index a high-write table like `executions` because insert amplification will hurt latency. Composite index column order matters — the leading column must be usable by the predicate; put the equality-filtered column first, the range-filtered column second.
**Watch-outs:** adding an index to fix one slow query and slowing down the ten hot inserts nobody looked at.

---

### Q24. What is a covering index and when is it worth it?
**Interviewer signal:** advanced tuning awareness.
**Answer:**
A covering index includes all columns the query needs — via key columns or the INCLUDE clause in SQL Server — so the engine can satisfy the query from the index alone without a bookmark lookup back to the base table. Worth it when the query is hot, the base table is wide, and the current plan shows a Key Lookup consuming most of the cost. Cost is disk space and extra write amplification. Example: a support query I run against `orders` filters on `trader_id, order_date` and selects `order_id, symbol, qty, side, status`. An index on `(trader_id, order_date) INCLUDE (order_id, symbol, qty, side, status)` turned a 4-second query into 80ms by eliminating 200k key lookups.
**Watch-outs:** covering everything — you double your write cost for a query nobody runs.

---

### Q25. How do you read a query execution plan?
**Interviewer signal:** can you actually debug slow SQL or do you just guess.
**Answer:**
Read from right to left, top to bottom — that is the data flow order. For each operator, look at three numbers: estimated rows vs actual rows (large divergence means bad statistics or bad cardinality estimates), the operator's cost percentage, and the physical operator type. Red flags I hunt for: Table Scan on a large table with a selective predicate (missing index); Key Lookup dominating cost (candidate for a covering index); Hash Match on tiny inputs (join hint or index could give a Nested Loop instead); Sort operator appearing when the ORDER BY column has no supporting index; a huge Filter operator far from the leaf (predicate that could not be pushed down). Also check for parallelism warnings and spills to tempdb. In production I use SET STATISTICS IO ON alongside the plan — logical reads tell you more about IO cost than the estimated numbers do.
**Watch-outs:** trusting the estimated plan and ignoring the actual — always capture the actual plan for a real diagnosis.
