/**
 * Canon executor — bridges the Canonboy strategy engine to real Polymarket
 * CLOB execution via canon-cli and the pmxt-core sidecar.
 *
 * All order-related commands shell out to canon-cli so this package carries
 * zero blockchain dependencies. The sidecar handles key management and
 * signing internally.
 *
 * cwd for every subprocess is the project root so .canon/wallet.env resolves.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

// Paths
const PROJECT_ROOT = path.resolve("/home/user/Canonboy");
const CANON_CLI = path.join(process.env["HOME"] ?? "/root", ".degacore/bin/canon-cli");
const PMXT_SERVER = path.join(
  process.env["HOME"] ?? "/root",
  ".degacore/canon/templates/node_modules/.bin/pmxt-ensure-server",
);

// Per-trade hard cap for the $10 USDC test budget
export const LIVE_MAX_POSITION_USD = 5.0;
export const LIVE_MAX_OPEN_TRADES = 2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function runCanon<T>(args: string[]): Promise<T> {
  const { stdout, stderr } = await execFileAsync(CANON_CLI, args, {
    cwd: PROJECT_ROOT,
    timeout: 30_000,
    env: { ...process.env },
  });
  if (stderr) logger.debug({ stderr }, "canon-cli stderr");
  return JSON.parse(stdout.trim()) as T;
}

// ─── Sidecar ─────────────────────────────────────────────────────────────────

let sidecarStarted = false;

export async function ensureSidecar(): Promise<void> {
  if (sidecarStarted) return;
  if (!existsSync(PMXT_SERVER)) {
    throw new Error(`pmxt-ensure-server not found at ${PMXT_SERVER}`);
  }
  try {
    await execFileAsync(PMXT_SERVER, [], {
      cwd: PROJECT_ROOT,
      timeout: 20_000,
      env: { ...process.env },
    });
    sidecarStarted = true;
    logger.info("pmxt sidecar ensured");
  } catch (err) {
    // pmxt-ensure-server exits non-zero if already running — that's fine
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already") || msg.includes("EEXIST") || msg.includes("running")) {
      sidecarStarted = true;
      return;
    }
    // Non-zero exit code from pmxt-ensure-server often means "already running"
    // Check by looking at the lock file
    const lockFile = path.join(process.env["HOME"] ?? "/root", ".pmxt/server.lock");
    if (existsSync(lockFile)) {
      sidecarStarted = true;
      logger.info("pmxt sidecar already running (lock file present)");
      return;
    }
    throw new Error(`Failed to start pmxt sidecar: ${msg}`);
  }
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

export interface WalletInfo {
  address: string;
  created: boolean;
  message: string;
}

export async function ensureWallet(): Promise<WalletInfo> {
  return runCanon<WalletInfo>(["wallet", "ensure"]);
}

export async function getWalletAddress(): Promise<string> {
  const result = await runCanon<{ address: string }>(["wallet", "address"]);
  return result.address;
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

export interface OnboardStatus {
  venue: string;
  chainId: number;
  funderAddress: string;
  funderDeployed: boolean;
  approvalsReady: boolean;
  credsReady: boolean;
  fundedCollateral: string;
}

export async function getOnboardStatus(): Promise<OnboardStatus> {
  return runCanon<OnboardStatus>(["onboard", "--status", "--venue", "polymarket"]);
}

export async function runOnboard(): Promise<{ status: OnboardStatus }> {
  return runCanon<{ status: OnboardStatus }>(["onboard", "--execute", "--venue", "polymarket"]);
}

// ─── Balance ─────────────────────────────────────────────────────────────────

export interface BalanceEntry {
  currency: string;
  address: string;
  amount: number;
  tradeable: boolean;
  note?: string;
}

export async function getBalances(): Promise<BalanceEntry[]> {
  return runCanon<BalanceEntry[]>(["balance"]);
}

export async function getUsdceBalance(): Promise<number> {
  const balances = await getBalances();
  const usdce = balances.find((b) => b.currency === "USDC.e");
  return usdce?.amount ?? 0;
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export interface OrderResult {
  id: string;
  marketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  amount: number;
  price: number;
  status: string;
  filled: number;
  remaining: number;
}

export async function createOrder(params: {
  tokenId: string;
  side: "buy" | "sell";
  size: number;
  price: number;
  marketId?: string;
  orderType?: "market" | "limit";
}): Promise<OrderResult> {
  const args = [
    "order", "create",
    "--token-id", params.tokenId,
    "--side", params.side,
    "--size", String(params.size.toFixed(2)),
    "--price", String(params.price.toFixed(4)),
    "--type", params.orderType ?? "limit",
  ];
  if (params.marketId) {
    args.push("--market-id", params.marketId);
  }
  return runCanon<OrderResult>(args);
}

export async function cancelOrder(orderId: string): Promise<{ id: string; status: string }> {
  return runCanon<{ id: string; status: string }>(["order", "cancel", orderId]);
}

export async function killAllOrders(): Promise<{ cancelled: number }> {
  try {
    const result = await runCanon<{ cancelled: number }>(["kill"]);
    return result;
  } catch {
    // kill returns non-zero when no orders exist — that's fine
    return { cancelled: 0 };
  }
}

// ─── Positions ───────────────────────────────────────────────────────────────

export interface LivePosition {
  marketId: string;
  outcomeId: string;
  outcomeLabel: string;
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
}

export interface PositionList {
  positions: LivePosition[];
  summary: {
    totalValue: number;
    dailyPnL: number;
    positionCount: number;
  };
}

export async function getLivePositions(): Promise<PositionList> {
  return runCanon<PositionList>(["position", "list"]);
}

// ─── Readiness check ─────────────────────────────────────────────────────────

export interface ReadinessResult {
  walletReady: boolean;
  walletAddress: string | null;
  onboardReady: boolean;
  sidecarReady: boolean;
  usdceBalance: number;
  errors: string[];
}

export async function checkReadiness(): Promise<ReadinessResult> {
  const result: ReadinessResult = {
    walletReady: false,
    walletAddress: null,
    onboardReady: false,
    sidecarReady: false,
    usdceBalance: 0,
    errors: [],
  };

  // Wallet
  try {
    result.walletAddress = await getWalletAddress();
    result.walletReady = true;
  } catch (err) {
    result.errors.push(`Wallet: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Sidecar
  try {
    await ensureSidecar();
    result.sidecarReady = true;
  } catch (err) {
    result.errors.push(`Sidecar: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Onboard status + balance (only if sidecar is up)
  if (result.sidecarReady && result.walletReady) {
    try {
      const status = await getOnboardStatus();
      result.onboardReady = status.funderDeployed && status.approvalsReady && status.credsReady;
      if (!result.onboardReady) {
        result.errors.push(
          `Onboarding incomplete: funder=${String(status.funderDeployed)} approvals=${String(status.approvalsReady)} creds=${String(status.credsReady)}`,
        );
      }
    } catch (err) {
      result.errors.push(`Onboard status: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      result.usdceBalance = await getUsdceBalance();
    } catch {
      // non-fatal
    }
  }

  return result;
}
