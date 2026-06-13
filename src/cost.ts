import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cost ledger — a $-budget is the primary termination signal for autonomous coding
 * agents (SWE-agent style). We parse the spend each provider reports in its structured
 * output and append it to an append-only ledger, then gate the loop on a configured cap.
 */

export type CostEntry = {
  ts: string;
  role: string;
  taskId: string;
  usd: number;
  inputTokens?: number;
  outputTokens?: number;
};

export function costLedgerPath(boardDir: string): string {
  return resolve(boardDir, "costs.jsonl");
}

/**
 * Extract the USD cost and token usage an agent reported in its JSON output.
 * Claude exposes `total_cost_usd` + `usage.{input,output}_tokens`; other providers may
 * expose `cost`/`usage`. Returns zeros when nothing is reported (e.g. subscription auth).
 */
export function parseCost(stdout: string): { usd: number; inputTokens?: number; outputTokens?: number } {
  const usdMatch = /"total_cost_usd"\s*:\s*([0-9.]+)/.exec(stdout) ?? /"cost(?:_usd)?"\s*:\s*([0-9.]+)/.exec(stdout);
  const inMatch = /"input_tokens"\s*:\s*([0-9]+)/.exec(stdout);
  const outMatch = /"output_tokens"\s*:\s*([0-9]+)/.exec(stdout);
  return {
    usd: usdMatch ? Number(usdMatch[1]) : 0,
    inputTokens: inMatch ? Number(inMatch[1]) : undefined,
    outputTokens: outMatch ? Number(outMatch[1]) : undefined
  };
}

export function recordCost(boardDir: string, entry: CostEntry): void {
  appendFileSync(costLedgerPath(boardDir), `${JSON.stringify(entry)}\n`);
}

export function totalSpend(boardDir: string): number {
  const path = costLedgerPath(boardDir);
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      total += Number((JSON.parse(trimmed) as CostEntry).usd) || 0;
    } catch {
      // skip torn line
    }
  }
  return total;
}

export function initCostLedger(boardDir: string): void {
  const path = costLedgerPath(boardDir);
  if (!existsSync(path)) writeFileSync(path, "");
}
