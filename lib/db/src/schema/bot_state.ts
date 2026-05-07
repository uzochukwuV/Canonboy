import { pgTable, text, serial, timestamp, boolean, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botStateTable = pgTable("bot_state", {
  id: serial("id").primaryKey(),
  isRunning: boolean("is_running").notNull().default(false),
  executionMode: text("execution_mode").notNull().default("paper"),
  strategy: text("strategy").notNull().default("series_arbitrage_nba_stats"),
  bankroll: real("bankroll").notNull().default(1000),
  scanIntervalSeconds: integer("scan_interval_seconds").notNull().default(30),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  totalSignalsGenerated: integer("total_signals_generated").notNull().default(0),
  totalTradesExecuted: integer("total_trades_executed").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBotStateSchema = createInsertSchema(botStateTable).omit({ id: true, updatedAt: true });
export type InsertBotState = z.infer<typeof insertBotStateSchema>;
export type BotState = typeof botStateTable.$inferSelect;
