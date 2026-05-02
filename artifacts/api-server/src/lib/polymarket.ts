import { db, marketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const GAMMA_API = "https://gamma-api.polymarket.com";

// Known NBA team name patterns to match against market questions
const NBA_KEYWORDS = [
  "nba", "thunder", "celtics", "knicks", "spurs", "nuggets",
  "timberwolves", "wolves", "warriors", "lakers", "cavaliers", "cavs",
  "pacers", "76ers", "sixers", "heat", "bucks", "pistons", "magic",
  "raptors", "rockets", "lakers", "clippers", "suns", "mavericks",
  "gilgeous-alexander", "wembanyama", "jokic", "lebron",
];

const NBA_TEAM_MAP: Record<string, string> = {
  "oklahoma city thunder": "OKC",
  "thunder": "OKC",
  "san antonio spurs": "SA",
  "spurs": "SA",
  "boston celtics": "BOS",
  "celtics": "BOS",
  "new york knicks": "NY",
  "knicks": "NY",
  "denver nuggets": "DEN",
  "nuggets": "DEN",
  "minnesota timberwolves": "MIN",
  "timberwolves": "MIN",
  "golden state warriors": "GS",
  "warriors": "GS",
  "los angeles lakers": "LAL",
  "lakers": "LAL",
  "cleveland cavaliers": "CLE",
  "cavaliers": "CLE",
  "miami heat": "MIA",
  "heat": "MIA",
  "milwaukee bucks": "MIL",
  "bucks": "MIL",
  "indiana pacers": "IND",
  "pacers": "IND",
  "philadelphia 76ers": "PHI",
  "76ers": "PHI",
  "detroit pistons": "DET",
  "pistons": "DET",
  "orlando magic": "ORL",
  "magic": "ORL",
  "toronto raptors": "TOR",
  "raptors": "TOR",
  "houston rockets": "HOU",
  "rockets": "HOU",
};

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomePrices: string;
  clobTokenIds: string;
  volume: string;
  volumeNum: number;
  liquidityNum: number;
  active: boolean;
  closed: boolean;
  endDate: string;
}

function detectMarketType(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("nba finals") || q.includes("nba championship") || q.includes("champion")) return "champion";
  if (q.includes("eastern conference finals") || q.includes("western conference finals") || q.includes("conference finals")) return "conference";
  if (q.includes("semifinals") || q.includes("series")) return "series_winner";
  if (q.includes("mvp")) return "award";
  if (q.includes("game")) return "game_winner";
  return "champion";
}

function extractTeam(question: string, pattern: "primary" | "secondary" = "primary"): string {
  const q = question.toLowerCase();
  const matches: string[] = [];
  for (const [key, abbr] of Object.entries(NBA_TEAM_MAP)) {
    if (q.includes(key)) {
      matches.push(abbr);
    }
  }
  // Dedupe
  const unique = [...new Set(matches)];
  if (pattern === "primary") return unique[0] ?? "N/A";
  return unique[1] ?? null as unknown as string;
}

function isNBAMarket(question: string): boolean {
  const q = question.toLowerCase();
  return NBA_KEYWORDS.some((kw) => q.includes(kw));
}

export async function fetchLiveNBAMarkets(): Promise<GammaMarket[]> {
  const url = `${GAMMA_API}/markets?active=true&closed=false&limit=500`;
  const res = await fetch(url, {
    headers: { "User-Agent": "DEGA-NBA-Bot/1.0" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`Polymarket Gamma API error: ${res.status}`);

  const markets: GammaMarket[] = await res.json();
  return markets.filter((m) => isNBAMarket(m.question));
}

export async function syncPolymarketMarkets(): Promise<number> {
  const raw = await fetchLiveNBAMarkets();
  let synced = 0;

  for (const m of raw) {
    try {
      const prices = JSON.parse(m.outcomePrices || "[0.5, 0.5]") as string[];
      const yesPrice = parseFloat(prices[0] ?? "0.5");
      const noPrice = parseFloat(prices[1] ?? "0.5");

      const teamA = extractTeam(m.question, "primary");
      const teamB = extractTeam(m.question, "secondary");
      const marketType = detectMarketType(m.question);

      const existing = await db
        .select()
        .from(marketsTable)
        .where(eq(marketsTable.polymarketId, m.id));

      if (existing.length > 0) {
        // Update prices
        await db.update(marketsTable)
          .set({ yesPrice, noPrice, volume: m.volumeNum ?? 0, isActive: m.active && !m.closed })
          .where(eq(marketsTable.polymarketId, m.id));
      } else {
        // Insert new market
        await db.insert(marketsTable).values({
          polymarketId: m.id,
          question: m.question,
          teamA,
          teamB: teamB || null,
          marketType,
          yesPrice,
          noPrice,
          volume: m.volumeNum ?? 0,
          isActive: m.active && !m.closed,
          endDate: m.endDate ? m.endDate.split("T")[0] : null,
        });
      }
      synced++;
    } catch (err) {
      logger.warn({ err, market: m.id }, "Failed to sync market");
    }
  }

  return synced;
}

// Fetch fresh price from CLOB midpoint API for a specific token
export async function fetchLivePrice(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`, {
      headers: { "User-Agent": "DEGA-NBA-Bot/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { mid: string };
    return parseFloat(data.mid);
  } catch {
    return null;
  }
}
