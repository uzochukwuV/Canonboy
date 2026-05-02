import { db, marketsTable, signalsTable, tradesTable, botLogsTable, botStateTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "./logger";

const STARTING_BANKROLL = 1000;
const KELLY_FRACTION = 0.15;
const MIN_EDGE_THRESHOLD = 0.04;
const MAX_POSITION_SIZE = 100;

// NBA Teams in 2026 playoffs
const NBA_TEAMS = [
  "Oklahoma City Thunder", "San Antonio Spurs", "Boston Celtics",
  "New York Knicks", "Denver Nuggets", "Minnesota Timberwolves",
  "Golden State Warriors", "Los Angeles Lakers", "Miami Heat",
  "Cleveland Cavaliers", "Milwaukee Bucks", "Indiana Pacers",
];

// Simulated NBA stats that drive our signals
interface NBAGameStats {
  teamA: string;
  teamB: string;
  teamAWinPct: number;
  teamBWinPct: number;
  teamASeriesWins: number;
  teamBSeriesWins: number;
  teamAInjuries: number;
  teamBInjuries: number;
  homeAdvantage: boolean;
}

function getSimulatedNBAStats(teamA: string, teamB: string): NBAGameStats {
  const seed = (teamA.charCodeAt(0) + teamB.charCodeAt(0)) % 100;
  return {
    teamA,
    teamB,
    teamAWinPct: 0.45 + (seed % 30) / 100,
    teamBWinPct: 0.45 + ((seed + 15) % 30) / 100,
    teamASeriesWins: Math.floor(seed % 4),
    teamBSeriesWins: Math.floor((seed + 2) % 4),
    teamAInjuries: Math.floor(seed % 3),
    teamBInjuries: Math.floor((seed + 1) % 3),
    homeAdvantage: seed % 2 === 0,
  };
}

function computeFairValue(stats: NBAGameStats, direction: "YES" | "NO"): number {
  const { teamAWinPct, teamBWinPct, teamASeriesWins, teamBSeriesWins, teamAInjuries, homeAdvantage } = stats;

  // Base probability from win rates
  let p = teamAWinPct / (teamAWinPct + teamBWinPct);

  // Series state adjustment (best of 7 — team leading has higher probability)
  const seriesEdge = (teamASeriesWins - teamBSeriesWins) * 0.08;
  p = Math.min(0.95, Math.max(0.05, p + seriesEdge));

  // Injury adjustment
  const injuryPenalty = teamAInjuries * 0.04;
  p = Math.max(0.05, p - injuryPenalty);

  // Home court advantage
  if (homeAdvantage) p = Math.min(0.95, p + 0.05);

  return direction === "YES" ? p : 1 - p;
}

function kellySize(edge: number, odds: number, bankroll: number): number {
  if (edge <= 0) return 0;
  const kelly = (edge * (odds + 1) - 1) / odds;
  const fractionalKelly = kelly * KELLY_FRACTION;
  return Math.min(MAX_POSITION_SIZE, Math.max(1, bankroll * fractionalKelly));
}

async function addLog(level: string, message: string, details?: string): Promise<void> {
  await db.insert(botLogsTable).values({ level, message, details: details ?? null });
}

export async function scanMarketsAndGenerateSignals(): Promise<void> {
  const markets = await db.select().from(marketsTable).where(eq(marketsTable.isActive, true));

  if (markets.length === 0) {
    await addLog("warn", "No active markets found to scan");
    return;
  }

  await addLog("info", `Scanning ${markets.length} active NBA prediction markets...`);

  let signalsGenerated = 0;

  for (const market of markets) {
    const stats = getSimulatedNBAStats(market.teamA, market.teamB ?? "");
    const direction: "YES" | "NO" = Math.random() > 0.5 ? "YES" : "NO";
    const fairValue = computeFairValue(stats, direction);
    const marketPrice = direction === "YES" ? market.yesPrice : market.noPrice;
    const edge = fairValue - marketPrice;

    if (Math.abs(edge) > MIN_EDGE_THRESHOLD) {
      const strategyTypes = ["series_arbitrage", "nba_stats", "cross_market", "momentum"] as const;
      const strategyType = strategyTypes[Math.floor(Math.random() * strategyTypes.length)];

      const nbaDataPoints = [
        `${market.teamA} series wins: ${stats.teamASeriesWins}, win rate: ${(stats.teamAWinPct * 100).toFixed(0)}%`,
        `${market.teamA} injury report: ${stats.teamAInjuries} key players out`,
        `Home court advantage: ${stats.homeAdvantage ? market.teamA : market.teamB ?? "Away team"}`,
        `Series momentum: ${stats.teamASeriesWins > stats.teamBSeriesWins ? market.teamA : "Opponent"} leads`,
      ];
      const nbaDataPoint = nbaDataPoints[Math.floor(Math.random() * nbaDataPoints.length)];

      await db.insert(signalsTable).values({
        marketId: market.id,
        marketQuestion: market.question,
        strategyType,
        direction,
        edge: Math.abs(edge),
        confidence: Math.min(0.95, 0.5 + Math.abs(edge) * 3),
        currentPrice: marketPrice,
        fairValueEstimate: fairValue,
        nbaDataPoint,
        status: "pending",
      });

      await addLog(
        "signal",
        `Signal: ${direction} on "${market.question.slice(0, 60)}..." edge=${(Math.abs(edge) * 100).toFixed(1)}%`,
        `Strategy: ${strategyType}, Fair value: ${(fairValue * 100).toFixed(1)}%, Market price: ${(marketPrice * 100).toFixed(1)}%`
      );

      signalsGenerated++;
    }
  }

  await addLog("info", `Scan complete. Generated ${signalsGenerated} signals above ${(MIN_EDGE_THRESHOLD * 100).toFixed(0)}% edge threshold.`);

  // Update bot state
  await db.update(botStateTable)
    .set({
      lastScanAt: new Date(),
      totalSignalsGenerated: sql`total_signals_generated + ${signalsGenerated}`,
    })
    .where(eq(botStateTable.id, 1));
}

export async function executePendingSignals(): Promise<void> {
  const pendingSignals = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.status, "pending"))
    .orderBy(desc(signalsTable.edge))
    .limit(5);

  if (pendingSignals.length === 0) return;

  const botState = await db.select().from(botStateTable).where(eq(botStateTable.id, 1));
  const bankroll = botState[0]?.bankroll ?? STARTING_BANKROLL;

  let tradesExecuted = 0;

  for (const signal of pendingSignals) {
    if (signal.edge < MIN_EDGE_THRESHOLD) {
      await db.update(signalsTable).set({ status: "rejected" }).where(eq(signalsTable.id, signal.id));
      continue;
    }

    const odds = signal.direction === "YES"
      ? (1 - signal.currentPrice) / signal.currentPrice
      : (1 - signal.currentPrice) / signal.currentPrice;

    const size = kellySize(signal.edge, odds, bankroll);

    await db.insert(tradesTable).values({
      signalId: signal.id,
      marketId: signal.marketId,
      marketQuestion: signal.marketQuestion,
      direction: signal.direction,
      entryPrice: signal.currentPrice,
      exitPrice: null,
      size,
      kellyFraction: KELLY_FRACTION,
      pnl: null,
      pnlPercent: null,
      status: "open",
    });

    await db.update(signalsTable).set({ status: "executed" }).where(eq(signalsTable.id, signal.id));

    await addLog(
      "trade",
      `Trade opened: ${signal.direction} ${size.toFixed(2)} USDC on "${signal.marketQuestion.slice(0, 50)}..."`,
      `Entry: ${(signal.currentPrice * 100).toFixed(1)}%, Kelly size: ${size.toFixed(2)} USDC`
    );

    tradesExecuted++;
  }

  if (tradesExecuted > 0) {
    await db.update(botStateTable)
      .set({ totalTradesExecuted: sql`total_trades_executed + ${tradesExecuted}` })
      .where(eq(botStateTable.id, 1));
  }
}

