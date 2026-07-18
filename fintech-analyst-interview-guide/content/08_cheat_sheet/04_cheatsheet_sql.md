# SQL — One-Page Reference

> Optimized for trading-DB use cases: fills, orders, positions, market data. Syntax is ANSI where possible; Oracle/SQL Server/Postgres variations flagged.

---

## Contents

- [1. Window functions — syntax skeleton](#1-window-functions--syntax-skeleton)
- [2. Join types — behavior matrix](#2-join-types--behavior-matrix)
- [3. Isolation levels & anomalies](#3-isolation-levels--anomalies)
- [4. NULL semantics](#4-null-semantics)
- [5. Query plan reading](#5-query-plan-reading)
- [6. Trading-DB recipes](#6-trading-db-recipes)
- [7. Anti-patterns](#7-anti-patterns)
- [8. Trivia](#8-trivia)

---

## 1. Window functions — syntax skeleton

```sql
SELECT
  order_id,
  fill_time,
  fill_qty,
  fill_price,
  -- ranking
  ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY fill_time)      AS fill_seq,
  RANK()       OVER (PARTITION BY symbol   ORDER BY fill_price DESC) AS px_rank,
  DENSE_RANK() OVER (PARTITION BY symbol   ORDER BY fill_price DESC) AS px_drank,
  NTILE(4)     OVER (ORDER BY fill_qty)                              AS qty_quartile,
  -- offsets
  LAG(fill_price, 1)  OVER (PARTITION BY order_id ORDER BY fill_time) AS prev_px,
  LEAD(fill_price, 1) OVER (PARTITION BY order_id ORDER BY fill_time) AS next_px,
  -- aggregates as window
  SUM(fill_qty) OVER (PARTITION BY order_id ORDER BY fill_time
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_qty,
  AVG(fill_price) OVER (PARTITION BY order_id ORDER BY fill_time
                        ROWS BETWEEN 4 PRECEDING AND CURRENT ROW)       AS mavg5,
  -- first/last
  FIRST_VALUE(fill_price) OVER (PARTITION BY order_id ORDER BY fill_time) AS first_px,
  LAST_VALUE(fill_price)  OVER (PARTITION BY order_id ORDER BY fill_time
                                ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_px
FROM fills;
```

**Frame keywords:**
- `ROWS` = physical rows (deterministic once ORDER BY is unique).
- `RANGE` = value-based (all peers with same ORDER BY value included).
- `UNBOUNDED PRECEDING`, `N PRECEDING`, `CURRENT ROW`, `N FOLLOWING`, `UNBOUNDED FOLLOWING`.

**Default frame** if omitted: `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` — beware `LAST_VALUE` returns current row unless you extend the frame.

## 2. Join types — behavior matrix

| Join | Kept from left? | Kept from right? | Match rows |
|------|-----------------|------------------|------------|
| `INNER JOIN` | matched only | matched only | matching |
| `LEFT [OUTER] JOIN` | all | matched only | matching |
| `RIGHT [OUTER] JOIN` | matched only | all | matching |
| `FULL [OUTER] JOIN` | all | all | matching |
| `CROSS JOIN` | all | all | cartesian |
| `LEFT SEMI JOIN` (Spark, some DBs) | matched left | — | left rows w/ ≥1 match |
| `LEFT ANTI JOIN` | unmatched left | — | left rows w/ 0 matches |
| `LATERAL / APPLY` | all left | correlated right | per-row subquery |

**Reads-well pattern for "orders with no fills":**

```sql
SELECT o.*
FROM orders o
LEFT JOIN fills f ON f.order_id = o.order_id
WHERE f.order_id IS NULL;

-- or, cleaner:
SELECT o.*
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM fills f WHERE f.order_id = o.order_id);
```

## 3. Isolation levels & anomalies

| Level | Dirty read | Non-repeatable read | Phantom read | Lost update |
|-------|:---:|:---:|:---:|:---:|
| Read Uncommitted | possible | possible | possible | possible |
| **Read Committed** (default: Oracle, Postgres, SQL Server RC) | no | possible | possible | possible |
| **Repeatable Read** (default: MySQL InnoDB) | no | no | possible* | no |
| **Serializable** | no | no | no | no |
| **Snapshot** (SQL Server, Oracle read-consistency) | no | no | no (write-skew possible) | no |

\* Postgres RR uses SSI so phantoms and write-skew are also prevented.

**Trading systems:** OMS usually uses **Read Committed** for OLTP, with row-level locking (`SELECT ... FOR UPDATE`) around order-state transitions. Reporting uses **Snapshot/Serializable** for reproducibility.

## 4. NULL semantics

- `NULL = NULL` → **NULL** (not TRUE). Use `IS NULL` / `IS NOT NULL`.
- `NULL` in `WHERE` filter drops the row.
- `COUNT(*)` counts rows including NULLs; `COUNT(col)` skips NULLs.
- `SUM`, `AVG`, `MIN`, `MAX` skip NULLs.
- `NULL` sorts last by default in ASC (Postgres/Oracle); use `NULLS FIRST`/`NULLS LAST` to override.
- `IN (...)` with a NULL in the list can hide misses; `NOT IN (subquery_with_NULL)` → always empty. Use `NOT EXISTS`.
- `CONCAT` in Oracle treats NULL as empty; SQL Server pre-2017 returned NULL — use `CONCAT()` function (not `||`).

## 5. Query plan reading

**Operators to recognize:**

| Op | Meaning | Good/bad |
|---|---|---|
| Seq / Table Scan | full table read | fine for small tables; red flag on multi-M row tables filtered narrowly |
| Index Seek / Range Scan | uses index B-tree | usually good |
| Index Scan | full traversal of an index (all leaves) | mediocre |
| Bitmap Heap Scan | Postgres; multi-key OR/AND on indexes | good on selective composite |
| Nested Loop | for each outer row, probe inner | great when outer is small |
| Hash Join | build hash on smaller side, probe with larger | great for big × big equi-joins |
| Merge Join | both sides sorted | wins when data already sorted (indexed) |
| Sort | explicit sort — memory or spill-to-disk | disk spill = tune `work_mem` |
| Aggregate | HashAggregate vs GroupAggregate | Hash if fits memory |

**Common wins:**
- Filter early (predicate pushdown).
- Cover the predicate + projected columns with a single **covering index** (`INCLUDE` clause).
- Avoid `SELECT *` in prod code.
- `EXISTS` beats `IN` when subquery is large; `IN` fine when list is small.
- Use `EXPLAIN (ANALYZE, BUFFERS)` (Postgres) or `SET STATISTICS IO ON` (SQL Server).

## 6. Trading-DB recipes

### 6.1 Reconstruct order state at a point in time (SCD-style history)

```sql
SELECT *
FROM order_history h
WHERE h.order_id = :oid
  AND :asof BETWEEN h.valid_from AND COALESCE(h.valid_to, TIMESTAMP '9999-12-31')
ORDER BY h.valid_from DESC
FETCH FIRST 1 ROW ONLY;   -- Oracle 12c+ / ANSI
-- SQL Server: TOP 1
-- Postgres:   LIMIT 1
```

### 6.2 VWAP by symbol per hour

```sql
SELECT
  symbol,
  DATE_TRUNC('hour', fill_time) AS bucket,      -- Postgres; SQL Server: DATETIMEFROMPARTS or DATEADD/DATEPART
  SUM(fill_qty * fill_price) / NULLIF(SUM(fill_qty), 0) AS vwap,
  SUM(fill_qty) AS vol
FROM fills
WHERE fill_time >= CURRENT_DATE
GROUP BY symbol, DATE_TRUNC('hour', fill_time)
ORDER BY symbol, bucket;
```

### 6.3 Find missing FIX sequence numbers per session per day

```sql
WITH bounds AS (
  SELECT session_id, trade_date, MIN(seq_num) mn, MAX(seq_num) mx
  FROM fix_msgs GROUP BY session_id, trade_date
),
allnums AS (
  SELECT b.session_id, b.trade_date,
         LEVEL AS seq_num          -- Oracle CONNECT BY
  FROM bounds b
  CONNECT BY LEVEL BETWEEN mn AND mx
)
SELECT a.session_id, a.trade_date, a.seq_num
FROM allnums a
LEFT JOIN fix_msgs m
  ON m.session_id = a.session_id AND m.trade_date = a.trade_date AND m.seq_num = a.seq_num
WHERE m.seq_num IS NULL;

-- Postgres alternative using generate_series
SELECT b.session_id, b.trade_date, s AS seq_num
FROM bounds b, LATERAL generate_series(b.mn, b.mx) s
LEFT JOIN fix_msgs m USING (session_id, trade_date)
WHERE m.seq_num IS NULL;
```

### 6.4 Running P&L on a position

```sql
SELECT
  order_id, fill_time, fill_qty, fill_price,
  SUM(CASE WHEN side='B' THEN  fill_qty ELSE -fill_qty END)
      OVER (PARTITION BY symbol ORDER BY fill_time) AS running_pos,
  SUM(CASE WHEN side='B' THEN -fill_qty*fill_price ELSE fill_qty*fill_price END)
      OVER (PARTITION BY symbol ORDER BY fill_time) AS running_cash
FROM fills
WHERE symbol = :sym
ORDER BY fill_time;
```

### 6.5 Top N per group (avoid RANK ties)

```sql
SELECT * FROM (
  SELECT f.*,
         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY fill_qty*fill_price DESC) rn
  FROM fills f
) WHERE rn <= 3;
```

### 6.6 Detect gaps in a time series (missing minute bars)

```sql
WITH t AS (
  SELECT trade_time, LAG(trade_time) OVER (ORDER BY trade_time) prev
  FROM ticks WHERE symbol=:sym
)
SELECT prev AS gap_start, trade_time AS gap_end,
       EXTRACT(EPOCH FROM (trade_time - prev)) AS gap_secs
FROM t WHERE trade_time - prev > INTERVAL '1 minute';
```

### 6.7 Deadlock-avoidance pattern (always take locks in the same key order)

```sql
BEGIN TRANSACTION;
SELECT ... FROM order o WHERE o.id IN (:a, :b) ORDER BY o.id FOR UPDATE;
-- always ORDER BY the locking key
UPDATE order SET status='CANCELLED' WHERE id IN (:a, :b);
COMMIT;
```

### 6.8 UPSERT (insert-or-update)

```sql
-- Postgres
INSERT INTO positions(account, symbol, qty)
VALUES (:a, :s, :q)
ON CONFLICT (account, symbol) DO UPDATE
SET qty = positions.qty + EXCLUDED.qty;

-- Oracle: MERGE
MERGE INTO positions p
USING (SELECT :a acct, :s sym, :q qty FROM dual) src
ON (p.account=src.acct AND p.symbol=src.sym)
WHEN MATCHED THEN UPDATE SET p.qty = p.qty + src.qty
WHEN NOT MATCHED THEN INSERT (account,symbol,qty) VALUES (src.acct,src.sym,src.qty);

-- SQL Server: MERGE (careful; use OUTPUT and target hint)
```

## 7. Anti-patterns

| Anti-pattern | Why bad | Fix |
|---|---|---|
| `SELECT *` in prod code | Breaks on schema evolution; hurts covering-index use | List columns |
| Function on indexed column: `WHERE UPPER(email)=...` | Kills index seek | Store normalized, or expression index |
| Implicit type conversion | Same as above | Match types explicitly |
| Correlated subquery in `SELECT` list | N+1 pattern | Rewrite as JOIN / window |
| `OR` across different columns | Poor plan | UNION ALL or IN |
| `NOT IN` with NULLs | Empty result surprise | `NOT EXISTS` |
| Cursors when set-based works | Row-by-row = row-by-agonizing-row | Set operations |
| Multi-statement without a tx | Partial updates on crash | Explicit `BEGIN..COMMIT` |
| Missing composite index for WHERE + ORDER BY | Extra sort step | Composite matching filter+order |

## 8. Trivia

- **Cluster factor / clustering** matters for range scans on Oracle heap tables; SQL Server has clustered indexes.
- **Materialized views** rebuild on refresh; **views** are just query rewrites.
- **CTE (`WITH`)** in Postgres <12 was an optimization fence (always materialized) — 12+ inline unless `MATERIALIZED` keyword.
- **`RETURNING`** (Postgres/Oracle) gives you the row(s) written by DML — useful in trading `NEXT VAL` sequences.
- **Advisory locks** (Postgres `pg_advisory_lock`) — for cross-tx coordination.
- **Partitioning strategies:** RANGE (date), LIST (symbol/venue), HASH (order_id).
- **CDC / logical replication** — how downstream analytics DBs stay in sync.
