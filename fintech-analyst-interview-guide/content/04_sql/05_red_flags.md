# SQL Red Flags — 15 Wrong Statements

Interviewers plant one of these to see if you push back. If you nod along, you fail. Answer each with: "That's wrong because…" then the correct model, then the operational consequence on an OMS.

## Table of contents

| # | Wrong statement |
|---|-----------------|
| Q1 | NOLOCK makes queries faster and safer |
| Q2 | COUNT(*) is slower than COUNT(1) |
| Q3 | UNION and UNION ALL are equivalent |
| Q4 | An index on every column is always good |
| Q5 | COALESCE and ISNULL are identical |
| Q6 | READ UNCOMMITTED is fine for trading dashboards |
| Q7 | SELECT * is fine in production queries |
| Q8 | A CTE is always faster than a subquery |
| Q9 | TRUNCATE and DELETE are the same |
| Q10 | Foreign keys always slow down inserts to unacceptable levels |
| Q11 | Snapshot isolation eliminates all locking |
| Q12 | Function-based indexes are always slower than column indexes |
| Q13 | Adding indexes never slows anything down |
| Q14 | The optimizer always picks the best plan |
| Q15 | MERGE is atomic and safe under concurrent updates |

---

### Q1. "NOLOCK makes queries faster and safer."
**Interviewer signal:** do you understand isolation levels and dirty reads, or do you sprinkle `WITH (NOLOCK)` everywhere because the vendor sample code did?
**Answer:**
Wrong on the "safer" half. `NOLOCK` is a table hint equivalent to `READ UNCOMMITTED`. It skips shared locks, so it reads faster because it doesn't wait, but it exposes you to:

- **Dirty reads** — you see uncommitted rows from an in-flight transaction that may roll back.
- **Missing rows / duplicate rows** — during a page split the scan can skip a row entirely or read it twice.
- **Allocation-order scans** — you can see corrupted intermediate state.

On an OMS, that means a reconciliation query with `NOLOCK` can show an order that never actually got persisted, or miss a fill that did. I've been burned by exactly that pattern — a P&L snapshot query with `NOLOCK` disagreed with the ledger because a rollback happened mid-read. Correct approach: use `READ COMMITTED SNAPSHOT ISOLATION` (RCSI) or `SNAPSHOT` isolation if you want reader/writer non-blocking without correctness loss.
**Watch-outs:** don't say "NOLOCK is always evil." It's acceptable for genuinely approximate operational queries (row-count sanity, log tailing) where you know the tradeoff.

---

### Q2. "COUNT(*) is slower than COUNT(1)."
**Interviewer signal:** micro-optimization folklore detector.
**Answer:**
Wrong. In every modern optimizer — SQL Server, Oracle, Postgres, MySQL — `COUNT(*)`, `COUNT(1)`, and `COUNT('x')` produce identical plans and identical performance. The optimizer recognizes them all as "count rows, don't dereference any column." The real distinction is `COUNT(*)` vs `COUNT(col)`: the latter counts non-NULL values of that specific column, which requires evaluating the column and is semantically different.
**Watch-outs:** the folklore comes from a 1990s Oracle myth. If someone insists, ask them to `EXPLAIN` both — the plans are byte-identical.

---

### Q3. "UNION and UNION ALL are equivalent."
**Interviewer signal:** do you know the hidden sort/distinct in `UNION`?
**Answer:**
Wrong. `UNION` deduplicates — it does an implicit `DISTINCT` over the combined result, which forces a sort or hash aggregation. `UNION ALL` just concatenates. On a large fills table joined across two date partitions, `UNION` can be 5–10x slower and spill to tempdb. Use `UNION ALL` whenever you know the inputs are disjoint (different partitions, different order sources) and only reach for `UNION` when duplicates are semantically possible and unwanted.
**Watch-outs:** `UNION ALL` won't reorder rows, but don't rely on that — always add `ORDER BY` if order matters.

---

### Q4. "An index on every column is always good."
**Interviewer signal:** do you understand write amplification and index maintenance cost?
**Answer:**
Wrong. Every index is a second copy of the indexed columns that has to be kept in sync on every `INSERT`, `UPDATE` (of the indexed column), and `DELETE`. On an OMS trades table doing thousands of inserts per second, adding a 12th index can turn a 5 ms insert into a 40 ms insert, cause lock escalation, and blow up the transaction log. Also:

