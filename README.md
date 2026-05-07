# Canonboy — NBA Prediction Market Trading Bot

AI-powered NBA Playoffs prediction market trading bot for the **DEGA Hackathon** (DoraHacks, deadline June 1, 2026).

Trades NBA series and championship markets on [Polymarket](https://polymarket.com) using live ESPN playoff data, Kelly Criterion sizing, and real CLOB execution via [Canon CLI](https://github.com/DEGAorg/dega-core).

---

## Quick Start

### Prerequisites

- Node 22 LTS + pnpm
- PostgreSQL (connection string in `DATABASE_URL`)
- **DEGA Core** installed to `~/.degacore/` (required for live trading)

Install DEGA Core:
```bash
curl -fsSL https://degacore.sh/install | bash
```

Install dependencies:
```bash
pnpm install
```

### Run (development)

**Terminal 1 — API server** (port 8080):
```bash
PORT=8080 DATABASE_URL=postgresql://... pnpm --filter @workspace/api-server run dev
```

**Terminal 2 — Frontend** (port 5173):
```bash
pnpm --filter @workspace/nba-trading-bot run dev
```

Open `http://localhost:5173` for the dashboard.

---

## Live Trading ($10 USDC)

> Live trading requires a funded Polymarket account onboarded via Canon CLI.

### 1. Verify readiness

```bash
curl http://localhost:8080/api/bot/readiness
```

All four flags must be `true` before going live:
```json
{
  "walletReady": true,
  "sidecarReady": true,
  "onboardReady": true,
  "usdceBalance": 10.00,
  "errors": []
}
```

If `onboardReady` is false, run Polymarket onboarding via Canon:
```bash
canon-cli onboard --execute --venue polymarket
```

### 2. Start in live mode

```bash
curl -X POST http://localhost:8080/api/bot/start \
  -H "Content-Type: application/json" \
  -d '{"mode": "live"}'
```

The bot will:
1. Verify the pmxt sidecar, Canon wallet, and Polymarket onboarding
2. Confirm USDC.e balance ≥ 1.00
3. Start scanning NBA markets every 30 seconds
4. Place real CLOB limit orders when edge ≥ 3.5%

**Safety caps**: max $5 USDC per position, max 2 open positions simultaneously (=$10 total).

### 3. Stop (cancels all open orders)

```bash
curl -X POST http://localhost:8080/api/bot/stop
```

### 4. Paper trading (default — no real money)

```bash
curl -X POST http://localhost:8080/api/bot/start \
  -H "Content-Type: application/json" \
  -d '{"mode": "paper"}'
```

---

## Strategy

| Component | Detail |
|-----------|--------|
| Data sources | Polymarket Gamma API (live prices) + ESPN Playoffs API (real game results) |
| Signal types | Championship fair value, Conference fair value, Cross-market arbitrage |
| Position sizing | Fractional Kelly (15%) capped at $5 USDC in live mode |
| Min edge | 3.5% before a signal is generated |
| Stop loss | 6% adverse price move |
| Take profit | 12% favorable price move |
| Age-out | 6h paper / 48h live |

---

## Architecture

Pnpm monorepo with two apps and four shared libraries:

```
artifacts/
  api-server/          Express 5 backend (port 8080)
    src/lib/
      strategy-engine.ts   Scan, signal, execute, mark-to-market
      canon-executor.ts    Canon CLI bridge (live CLOB execution)
      polymarket.ts        Gamma API sync + price feeds
      nba-stats.ts         ESPN playoff state + win probability models
  nba-trading-bot/     React + Vite dashboard (port 5173)

lib/
  api-spec/            OpenAPI 0.1.0 (single source of truth)
  api-client-react/    TanStack Query hooks (orval codegen)
  api-zod/             Zod validation schemas (orval codegen)
  db/                  Drizzle ORM + PostgreSQL schema
```

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bot/status` | Bot state, mode, bankroll, counters |
| POST | `/api/bot/start` | Start bot — body: `{ mode: "paper" \| "live" }` |
| POST | `/api/bot/stop` | Stop bot, cancel live orders |
| GET | `/api/bot/readiness` | Canon/Polymarket readiness check |
| GET | `/api/bot/logs` | Recent activity log |
| GET | `/api/markets` | All tracked NBA markets |
| GET | `/api/signals` | Trading signals |
| GET | `/api/trades` | Trade history |
| GET | `/api/pnl` | P&L summary + equity curve |

---

## Database

PostgreSQL via Drizzle ORM. Schema migrations run automatically at server startup via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

| Table | Key columns |
|-------|-------------|
| `markets` | `polymarket_id`, `condition_id`, `yes_token_id`, `no_token_id`, `yes_price`, `no_price` |
| `signals` | `market_id`, `direction`, `edge`, `confidence`, `strategy_type`, `status` |
| `trades` | `market_id`, `direction`, `entry_price`, `size`, `execution_mode`, `clob_order_id`, `clob_token_id` |
| `bot_logs` | `level`, `message`, `details` |
| `bot_state` | `is_running`, `execution_mode`, `bankroll`, `total_trades_executed` |

Manual schema push (after editing `lib/db/src/schema/`):
```bash
pnpm --filter @workspace/db run push
```

---

## Codegen

After editing `lib/api-spec/openapi.yaml`:
```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Canon CLI Integration

All live order execution shells out to `~/.degacore/bin/canon-cli`. The pmxt-core sidecar handles key management and signing internally. The codebase carries zero blockchain dependencies.

```
canon-cli wallet address          # check wallet
canon-cli balance                  # USDC.e balance
canon-cli onboard --status --venue polymarket
canon-cli position list            # open positions
canon-cli kill                     # cancel all orders
```

---

## Design

Dark neon teal terminal aesthetic. DEGA brand palette: `#00FFB4` (neon teal) on `#050A0F` (near-black). Space Mono font.
