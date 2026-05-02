import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, tradesTable } from "@workspace/db";
import {
  GetTradesQueryParams,
  GetTradesResponse,
  GetPnlSummaryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const STARTING_BANKROLL = 1000;

function serializeTrade(t: typeof tradesTable.$inferSelect) {
  return {
    ...t,
    openedAt: t.openedAt instanceof Date ? t.openedAt.toISOString() : t.openedAt,
    closedAt: t.closedAt instanceof Date ? t.closedAt.toISOString() : (t.closedAt ?? null),
  };
}

router.get("/trades/pnl", async (_req, res): Promise<void> => {
  const trades = await db.select().from(tradesTable).orderBy(tradesTable.openedAt);

  const closed = trades.filter((t) => t.status === "closed");
  const open = trades.filter((t) => t.status === "open");

  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winners = closed.filter((t) => (t.pnl ?? 0) > 0);
  const winRate = closed.length > 0 ? winners.length / closed.length : 0;

  let running = STARTING_BANKROLL;
  const equityCurve = [
    { timestamp: new Date(Date.now() - 86400000).toISOString(), bankroll: STARTING_BANKROLL, pnl: 0 },
  ];

  for (const t of closed) {
    running += t.pnl ?? 0;
    equityCurve.push({
      timestamp: t.closedAt instanceof Date
        ? t.closedAt.toISOString()
        : (t.closedAt ?? new Date().toISOString()),
      bankroll: running,
      pnl: t.pnl ?? 0,
    });
  }

  res.json(
    GetPnlSummaryResponse.parse({
      totalPnl,
      totalPnlPercent: (totalPnl / STARTING_BANKROLL) * 100,
      winRate,
      totalTrades: trades.length,
      openTrades: open.length,
      closedTrades: closed.length,
      bankroll: running,
      startingBankroll: STARTING_BANKROLL,
      equityCurve,
    })
  );
});

router.get("/trades", async (req, res): Promise<void> => {
  const params = GetTradesQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const status = params.success ? params.data.status : undefined;

  let rows;
  if (status) {
    rows = await db
      .select()
      .from(tradesTable)
      .where(eq(tradesTable.status, status))
      .orderBy(desc(tradesTable.openedAt))
      .limit(limit);
  } else {
    rows = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.openedAt))
      .limit(limit);
  }

  res.json(GetTradesResponse.parse(rows.map(serializeTrade)));
});

export default router;