- Duplicate/overlapping indexes waste buffer pool.
- The optimizer has more choices to consider and can pick a worse plan.
- Rebuild/reorg windows get longer.

Correct rule: index for the queries you actually run, look at `sys.dm_db_index_usage_stats` to drop unused ones, and prefer covering indexes over many single-column indexes.
**Watch-outs:** don't confuse "column has an index" with "query is fast" — a leading-column mismatch means the index is unused.

---

### Q5. "COALESCE and ISNULL are identical."
**Interviewer signal:** vendor-specific SQL trivia — surprisingly common in bank tests.
**Answer:**
Wrong on three counts, at least in SQL Server:

1. **ANSI standard** — `COALESCE` is standard SQL and portable; `ISNULL` is T-SQL specific.
2. **Arity** — `COALESCE` takes N arguments, `ISNULL` takes exactly 2.
3. **Data type resolution** — `ISNULL` returns the type of the first argument (which can silently truncate). `COALESCE` uses data type precedence across all arguments.
4. **NULL-ability of result** — `ISNULL(nullable, non_null)` is treated as non-nullable, which affects how it's used in computed columns and constraints. `COALESCE` is treated as nullable.
5. **Performance** — `COALESCE` is rewritten internally as a `CASE` and can evaluate subqueries multiple times. `ISNULL` evaluates once.

Concrete gotcha: `ISNULL(CAST('' AS VARCHAR(3)), 'ABCDEF')` returns `'ABC'` truncated; `COALESCE` returns `'ABCDEF'`.
**Watch-outs:** on Oracle, `NVL` is the equivalent of `ISNULL`, and `COALESCE` behaves the same way there.

---

### Q6. "READ UNCOMMITTED is fine for trading dashboards."
**Interviewer signal:** do you push back when a PM asks for "faster refresh" on a P&L screen?
**Answer:**
Wrong for anything a trader actually decides on. `READ UNCOMMITTED` exposes dirty reads, missing rows, and duplicate rows as described in Q1. A trader looking at intraday position or open-order counts must not see a state that never committed — that's how you get double-hedged or fat-fingered cancels.

The right answer for a low-latency read path is:

- `READ COMMITTED SNAPSHOT ISOLATION` (RCSI) at the database level — readers see the last committed row version, never block writers.
- Or a read replica / reporting server with async replication if staleness is acceptable.
- Or an in-memory cache with a defined refresh cadence, so the trader knows what "as-of" they're seeing.

**Watch-outs:** "eventual consistency is fine" is a good answer only if the UI shows the as-of timestamp. Silent staleness is worse than slow.

---

### Q7. "SELECT * is fine in production queries."
**Interviewer signal:** do you know the operational cost, not just the style rule?
**Answer:**
Wrong. Beyond style, `SELECT *` causes real production incidents:

- **Schema drift breakage** — someone adds a `BLOB` column to the orders table and every `SELECT *` query now pulls megabytes per row.
- **Covering index defeat** — if you `SELECT *` the optimizer can't use a covering non-clustered index and does a bookmark lookup on the heap/clustered index for every row.
- **Network and serialization cost** — you ship columns the app doesn't use.
- **View / stored procedure breakage** — `SELECT * INTO` and views bind to the shape at creation time.
- **Ambiguity in joins** — duplicate column names, unclear intent for reviewers.

Correct: enumerate columns explicitly. Every column you list is a contract with the caller.
**Watch-outs:** `SELECT *` inside `EXISTS` is fine — the optimizer ignores the projection.

---

### Q8. "A CTE is always faster than a subquery."
**Interviewer signal:** do you know a CTE is syntactic sugar, not a materialization directive (in most engines)?
**Answer:**
Wrong. In SQL Server, MySQL 8+, and non-recursive Postgres CTEs, a CTE is inlined into the query and optimized as if it were a subquery — same plan, same speed. Postgres pre-12 did materialize CTEs (optimization fence), and that could be either faster or slower depending on reuse. Oracle uses the `MATERIALIZE` hint to force materialization.

