import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull(),
  marketQuestion: text("market_question").notNull(),
  strategyType: text("strategy_type").notNull().default("nba_stats"),
  direction: text("direction").notNull().default("YES"),
  edge: real("edge").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  currentPrice: real("current_price").notNull().default(0.5),
  fairValueEstimate: real("fair_value_estimate").notNull().default(0.5),
  nbaDataPoint: text("nba_data_point"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
