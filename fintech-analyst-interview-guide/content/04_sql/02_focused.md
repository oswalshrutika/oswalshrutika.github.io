# SQL — 50 Focused Q&A

Curated for Technical Analyst / Production Support roles at a sell-side / buy-side trading firm. Focus areas: window functions, join semantics, isolation levels, indexes, EXPLAIN plans. Grounded in the kind of SQL problems that come up when triaging an OMS: reconciling fills, chasing missing orders across staging/prod tables, explaining why a report query timed out at 3 pm.

## Table of contents

| #  | Topic | Question |
|----|-------|----------|
| Q1 | Window functions | ROW_NUMBER vs RANK vs DENSE_RANK |
| Q2 | Window functions | Latest fill per order using window function |
| Q3 | Window functions | Running total of executed quantity |
| Q4 | Window functions | LAG/LEAD to compute inter-fill latency |
| Q5 | Window functions | Windowed vs GROUP BY — when to pick which |
| Q6 | Window functions | PARTITION BY vs ORDER BY inside OVER() |
| Q7 | Window functions | Frame clause — ROWS vs RANGE |
| Q8 | Window functions | NTILE for bucketing orders by size |
| Q9 | Window functions | FIRST_VALUE / LAST_VALUE gotcha |
| Q10 | Window functions | Deduping rows keeping the latest |
| Q11 | Joins | INNER vs LEFT vs FULL OUTER |
| Q12 | Joins | Semi-join vs anti-join |
| Q13 | Joins | Cross join and when it is legitimate |
| Q14 | Joins | Filter in ON vs WHERE for LEFT JOIN |
| Q15 | Joins | Self join for parent/child orders |
| Q16 | Joins | Hash vs merge vs nested loop |
| Q17 | Joins | Cardinality explosion — one-to-many trap |
| Q18 | Joins | LEFT JOIN with GROUP BY and MAX pitfall |
| Q19 | Joins | Non-equi join for time-range matching |
| Q20 | Joins | EXISTS vs IN vs JOIN — semantics |
| Q21 | Isolation | Four ANSI isolation levels |
| Q22 | Isolation | Dirty read — concrete example |
| Q23 | Isolation | Non-repeatable read vs phantom read |
| Q24 | Isolation | READ COMMITTED vs REPEATABLE READ |
| Q25 | Isolation | SERIALIZABLE — how it is implemented |
| Q26 | Isolation | Snapshot isolation and write skew |
| Q27 | Isolation | Locking hints — NOLOCK, UPDLOCK |
| Q28 | Isolation | Deadlock — how you diagnose and resolve |
| Q29 | Isolation | Long-running SELECT blocking writes |
| Q30 | Isolation | Choosing isolation for a reconciliation job |
| Q31 | Indexes | Clustered vs non-clustered |
| Q32 | Indexes | Composite index — column order matters |
| Q33 | Indexes | Covering index and INCLUDE columns |
| Q34 | Indexes | Index selectivity and cardinality |
| Q35 | Indexes | When an index is NOT used |
| Q36 | Indexes | Function on indexed column kills the index |
| Q37 | Indexes | Bookmark lookup / key lookup |
| Q38 | Indexes | Fragmentation and rebuild vs reorganize |
| Q39 | Indexes | Filtered / partial indexes |
| Q40 | Indexes | Cost of over-indexing |
| Q41 | EXPLAIN | Reading an EXPLAIN plan top-down |
| Q42 | EXPLAIN | Seek vs scan |
| Q43 | EXPLAIN | Estimated vs actual rows — why they diverge |
| Q44 | EXPLAIN | Parameter sniffing |
| Q45 | EXPLAIN | Spool, sort, hash spill warnings |
| Q46 | Practical | Debug a suddenly slow report |
| Q47 | Practical | Find orders in child table missing from parent |
| Q48 | Practical | Pivot fills by venue by day |
| Q49 | Practical | Median fill price without a MEDIAN function |
| Q50 | Practical | Top-N per group |

---

### Q1. ROW_NUMBER vs RANK vs DENSE_RANK — how do they differ?
**Interviewer signal:** does the candidate know their window-function fundamentals cold, not just recite them.
**Answer:**
All three number rows within a partition ordered by a key. The difference is how they treat ties.

- `ROW_NUMBER()` — assigns a unique sequential integer. Ties are broken arbitrarily unless `ORDER BY` is fully deterministic.
- `RANK()` — ties get the same rank, and the next rank is skipped. 1, 2, 2, 4.
- `DENSE_RANK()` — ties get the same rank, no gap. 1, 2, 2, 3.

In OMS work I reach for `ROW_NUMBER()` most often — for example numbering fills per order by exec time to pick "the latest" one. `RANK` is what I want when producing league-table style reports where ties genuinely tie.

**Watch-outs:** if `ORDER BY` in `OVER()` is not unique, `ROW_NUMBER` results are non-deterministic across runs.

