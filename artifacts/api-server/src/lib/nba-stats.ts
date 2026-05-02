import { logger } from "./logger";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

export interface PlayoffGame {
  id: string;
  date: string;
  status: string;
  round: string;         // e.g. "East 1st Round - Game 6"
  homeTeam: string;      // abbr
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: string | null; // abbr of winner, null if not final
}

export interface SeriesRecord {
  teamA: string;         // abbr
  teamB: string;
  teamAWins: number;
  teamBWins: number;
  round: string;
  nextGameHome: string | null;  // abbr of team hosting next game
}

export interface NBAPlayoffState {
  games: PlayoffGame[];
  series: SeriesRecord[];
  teamPowerRatings: Record<string, number>; // abbr -> 0-1 power rating
}

// Power ratings derived from regular season record + expected playoff performance
// Based on market prices and real-world analysis
const TEAM_BASE_RATINGS: Record<string, number> = {
  "OKC": 0.82,  // Clear frontrunner, #1 seed
  "SA":  0.68,  // Victor Wembanyama, Spurs surprise run
  "BOS": 0.64,  // Defending champion class
  "NY":  0.61,  // Strong this year
  "DET": 0.58,  // Cade Cunningham
  "CLE": 0.57,  // Good squad
  "LAL": 0.55,  // LeBron run
  "TOR": 0.52,
  "ORL": 0.50,
  "PHI": 0.48,
  "MIN": 0.46,
  "HOU": 0.44,
};

function parseScore(scoreStr: string): number {
  const n = parseInt(scoreStr, 10);
  return isNaN(n) ? 0 : n;
}

