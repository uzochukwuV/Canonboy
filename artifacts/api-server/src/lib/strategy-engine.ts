import { db, marketsTable, signalsTable, tradesTable, botLogsTable, botStateTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { logger } from "./logger";
import { syncPolymarketMarkets } from "./polymarket";
import {
  fetchNBAPlayoffState,
  getSeriesRecord,
  computeWinProb,
  remainingSeriesWinProb,
  type NBAPlayoffState,
} from "./nba-stats";
import {
  ensureSidecar,
  ensureWallet,
  getOnboardStatus,
  getUsdceBalance,
  createOrder,
  cancelOrder,
  getLivePositions,
  killAllOrders,
  LIVE_MAX_POSITION_USD,
  LIVE_MAX_OPEN_TRADES,
} from "./canon-executor";

// ─── Config ───────────────────────────────────────────────────────────────────
const STARTING_BANKROLL = 1000;
const KELLY_FRACTION = 0.15;       // Fractional Kelly for risk management
const MIN_EDGE_THRESHOLD = 0.035;  // 3.5% minimum edge to generate signal
const MAX_POSITION_PCT = 0.08;     // Max 8% of bankroll per trade
const MAX_POSITION_USD = 100;
const STOP_LOSS_PCT = 0.06;        // Close trade if price moves 6% against us
const TAKE_PROFIT_PCT = 0.12;      // Close trade if price moves 12% in our favor

// ─── Logging ──────────────────────────────────────────────────────────────────
async function addLog(level: string, message: string, details?: string): Promise<void> {
  await db.insert(botLogsTable).values({ level, message, details: details ?? null });
}

// ─── Kelly Position Sizing ────────────────────────────────────────────────────
function kellySize(edge: number, currentPrice: number, bankroll: number, direction: "YES" | "NO"): number {
  if (edge <= 0) return 0;
  // Odds = profit per unit risked
  const impliedProb = direction === "YES" ? currentPrice : (1 - currentPrice);
  const odds = (1 - impliedProb) / impliedProb;
  const kelly = (edge * (odds + 1) - odds) / odds;
  const fractional = Math.max(0, kelly * KELLY_FRACTION);
  return Math.min(MAX_POSITION_USD, Math.max(1, bankroll * Math.min(fractional, MAX_POSITION_PCT)));
}

// ─── Fair Value Models ─────────────────────────────────────────────────────────

/**
 * Championship market fair value.
 * For teams still in playoffs, we compute: P(win remaining rounds) using
 * series-aware probabilities from real ESPN data.
 */
function computeChampionshipFairValue(
  teamAbbr: string,
  state: NBAPlayoffState
): number {
  const rating = state.teamPowerRatings[teamAbbr];
  if (!rating) return 0.01; // Not a playoff team or already eliminated

  // Find if team is in an active series
  const activeSeries = state.series.find(
    (s) => (s.teamA === teamAbbr || s.teamB === teamAbbr) &&
            (s.teamAWins < 4 && s.teamBWins < 4)
  );

  if (!activeSeries) {
    // May be eliminated or waiting for opponent — use base rating
    return Math.max(0.01, rating * 0.25); // Rough championship probability
  }

  const isTeamA = activeSeries.teamA === teamAbbr;
  const myWins = isTeamA ? activeSeries.teamAWins : activeSeries.teamBWins;
  const oppWins = isTeamA ? activeSeries.teamBWins : activeSeries.teamAWins;
  const oppAbbr = isTeamA ? activeSeries.teamB : activeSeries.teamA;
  const oppRating = state.teamPowerRatings[oppAbbr] ?? 0.5;

  const gameP = computeWinProb(rating, oppRating, activeSeries.nextGameHome === teamAbbr ? 1 : -1);
  const roundWinP = remainingSeriesWinProb(gameP, myWins, oppWins, 4);

  // After winning this round, assume equal competition for the rest (simplified)
  // Championship probability = P(win current series) × P(win remaining rounds)
  const round = activeSeries.round;
  let remainingRounds = 1;
  if (round.includes("1st Round") || round.includes("First Round")) remainingRounds = 3;
  else if (round.includes("Semifinals")) remainingRounds = 2;
  else if (round.includes("Conference Finals")) remainingRounds = 1;

  // Each additional round: use average game probability vs average opponent
  const avgWinPerRound = Math.sqrt(rating); // Rough heuristic — stronger teams win later rounds
  let champP = roundWinP;
  for (let r = 1; r < remainingRounds; r++) {
    champP *= avgWinPerRound;
  }

  return Math.min(0.92, Math.max(0.01, champP));
}

/**
 * Conference finals market fair value.
 * Cross-market: if we know team's championship prob and rivals' probs,
 * we can bound what the conference win probability should be.
 */
function computeConferenceFairValue(
  teamAbbr: string,
  state: NBAPlayoffState
): number {
  const rating = state.teamPowerRatings[teamAbbr];
  if (!rating) return 0.02;

  const activeSeries = state.series.find(
    (s) => (s.teamA === teamAbbr || s.teamB === teamAbbr) &&
            (s.teamAWins < 4 && s.teamBWins < 4)
  );

  if (!activeSeries) return Math.max(0.02, rating * 0.5);

  const isTeamA = activeSeries.teamA === teamAbbr;
  const myWins = isTeamA ? activeSeries.teamAWins : activeSeries.teamBWins;
  const oppWins = isTeamA ? activeSeries.teamBWins : activeSeries.teamAWins;
  const oppAbbr = isTeamA ? activeSeries.teamB : activeSeries.teamA;
  const oppRating = state.teamPowerRatings[oppAbbr] ?? 0.5;

  const gameP = computeWinProb(rating, oppRating, activeSeries.nextGameHome === teamAbbr ? 1 : -1);
  const currentSeriesP = remainingSeriesWinProb(gameP, myWins, oppWins, 4);

  const round = activeSeries.round;
  if (round.includes("Conference Finals")) {
    // Already in conf finals — just need to win this series
    return currentSeriesP;
  } else if (round.includes("Semifinals") || round.includes("Second Round")) {
    // Win current + win conf finals
    const avgNextRoundP = Math.sqrt(rating) * 0.8;
    return Math.min(0.92, currentSeriesP * avgNextRoundP);
  } else {
    // 1st round — two more rounds
    const avgP = Math.sqrt(rating) * 0.75;
    return Math.min(0.92, currentSeriesP * avgP * avgP);
  }
}

/**
 * Cross-market arbitrage check:
 * P(team wins Finals) should be roughly consistent across:
 * - Championship market
 * - Conference market × Historical Finals win rate
 */
function detectCrossMarketArbitrage(
  champMarkets: Array<{ teamAbbr: string; yesPrice: number; question: string; id: number }>,
  confMarkets: Array<{ teamAbbr: string; yesPrice: number; question: string; id: number }>,
  state: NBAPlayoffState
): Array<{
  type: "cross_market_arb";
  marketId: number;
  question: string;
  direction: "YES" | "NO";
  edge: number;
  confidence: number;
  currentPrice: number;
  fairValue: number;
  dataPoint: string;
}> {
  const signals = [];
  // Historical NBA Finals win rate for team that wins conference: ~50% (equal matchup)
  const FINALS_WIN_RATE = 0.50;

  for (const champ of champMarkets) {
    const conf = confMarkets.find((c) => c.teamAbbr === champ.teamAbbr);
    if (!conf) continue;

    // Implied: P(win Finals | in Finals) × P(in Finals) = P(win championship)
    // → P(in Finals) = P(win championship) / P(win Finals | in Finals)
    // → If conf market price >> champ price / FINALS_WIN_RATE, conf is overpriced
    const impliedConfFromChamp = champ.yesPrice / FINALS_WIN_RATE;
    const confEdge = impliedConfFromChamp - conf.yesPrice;

    if (Math.abs(confEdge) > MIN_EDGE_THRESHOLD) {
      const rating = state.teamPowerRatings[champ.teamAbbr] ?? 0.5;
      signals.push({
        type: "cross_market_arb" as const,
        marketId: conf.id,
        question: conf.question,
        direction: confEdge > 0 ? "YES" : "NO" as "YES" | "NO",
        edge: Math.abs(confEdge),
        confidence: Math.min(0.85, 0.5 + Math.abs(confEdge) * 3),
        currentPrice: conf.yesPrice,
        fairValue: impliedConfFromChamp,
        dataPoint: `Cross-market arb: Champ price ${(champ.yesPrice * 100).toFixed(1)}% → implied conf ${(impliedConfFromChamp * 100).toFixed(1)}% vs market ${(conf.yesPrice * 100).toFixed(1)}%`,
      });
    }
  }

  return signals;
}

// ─── Main Scan ────────────────────────────────────────────────────────────────
export async function scanMarketsAndGenerateSignals(): Promise<void> {
  await addLog("info", "Fetching live Polymarket prices and ESPN playoff data...");

  // 1. Sync real Polymarket market prices
  let syncedCount = 0;
  try {
    syncedCount = await syncPolymarketMarkets();
    await addLog("info", `Polymarket sync complete: ${syncedCount} NBA markets updated with live prices`);
  } catch (err) {
    await addLog("warn", `Polymarket sync failed, using cached prices: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Fetch real ESPN playoff state
  let state: NBAPlayoffState;
  try {
    state = await fetchNBAPlayoffState();
    const gameCount = state.games.length;
    const finishedGames = state.games.filter((g) => g.winner !== null).length;
    await addLog(
      "info",
      `ESPN data loaded: ${gameCount} playoff games (${finishedGames} completed), ${state.series.length} active series`,
      state.games.filter((g) => g.winner !== null).slice(0, 3)
        .map((g) => `${g.awayTeam} @ ${g.homeTeam}: ${g.awayScore}-${g.homeScore} [${g.round}]`)
        .join(" | ")
    );
  } catch (err) {
    await addLog("warn", `ESPN data fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // 3. Load all active markets from DB (now with real Polymarket prices)
  const markets = await db.select().from(marketsTable).where(eq(marketsTable.isActive, true));
  if (markets.length === 0) {
    await addLog("warn", "No active markets in database");
    return;
  }

  // 4. Categorize markets
  const champMarkets = markets
    .filter((m) => m.marketType === "champion")
    .map((m) => ({ ...m, teamAbbr: m.teamA }));
  const confMarkets = markets
    .filter((m) => m.marketType === "conference")
    .map((m) => ({ ...m, teamAbbr: m.teamA }));
  const seriesMarkets = markets.filter((m) => m.marketType === "series_winner");

  let signalsGenerated = 0;

  // 5. Analyze championship markets
  for (const market of champMarkets) {
    const fairValue = computeChampionshipFairValue(market.teamAbbr, state);
    const direction: "YES" | "NO" = fairValue > market.yesPrice ? "YES" : "NO";
    const edge = Math.abs(fairValue - market.yesPrice);

    if (edge > MIN_EDGE_THRESHOLD) {
      const seriesContext = state.series.find(
        (s) => s.teamA === market.teamAbbr || s.teamB === market.teamAbbr
      );
      const dataPoint = seriesContext
        ? `${market.teamAbbr} series record: ${seriesContext.teamA === market.teamAbbr ? seriesContext.teamAWins : seriesContext.teamBWins}-${seriesContext.teamA === market.teamAbbr ? seriesContext.teamBWins : seriesContext.teamAWins} (${seriesContext.round})`
        : `Power rating: ${((state.teamPowerRatings[market.teamAbbr] ?? 0.5) * 100).toFixed(0)}%`;

      await db.insert(signalsTable).values({
        marketId: market.id,
        marketQuestion: market.question,
        strategyType: "nba_stats",
        direction,
        edge,
        confidence: Math.min(0.90, 0.5 + edge * 4),
        currentPrice: market.yesPrice,
        fairValueEstimate: fairValue,
        nbaDataPoint: dataPoint,
        status: "pending",
      });

      await addLog(
        "signal",
        `[CHAMP] ${direction} "${market.question.slice(0, 55)}..." edge=${(edge * 100).toFixed(1)}%`,
        `Market: ${(market.yesPrice * 100).toFixed(1)}% | Fair value: ${(fairValue * 100).toFixed(1)}% | ${dataPoint}`
      );
      signalsGenerated++;
    }
  }

  // 6. Analyze conference markets
  for (const market of confMarkets) {
    const fairValue = computeConferenceFairValue(market.teamAbbr, state);
    const direction: "YES" | "NO" = fairValue > market.yesPrice ? "YES" : "NO";
    const edge = Math.abs(fairValue - market.yesPrice);

    if (edge > MIN_EDGE_THRESHOLD) {
      const dataPoint = `Power rating: ${((state.teamPowerRatings[market.teamAbbr] ?? 0.5) * 100).toFixed(0)}%`;

      await db.insert(signalsTable).values({
        marketId: market.id,
        marketQuestion: market.question,
        strategyType: "series_arbitrage",
        direction,
        edge,
        confidence: Math.min(0.85, 0.5 + edge * 3),
        currentPrice: market.yesPrice,
        fairValueEstimate: fairValue,
        nbaDataPoint: dataPoint,
        status: "pending",
      });

      await addLog(
        "signal",
        `[CONF] ${direction} "${market.question.slice(0, 55)}..." edge=${(edge * 100).toFixed(1)}%`,
        `Market: ${(market.yesPrice * 100).toFixed(1)}% | Fair value: ${(fairValue * 100).toFixed(1)}%`
      );
      signalsGenerated++;
    }
  }

  // 7. Cross-market arbitrage
  const arbSignals = detectCrossMarketArbitrage(champMarkets, confMarkets, state);
  for (const signal of arbSignals) {
    await db.insert(signalsTable).values({
      marketId: signal.marketId,
      marketQuestion: signal.question,
      strategyType: "cross_market",
      direction: signal.direction,
      edge: signal.edge,
      confidence: signal.confidence,
      currentPrice: signal.currentPrice,
      fairValueEstimate: signal.fairValue,
      nbaDataPoint: signal.dataPoint,
      status: "pending",
    });

    await addLog(
      "signal",
      `[ARB] ${signal.direction} "${signal.question.slice(0, 55)}..." edge=${(signal.edge * 100).toFixed(1)}%`,
      signal.dataPoint
    );
    signalsGenerated++;
  }

  await addLog(
    "info",
    `Scan complete. ${signalsGenerated} signals above ${(MIN_EDGE_THRESHOLD * 100).toFixed(1)}% edge threshold. Polymarket prices live.`
  );

  // Update bot state
  await db.update(botStateTable)
    .set({
      lastScanAt: new Date(),
      totalSignalsGenerated: sql`total_signals_generated + ${signalsGenerated}`,
    })
    .where(eq(botStateTable.id, 1));
}

// ─── Execution Mode State ─────────────────────────────────────────────────────
let currentExecutionMode: "paper" | "live" = "paper";

// ─── Trade Execution ──────────────────────────────────────────────────────────
export async function executePendingSignals(): Promise<void> {
  const pendingSignals = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.status, "pending"))
    .orderBy(desc(signalsTable.edge))
    .limit(3);

  if (pendingSignals.length === 0) return;

  const [botState] = await db.select().from(botStateTable).where(eq(botStateTable.id, 1));
  const bankroll = botState?.bankroll ?? STARTING_BANKROLL;
  const isLive = currentExecutionMode === "live";

  if (isLive) {
    // Count currently open live trades to enforce position cap
    const openLive = await db
      .select()
      .from(tradesTable)
      .where(and(eq(tradesTable.status, "open"), eq(tradesTable.executionMode, "live")));
    if (openLive.length >= LIVE_MAX_OPEN_TRADES) {
      await addLog("info", `Live trade cap reached (${openLive.length}/${LIVE_MAX_OPEN_TRADES} open) — skipping new signals`);
      return;
    }
  }

  let executed = 0;
  for (const signal of pendingSignals) {
    if (signal.edge < MIN_EDGE_THRESHOLD) {
      await db.update(signalsTable).set({ status: "rejected" }).where(eq(signalsTable.id, signal.id));
      continue;
    }

    const paperSize = kellySize(signal.edge, signal.currentPrice, bankroll, signal.direction as "YES" | "NO");
    const size = isLive ? Math.min(paperSize, LIVE_MAX_POSITION_USD) : paperSize;

    if (isLive) {
      // Resolve the CLOB token ID for this signal's market and direction
      const [market] = await db.select().from(marketsTable).where(eq(marketsTable.id, signal.marketId));
      const tokenId = signal.direction === "YES" ? market?.yesTokenId : market?.noTokenId;

      if (!tokenId) {
        await addLog("warn", `Skipping live signal — no CLOB token ID for market ${signal.marketId} (${signal.direction})`, signal.marketQuestion);
        await db.update(signalsTable).set({ status: "rejected" }).where(eq(signalsTable.id, signal.id));
        continue;
      }

      try {
        const order = await createOrder({
          tokenId,
          side: "buy",
          size,
          price: signal.currentPrice,
          marketId: market?.conditionId ?? undefined,
          orderType: "limit",
        });

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
          executionMode: "live",
          clobOrderId: order.id,
          clobTokenId: tokenId,
        });

        await db.update(signalsTable).set({ status: "executed" }).where(eq(signalsTable.id, signal.id));

        await addLog(
          "trade",
          `[LIVE] Opened: ${signal.direction} ${size.toFixed(2)} USDC @ ${(signal.currentPrice * 100).toFixed(1)}% — "${signal.marketQuestion.slice(0, 50)}..."`,
          `Edge: ${(signal.edge * 100).toFixed(1)}% | CLOB order: ${order.id} | Token: ${tokenId.slice(0, 16)}... | Strategy: ${signal.strategyType}`
        );
        executed++;

        // Enforce per-loop cap
        const openLive = await db
          .select()
          .from(tradesTable)
          .where(and(eq(tradesTable.status, "open"), eq(tradesTable.executionMode, "live")));
        if (openLive.length >= LIVE_MAX_OPEN_TRADES) break;
      } catch (err) {
        await addLog("error", `[LIVE] Order failed for signal ${signal.id}: ${err instanceof Error ? err.message : String(err)}`);
        await db.update(signalsTable).set({ status: "rejected" }).where(eq(signalsTable.id, signal.id));
      }
    } else {
      // Paper trade — record at the LIVE Polymarket price fetched during this scan
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
        executionMode: "paper",
      });

      await db.update(signalsTable).set({ status: "executed" }).where(eq(signalsTable.id, signal.id));

      await addLog(
        "trade",
        `[PAPER] Opened: ${signal.direction} ${size.toFixed(2)} USDC @ ${(signal.currentPrice * 100).toFixed(1)}% — "${signal.marketQuestion.slice(0, 50)}..."`,
        `Edge: ${(signal.edge * 100).toFixed(1)}% | Kelly size: ${size.toFixed(2)} USDC | Strategy: ${signal.strategyType}`
      );
      executed++;
    }
  }

  if (executed > 0) {
    await db.update(botStateTable)
      .set({ totalTradesExecuted: sql`total_trades_executed + ${executed}` })
      .where(eq(botStateTable.id, 1));
  }
}