---

### Q2. Give me the latest fill per order.
**Interviewer signal:** can they write it without a self-join.
**Answer:**
```sql
SELECT order_id, fill_id, exec_time, price, qty
FROM (
  SELECT f.*,
         ROW_NUMBER() OVER (
           PARTITION BY order_id
           ORDER BY exec_time DESC, fill_id DESC
         ) AS rn
  FROM fills f
) x
WHERE rn = 1;
```
Tiebreak on `fill_id` so the result is stable when two fills share a microsecond. The alternative — `LEFT JOIN` with `MAX(exec_time)` — works but usually costs an extra scan and can double-count if `exec_time` is not unique.

**Watch-outs:** if the table has an `is_deleted` or `is_bust` flag, filter it out in a `WHERE` before the window — otherwise you may return busted fills.

---

### Q3. Compute a running total of executed quantity per order over time.
**Interviewer signal:** understands `SUM() OVER (ORDER BY ...)`.
**Answer:**
```sql
SELECT order_id, exec_time, qty,
       SUM(qty) OVER (
         PARTITION BY order_id
         ORDER BY exec_time
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS cum_filled
FROM fills;
```
Explicit `ROWS BETWEEN ...` is safer than relying on the default. With `RANGE` and non-unique `exec_time`, all rows sharing that timestamp are collapsed into one cumulative step, which is almost never what you want.

**Watch-outs:** default frame is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which behaves differently from `ROWS` on ties.

---

### Q4. How would you compute the time between consecutive fills on the same order?
**Interviewer signal:** knows LAG/LEAD.
**Answer:**
```sql
SELECT order_id, fill_id, exec_time,
       exec_time - LAG(exec_time) OVER (
         PARTITION BY order_id ORDER BY exec_time
       ) AS gap_since_prev
FROM fills;
```
`LAG` returns the previous row's value in the partition; `LEAD` returns the next. For latency analysis I often chain a `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY gap_since_prev)` on top to spot outlier orders.

**Watch-outs:** on the first fill of each order `LAG` is NULL — decide whether to include or exclude it.

---

### Q5. Windowed aggregate vs GROUP BY — when do you pick which?
**Interviewer signal:** understands that windows preserve row-level detail.
**Answer:**
`GROUP BY` collapses rows into one row per group. A window function computes an aggregate **per row** while keeping every input row visible. So if I want "for each fill, show the fill AND the total qty on the order", I need a window function. If I only want "total qty per order", `GROUP BY` is simpler and often cheaper.

**Watch-outs:** don't wrap a `GROUP BY` query in an outer join just to bring back detail — a window is cleaner and usually faster.

---

### Q6. What do PARTITION BY and ORDER BY do inside OVER()?
**Interviewer signal:** basic literacy.
**Answer:**
- `PARTITION BY` splits the result set into independent groups, like `GROUP BY` but the rows are preserved.
- `ORDER BY` inside `OVER()` defines the sequence within a partition — required for ranking, `LAG/LEAD`, and running totals.

They are independent — you can have one without the other.

**Watch-outs:** an `ORDER BY` outside `OVER()` (the query-level one) has no effect on the window's ordering.

---

### Q7. Explain the frame clause — ROWS vs RANGE.
**Interviewer signal:** senior-level detail.
**Answer:**
The frame decides which rows in the partition contribute to the aggregate at the current row.

- `ROWS` — physical rows. `ROWS BETWEEN 1 PRECEDING AND CURRENT ROW` = the immediately previous row plus this row, regardless of value.
- `RANGE` — logical values. `RANGE BETWEEN 1 PRECEDING AND CURRENT ROW` groups all rows whose `ORDER BY` key is within 1 of the current row's key.

For most running totals I want `ROWS` — it is unambiguous even when timestamps tie.

**Watch-outs:** default frame when `ORDER BY` is present is `RANGE UNBOUNDED PRECEDING`, which surprises people on tied keys.

---

### Q8. How would you bucket orders into deciles by notional?
**Interviewer signal:** knows NTILE.
**Answer:**
```sql
SELECT order_id, notional,
       NTILE(10) OVER (ORDER BY notional) AS decile
FROM orders;
```
`NTILE(n)` slices the ordered partition into `n` roughly-equal buckets. Handy for "which decile of order size did this fill come from" analyses.

**Watch-outs:** NTILE is not a percentile — it assigns bucket labels 1..n by row count, not by value distribution. Two orders with identical notional can land in different deciles.

---

### Q9. What is the LAST_VALUE gotcha?
**Interviewer signal:** experience — this bites everyone once.
**Answer:**
Naive:
```sql
LAST_VALUE(price) OVER (PARTITION BY order_id ORDER BY exec_time)
```
returns the current row's price, not the true last, because the default frame is `RANGE UNBOUNDED PRECEDING AND CURRENT ROW`. To get the actual final value:
```sql
LAST_VALUE(price) OVER (
  PARTITION BY order_id ORDER BY exec_time
  ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
)
```
Or use `FIRST_VALUE(price) OVER (... ORDER BY exec_time DESC)`.

