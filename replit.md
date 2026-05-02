# NBA Prediction Market Trading Bot

DEGA Hackathon (DoraHacks, deadline June 1 2026). AI-powered NBA Playoffs prediction market trading bot with simulation/paper trading mode.

## Architecture

**Monorepo** (pnpm workspaces):
- `artifacts/nba-trading-bot` — React + Vite frontend dashboard (port 5173, previewPath `/`)
- `artifacts/api-server` — Express 5 backend API (port 8080, previewPath `/api`)
- `lib/api-spec` — OpenAPI 0.1.0 spec (single source of truth)
- `lib/api-client-react` — Generated TanStack Query hooks (orval)
- `lib/api-zod` — Generated Zod validation schemas (orval)
- `lib/db` — Drizzle ORM + PostgreSQL schema

## Strategy

- **Series Arbitrage**: Cross-market NBA series pricing inconsistencies
- **NBA Stats Edge Detection**: Win rate, injury data, home court, series momentum
- **Kelly Criterion Sizing**: Fractional Kelly (15%) for position sizing
- **Min Edge Threshold**: 4% before generating signal
- **Simulation Mode**: Paper trades only — no real money

## Database Schema (PostgreSQL via Drizzle)

- `markets` — Polymarket NBA prediction markets (12 seeded for 2026 playoffs)
- `signals` — Trading signals with edge%, confidence, strategy type, NBA data point
- `trades` — Paper trades with entry/exit prices, size, kelly fraction, P&L
- `bot_logs` — Activity log with levels: info, signal, trade, warn, error
- `bot_state` — Single row for bot running state, bankroll, counters

## Frontend Pages

- `/` — Dashboard: P&L cards, equity curve chart, latest signals, recent trades
- `/markets` — All tracked NBA markets with yes/no prices, volume, type badges
- `/signals` — Trading signals with edge%, confidence, strategy, status
- `/trades` — Trade history with entry/exit, P&L, Kelly fraction
- `/bot` — Bot Control: start/stop engine, live terminal log feed

## Key Files

- `lib/api-spec/openapi.yaml` — OpenAPI spec
- `lib/api-client-react/src/generated/api.ts` — React Query hooks
- `lib/api-zod/src/generated/api.ts` — Zod schemas
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/strategy-engine.ts` — Bot simulation engine
- `lib/db/src/schema/` — Drizzle table definitions
- `artifacts/nba-trading-bot/src/pages/` — React pages
- `artifacts/nba-trading-bot/src/components/layout/Shell.tsx` — App shell/nav

## Running

Both workflows auto-start:
- `artifacts/api-server: API Server` — builds then runs Express
- `artifacts/nba-trading-bot: web` — Vite dev server

## Codegen

After editing `lib/api-spec/openapi.yaml`:
```
pnpm --filter @workspace/api-spec run codegen
```

## DB Schema Push

After editing schema files in `lib/db/src/schema/`:
```
pnpm --filter @workspace/db run push
```

## Design

Dark neon teal cyber aesthetic. DEGA brand palette: `--color-primary: #00FFB4` (neon teal), `--background: #050A0F` (near-black). Space Mono font. Dense, information-rich trading terminal look.