export async function simulateTradeResolution(): Promise<void> {
  const openTrades = await db
    .select()
    .from(tradesTable)
    .where(eq(tradesTable.status, "open"))
    .limit(3);

  for (const trade of openTrades) {
    // Simulate resolution — 55% win rate (slight edge from strategy)
    const won = Math.random() < 0.55;
    const exitPrice = won
      ? Math.min(0.95, trade.entryPrice + 0.05 + Math.random() * 0.15)
      : Math.max(0.05, trade.entryPrice - 0.05 - Math.random() * 0.15);

    const pnl = won
      ? trade.size * (exitPrice / trade.entryPrice - 1)
      : -trade.size * (1 - exitPrice / trade.entryPrice);

    const pnlPercent = (pnl / trade.size) * 100;

    await db.update(tradesTable)
      .set({
        exitPrice,
        pnl,
        pnlPercent,
        status: "closed",
        closedAt: new Date(),
      })
      .where(eq(tradesTable.id, trade.id));

    // Update bankroll
    await db.update(botStateTable)
      .set({ bankroll: sql`bankroll + ${pnl}` })
      .where(eq(botStateTable.id, 1));

    const emoji = won ? "WIN" : "LOSS";
    await addLog(
      "trade",
      `Trade closed [${emoji}]: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDC (${pnlPercent.toFixed(1)}%)`,
      `"${trade.marketQuestion.slice(0, 50)}..." — Exit: ${(exitPrice * 100).toFixed(1)}%`
    );
  }
}

// Update market prices (simulates live market movement)
export async function refreshMarketPrices(): Promise<void> {
  const markets = await db.select().from(marketsTable).where(eq(marketsTable.isActive, true));

  for (const market of markets) {
    const drift = (Math.random() - 0.48) * 0.02;
    const newYesPrice = Math.min(0.97, Math.max(0.03, market.yesPrice + drift));
    const newNoPrice = 1 - newYesPrice;

    await db.update(marketsTable)
      .set({ yesPrice: newYesPrice, noPrice: newNoPrice })
      .where(eq(marketsTable.id, market.id));
  }
}

let botInterval: ReturnType<typeof setInterval> | null = null;

export async function startBotEngine(): Promise<void> {
  if (botInterval) return;

  await db.update(botStateTable)
    .set({ isRunning: true, startedAt: new Date() })
    .where(eq(botStateTable.id, 1));

  await addLog("info", "Bot engine started. Strategy: Series Arbitrage + NBA Stats Analysis");

  botInterval = setInterval(async () => {
    try {
      await refreshMarketPrices();
      await scanMarketsAndGenerateSignals();
      await executePendingSignals();
      await simulateTradeResolution();
    } catch (err) {
      logger.error({ err }, "Bot engine error");
      await addLog("error", `Bot engine error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 15000); // Every 15 seconds
}

export async function stopBotEngine(): Promise<void> {
  if (botInterval) {
    clearInterval(botInterval);
    botInterval = null;
  }

  await db.update(botStateTable)
    .set({ isRunning: false, startedAt: null })
    .where(eq(botStateTable.id, 1));

  await addLog("info", "Bot engine stopped.");
}

export function isBotRunning(): boolean {
  return botInterval !== null;
}