**Watch-outs:** this bug is subtle — the query returns "a" value, so it silently produces wrong reports.

---

### Q10. How do you dedupe rows keeping the latest by some key?
**Interviewer signal:** practical SQL.
**Answer:**
```sql
WITH ranked AS (
  SELECT t.*,
         ROW_NUMBER() OVER (
           PARTITION BY natural_key
           ORDER BY updated_at DESC
         ) rn
  FROM staging_orders t
)
SELECT * FROM ranked WHERE rn = 1;
```
On a permanent table I would prefer a `DELETE ... WHERE rn > 1` variant or use `MERGE`. In OMS reconciliation this pattern shows up constantly — the vendor drops a raw feed with duplicates and we take the last-write-wins record.

**Watch-outs:** if `updated_at` is not populated on every row, dedupe becomes non-deterministic — coalesce with `create_time` or a monotonic id.

---

### Q11. INNER vs LEFT vs FULL OUTER join?
**Interviewer signal:** foundational.
**Answer:**
- `INNER` — rows where the join predicate matches in both sides.
- `LEFT` — all rows from the left, matched rows from the right, NULLs where no match.
- `FULL OUTER` — all rows from both sides; NULLs on the side that did not match.

In a reconciliation, I usually run all three symbolically:
- `INNER` — matched pairs.
- `LEFT` anti (`WHERE right.id IS NULL`) — in source, not in target.
- `RIGHT` anti — in target, not in source.

**Watch-outs:** many candidates say "LEFT returns all rows including nulls" — sloppy. It returns all rows from the left; NULLs appear only in right-side columns of unmatched rows.

---

### Q12. What is a semi-join and an anti-join?
**Interviewer signal:** knows what the optimizer is really doing.
**Answer:**
- Semi-join — "return left rows where at least one right row matches, but don't duplicate the left row per match." SQL surface form: `EXISTS` or `IN (subquery)`.
- Anti-join — "return left rows where no right row matches." Surface form: `NOT EXISTS` or `LEFT JOIN ... WHERE right.id IS NULL`.

Optimizers frequently rewrite `EXISTS` and `LEFT JOIN ... IS NULL` into the same semi/anti physical operator, so performance is often equivalent.

**Watch-outs:** `NOT IN` is not equivalent to `NOT EXISTS` if the subquery can produce NULL — `NOT IN` returns nothing in that case. Always prefer `NOT EXISTS`.

---

### Q13. Cross join — when is it legitimate?
**Interviewer signal:** understands intent, not just definition.
**Answer:**
A cross join is the Cartesian product. Legitimate uses:
- Generating date/time buckets (`calendar CROSS JOIN venue`).
- Producing an "all combinations" seed table before a `LEFT JOIN` to fill missing slots with zeros.
- Small dimension × small dimension for reports.

**Watch-outs:** an unintentional cross join — typically from forgetting a join predicate — will silently blow up row counts and make a query "hang." First thing I check when a query slows down after a code change.

---

### Q14. In a LEFT JOIN, does it matter whether the filter is in ON or WHERE?
**Interviewer signal:** classic trap question.
**Answer:**
Yes.
- Predicate in `ON` — evaluated during the join. Non-matching right rows still produce a left row with NULLs.
- Predicate in `WHERE` — evaluated after the join. A NULL right column filtered in `WHERE` demotes the LEFT JOIN to an INNER JOIN.

So `LEFT JOIN fills f ON f.order_id = o.id AND f.status = 'ACK'` returns every order plus its ACK'd fills. Moving `f.status = 'ACK'` to `WHERE` drops orders that have no ACK fills.

**Watch-outs:** the "moved to WHERE" version is the most common cause of "why is my order missing from the report" tickets.

---

### Q15. Show a self-join for parent/child orders.
**Interviewer signal:** understands hierarchical joins.
**Answer:**
```sql
SELECT p.order_id AS parent_id,
       c.order_id AS child_id,
       c.qty, c.status
FROM orders p
JOIN orders c ON c.parent_order_id = p.order_id
WHERE p.status = 'WORKING';
```
For deeper hierarchies (basket → parent → child → child-of-child) I would use a recursive CTE:
```sql
WITH RECURSIVE tree AS (
  SELECT order_id, parent_order_id, 0 AS depth FROM orders WHERE parent_order_id IS NULL
  UNION ALL
  SELECT o.order_id, o.parent_order_id, t.depth + 1
  FROM orders o JOIN tree t ON o.parent_order_id = t.order_id
)
SELECT * FROM tree;
```

**Watch-outs:** guard the recursive CTE with a depth cap when your data can contain cycles.

---