export async function fetchPlayoffGames(): Promise<PlayoffGame[]> {
  const url = `${ESPN_BASE}/scoreboard?seasontype=3&limit=50`;
  const res = await fetch(url, {
    headers: { "User-Agent": "DEGA-NBA-Bot/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ESPN scoreboard error: ${res.status}`);

  const data = await res.json() as { events?: any[] };
  const events = data.events ?? [];

  const games: PlayoffGame[] = [];

  for (const e of events) {
    const comp = (e.competitions ?? [])[0];
    if (!comp) continue;

    const competitors: any[] = comp.competitors ?? [];
    const home = competitors.find((c: any) => c.homeAway === "home");
    const away = competitors.find((c: any) => c.homeAway === "away");
    if (!home || !away) continue;

    const note = (comp.notes ?? [])[0]?.headline ?? "";
    const status = e.status?.type?.description ?? "";
    const isFinal = status === "Final";

    const homeScore = parseScore(home.score);
    const awayScore = parseScore(away.score);
    let winner: string | null = null;
    if (isFinal) {
      winner = homeScore > awayScore ? home.team?.abbreviation : away.team?.abbreviation;
    }

    games.push({
      id: e.id,
      date: e.date,
      status,
      round: note,
      homeTeam: home.team?.abbreviation ?? "",
      awayTeam: away.team?.abbreviation ?? "",
      homeScore,
      awayScore,
      winner,
    });
  }

  return games;
}

export function deriveSeries(games: PlayoffGame[]): SeriesRecord[] {
  // Group games by matchup (unordered pair of teams)
  const matchupMap = new Map<string, PlayoffGame[]>();

  for (const g of games) {
    if (!g.homeTeam || !g.awayTeam) continue;
    const key = [g.homeTeam, g.awayTeam].sort().join("_");
    const existing = matchupMap.get(key) ?? [];
    existing.push(g);
    matchupMap.set(key, existing);
  }

  const series: SeriesRecord[] = [];

  for (const [key, matchGames] of matchupMap.entries()) {
    const [teamA, teamB] = key.split("_");
    const sorted = matchGames.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const finishedGames = sorted.filter((g) => g.winner !== null);

    const teamAWins = finishedGames.filter((g) => g.winner === teamA).length;
    const teamBWins = finishedGames.filter((g) => g.winner === teamB).length;

    // Find next scheduled game for home court
    const nextGame = sorted.find((g) => g.status === "Scheduled");
    const round = sorted[0]?.round.split(" - ")[0] ?? "";

    series.push({ teamA, teamB, teamAWins, teamBWins, round, nextGameHome: nextGame?.homeTeam ?? null });
  }

  return series;
}

export async function fetchNBAPlayoffState(): Promise<NBAPlayoffState> {
  const games = await fetchPlayoffGames();
  const series = deriveSeries(games);

  // Adjust power ratings based on current series performance
  const teamPowerRatings: Record<string, number> = { ...TEAM_BASE_RATINGS };

  for (const s of series) {
    const winDiff = s.teamAWins - s.teamBWins;
    const seriesBoost = winDiff * 0.03;
    if (teamPowerRatings[s.teamA] !== undefined) {
      teamPowerRatings[s.teamA] = Math.max(0.05, Math.min(0.95, teamPowerRatings[s.teamA] + seriesBoost));
    }
    if (teamPowerRatings[s.teamB] !== undefined) {
      teamPowerRatings[s.teamB] = Math.max(0.05, Math.min(0.95, teamPowerRatings[s.teamB] - seriesBoost));
    }
  }

  return { games, series, teamPowerRatings };
}

// Get head-to-head series record for a pair of teams
export function getSeriesRecord(series: SeriesRecord[], teamA: string, teamB: string): SeriesRecord | null {
  const key = [teamA, teamB].sort().join("_");
  return series.find((s) => [s.teamA, s.teamB].sort().join("_") === key) ?? null;
}

// Compute win probability from Elo-style ratings
export function computeWinProb(ratingA: number, ratingB: number, homeAdvantage = 0): number {
  const adjusted = ratingA + homeAdvantage * 0.05;
  const p = adjusted / (adjusted + ratingB);
  return Math.min(0.95, Math.max(0.05, p));
}

// Compute series win probability (best of 7)
// Given per-game probability p, compute series win probability
export function seriesWinProb(gameP: number, winsNeeded = 4): number {
  // Negative binomial CDF
  let prob = 0;
  for (let wins = winsNeeded; wins <= winsNeeded * 2 - 1; wins++) {
    const losses = wins + (winsNeeded * 2 - 1) - wins - (winsNeeded - 1);
    // Actually: P(win series in exactly n games) = C(n-1, winsNeeded-1) * p^winsNeeded * (1-p)^(n-winsNeeded)
    // where n = total games played
    const totalGames = wins; // this is wrong, let me fix
    // P(team wins series) where series goes to best of 7
    // = sum over k=0 to 3 of C(3+k, k) * p^4 * (1-p)^k
    break;
  }

  // Simpler: use recursive formula
  // P(win series | 0-0) with per-game prob p
  function seriesP(needA: number, needB: number): number {
    if (needA === 0) return 1;
    if (needB === 0) return 0;
    return gameP * seriesP(needA - 1, needB) + (1 - gameP) * seriesP(needA, needB - 1);
  }

  return seriesP(winsNeeded, winsNeeded);
}

// Given current series wins, compute remaining win probability
export function remainingSeriesWinProb(
  gameP: number,
  myCurrentWins: number,
  oppCurrentWins: number,
  winsNeeded = 4
): number {
  const myNeed = winsNeeded - myCurrentWins;
  const oppNeed = winsNeeded - oppCurrentWins;
  if (myNeed <= 0) return 1;
  if (oppNeed <= 0) return 0;

  function seriesP(needA: number, needB: number): number {
    if (needA === 0) return 1;
    if (needB === 0) return 0;
    return gameP * seriesP(needA - 1, needB) + (1 - gameP) * seriesP(needA, needB - 1);
  }

  return Math.min(0.97, Math.max(0.03, seriesP(myNeed, oppNeed)));
}