If a CTE is referenced multiple times in the same query, some engines will re-execute it each time (SQL Server does — no automatic caching). To force materialization for reuse, use a temp table or `#temp`. So the "CTE is faster" claim can invert: a CTE referenced 3 times can be 3x slower than a temp-table equivalent.
**Watch-outs:** recursive CTEs are a different animal — they're the only way to express hierarchical walks in standard SQL and don't have a subquery equivalent.

---

### Q9. "TRUNCATE and DELETE are the same."
**Interviewer signal:** do you know the log behavior, permissions, and constraints difference?
**Answer:**
Wrong. Key differences:

| Aspect | DELETE | TRUNCATE |
|---|---|---|
| Logging | Row-by-row logged | Minimally logged (deallocates pages) |
| Rollback | Full rollback | Rollback works inside a transaction, but log is small |
| Triggers | Fires DELETE triggers | Does not fire triggers |
| Identity | Preserves seed | Resets seed to original |
| Foreign keys | Allowed if cascade set | Blocked if any FK references the table |
| WHERE clause | Yes | No — all rows |
| Permissions | DELETE right | ALTER TABLE right |
| Locking | Row/page locks | Table lock, schema modification |

On an OMS staging table you're clearing between EOD batches, `TRUNCATE` is right — fast, no log bloat. On a live orders table you'd never `TRUNCATE`, and even `DELETE` should be batched with a `TOP (10000)` loop to avoid log growth and lock escalation.
**Watch-outs:** don't say "TRUNCATE can't be rolled back" — it can, inside a transaction. The log is just tiny.

---

### Q10. "Foreign keys always slow down inserts to unacceptable levels."
**Interviewer signal:** are you a "we don't use FKs because vendor said so" cargo-culter?
**Answer:**
Wrong as stated. FK enforcement adds a lookup per insert against the parent index, which is cheap if the parent PK is a small integer with a hot index — typically single-digit microseconds. The cost becomes real only when:

- Parent index isn't in memory (cold parent table).
- FK column is unindexed on the *child* side, so cascade deletes scan the child.
- You're bulk-loading millions of rows and haven't disabled/re-enabled the FK.

The right pattern is: keep FKs on for OLTP correctness, and for bulk loads use `ALTER TABLE ... NOCHECK CONSTRAINT` around the load, then re-enable with `WITH CHECK` so the optimizer trusts the constraint. Also always index the FK column on the child side.

Many OMS vendors disable FKs entirely and enforce referential integrity in the app tier. That's a real design choice, but "unacceptable" is the wrong framing — it's a tradeoff between microseconds of insert latency and hours of debugging orphan rows.
**Watch-outs:** untrusted FKs (`WITH NOCHECK` after a load) don't help the optimizer eliminate joins.

---

### Q11. "Snapshot isolation eliminates all locking."
**Interviewer signal:** do you know the write-write conflict story?
**Answer:**
Wrong. Snapshot isolation eliminates **reader/writer** blocking — readers see a versioned snapshot from tempdb (or the version store) and don't take shared locks. But:

- **Writers still lock writers.** Two transactions updating the same row will still serialize.
- **Under SNAPSHOT (not RCSI), write-write conflicts abort one transaction with error 3960** — "snapshot isolation transaction aborted due to update conflict."
- **Schema locks** still apply — DDL blocks everything.
- **Version store overhead** — tempdb grows, and long-running snapshots can bloat it enough to fail the whole instance.

So snapshot is a huge win for OLTP mixed with reporting, but you still need to design for conflict retries and monitor tempdb.
**Watch-outs:** RCSI and SNAPSHOT are different — RCSI gives statement-level snapshots (each statement sees latest committed), SNAPSHOT gives transaction-level.

---

### Q12. "Function-based indexes are always slower than column indexes."
**Interviewer signal:** do you understand what makes an index sargable?
**Answer:**
Wrong. A function-based (a.k.a. computed-column or expression) index is *the* fix for queries with a function in the `WHERE` clause. Compare:

```sql
-- Non-sargable — index on order_ts is useless
WHERE CONVERT(date, order_ts) = '2026-07-17'

-- Fix option A: rewrite predicate to be sargable
WHERE order_ts >= '2026-07-17' AND order_ts < '2026-07-18'

-- Fix option B: index the expression
CREATE INDEX ix_order_date ON orders (CAST(order_ts AS date));
```