### Q16. Hash vs merge vs nested-loop join?
**Interviewer signal:** understands what EXPLAIN shows.
**Answer:**
- Nested loop — for each row in outer, probe inner. Good when the outer is tiny and the inner is indexed. O(n·m) worst case.
- Merge — both inputs pre-sorted on the join key; walk them together. Good for large equi-joins on indexed keys, or when both sides are already sorted.
- Hash — build a hash table on the smaller side, probe with the larger side. Good for large equi-joins with no useful index. Requires memory; can spill to disk.

I look for a nested loop appearing where I expected a hash — usually a sign of a bad cardinality estimate.

**Watch-outs:** hash join needs equi-predicates. If you see nested loop on a large table, check for a `LIKE`, function call, or type mismatch that killed the equi-join.

---

### Q17. What is cardinality explosion?
**Interviewer signal:** experience.
**Answer:**
When you join two one-to-many tables on the same key and forget one of them is many-to-many with the parent, output row count multiplies. Example: `orders` × `fills` × `allocations` where allocations are per-fill — join `orders` to `fills` and `allocations` naively on `order_id` and you double-count. Fix: aggregate one side first in a subquery, or use `EXISTS` for existence checks.

**Watch-outs:** if a report suddenly reports 10x the notional and someone recently touched the JOINs, this is your first suspect.

---

### Q18. LEFT JOIN with GROUP BY and MAX — what pitfall?
**Interviewer signal:** subtle correctness.
**Answer:**
```sql
SELECT o.order_id, MAX(f.exec_time) AS last_fill,
       MAX(f.price) AS last_price   -- WRONG
FROM orders o LEFT JOIN fills f USING (order_id)
GROUP BY o.order_id;
```
`MAX(price)` is not the price of the last fill — it is the largest price. To get "the price at the max exec_time" you need either a correlated subquery, a window function (see Q2), or `DISTINCT ON` in Postgres.

**Watch-outs:** this bug hides for months because on many orders max price happens to equal last price.

---

### Q19. How would you join fills to a snapshot of NBBO at fill time?
**Interviewer signal:** knows non-equi joins.
**Answer:**
```sql
SELECT f.fill_id, f.exec_time, f.price,
       n.bid, n.ask
FROM fills f
JOIN nbbo n
  ON n.symbol = f.symbol
 AND n.effective_time <= f.exec_time
 AND n.expiry_time   >  f.exec_time;
```
Range joins are expensive — indexes on `(symbol, effective_time)` help, and I often materialize NBBO into interval-partitioned buckets so the optimizer can prune.

**Watch-outs:** without the `expiry_time` guard you get a many-match cardinality explosion.

---

### Q20. EXISTS vs IN vs JOIN — when do you choose which?
**Interviewer signal:** semantic literacy.
**Answer:**
- `EXISTS (subquery)` — existence test. Preserves left-side cardinality. Best when I only care "is there a matching row?"
- `IN (subquery)` — same intent but with two footguns: `NOT IN` breaks on NULLs, and some old optimizers don't rewrite it to a semi-join.
- `JOIN` — I need columns from the other side. But then I have to worry about duplicating rows if the right side is not unique on the key.

**Watch-outs:** if the right-side subquery can be non-unique, `JOIN` will duplicate rows and skew aggregates — use `EXISTS` unless you actually need those columns.

---

### Q21. What are the four ANSI isolation levels?
**Interviewer signal:** foundational.
**Answer:**

| Level | Dirty read | Non-repeatable read | Phantom |
|-------|-----------|---------------------|---------|
| READ UNCOMMITTED | possible | possible | possible |
| READ COMMITTED | prevented | possible | possible |
| REPEATABLE READ | prevented | prevented | possible (in ANSI; MySQL InnoDB uses gap locks so mostly prevented) |
| SERIALIZABLE | prevented | prevented | prevented |

Snapshot isolation (Postgres, SQL Server RCSI) is a separate model that gives repeatable-read-like guarantees without read locks.

**Watch-outs:** SQL Server defaults to READ COMMITTED with locks; Postgres defaults to READ COMMITTED with MVCC. Oracle defaults are basically snapshot at statement level. Know your vendor.

---

### Q22. Give me a concrete dirty read scenario.
**Interviewer signal:** applied thinking.
**Answer:**
1. Transaction A updates `orders.status = 'FILLED'` for order X, has not committed.
2. Transaction B reads status of X under `READ UNCOMMITTED`, sees `FILLED`, and downstream fires a settlement instruction.
3. Transaction A rolls back — but the settlement is already in flight.

This is why READ UNCOMMITTED is banned for anything that touches trade state.

**Watch-outs:** vendors sometimes ship reports with `WITH (NOLOCK)` for speed — that reintroduces dirty reads and is a common source of "the numbers don't match" complaints.

---

### Q23. Non-repeatable read vs phantom read?
**Interviewer signal:** subtle distinction.
**Answer:**
- Non-repeatable read — the same row read twice in one transaction returns different data because another transaction updated it in between.
- Phantom read — the same range query executed twice returns a different row **set** because another transaction inserted (or deleted) rows matching the predicate.

