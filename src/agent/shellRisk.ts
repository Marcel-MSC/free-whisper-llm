export type ShellRisk = "low" | "medium" | "high" | "blocked";

export interface ShellRiskAssessment {
  risk: ShellRisk;
  reasons: string[];
  allowAutoRun: boolean;
}

const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/i,
  /\brm\s+-rf\s+\/\b/i,
  /\bmkfs\b/i,
  /\bdd\s+.*\bof=\/dev\//i,
  /\b:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?/i, // fork bomb
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\binit\s+[06]\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bwget\b.*\|\s*(ba)?sh\b/i,
  /\bpowershell\b.*-enc\b/i,
  /\bInvoke-Expression\b/i,
  /\bRemove-Item\b.*-Recurse.*-Force\b.*\\$/i,
];

const HIGH_PATTERNS: RegExp[] = [
  /\brm\s+-rf?\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\b.*--force\b/i,
  /\bgit\s+clean\s+-fd/i,
  /\bsudo\b/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\b/i,
  /\bformat\s+[a-z]:/i,
  /\breg\s+delete\b/i,
  /\bkill\s+-9\b/i,
  /\bpkill\b/i,
];

const MEDIUM_PATTERNS: RegExp[] = [
  /\bnpm\s+(publish|unpublish)\b/i,
  /\bdocker\s+(system\s+prune|rmi|volume\s+rm)\b/i,
  /\bkubectl\s+delete\b/i,
  /\bgit\s+push\b/i,
  /\bmv\s+/i,
  /\bcp\s+-r\b/i,
];

export function assessShellRisk(command: string): ShellRiskAssessment {
  const cmd = command.trim();
  if (!cmd) {
    return { risk: "blocked", reasons: ["Empty command"], allowAutoRun: false };
  }

  const reasons: string[] = [];

  for (const re of BLOCKED_PATTERNS) {
    if (re.test(cmd)) {
      reasons.push(`Blocked pattern: ${re.source}`);
      return { risk: "blocked", reasons, allowAutoRun: false };
    }
  }

  for (const re of HIGH_PATTERNS) {
    if (re.test(cmd)) {
      reasons.push(`High-risk pattern: ${re.source}`);
    }
  }
  if (reasons.length) {
    return { risk: "high", reasons, allowAutoRun: false };
  }

  for (const re of MEDIUM_PATTERNS) {
    if (re.test(cmd)) {
      reasons.push(`Medium-risk pattern: ${re.source}`);
    }
  }
  if (reasons.length) {
    return { risk: "medium", reasons, allowAutoRun: false };
  }

  return { risk: "low", reasons: [], allowAutoRun: true };
}
