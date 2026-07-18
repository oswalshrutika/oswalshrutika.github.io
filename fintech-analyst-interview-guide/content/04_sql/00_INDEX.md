# 04 — SQL for OMS Support

Interview prep pack for Technical Analyst / Production Support roles at investment banks and trading firms. Focus: SQL you will actually use to diagnose trading issues on Sybase ASE / Oracle / MSSQL / Postgres backing a vendor OMS.

## Files in this pack

| File | Purpose | Volume |
|------|---------|--------|
| [01_comprehensive.md](01_comprehensive.md) | Full reference: joins, CTEs, windows, isolation, MVCC, plans, vendor differences, OMS patterns | 100+ Q&A |
| [02_focused.md](02_focused.md) | Ranked shortlist — the 50 questions most likely to be asked | 50 Q&A |
| [03_quick_hit.md](03_quick_hit.md) | Rapid-fire drills, one-liner answers | 25 Q&A |
| [05_red_flags.md](05_red_flags.md) | Wrong-answer patterns that will torpedo the interview | 15 items |
| [06_mock_interview.md](06_mock_interview.md) | Three full dialogues: live-coding, EOD slow-query diagnosis, trade audit log design | 3 mocks |
| [07_exercises.md](07_exercises.md) | 20 hands-on problems on `orders`/`fills`/`positions` schema with solutions | 20 problems |

## How to use this pack

1. **Day 1** — read `01_comprehensive.md` end-to-end. Star anything unfamiliar.
2. **Day 2** — drill `03_quick_hit.md` and `05_red_flags.md`. Say answers aloud.
3. **Day 3** — work `07_exercises.md` cold on paper before checking answers.
4. **Day of** — re-read `02_focused.md` and rehearse `06_mock_interview.md`.

## Scope

- **In**: ANSI SQL, joins, window functions, CTEs, execution plans, indexing, isolation & MVCC, deadlocks, Sybase ASE quirks, Oracle vs Postgres vs MSSQL vs MySQL differences, OMS/FIX-shaped queries (orders, fills, positions, EOD snapshots, audit journals).
- **Out**: NoSQL, kdb+/q (see the market-data pack), ORM internals, admin/DBA-only topics (unless it materially affects support).

## Assumed background

Five years supporting a vendor OMS. Comfortable reading FIX logs, running production queries under pressure, and pushing back on developers when the plan is wrong.

## Reference schema used throughout

```sql
-- Simplified OMS schema referenced by examples & exercises
CREATE TABLE orders (
    order_id       BIGINT       PRIMARY KEY,
    parent_id      BIGINT       NULL,          -- self-ref for child slices
    clordid        VARCHAR(32)  NOT NULL,
    sender         VARCHAR(16)  NOT NULL,      -- SenderCompID
    client_id      VARCHAR(16)  NOT NULL,
    symbol         VARCHAR(16)  NOT NULL,
    side           CHAR(1)      NOT NULL,      -- 1=Buy,2=Sell,5=SellShort
    ord_type       CHAR(1)      NOT NULL,      -- 1=Mkt,2=Limit
    qty            DECIMAL(18,2) NOT NULL,
    price          DECIMAL(18,6) NULL,
    ord_status     CHAR(1)      NOT NULL,      -- 0=New,1=Partial,2=Filled,4=Cxl,8=Rej
    desk           VARCHAR(16)  NOT NULL,
    trader         VARCHAR(16)  NOT NULL,
    transact_time  DATETIME     NOT NULL,
    ack_time       DATETIME     NULL
);

CREATE TABLE fills (
    exec_id        VARCHAR(32)  PRIMARY KEY,
    order_id       BIGINT       NOT NULL,
    last_qty       DECIMAL(18,2) NOT NULL,
    last_px        DECIMAL(18,6) NOT NULL,
    exec_type      CHAR(1)      NOT NULL,      -- F=Trade, 4=Cxl, 5=Replace
    transact_time  DATETIME     NOT NULL,
    venue          VARCHAR(16)  NOT NULL
);

CREATE TABLE positions (
    trade_date     DATE         NOT NULL,
    account        VARCHAR(32)  NOT NULL,
    symbol         VARCHAR(16)  NOT NULL,
    qty            DECIMAL(18,2) NOT NULL,
    avg_px         DECIMAL(18,6) NOT NULL,
    PRIMARY KEY (trade_date, account, symbol)
);
```
