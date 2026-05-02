import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, marketsTable } from "@workspace/db";
import {
  GetMarketsQueryParams,
  GetMarketParams,
  GetMarketsResponse,
  GetMarketResponse,
  GetMarketsSummaryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeMarket(m: typeof marketsTable.$inferSelect) {
  return {
    ...m,
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
    updatedAt: m.updatedAt instanceof Date ? m.updatedAt.toISOString() : m.updatedAt,
  };
}

router.get("/markets/summary", async (_req, res): Promise<void> => {
  const markets = await db.select().from(marketsTable);
  const active = markets.filter((m) => m.isActive);
  const totalVolume = markets.reduce((s, m) => s + m.volume, 0);
  const edges = markets.map((m) => Math.abs(m.yesPrice - 0.5));
  const avgEdge = edges.length > 0 ? edges.reduce((a, b) => a + b, 0) / edges.length : 0;
  const top = [...markets].sort((a, b) => Math.abs(b.yesPrice - 0.5) - Math.abs(a.yesPrice - 0.5))[0];

  res.json(
    GetMarketsSummaryResponse.parse({
      totalMarkets: markets.length,
      activeMarkets: active.length,
      totalVolume,
      avgEdge,
      topOpportunity: top?.question ?? null,
    })
  );
});

router.get("/markets", async (req, res): Promise<void> => {
  const params = GetMarketsQueryParams.safeParse(req.query);
  let rows;
  if (params.success && params.data.active !== undefined) {
    rows = await db.select().from(marketsTable).where(eq(marketsTable.isActive, params.data.active));
  } else {
    rows = await db.select().from(marketsTable);
  }
  res.json(GetMarketsResponse.parse(rows.map(serializeMarket)));
});

router.get("/markets/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetMarketParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [market] = await db.select().from(marketsTable).where(eq(marketsTable.id, params.data.id));
  if (!market) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  res.json(GetMarketResponse.parse(serializeMarket(market)));
});

export default router;
