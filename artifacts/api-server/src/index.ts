import app from "./app";
import { logger } from "./lib/logger";
import { syncPolymarketMarkets } from "./lib/polymarket";
import { db, botLogsTable, botStateTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Add columns introduced in the live-trading update — all idempotent
    await client.query(`
      ALTER TABLE markets
        ADD COLUMN IF NOT EXISTS condition_id  text,
        ADD COLUMN IF NOT EXISTS yes_token_id  text,
        ADD COLUMN IF NOT EXISTS no_token_id   text
    `);
    await client.query(`
      ALTER TABLE trades
        ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'paper',
        ADD COLUMN IF NOT EXISTS clob_order_id  text,
        ADD COLUMN IF NOT EXISTS clob_token_id  text
    `);
    await client.query(`
      ALTER TABLE bot_state
        ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'paper'
    `);
    logger.info("Schema migrations applied");
  } finally {
    client.release();
  }
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  await runMigrations();

  // Ensure bot_state row exists
  const existing = await db.select().from(botStateTable).where(eq(botStateTable.id, 1));
  if (existing.length === 0) {
    await db.insert(botStateTable).values({
      id: 1,
      isRunning: false,
      executionMode: "paper",
      strategy: "series_arbitrage_nba_stats",
      bankroll: 1000,
      scanIntervalSeconds: 30,
      totalSignalsGenerated: 0,
      totalTradesExecuted: 0,
    });
  }

  // Sync real Polymarket NBA markets immediately on startup
  try {
    logger.info("Syncing live Polymarket NBA markets...");
    const count = await syncPolymarketMarkets();
    logger.info({ count }, "Polymarket market sync complete");
    await db.insert(botLogsTable).values({
      level: "info",
      message: `Server started. Synced ${count} live NBA markets from Polymarket.`,
      details: "Data sources: Polymarket Gamma API (live prices) + ESPN (playoff bracket). Paper trading mode active.",
    });
  } catch (err) {
    logger.warn({ err }, "Startup Polymarket sync failed — markets will sync on first bot scan");
    await db.insert(botLogsTable).values({
      level: "warn",
      message: "Startup market sync failed — will retry on first bot scan",
      details: String(err),
    });
  }
});
