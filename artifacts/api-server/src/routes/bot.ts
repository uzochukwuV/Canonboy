import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, botStateTable, botLogsTable } from "@workspace/db";
import {
  GetBotStatusResponse,
  StartBotResponse,
  StopBotResponse,
  GetBotLogsQueryParams,
  GetBotLogsResponse,
} from "@workspace/api-zod";
import { startBotEngine, stopBotEngine, isBotRunning, getExecutionMode } from "../lib/strategy-engine";
import { checkReadiness } from "../lib/canon-executor";

const router: IRouter = Router();

function serializeBotState(state: typeof botStateTable.$inferSelect) {
  return {
    isRunning: isBotRunning(),
    executionMode: getExecutionMode(),
    strategy: state.strategy,
    bankroll: state.bankroll,
    scanIntervalSeconds: state.scanIntervalSeconds,
    lastScanAt: state.lastScanAt instanceof Date ? state.lastScanAt.toISOString() : (state.lastScanAt ?? null),
    totalSignalsGenerated: state.totalSignalsGenerated,
    totalTradesExecuted: state.totalTradesExecuted,
    uptime: state.startedAt instanceof Date
      ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000)
      : null,
  };
}

router.get("/bot/status", async (_req, res): Promise<void> => {
  const [state] = await db.select().from(botStateTable).where(eq(botStateTable.id, 1));
  if (!state) {
    res.status(404).json({ error: "Bot state not found" });
    return;
  }
  res.json(GetBotStatusResponse.parse(serializeBotState(state)));
});

router.post("/bot/start", async (req, res): Promise<void> => {
  const body = req.body as { mode?: string } | undefined;
  const mode = body?.mode === "live" ? "live" : "paper";
  try {
    await startBotEngine(mode);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const [state] = await db.select().from(botStateTable).where(eq(botStateTable.id, 1));
  res.json(StartBotResponse.parse(serializeBotState(state ?? {
    id: 1, isRunning: true, strategy: "series_arbitrage_nba_stats",
    bankroll: 1000, scanIntervalSeconds: 15, lastScanAt: null,
    totalSignalsGenerated: 0, totalTradesExecuted: 0, startedAt: new Date(), updatedAt: new Date(),
    executionMode: mode,
  })));
});

router.post("/bot/stop", async (_req, res): Promise<void> => {
  await stopBotEngine();
  const [state] = await db.select().from(botStateTable).where(eq(botStateTable.id, 1));
  res.json(StopBotResponse.parse(serializeBotState(state ?? {
    id: 1, isRunning: false, strategy: "series_arbitrage_nba_stats",
    bankroll: 1000, scanIntervalSeconds: 15, lastScanAt: null,
    totalSignalsGenerated: 0, totalTradesExecuted: 0, startedAt: null, updatedAt: new Date(),
    executionMode: "paper",
  })));
});

router.get("/bot/readiness", async (_req, res): Promise<void> => {
  const result = await checkReadiness();
  const httpStatus = result.errors.length === 0 ? 200 : 503;
  res.status(httpStatus).json(result);
});

router.get("/bot/logs", async (req, res): Promise<void> => {
  const params = GetBotLogsQueryParams.safeParse(req.query);
  const limit = params.success ? (params.data.limit ?? 100) : 100;

  const logs = await db
    .select()
    .from(botLogsTable)
    .orderBy(desc(botLogsTable.createdAt))
    .limit(limit);

  const serialized = logs.map((l) => ({
    ...l,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
  }));

  res.json(GetBotLogsResponse.parse(serialized));
});

export default router;