A function-based index on `CAST(order_ts AS date)` is looked up in O(log n) just like a column index. What's actually slow is a plain column index combined with a function wrapper on the query side — the optimizer can't use it.
**Watch-outs:** function-based indexes require deterministic + precise (in SQL Server) or IMMUTABLE (in Postgres) expressions. `GETDATE()` in an index expression won't work.

---

### Q13. "Adding indexes never slows anything down."
**Interviewer signal:** counterpart to Q4 — do you push back on "just add an index"?
**Answer:**
Wrong. Adding indexes has real costs:

- **Write amplification** — every insert/update/delete has to maintain the index.
- **Storage** — non-clustered indexes on wide keys cost real disk.
- **Buffer pool pressure** — the index competes for RAM with hot data.
- **Plan regression** — a new index changes optimizer statistics and can push the optimizer into a worse plan for a different query (parameter sniffing amplification).
- **Rebuild/reorg time** — maintenance windows lengthen.
- **Log growth during creation** — building an index on a 500 GB table can fill the log.

I've seen a "helpful" new index cause a 3 AM batch to timeout because the optimizer switched to it and did key lookups for 20M rows instead of a full scan. Rule: measure before *and* after, and always check `sys.dm_db_index_usage_stats` a week later to see if the new index is actually used.
**Watch-outs:** filtered indexes are often the right answer for skewed data — small, targeted, low maintenance.

---

### Q14. "The optimizer always picks the best plan."
**Interviewer signal:** are you humble about the optimizer, or do you blame the app?
**Answer:**
Wrong. The optimizer picks the best plan it can find in the time it has, from the stats it has, using a cost model that has assumptions. It gets it wrong when:

- **Stats are stale** — auto-update fires at 20% row change (or the SQL 2016+ threshold), which for a billion-row table is 200M rows of drift.
- **Cardinality estimation misfires** — highly skewed columns, correlated predicates, function wrappers, table variables (which the optimizer assumes have 1 row).
- **Parameter sniffing** — the plan cached for the first parameter value is reused for very different subsequent values.
- **Join order combinatorics** — with >6 tables the optimizer times out and picks a heuristic.
- **Missing multi-column stats** — correlated columns like `(instrument_id, venue_id)` need a stats object or extended stats.

Fixes: `OPTION (RECOMPILE)`, `OPTIMIZE FOR UNKNOWN`, plan guides, `USE PLAN`, forced plans in Query Store, or restructuring the query. On an OMS, parameter sniffing on a stored proc that takes `@symbol` is a classic — first call is `IBM` (100 rows), plan cached, next call is `SPY` (10M rows), same plan, timeout.
**Watch-outs:** don't hint your way out of the problem without understanding why. Hints become tech debt.

---

### Q15. "MERGE is atomic and safe under concurrent updates."
**Interviewer signal:** do you know the MERGE bugs and race conditions?
**Answer:**
Wrong on both counts, in SQL Server specifically. `MERGE` is one statement, so it runs in a single implicit transaction, but:

- **It is not race-safe by default.** Two concurrent MERGEs with the same source key can both take the "not matched → insert" branch and cause primary key violations, or worse, duplicate inserts if there's no unique constraint.
- **Microsoft has documented bugs** in `MERGE` around unique indexes, filtered indexes, and target row versioning (see MS Connect / Feedback IDs — Aaron Bertrand has a well-known list of ~15 open bugs).
- **You must lock the target explicitly** — use `MERGE ... WITH (HOLDLOCK)` or `SERIALIZABLE` isolation to make the read of "does this key exist" and the insert atomic.
- **The plan is often worse** than an equivalent `IF EXISTS ... UPDATE ... ELSE INSERT` pattern.

For an OMS upsert of order state, most senior DBAs recommend avoiding `MERGE` and using an explicit `UPDATE` then `INSERT WHERE NOT EXISTS` with `HOLDLOCK`, or `INSERT ... ON CONFLICT` on Postgres, or `INSERT ... ON DUPLICATE KEY UPDATE` on MySQL.
**Watch-outs:** if the interviewer insists MERGE is fine, ask about the Aaron Bertrand "Please, stop using MERGE" post — it's the standard reference.