Non-repeatable is about a specific row changing; phantom is about the set membership changing.

**Watch-outs:** `REPEATABLE READ` under ANSI still allows phantoms — you need SERIALIZABLE or gap locks to fully prevent.

---

### Q24. READ COMMITTED vs REPEATABLE READ — practical difference?
**Interviewer signal:** applied.
**Answer:**
Under READ COMMITTED, every statement sees the latest committed data — so within one transaction, two `SELECT`s on the same row can return different values.

Under REPEATABLE READ, the transaction sees a consistent snapshot of the rows it read; subsequent reads see the same values. New rows (phantoms) can still appear on range queries in strict ANSI, though most vendors close that gap.

For a reconciliation job running dozens of queries, I use REPEATABLE READ (or snapshot) so aggregates are internally consistent.

**Watch-outs:** REPEATABLE READ increases lock/undo pressure — on high-write OLTP it can raise deadlock rates.

---

### Q25. How is SERIALIZABLE implemented in practice?
**Interviewer signal:** knows the vendor differences.
**Answer:**
Two families of implementations:
- Strict two-phase locking (SQL Server, DB2) — range locks on predicates, read locks held to end of transaction. High contention.
- Serializable Snapshot Isolation (Postgres) — MVCC snapshot plus dependency tracking. Detect cycles at commit; abort one transaction. Zero read locks but occasional serialization failures.

Trade-off: locking = predictable behavior, more blocking. SSI = better concurrency, but callers must retry.

**Watch-outs:** if your code doesn't have a retry loop, don't use SSI — you'll surface `40001` errors as user-visible failures.

---

### Q26. Snapshot isolation — what is write skew?
**Interviewer signal:** senior.
**Answer:**
Under snapshot isolation, two transactions each see a consistent snapshot and write disjoint rows. Neither conflict is detected, but their combined effect violates an invariant. Classic example: on-call rotation where two people simultaneously go off-call — each reads "the other is still on" and updates their own row.

In OMS terms: two positions-adjustment jobs each read the same "current position = 0" snapshot and each insert a hedge — you end up with a doubled hedge.

Fix: SERIALIZABLE, or explicit `SELECT ... FOR UPDATE` on the row(s) that gate the invariant.

**Watch-outs:** write skew is invisible in normal load testing — only shows up under real concurrency.

---

### Q27. NOLOCK, UPDLOCK, HOLDLOCK — what are these?
**Interviewer signal:** SQL Server familiarity.
**Answer:**
Table hints in SQL Server.
- `NOLOCK` — read uncommitted. Fast but wrong for anything transactional. Also risks read-once-and-again inconsistencies and torn rows.
- `UPDLOCK` — take an update-lock while reading, upgrade to exclusive on write. Prevents deadlocks when two transactions read-then-write the same row.
- `HOLDLOCK` — hold shared lock to end of transaction, effectively `SERIALIZABLE` for that statement.
- `ROWLOCK`, `PAGLOCK`, `TABLOCK` — hint the granularity.

**Watch-outs:** hints should be rare and documented. A codebase full of `NOLOCK` is a red flag.

---

### Q28. How do you diagnose a deadlock in production?
**Interviewer signal:** ops experience.
**Answer:**
1. Confirm from error text — vendor code (e.g. SQL Server 1205, Postgres 40P01) plus victim statement.
2. Pull the deadlock graph — SQL Server: `system_health` XE session or `trace flag 1222`; Postgres: `log_lock_waits = on` and check `pg_locks`.
3. Identify the two resources and the two access orders. Deadlocks are almost always A→B vs B→A on the same two objects.
4. Fix — usually normalize the access order across code paths, or shorten the transaction, or add an index so the lock is on a row instead of a range.
5. If the deadlock is with a batch job vs an OLTP writer, reschedule the batch or split it into smaller commits.

**Watch-outs:** "just retry" is a valid last resort but not a fix — the underlying access pattern is still wrong.

---

### Q29. A long-running SELECT is blocking writes. What do you do?
**Interviewer signal:** ops instinct.
**Answer:**
Immediate: kill the SELECT (with the trader/user's blessing if it's a manual query) to unblock the writers. Long term:
1. Check isolation level — if it's `SERIALIZABLE` or `REPEATABLE READ` and doesn't need to be, downgrade to READ COMMITTED SNAPSHOT.
2. Rewrite the query to be indexed and short.
3. If it's a reporting workload, point it at a replica.
4. If the DB is SQL Server, consider enabling RCSI so readers don't take shared locks.
5. Never solve it with `NOLOCK` on writes-of-record.

**Watch-outs:** the temptation is to sprinkle hints. First understand *why* it's slow — usually a missing index or a stale plan.

---