// ─── Mark-to-Market ───────────────────────────────────────────────────────────
export async function markToMarket(): Promise<void> {
  const openTrades = await db
    .select()
    .from(tradesTable)
    .where(eq(tradesTable.status, "open"));

  if (openTrades.length === 0) return;

  // For live trades, fetch real positions from Canon
  let livePositionMap = new Map<string, { currentPrice: number; unrealizedPnL: number }>();
  if (currentExecutionMode === "live") {
    try {
      const { positions } = await getLivePositions();
      for (const pos of positions) {
        livePositionMap.set(pos.outcomeId, { currentPrice: pos.currentPrice, unrealizedPnL: pos.unrealizedPnL });
      }
    } catch (err) {
      await addLog("warn", `Failed to fetch live positions for mark-to-market: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const currentMarkets = await db
    .select()
    .from(marketsTable)
    .where(eq(marketsTable.isActive, true));

  const priceMap = new Map(currentMarkets.map((m) => [m.id, m]));

  for (const trade of openTrades) {
    const isLiveTrade = trade.executionMode === "live";
    const market = priceMap.get(trade.marketId);
    if (!market) continue;

    let currentPrice: number;
    if (isLiveTrade && trade.clobTokenId && livePositionMap.has(trade.clobTokenId)) {
      currentPrice = livePositionMap.get(trade.clobTokenId)!.currentPrice;
    } else {
      currentPrice = trade.direction === "YES" ? market.yesPrice : market.noPrice;
    }

    const entryPrice = trade.entryPrice;
    const priceDelta = currentPrice - entryPrice;
    const priceMoveInOurFavor = trade.direction === "YES" ? priceDelta : -priceDelta;

    let shouldClose = false;
    let closeReason = "";

    if (priceMoveInOurFavor >= TAKE_PROFIT_PCT) {
      shouldClose = true;
      closeReason = `Take profit triggered: +${(priceMoveInOurFavor * 100).toFixed(1)}% price move`;
    }

    if (priceMoveInOurFavor <= -STOP_LOSS_PCT) {
      shouldClose = true;
      closeReason = `Stop loss triggered: ${(priceMoveInOurFavor * 100).toFixed(1)}% adverse move`;
    }

    // Age out: 6h for paper, 48h for live (prediction markets are long-horizon)
    const ageHours = (Date.now() - trade.openedAt.getTime()) / 3600000;
    const maxAgeHours = isLiveTrade ? 48 : 6;
    if (ageHours > maxAgeHours && !shouldClose) {
      shouldClose = true;
      closeReason = `Position aged out (${ageHours.toFixed(1)}h)`;
    }

    if (shouldClose) {
      const exitPrice = currentPrice;

      if (isLiveTrade && trade.clobTokenId) {
        // Place a sell order to close the live position
        try {
          await createOrder({
            tokenId: trade.clobTokenId,
            side: "sell",
            size: trade.size,
            price: exitPrice,
            orderType: "limit",
          });
        } catch (err) {
          await addLog("warn", `Live close order failed for trade ${trade.id}: ${err instanceof Error ? err.message : String(err)}`);
          // Still mark closed in DB — position may have resolved naturally
        }
      }

      let pnl: number;
      if (trade.direction === "YES") {
        pnl = trade.size * (exitPrice - entryPrice) / entryPrice;
      } else {
        pnl = trade.size * (entryPrice - exitPrice) / entryPrice;
      }
      const pnlPercent = (pnl / trade.size) * 100;
      const outcome = pnl >= 0 ? "WIN" : "LOSS";
      const modeTag = isLiveTrade ? "LIVE" : "PAPER";

      await db.update(tradesTable)
        .set({ exitPrice, pnl, pnlPercent, status: "closed", closedAt: new Date() })
        .where(eq(tradesTable.id, trade.id));

      if (!isLiveTrade) {
        // Only adjust paper bankroll — live bankroll comes from actual USDC.e balance
        await db.update(botStateTable)
          .set({ bankroll: sql`bankroll + ${pnl}` })
          .where(eq(botStateTable.id, 1));
      }

      await addLog(
        "trade",
        `[${modeTag}] Closed [${outcome}]: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDC (${pnlPercent.toFixed(1)}%) — "${trade.marketQuestion.slice(0, 45)}..."`,
        `Entry: ${(entryPrice * 100).toFixed(1)}% → Exit: ${(exitPrice * 100).toFixed(1)}% | ${closeReason}`
      );
    }
  }
}

// ─── Bot Lifecycle ────────────────────────────────────────────────────────────
let botInterval: ReturnType<typeof setInterval> | null = null;

export async function startBotEngine(mode: "paper" | "live" = "paper"): Promise<void> {
  if (botInterval) return;

  currentExecutionMode = mode;

  if (mode === "live") {
    await addLog("info", "Live mode: verifying Canon sidecar, wallet, and Polymarket onboarding...");
    try {
      await ensureSidecar();
      await addLog("info", "pmxt sidecar ready");
    } catch (err) {
      throw new Error(`Live mode startup: sidecar failed — ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await ensureWallet();
      await addLog("info", "Canon wallet ready");
    } catch (err) {
      throw new Error(`Live mode startup: wallet check failed — ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const status = await getOnboardStatus();
      if (!status.funderDeployed || !status.approvalsReady || !status.credsReady) {
        throw new Error(`Polymarket onboarding incomplete: funder=${String(status.funderDeployed)} approvals=${String(status.approvalsReady)} creds=${String(status.credsReady)}`);
      }
      const balance = await getUsdceBalance();
      if (balance < 1.0) {
        throw new Error(`Insufficient USDC.e balance: ${balance.toFixed(2)} (need ≥ 1.00)`);
      }
      await addLog("info", `Polymarket onboarding verified. USDC.e balance: ${balance.toFixed(2)}`);
    } catch (err) {
      throw new Error(`Live mode startup: onboard check failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await db.update(botStateTable)
    .set({ isRunning: true, startedAt: new Date(), executionMode: mode })
    .where(eq(botStateTable.id, 1));

  const modeLabel = mode === "live" ? "LIVE (real USDC.e on Polymarket)" : "Paper trading";
  await addLog(
    "info",
    `Bot engine started. Mode: ${modeLabel}`,
    `Strategy: Series Arbitrage + Cross-Market Arb + NBA Stats | Data: Polymarket CLOB (live) + ESPN Playoffs (live)${mode === "live" ? ` | Max position: $${LIVE_MAX_POSITION_USD} | Max open: ${LIVE_MAX_OPEN_TRADES}` : ""}`
  );

  const tick = async () => {
    try {
      await syncPolymarketMarkets();
      await markToMarket();
      await scanMarketsAndGenerateSignals();
      await executePendingSignals();
    } catch (err) {
      logger.error({ err }, "Bot engine tick error");
      await addLog("error", `Bot tick error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await tick();
  botInterval = setInterval(tick, 30000);
}

export async function stopBotEngine(): Promise<void> {
  if (botInterval) {
    clearInterval(botInterval);
    botInterval = null;
  }

  if (currentExecutionMode === "live") {
    try {
      const { cancelled } = await killAllOrders();
      await addLog("info", `Live mode shutdown: cancelled ${cancelled} open order(s)`);
    } catch (err) {
      await addLog("warn", `killAllOrders on shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await db.update(botStateTable)
    .set({ isRunning: false, startedAt: null })
    .where(eq(botStateTable.id, 1));

  const modeLabel = currentExecutionMode === "live" ? "live mode — open positions remain on Polymarket" : "paper account";
  await addLog("info", `Bot engine stopped. Open positions tracked in ${modeLabel}.`);
  currentExecutionMode = "paper";
}

export function isBotRunning(): boolean {
  return botInterval !== null;
}

export function getExecutionMode(): "paper" | "live" {
  return currentExecutionMode;
}
