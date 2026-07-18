# SQL Exercises — 20 Hands-On Problems

## Table of Contents
1. [Fill % per order](#q1-fill--per-order)
2. [Cumulative traded notional per client per day](#q2-cumulative-traded-notional-per-client-per-day)
3. [Duplicate detection on (ClOrdID, sender, date)](#q3-duplicate-detection-on-clordid-sender-date)
4. [Recursive parent→child firm-order chain](#q4-recursive-parentchild-firm-order-chain)
5. [Top-N symbols by traded volume per desk](#q5-top-n-symbols-by-traded-volume-per-desk)
6. [Orders replaced 3+ times using LAG/LEAD](#q6-orders-replaced-3-times-using-laglead)
7. [Detect gaps in FIX MsgSeqNum](#q7-detect-gaps-in-fix-msgseqnum)
8. [Orders with no ACK within N seconds](#q8-orders-with-no-ack-within-n-seconds)
9. [Position rollup by (client, symbol, side)](#q9-position-rollup-by-client-symbol-side)
10. [Slippage per order](#q10-slippage-per-order)
11. [VWAP fill price per order](#q11-vwap-fill-price-per-order)
12. [Orders overlapping market open cross window](#q12-orders-overlapping-market-open-cross-window)
13. [Symbols with unusual price move vs 20-day avg](#q13-symbols-with-unusual-price-move-vs-20-day-avg)
14. [Top 10 clients by cancel/replace ratio](#q14-top-10-clients-by-cancelreplace-ratio)
15. [Wash trade detection — same client both sides within 5s](#q15-wash-trade-detection)
16. [Messages per FIX session per hour](#q16-messages-per-fix-session-per-hour)
17. [Duplicate fills (same exec_id twice)](#q17-duplicate-fills)
18. [Broker commission bucket by traded notional](#q18-broker-commission-bucket)
19. [Partially filled then cancelled with residual qty](#q19-partially-filled-then-cancelled)
20. [Rolling 30-day trader P&L](#q20-rolling-30-day-trader-pl)

---

## Sample Schema (assumed for all questions)

```sql
orders(order_id, client_id, symbol, side, order_qty, order_price, order_type, tif, status, ts_received, parent_order_id)
fills(fill_id, order_id, fill_qty, fill_px, fill_ts, venue, exec_id)
positions_sod(client_id, symbol, qty, avg_px)
fix_msgs(session_id, msg_seq, sender_comp, target_comp, msg_type, ts)
```

Assume `side` is `'B'` or `'S'`, `status` includes values like `NEW`, `PARTIAL`, `FILLED`, `CANCELLED`, `REPLACED`, `REJECTED`. `parent_order_id` is `NULL` for the root order in a replace chain.

---

### Q1. Fill % per order
**Interviewer signal:** Can I aggregate a child table back to a parent and handle NULLs / zero-fill orders cleanly.

**Problem:** For every order, return `order_id`, `order_qty`, total filled qty, and fill percentage. Include orders with zero fills.

**Expected columns:** `order_id, order_qty, filled_qty, fill_pct`

**Answer:**
```sql
SELECT  o.order_id,
        o.order_qty,
        COALESCE(SUM(f.fill_qty), 0)                        AS filled_qty,
        ROUND(100.0 * COALESCE(SUM(f.fill_qty), 0)
              / NULLIF(o.order_qty, 0), 2)                  AS fill_pct
FROM    orders o
LEFT    JOIN fills f ON f.order_id = o.order_id
GROUP BY o.order_id, o.order_qty;
```

**Why it works:** `LEFT JOIN` keeps orders that never filled. `COALESCE` turns the `NULL` sum into `0`. `NULLIF(order_qty, 0)` guards against divide-by-zero on placeholder orders.

**Watch-outs:** Inner join silently drops zero-fill orders — that hides the exact orders production support cares about. Also do not divide inside SUM — aggregate first, divide once.

---

### Q2. Cumulative traded notional per client per day
**Interviewer signal:** Do I know window functions with partition + order.

**Problem:** For each client and each trading day, produce running-total traded notional (`fill_qty * fill_px`) as fills come in.

**Expected columns:** `client_id, trade_date, fill_ts, notional, cum_notional`

**Answer:**
```sql
SELECT  o.client_id,
        CAST(f.fill_ts AS DATE)                                       AS trade_date,
        f.fill_ts,
        f.fill_qty * f.fill_px                                        AS notional,
        SUM(f.fill_qty * f.fill_px) OVER (
            PARTITION BY o.client_id, CAST(f.fill_ts AS DATE)
            ORDER BY f.fill_ts
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )                                                              AS cum_notional
FROM    fills  f
JOIN    orders o ON o.order_id = f.order_id;
```

**Why it works:** `PARTITION BY client + date` resets the running total each day. `ROWS UNBOUNDED PRECEDING` is the explicit and portable frame — safer than the default `RANGE` when timestamps have duplicates.

**Watch-outs:** Default frame is `RANGE` which will collapse ties in `fill_ts` into one bucket. On a busy stock with 3 fills at the same millisecond, that silently double-counts. Always specify `ROWS`.

---

### Q3. Duplicate detection on (ClOrdID, sender, date)
**Interviewer signal:** Real ops task — spotting duplicate FIX submissions.

**Problem:** From `fix_msgs`, find any (`sender_comp`, `msg_seq`, date) that appears more than once for `msg_type = 'D'` (NewOrderSingle). Assume `msg_seq` is being reused as `ClOrdID` for the exercise.

**Expected columns:** `sender_comp, msg_seq, trade_date, dup_count`

**Answer:**
```sql
SELECT  sender_comp,
        msg_seq,
        CAST(ts AS DATE) AS trade_date,
        COUNT(*)         AS dup_count
FROM    fix_msgs
WHERE   msg_type = 'D'
GROUP BY sender_comp, msg_seq, CAST(ts AS DATE)
HAVING  COUNT(*) > 1;
```

**Why it works:** Aggregate on the natural key that should be unique, then filter with `HAVING`. This is the canonical way to find duplicates without a self-join.

**Watch-outs:** A self-join on `msg_seq` also works but is O(n²). Also — some counterparties reuse ClOrdID across days legitimately, so the date is part of the key.

---

### Q4. Recursive parent→child firm-order chain
**Interviewer signal:** CTE / recursion. Standard OMS interview question because a cancel/replace chain is a tree.

**Problem:** Given a root `order_id`, return every descendant (child, grandchild, …) with its depth.

**Expected columns:** `order_id, parent_order_id, depth`

**Answer:**
```sql
WITH RECURSIVE chain AS (
    SELECT  order_id, parent_order_id, 0 AS depth
    FROM    orders
    WHERE   order_id = :root_order_id

    UNION ALL

    SELECT  o.order_id, o.parent_order_id, c.depth + 1
    FROM    orders o
    JOIN    chain  c ON o.parent_order_id = c.order_id
)
SELECT * FROM chain;
```

**Why it works:** Anchor picks the root. Recursive term joins each level's children until no more rows are produced. `depth` counts hops.

**Watch-outs:** Add a `depth < 50` guard in production — a bad data cycle (child pointing back at ancestor) will loop until the engine kills it. In PostgreSQL use `CYCLE` clause; in SQL Server / Oracle use `MAXRECURSION` option / `NOCYCLE`.

---

### Q5. Top-N symbols by traded volume per desk
**Interviewer signal:** Window function `ROW_NUMBER` per partition — "top-N in group" pattern.

**Problem:** For each `client_id` (proxy for desk), return the top 5 symbols by total filled quantity.

**Expected columns:** `client_id, symbol, filled_qty, rn`

**Answer:**
```sql
WITH agg AS (
    SELECT  o.client_id,
            o.symbol,
            SUM(f.fill_qty) AS filled_qty
    FROM    orders o
    JOIN    fills  f ON f.order_id = o.order_id
    GROUP BY o.client_id, o.symbol
)
SELECT  client_id, symbol, filled_qty, rn
FROM (
    SELECT  a.*,
            ROW_NUMBER() OVER (PARTITION BY client_id
                               ORDER BY filled_qty DESC) AS rn
    FROM    agg a
) t
WHERE   rn <= 5;
```

**Why it works:** Aggregate first, then rank inside each desk. `ROW_NUMBER` guarantees exactly 5 rows even on ties; use `RANK` if you want to include ties for 5th place.

**Watch-outs:** Filtering `WHERE rn <= 5` in the same SELECT as the window function does not work — window is evaluated after WHERE. Wrap in a subquery / CTE.

---

### Q6. Orders replaced 3+ times using LAG/LEAD
**Interviewer signal:** Can I chase parent chains without recursion when the depth is bounded.

**Problem:** Find every root order whose chain has 3 or more replacements (i.e. 4+ nodes total).

**Expected columns:** `root_order_id, chain_length`

**Answer:**
```sql
WITH RECURSIVE chain AS (
    SELECT  order_id AS root_order_id, order_id, parent_order_id, 1 AS len
    FROM    orders
    WHERE   parent_order_id IS NULL

    UNION ALL

    SELECT  c.root_order_id, o.order_id, o.parent_order_id, c.len + 1
    FROM    orders o
    JOIN    chain  c ON o.parent_order_id = c.order_id
)
SELECT  root_order_id, MAX(len) AS chain_length
FROM    chain
GROUP BY root_order_id
HAVING  MAX(len) >= 4;
```

**Why it works:** The recursive CTE labels every row with its root, then we count nodes per root and filter. LAG/LEAD alone cannot walk an arbitrary-length tree, so recursion is the honest answer — flag that to the interviewer.

**Watch-outs:** If the interviewer insists on LAG only, they are implicitly assuming a flat sequential design (one row per version with a monotonically increasing `revision_no`) — clarify the schema.

---

### Q7. Detect gaps in FIX MsgSeqNum
**Interviewer signal:** Support day-one skill — spotting missing sequence numbers per session.

**Problem:** For each session, find where the next `msg_seq` is not `prev + 1`.

**Expected columns:** `session_id, prev_seq, next_seq, gap_size`

**Answer:**
```sql
WITH ordered AS (
    SELECT  session_id,
            msg_seq,
            LEAD(msg_seq) OVER (PARTITION BY session_id
                                ORDER BY msg_seq) AS next_seq
    FROM    fix_msgs
)
SELECT  session_id,
        msg_seq        AS prev_seq,
        next_seq,
        next_seq - msg_seq - 1 AS gap_size
FROM    ordered
WHERE   next_seq IS NOT NULL
  AND   next_seq <> msg_seq + 1;
```

**Why it works:** `LEAD` gives me the next sequence in the session; any row where `next_seq > msg_seq + 1` is a gap of size `next_seq - msg_seq - 1`.

**Watch-outs:** FIX sessions reset seq to 1 on logon by default, so include a `logon_ts` filter or partition by (session_id, logon_date). Otherwise a valid daily reset looks like a giant negative gap.

---

### Q8. Orders with no ACK within N seconds of ts_received
**Interviewer signal:** Anti-join / NOT EXISTS. Bread-and-butter latency alert.

**Problem:** List orders that received no ExecutionReport (`msg_type='8'`) from the broker within 3 seconds of `ts_received`. Assume `fix_msgs.msg_seq` matches `orders.order_id` for the exercise, and the broker is `sender_comp`.

**Expected columns:** `order_id, client_id, symbol, ts_received`

**Answer:**
```sql
SELECT  o.order_id, o.client_id, o.symbol, o.ts_received
FROM    orders o
WHERE   NOT EXISTS (
            SELECT 1
            FROM   fix_msgs m
            WHERE  m.msg_type = '8'
              AND  m.msg_seq  = o.order_id
              AND  m.ts BETWEEN o.ts_received
                            AND o.ts_received + INTERVAL '3 seconds'
        );
```

**Why it works:** `NOT EXISTS` short-circuits once a single ACK is found — faster than `LEFT JOIN … WHERE m.msg_seq IS NULL` on wide tables. The time-bounded correlated predicate is what makes it a latency check, not a coverage check.

**Watch-outs:** `NOT IN` breaks silently on `NULL` matching rows. Use `NOT EXISTS`. Also — make sure `fix_msgs.ts` has an index or this scan will hurt.

---

### Q9. Position rollup by (client, symbol, side)
**Interviewer signal:** Signed aggregation — do I know to negate sells.

**Problem:** Combine `positions_sod` with today's fills to produce end-of-day position per client/symbol. Buys add, sells subtract.

**Expected columns:** `client_id, symbol, sod_qty, traded_qty, eod_qty`

**Answer:**
```sql
WITH traded AS (
    SELECT  o.client_id,
            o.symbol,
            SUM(CASE WHEN o.side = 'B' THEN  f.fill_qty
                     WHEN o.side = 'S' THEN -f.fill_qty
                END) AS traded_qty
    FROM    orders o
    JOIN    fills  f ON f.order_id = o.order_id
    WHERE   CAST(f.fill_ts AS DATE) = CURRENT_DATE
    GROUP BY o.client_id, o.symbol
)
SELECT  COALESCE(s.client_id, t.client_id)    AS client_id,
        COALESCE(s.symbol,    t.symbol)       AS symbol,
        COALESCE(s.qty, 0)                    AS sod_qty,
        COALESCE(t.traded_qty, 0)             AS traded_qty,
        COALESCE(s.qty, 0) + COALESCE(t.traded_qty, 0) AS eod_qty
FROM    positions_sod s
FULL    OUTER JOIN traded t
        ON  s.client_id = t.client_id
        AND s.symbol    = t.symbol;
```

**Why it works:** `CASE` inside `SUM` gives signed netting per side. `FULL OUTER JOIN` covers new positions opened today (no SOD row) and closed positions (no trades today).

**Watch-outs:** If dialect lacks FULL OUTER (MySQL), emulate with two LEFT JOINs and a UNION. Also — short positions live as negative SOD; do not filter them out.

---

### Q10. Slippage per order
**Interviewer signal:** TCA / execution-quality math.

**Problem:** Given a `decision_px` column (assume added to `orders`), compute per-order slippage in basis points. Buy slippage = fill − decision; sell slippage = decision − fill.

**Expected columns:** `order_id, side, decision_px, avg_fill_px, slippage_bps`

**Answer:**
```sql
WITH fp AS (
    SELECT  order_id,
            SUM(fill_qty * fill_px) / NULLIF(SUM(fill_qty), 0) AS avg_fill_px
    FROM    fills
    GROUP BY order_id
)
SELECT  o.order_id,
        o.side,
        o.decision_px,
        fp.avg_fill_px,
        CASE WHEN o.side = 'B'
             THEN (fp.avg_fill_px - o.decision_px) / o.decision_px * 10000
             ELSE (o.decision_px - fp.avg_fill_px) / o.decision_px * 10000
        END AS slippage_bps
FROM    orders o
JOIN    fp     ON fp.order_id = o.order_id;
```

**Why it works:** VWAP fill price is the fair reference. Side multiplier flips the sign so positive slippage always means "worse than decision" regardless of buy/sell.

**Watch-outs:** Dividing by fill price versus decision price is a business convention — clarify with the desk. Also multiply by 10000 for bps, not 100.

---

### Q11. VWAP fill price per order
**Interviewer signal:** Weighted average — do I write `SUM(x*w)/SUM(w)` or the wrong `AVG(x)`.

**Problem:** Compute the volume-weighted average fill price for each order.

**Expected columns:** `order_id, total_qty, vwap`

**Answer:**
```sql
SELECT  order_id,
        SUM(fill_qty)                                        AS total_qty,
        SUM(fill_qty * fill_px) / NULLIF(SUM(fill_qty), 0)   AS vwap
FROM    fills
GROUP BY order_id;
```

**Why it works:** VWAP = Σ(price × qty) / Σ(qty). Anything that reduces to plain `AVG(fill_px)` is wrong because a 100k-share fill at 50.01 and a 100-share fill at 55.00 must not have equal weight.

**Watch-outs:** `NULLIF(SUM(fill_qty),0)` prevents divide-by-zero for orders that never filled but somehow have a row (data-quality edge). Also cast to numeric — integer division silently truncates in some dialects.

---

### Q12. Orders overlapping market open cross window
**Interviewer signal:** Range filter + edge conditions around auctions.

**Problem:** Return every order whose `ts_received` falls in the US open cross window 09:29:30–09:30:00 ET on any trading day.

**Expected columns:** `order_id, client_id, symbol, ts_received`

**Answer:**
```sql
SELECT  order_id, client_id, symbol, ts_received
FROM    orders
WHERE   CAST(ts_received AS TIME) >= TIME '09:29:30'
  AND   CAST(ts_received AS TIME) <  TIME '09:30:00'
  AND   EXTRACT(ISODOW FROM ts_received) BETWEEN 1 AND 5;
```

**Why it works:** Casting to `TIME` lets me express the intra-day auction window independent of date. `ISODOW BETWEEN 1 AND 5` filters weekends cheaply; a real system would join against an exchange calendar table for holidays.

**Watch-outs:** Timestamps must already be in ET. If they are stored in UTC, convert first — otherwise every summer/winter DST switch produces a 60-minute gap of missed orders.

---

### Q13. Symbols with unusual price move vs 20-day avg
**Interviewer signal:** Window function with a rolling frame plus a threshold rule.

**Problem:** For each symbol, compare today's average fill price to the trailing 20-day average and flag anything more than 3σ away.

**Expected columns:** `symbol, trade_date, today_px, avg_20d, stddev_20d, z_score`

**Answer:**
```sql
WITH daily AS (
    SELECT  o.symbol,
            CAST(f.fill_ts AS DATE) AS trade_date,
            SUM(f.fill_qty * f.fill_px) / NULLIF(SUM(f.fill_qty),0) AS vwap_px
    FROM    fills  f
    JOIN    orders o ON o.order_id = f.order_id
    GROUP BY o.symbol, CAST(f.fill_ts AS DATE)
),
rolled AS (
    SELECT  d.*,
            AVG(vwap_px) OVER w AS avg_20d,
            STDDEV(vwap_px) OVER w AS stddev_20d
    FROM    daily d
    WINDOW w AS (PARTITION BY symbol ORDER BY trade_date
                 ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING)
)
SELECT  symbol, trade_date,
        vwap_px AS today_px,
        avg_20d, stddev_20d,
        (vwap_px - avg_20d) / NULLIF(stddev_20d, 0) AS z_score
FROM    rolled
WHERE   trade_date = CURRENT_DATE
  AND   ABS((vwap_px - avg_20d) / NULLIF(stddev_20d, 0)) > 3;
```

**Why it works:** Named `WINDOW w` gets reused for avg and stddev. Frame is `20 PRECEDING AND 1 PRECEDING` — deliberately excludes today so the z-score compares "today vs history", not "today vs history including today".

**Watch-outs:** Rolling calendar days ≠ rolling trading days. On a holiday, the window contains fewer than 20 real trading days. Fix by dense-ranking by trading day first, then framing on that rank.

---

### Q14. Top 10 clients by cancel/replace ratio
**Interviewer signal:** Ratio metric with edge cases; a common client-behaviour analytic.

**Problem:** Rank clients by (cancels + replaces) / new orders, high to low.

**Expected columns:** `client_id, new_count, cxl_rep_count, cxl_rep_ratio`

**Answer:**
```sql
WITH counts AS (
    SELECT  client_id,
            SUM(CASE WHEN status = 'NEW'                       THEN 1 ELSE 0 END) AS new_count,
            SUM(CASE WHEN status IN ('CANCELLED','REPLACED')   THEN 1 ELSE 0 END) AS cxl_rep_count
    FROM    orders
    GROUP BY client_id
)
SELECT  client_id, new_count, cxl_rep_count,
        ROUND(1.0 * cxl_rep_count / NULLIF(new_count, 0), 3) AS cxl_rep_ratio
FROM    counts
WHERE   new_count > 0
ORDER BY cxl_rep_ratio DESC
LIMIT 10;
```

**Why it works:** Conditional sums give both counters in one pass. Ratio is guarded against zero-new (a client with only cancels is a data-quality alert, not a legit ratio).

**Watch-outs:** If the same order is captured in multiple rows (once per state transition), you'll double-count. Prefer to aggregate against a state-changes fact table, not a mutable orders row.

---

### Q15. Wash trade detection
**Interviewer signal:** Time-window self-join; compliance-flavoured.

**Problem:** Find pairs of orders from the same client on the same symbol on opposite sides where both were received within 5 seconds of each other.

**Expected columns:** `client_id, symbol, buy_order_id, sell_order_id, gap_seconds`

**Answer:**
```sql
SELECT  b.client_id,
        b.symbol,
        b.order_id AS buy_order_id,
        s.order_id AS sell_order_id,
        EXTRACT(EPOCH FROM (s.ts_received - b.ts_received)) AS gap_seconds
FROM    orders b
JOIN    orders s
        ON  b.client_id = s.client_id
        AND b.symbol    = s.symbol
        AND b.side = 'B' AND s.side = 'S'
        AND s.ts_received BETWEEN b.ts_received
                              AND b.ts_received + INTERVAL '5 seconds';
```

**Why it works:** Self-join keyed on client + symbol, restricted to buy-on-one-side / sell-on-the-other, with a bounded time window. That is the textbook wash-trade shape.

**Watch-outs:** Same-second orders on both sides are legitimate for a market-maker; do not flag those without an accompanying "same account" filter. Also the reciprocal pair (sell-first then buy) needs a mirror query or a symmetric predicate `ABS(EXTRACT(EPOCH ...)) <= 5` with side inequality.

---

### Q16. Messages per FIX session per hour
**Interviewer signal:** Time bucketing.

**Problem:** Bucket `fix_msgs` by session and hour of day; count messages per bucket.

**Expected columns:** `session_id, hour_bucket, msg_count`

**Answer:**
```sql
SELECT  session_id,
        DATE_TRUNC('hour', ts) AS hour_bucket,
        COUNT(*)               AS msg_count
FROM    fix_msgs
GROUP BY session_id, DATE_TRUNC('hour', ts)
ORDER BY session_id, hour_bucket;
```

**Why it works:** `DATE_TRUNC` (Postgres) collapses timestamps into hour bins. Any equivalent — `TRUNC(ts,'HH')` in Oracle, `DATETRUNC(hour, ts)` in modern SQL Server — works identically.

**Watch-outs:** The default result skips hours with zero traffic. If the desk wants a heatmap, cross-join against a generated hour spine and LEFT JOIN so empty buckets show as zero.

---

### Q17. Duplicate fills
**Interviewer signal:** Data-integrity check that surfaces broker-side bugs.

**Problem:** Find any `exec_id` present more than once in `fills`.

**Expected columns:** `exec_id, dup_count`

**Answer:**
```sql
SELECT  exec_id, COUNT(*) AS dup_count
FROM    fills
WHERE   exec_id IS NOT NULL
GROUP BY exec_id
HAVING  COUNT(*) > 1;
```

**Why it works:** `exec_id` is the venue-issued unique key per execution. Duplicates almost always mean the OMS booked the same fill twice — either replay after reconnect or a downstream double-post.

**Watch-outs:** Some venues legitimately reuse exec_id across sessions/days. Widen to `(venue, exec_id, CAST(fill_ts AS DATE))` if that is the convention. Ignoring `NULL` avoids counting placeholder fills.

---

### Q18. Broker commission bucket
**Interviewer signal:** `CASE` bucketing + aggregation.

**Problem:** For each broker (`venue` in fills), classify each day's traded notional into `LOW` (<$1M), `MID` ($1M–$10M), `HIGH` (>$10M) and count days per bucket.

**Expected columns:** `venue, bucket, day_count, avg_daily_notional`

**Answer:**
```sql
WITH daily AS (
    SELECT  venue,
            CAST(fill_ts AS DATE)        AS trade_date,
            SUM(fill_qty * fill_px)      AS daily_notional
    FROM    fills
    GROUP BY venue, CAST(fill_ts AS DATE)
)
SELECT  venue,
        CASE WHEN daily_notional <  1000000    THEN 'LOW'
             WHEN daily_notional <= 10000000   THEN 'MID'
             ELSE                                    'HIGH'
        END                            AS bucket,
        COUNT(*)                       AS day_count,
        AVG(daily_notional)            AS avg_daily_notional
FROM    daily
GROUP BY venue,
         CASE WHEN daily_notional <  1000000    THEN 'LOW'
              WHEN daily_notional <= 10000000   THEN 'MID'
              ELSE                                    'HIGH'
         END;
```

**Why it works:** Aggregate daily first, then bucket the daily totals — that keeps low-notional days out of the HIGH bucket even if the whole month sums into millions.

**Watch-outs:** Repeating the CASE in `GROUP BY` is ugly but portable; some dialects allow `GROUP BY bucket` by alias (Postgres), some do not (SQL Server). Wrap in a subquery if you prefer.

---

### Q19. Partially filled then cancelled
**Interviewer signal:** State-machine reasoning against a mutable row.

**Problem:** List orders currently in status `CANCELLED` that had at least one fill and residual quantity > 0.

**Expected columns:** `order_id, order_qty, filled_qty, residual_qty`

**Answer:**
```sql
SELECT  o.order_id,
        o.order_qty,
        SUM(f.fill_qty)                     AS filled_qty,
        o.order_qty - SUM(f.fill_qty)       AS residual_qty
FROM    orders o
JOIN    fills  f ON f.order_id = o.order_id
WHERE   o.status = 'CANCELLED'
GROUP BY o.order_id, o.order_qty
HAVING  SUM(f.fill_qty) > 0
   AND  o.order_qty - SUM(f.fill_qty) > 0;
```

**Why it works:** `INNER JOIN` ensures at least one fill exists; the `HAVING` clause enforces positive residual and positive filled. That is exactly the "cancelled with unfilled leaves" signature.

**Watch-outs:** If cancels happen after a replace, you may be looking at the child order — the parent's original qty is what the desk usually cares about. Traverse `parent_order_id` if the desk wants a root view.

---

### Q20. Rolling 30-day trader P&L
**Interviewer signal:** Multi-day window with a real business metric.

**Problem:** Assume a `pnl_daily(trader_id, trade_date, pnl)` view. Compute rolling 30-day P&L for each trader.

**Expected columns:** `trader_id, trade_date, daily_pnl, rolling_30d_pnl`

**Answer:**
```sql
SELECT  trader_id,
        trade_date,
        pnl AS daily_pnl,
        SUM(pnl) OVER (
            PARTITION BY trader_id
            ORDER BY trade_date
            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
        ) AS rolling_30d_pnl
FROM    pnl_daily;
```

**Why it works:** `ROWS BETWEEN 29 PRECEDING AND CURRENT ROW` gives me a 30-row trailing window per trader. Ordered by date, partitioned by trader — each trader gets an independent rolling sum.

**Watch-outs:** This is a 30-*row* window, not a 30-*calendar-day* window. If a trader is missing rows for weekends/holidays that is fine; if they are missing rows because they were on leave, the window silently reaches further back. Use `RANGE BETWEEN INTERVAL '30 days' PRECEDING AND CURRENT ROW` for a strict calendar window (Postgres 11+).
