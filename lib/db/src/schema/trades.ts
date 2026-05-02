import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  signalId: integer("signal_id"),
  marketId: integer("market_id").notNull(),
  marketQuestion: text("market_question").notNull(),
  direction: text("direction").notNull(),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  size: real("size").notNull().default(10),
  kellyFraction: real("kelly_fraction").notNull().default(0.1),
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, openedAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
