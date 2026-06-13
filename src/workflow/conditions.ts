// Pure stop-condition evaluation. No IO here so it stays trivially testable.
//
// Supported condition vocabulary:
//   pane-matches:<regex>   true when the captured pane text matches the regex
//   pane-idle:<seconds>    true when the pane has not changed for >= N seconds
//   tests-pass             named regex for a passing test/build signal
//   tests-fail             named regex for a failing test/build signal
//   pr-opened              true when the `prOpened` signal is set (e.g. via gh)
//   review-approved        true when the `reviewApproved` signal is set
//   <anything else>        treated as a case-insensitive substring match (compat)

export type ConditionContext = {
  paneText: string;
  secondsSinceChange: number;
  signals: Record<string, boolean>;
};

export type ConditionResult = {
  condition: string;
  met: boolean;
  evidence?: string;
};

const NAMED_PATTERNS: Record<string, RegExp> = {
  "tests-pass": /\b(tests?\s+pass(ed)?|all tests pass(ed)?|0 failing|build succeeded|✓\s*all)\b/i,
  "tests-fail": /\b(tests?\s+fail(ed)?|\d+\s+failing|build failed|fatal error)\b/i
};

const SIGNAL_CONDITIONS: Record<string, string> = {
  "pr-opened": "prOpened",
  "review-approved": "reviewApproved"
};

function truncate(value: string, max = 80): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function matchRegex(condition: string, regex: RegExp, text: string): ConditionResult {
  const match = regex.exec(text);
  return { condition, met: Boolean(match), evidence: match ? truncate(match[0]) : undefined };
}

export function evaluateCondition(condition: string, ctx: ConditionContext): ConditionResult {
  const value = condition.trim();

  if (value.startsWith("pane-matches:")) {
    const pattern = value.slice("pane-matches:".length);
    try {
      return matchRegex(value, new RegExp(pattern, "i"), ctx.paneText);
    } catch {
      return { condition: value, met: false, evidence: "invalid regex" };
    }
  }

  if (value.startsWith("pane-idle:")) {
    const seconds = Number(value.slice("pane-idle:".length));
    const met = Number.isFinite(seconds) && ctx.secondsSinceChange >= seconds;
    return { condition: value, met, evidence: met ? `idle ${Math.floor(ctx.secondsSinceChange)}s` : undefined };
  }

  const named = NAMED_PATTERNS[value];
  if (named) return matchRegex(value, named, ctx.paneText);

  const signalKey = SIGNAL_CONDITIONS[value];
  if (signalKey) {
    return { condition: value, met: Boolean(ctx.signals[signalKey]), evidence: ctx.signals[signalKey] ? signalKey : undefined };
  }

  // Backward-compatible fallback: free-text condition => substring match.
  const idx = ctx.paneText.toLowerCase().indexOf(value.toLowerCase());
  return { condition: value, met: idx >= 0, evidence: idx >= 0 ? truncate(value) : undefined };
}

// Returns the first met condition (with its evidence), or null if none matched.
export function firstMet(conditions: string[], ctx: ConditionContext): ConditionResult | null {
  for (const condition of conditions) {
    const result = evaluateCondition(condition, ctx);
    if (result.met) return result;
  }
  return null;
}
