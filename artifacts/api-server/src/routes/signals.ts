import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, signalsTable } from "@workspace/db";
import {
  GetSignalsQueryParams,
  GetSignalsResponse,
  GetLatestSignalsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeSignal(s: typeof signalsTable.$inferSelect) {
  return {
    ...s,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
  };
}

router.get("/signals/latest", async (_req, res): Promise<void> => {
  const signals = await db
    .select()
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt))
    .limit(20);

  const seen = new Set<number>();
  const latest = signals.filter((s) => {
    if (seen.has(s.marketId)) return false;
    seen.add(s.marketId);
    return true;
  });

  res.json(GetLatestSignalsResponse.parse(latest.map(serializeSignal)));
});

router.get("/signals", async (req, res): Promise<void> => {
  const params = GetSignalsQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  const strategyType = params.success ? params.data.strategyType : undefined;

  let rows;
  if (strategyType) {
    rows = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.strategyType, strategyType))
      .orderBy(desc(signalsTable.createdAt))
      .limit(limit);
  } else {
    rows = await db
      .select()
      .from(signalsTable)
      .orderBy(desc(signalsTable.createdAt))
      .limit(limit);
  }

  res.json(GetSignalsResponse.parse(rows.map(serializeSignal)));
});

export default router;