### Q30. For an end-of-day reconciliation across dozens of tables, what isolation do you pick?
**Interviewer signal:** applied judgment.
**Answer:**
Snapshot / repeatable-read at the transaction level, so every table read within the recon reflects the same point-in-time. Under READ COMMITTED, one table could reflect 16:30:01 and another 16:30:04, and the recon will spuriously flag breaks. I make the recon read-only, transactional, and time-boxed — if it exceeds SLA, we investigate rather than commit partial results.

**Watch-outs:** long snapshots hold undo/xact info — on Postgres they can bloat, on SQL Server they inflate tempdb. Coordinate with the DBA on runtime windows.

---

### Q31. Clustered vs non-clustered index?
**Interviewer signal:** foundational.
**Answer:**
- Clustered — the table itself is stored in the order of the clustered key. There is only one. Leaf pages are the data rows.
- Non-clustered — a separate B-tree keyed on the indexed column(s) with a pointer (row locator in a heap, or clustered key in a clustered table) back to the row.

The clustered index choice matters a lot: on a `fills` table, clustering by `exec_time` makes range-scans by time cheap but insert-hot-spots the tail; clustering by `fill_id` (identity) spreads inserts but makes time-range scans random.

**Watch-outs:** Postgres doesn't have permanent clustered indexes — `CLUSTER` is a one-time reorg. Everyone else calls the base table "heap" vs "index-organized."

---

### Q32. Composite index — does column order matter?
**Interviewer signal:** important gotcha.
**Answer:**
Yes. An index on `(a, b, c)` can be used for predicates:
- `a = ?`
- `a = ? AND b = ?`
- `a = ? AND b = ? AND c = ?`
- `a = ? AND b > ?` (range on trailing column ok)

But **not** efficiently for `b = ?` alone. It's a phone book sorted by last name then first name — you can find all "Smith"s, but not all "John"s without scanning.

Rule of thumb: equality columns first (highest selectivity), then range columns, then any that are only in SELECT for covering.

**Watch-outs:** leading column skip — you can technically "index skip scan" in Oracle and modern Postgres, but don't design around it.

---

### Q33. What is a covering index and INCLUDE?
**Interviewer signal:** performance tuning.
**Answer:**
A covering index contains every column the query needs — key columns plus non-key columns "along for the ride." The query is satisfied from the index leaf without going to the base table (no key lookup).

In SQL Server / Postgres, `INCLUDE (col1, col2)` stores extra columns at the leaf without adding them to the key. Cheaper than putting them in the key because they don't participate in ordering or B-tree comparisons.

```sql
CREATE INDEX ix_fills_order ON fills(order_id) INCLUDE(price, qty, exec_time);
```
A query `SELECT price, qty, exec_time FROM fills WHERE order_id = ?` is fully covered.

**Watch-outs:** too many included columns bloat the index and hurt write performance. Cover only hot queries.

---

### Q34. What is selectivity, and why does it matter?
**Interviewer signal:** cost-model literacy.
**Answer:**
Selectivity = fraction of rows matched by a predicate. High selectivity = matches few rows. `where fill_id = 12345` is very selective; `where status = 'ACK'` on a table where 99% are ACK is not.

The optimizer only uses an index if the index is selective enough that seek + lookups beats a full scan. Rough threshold: below ~5-10% of the table, index seek; above that, scan.

**Watch-outs:** `IS NULL` predicates on nullable columns are sometimes not covered by the default index. Confirm your vendor.

---

### Q35. Why might an index not be used?
**Interviewer signal:** experience.
**Answer:**
Common reasons:
1. Predicate wraps the column in a function — `WHERE UPPER(symbol) = 'AAPL'` won't use `IX(symbol)`.
2. Type mismatch — `WHERE order_id = '12345'` where `order_id` is INT and the parameter is NVARCHAR; implicit cast blocks the seek.
3. Leading-column mismatch on a composite.
4. Very low selectivity — scan is genuinely cheaper.
5. Stale statistics — optimizer wrongly estimates high cardinality.
6. `OR` across different columns that would each need a different index — optimizer sometimes gives up.
7. Parameter sniffing produced a scan-friendly plan for one param and it stuck.

**Watch-outs:** in prod issues, #2 and #5 are shockingly common causes of "the query used to be fast."

---

### Q36. Why does a function on an indexed column kill the index?
**Interviewer signal:** basic but often muddled.
**Answer:**
The index stores the raw column values in sorted order. If the predicate is `f(col) = ?`, the optimizer would need `f(col)` for every row — it can't binary-search the tree. So it scans.

Workarounds:
- Rewrite the predicate: `WHERE created_at >= '2026-07-18' AND created_at < '2026-07-19'` instead of `WHERE DATE(created_at) = '2026-07-18'`.
- Add a computed / functional / expression index: `CREATE INDEX ix ON t (LOWER(email))`.

**Watch-outs:** implicit conversions count as functions — `WHERE varchar_col = @int_param` will silently kill the seek.

