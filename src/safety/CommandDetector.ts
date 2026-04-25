/**
 * @file agent出力内の危険コマンドや秘密情報参照を検出する。
 * @module safety/CommandDetector
 */

export type SafetyFindingKind = "dangerous-command" | "secret-reference";
export type SafetySeverity = "medium" | "high";

export type SafetyFinding = {
  kind: SafetyFindingKind;
  severity: SafetySeverity;
  ruleId: string;
  match: string;
  reason: string;
  index: number;
};

type DetectionRule = {
  kind: SafetyFindingKind;
  severity: SafetySeverity;
  ruleId: string;
  pattern: RegExp;
  reason: string;
};

const dangerousCommandRules: DetectionRule[] = [
  {
    kind: "dangerous-command",
    severity: "high",
    ruleId: "rm-recursive-force",
    pattern: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(?:\/|~|\$HOME|\.{1,2}(?=$|\s|\/)|\*)/gim,
    reason: "recursive force delete can remove broad workspace or system data",
  },
  {
    kind: "dangerous-command",
    severity: "high",
    ruleId: "sudo-rm",
    pattern: /\bsudo\s+rm\s+-[^\n]*[rf][^\n]*/gim,
    reason: "privileged delete command requires explicit approval",
  },
  {
    kind: "dangerous-command",
    severity: "high",
    ruleId: "disk-write",
    pattern: /\bdd\s+[^\n]*(?:of=\/dev\/|if=\/dev\/zero)[^\n]*/gim,
    reason: "raw disk writes can destroy data",
  },
  {
    kind: "dangerous-command",
    severity: "high",
    ruleId: "format-disk",
    pattern: /\b(?:mkfs(?:\.\w+)?|fdisk|diskutil\s+eraseDisk)\b[^\n]*/gim,
    reason: "disk formatting or partitioning can destroy data",
  },
  {
    kind: "dangerous-command",
    severity: "medium",
    ruleId: "git-reset-hard",
    pattern: /\bgit\s+reset\s+--hard\b/gim,
    reason: "hard resets can discard local changes",
  },
  {
    kind: "dangerous-command",
    severity: "medium",
    ruleId: "git-clean-force",
    pattern: /\bgit\s+clean\s+-[^\n]*[fdx][^\n]*/gim,
    reason: "forced git clean can delete untracked files",
  },
  {
    kind: "dangerous-command",
    severity: "medium",
    ruleId: "docker-prune",
    pattern: /\bdocker\s+system\s+prune\b[^\n]*/gim,
    reason: "docker prune can delete images, containers, and build cache",
  },
  {
    kind: "dangerous-command",
    severity: "high",
    ruleId: "kubectl-delete",
    pattern: /\bkubectl\s+delete\b[^\n]*(?:--all|\bnamespace\b|\bdeployment\b|\bpod\b|\bsvc\b)/gim,
    reason: "cluster delete operations can remove live resources",
  },
  {
    kind: "dangerous-command",
    severity: "high",
    ruleId: "sql-drop",
    pattern: /\b(?:DROP\s+DATABASE|DROP\s+SCHEMA|TRUNCATE\s+TABLE)\b/gim,
    reason: "destructive SQL can remove persisted data",
  },
  {
    kind: "dangerous-command",
    severity: "medium",
    ruleId: "chmod-recursive-777",
    pattern: /\bchmod\s+-R\s+777\s+(?:\/|~|\$HOME)\b/gim,
    reason: "recursive broad permission changes are risky",
  },
];

const secretReferenceRules: DetectionRule[] = [
  {
    kind: "secret-reference",
    severity: "medium",
    ruleId: "dotenv-file",
    pattern: /(?:^|[^\w.-])\.env(?:\.[A-Za-z0-9_-]+)?\b/gm,
    reason: "dotenv files often contain secrets",
  },
  {
    kind: "secret-reference",
    severity: "high",
    ruleId: "private-key-file",
    pattern: /\b(?:id_rsa|id_ed25519|[^/\s]+\.pem|[^/\s]+\.p12|[^/\s]+\.key)\b/gim,
    reason: "private key files require care before reading or printing",
  },
  {
    kind: "secret-reference",
    severity: "high",
    ruleId: "private-key-block",
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/gim,
    reason: "private key material appears to be present",
  },
  {
    kind: "secret-reference",
    severity: "high",
    ruleId: "well-known-secret-env",
    pattern:
      /\b(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|DATABASE_URL|NPM_TOKEN)\b/gm,
    reason: "well-known secret-bearing environment variable appears in output",
  },
  {
    kind: "secret-reference",
    severity: "medium",
    ruleId: "generic-secret-assignment",
    pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key)\b\s*[:=]/gim,
    reason: "secret-like assignment appears in output",
  },
];

export class CommandDetector {
  constructor(private readonly rules: DetectionRule[] = defaultRules()) {}

  detect(content: string): SafetyFinding[] {
    const findings: SafetyFinding[] = [];

    for (const rule of this.rules) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      for (const match of content.matchAll(pattern)) {
        const text = match[0].trim();
        if (text.length === 0) {
          continue;
        }
        findings.push({
          kind: rule.kind,
          severity: rule.severity,
          ruleId: rule.ruleId,
          match: text,
          reason: rule.reason,
          index: match.index ?? 0,
        });
      }
    }

    return dedupeFindings(findings);
  }
}

export const detectSafetyIssues = (content: string): SafetyFinding[] =>
  new CommandDetector().detect(content);

const defaultRules = (): DetectionRule[] => [...dangerousCommandRules, ...secretReferenceRules];

const dedupeFindings = (findings: SafetyFinding[]): SafetyFinding[] => {
  const seen = new Set<string>();
  const out: SafetyFinding[] = [];
  for (const finding of findings.sort((a, b) => a.index - b.index)) {
    const key = `${finding.ruleId}:${finding.index}:${finding.match}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(finding);
  }
  return out;
};
