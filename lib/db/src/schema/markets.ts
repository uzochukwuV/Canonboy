import { pgTable, text, serial, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketsTable = pgTable("markets", {
  id: serial("id").primaryKey(),
  polymarketId: text("polymarket_id").notNull().unique(),
  conditionId: text("condition_id"),
  question: text("question").notNull(),
  teamA: text("team_a").notNull(),
  teamB: text("team_b"),
  marketType: text("market_type").notNull().default("game_winner"),
  yesPrice: real("yes_price").notNull().default(0.5),
  noPrice: real("no_price").notNull().default(0.5),
  yesTokenId: text("yes_token_id"),
  noTokenId: text("no_token_id"),
  volume: real("volume").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  endDate: text("end_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMarketSchema = createInsertSchema(marketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type Market = typeof marketsTable.$inferSelect;