---

### Q37. What is a key lookup / bookmark lookup?
**Interviewer signal:** SQL Server or Oracle experience.
**Answer:**
The non-clustered index tells you which rows match — but if the query needs columns not in the index, the engine fetches each matching row from the base table. That fetch is a "key lookup" (clustered table) or "RID lookup" (heap).

Symptom in EXPLAIN: `Index Seek` followed by `Key Lookup` in a nested loop. Bad if the seek returns thousands of rows — each lookup is a random I/O.

Fix: add the missing columns to the index's `INCLUDE` so the query is fully covered.

**Watch-outs:** "just add a covering index" is right for hot queries and wrong for cold ones — you're trading write cost for read cost.

---

### Q38. Index fragmentation — rebuild vs reorganize?
**Interviewer signal:** DBA-adjacent.
**Answer:**
- Reorganize — online, defragments leaf pages, updates statistics only if asked. Cheap.
- Rebuild — drops and recreates. Fully online in Enterprise editions, else blocks. Resets stats to fullscan.

Common rule of thumb: fragmentation < 5% ignore, 5-30% reorganize, > 30% rebuild.

**Watch-outs:** on modern SSDs, index fragmentation matters less than statistics being current. Fixing stats is often more impactful than rebuilding.

---

### Q39. Filtered / partial indexes?
**Interviewer signal:** advanced.
**Answer:**
An index over only a subset of rows:
```sql
CREATE INDEX ix_open_orders ON orders(order_id) WHERE status IN ('WORKING','ACK');
```
Smaller, cheaper to maintain, only useful for queries whose predicate matches the filter.

Great pattern for OMS: 99% of a day's orders end up terminal within minutes; you only care about the open ones for real-time queries.

**Watch-outs:** the optimizer will only use it if the query predicate is a subset of the index predicate. `WHERE status = 'CANCELLED'` will not use the above.

---

### Q40. Downside of over-indexing?
**Interviewer signal:** engineering trade-offs.
**Answer:**
Every non-clustered index is a mini-table maintained on every insert/update/delete. On a hot writes table, ten redundant indexes can halve throughput. Also — the optimizer takes longer to choose a plan when many candidates exist, and disk/backup size grows.

I audit periodically with `sys.dm_db_index_usage_stats` (SQL Server) or `pg_stat_user_indexes` (Postgres) and drop unused indexes.

**Watch-outs:** "unused since server restart" is not the same as "unused" — confirm across a full business cycle before dropping.

---

### Q41. How do you read an EXPLAIN plan?
**Interviewer signal:** applied.
**Answer:**
Read from the deepest, innermost operator outward — the leaves are what runs first. For each operator I check:
1. Operation type — seek, scan, hash join, sort, spool.
2. Estimated rows vs actual rows — big divergence = stale stats or bad estimate.
3. Cost as a percentage of total — focus on the top 1-2.
4. Warnings — spills, implicit conversions, missing indexes.

I compare the current plan against a known-good baseline when troubleshooting regression.

**Watch-outs:** "cost" is an estimate, not a wall-clock. Always cross-check with `SET STATISTICS TIME/IO ON` or `EXPLAIN (ANALYZE, BUFFERS)`.

---

### Q42. Index seek vs index scan?
**Interviewer signal:** basic.
**Answer:**
- Seek — the engine descends the B-tree to a specific starting point and reads matching rows. Fast when selective.
- Scan — reads the entire index (or a large range). Fine for reporting, bad for OLTP point-lookups.

A "scan" isn't automatically bad — for a 1000-row table it's the right answer. It's bad when it appears on a large table where a seek was expected.

**Watch-outs:** a "seek" that internally reads 5 million rows because of a wide range is still slow. Look at row count, not just operator name.

---

### Q43. Estimated vs actual rows — why do they diverge?
**Interviewer signal:** senior.
**Answer:**
The optimizer picks a plan using statistics. If stats are stale, sampled, or the predicate uses local variables the optimizer can't sniff, the estimate is wrong. Consequences: nested loop chosen where hash would be right, or vice versa.

Fix path:
1. `UPDATE STATISTICS` (SQL Server) or `ANALYZE` (Postgres).
2. If it's a parameter-sniffing issue, use `OPTION (RECOMPILE)` or `OPTIMIZE FOR UNKNOWN` on the hot query.
3. Consider filtered stats or extended stats on multi-column predicates.

**Watch-outs:** in a data-warehouse ETL, stats can go stale within one large load. Refresh them after big loads, not on a schedule.

---

### Q44. What is parameter sniffing?
**Interviewer signal:** SQL Server ops.
**Answer:**
The optimizer compiles a plan on the first execution based on the parameter values it "sniffs." That plan is cached. If a later call passes a value with very different selectivity, the cached plan can be terrible.

Symptoms: same stored procedure sometimes fast, sometimes slow, with no data change. Fix: `OPTION (RECOMPILE)`, `OPTIMIZE FOR (@x = value)`, local-variable trick, or plan guides.

**Watch-outs:** Postgres has a similar issue with prepared statements after 5 executions when it switches to a generic plan.

---

### Q45. What warnings should you look for in an EXPLAIN plan?
**Interviewer signal:** troubleshooting.
**Answer:**
- Hash spill / sort spill to disk / tempdb spill — memory grant was too small; actuals >> estimate.
- Implicit conversion — usually kills an index.
- Missing index hint — engine telling you there's a better index; validate before applying.
- Table spool — engine is caching intermediate results, often because of a correlated subquery pattern.
- Excessive sort — often eliminable by a matching index order.

**Watch-outs:** the "missing index" suggestion is a hint, not gospel — often it's suggesting a redundant near-duplicate.

---

### Q46. A daily P&L report ran in 30 seconds all quarter and today takes 20 minutes. Walk me through debugging.
**Interviewer signal:** production support instinct.
**Answer:**
1. Confirm the query is the same — check the query hash against yesterday's cache.
2. Get the current plan and the last known-good plan (`sys.dm_exec_query_stats`, `pg_stat_statements` + plan cache).
3. Compare — did an operator change (hash → nested loop)? Did row estimates blow up?
4. Check data volume — did today's `fills` load bring 100× yesterday's rows because of a bad upstream feed?
5. Check statistics — `UPDATE STATISTICS` on the driving tables, retry.
6. Check blocking — someone might hold an incompatible lock; look at wait stats.
7. If it's parameter sniffing, force recompile as a hotfix and open a story to make it deterministic.
8. Report root cause to trader/PM with SLA restored.

**Watch-outs:** don't `ALTER` indexes at 9am on trading day. Fix in place with a plan hint, root-cause after close.

---

### Q47. Find orders in the fills table that have no matching parent order row.
**Interviewer signal:** anti-join fluency.
**Answer:**
```sql
SELECT DISTINCT f.order_id
FROM fills f
LEFT JOIN orders o ON o.order_id = f.order_id
WHERE o.order_id IS NULL;
```
Or:
```sql
SELECT DISTINCT f.order_id
FROM fills f
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = f.order_id);
```
Both compile to an anti-join on any decent optimizer. I prefer `NOT EXISTS` — NULL-safe and clearer intent.

**Watch-outs:** if `f.order_id` can be NULL, decide whether to include those. Also, in OMS environments this query is a bread-and-butter reconciliation — schedule it, don't run ad hoc.

---

### Q48. Pivot fills by venue by day.
**Interviewer signal:** knows pivot patterns.
**Answer:**
Static pivot with conditional aggregation:
```sql
SELECT trade_date,
       SUM(CASE WHEN venue = 'ARCA'  THEN qty ELSE 0 END) AS arca,
       SUM(CASE WHEN venue = 'NASDAQ' THEN qty ELSE 0 END) AS nasdaq,
       SUM(CASE WHEN venue = 'IEX'    THEN qty ELSE 0 END) AS iex
FROM fills
GROUP BY trade_date
ORDER BY trade_date;
```
Or vendor-native (SQL Server):
```sql
SELECT * FROM (
  SELECT trade_date, venue, qty FROM fills
) src
PIVOT (SUM(qty) FOR venue IN ([ARCA],[NASDAQ],[IEX])) p;
```

**Watch-outs:** PIVOT requires a fixed list of column names — for dynamic venues, build the SQL string or return long-form and let the BI tool pivot.

---

### Q49. Median fill price per order — without a MEDIAN function.
**Interviewer signal:** creative SQL.
**Answer:**
Percentile function if available:
```sql
SELECT order_id,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)
         OVER (PARTITION BY order_id) AS median_price
FROM fills;
```
Portable fallback:
```sql
WITH r AS (
  SELECT order_id, price,
         ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY price) AS rn,
         COUNT(*)     OVER (PARTITION BY order_id)                AS cnt
  FROM fills
)
SELECT order_id, AVG(price) AS median_price
FROM r
WHERE rn IN ((cnt+1)/2, (cnt+2)/2)
GROUP BY order_id;
```

**Watch-outs:** PERCENTILE_CONT is an ordered-set aggregate and can be expensive on huge partitions — pre-aggregate if possible.

---

### Q50. Top 3 largest fills per order.
**Interviewer signal:** classic top-N-per-group.
**Answer:**
```sql
SELECT order_id, fill_id, qty, price
FROM (
  SELECT f.*,
         ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY qty DESC, fill_id) rn
  FROM fills f
) x
WHERE rn <= 3;
```
Use `DENSE_RANK` instead of `ROW_NUMBER` if ties should all be returned (more than 3 rows possible).

**Watch-outs:** without a stable tiebreaker like `fill_id`, results are non-deterministic across runs — dashboards then flip.
