/**
 * @file Safety Hooks の承認要否判定。
 * @module safety/SafetyPolicy
 */

import { CommandDetector, type SafetyFinding } from "./CommandDetector.js";

export type SafetyDecision = {
  requiresApproval: boolean;
  findings: SafetyFinding[];
  summary: string;
};

export type SafetyPolicyOptions = {
  detector?: CommandDetector;
};

export class SafetyPolicy {
  private readonly detector: CommandDetector;

  constructor(options: SafetyPolicyOptions = {}) {
    this.detector = options.detector ?? new CommandDetector();
  }

  evaluate(content: string): SafetyDecision {
    const findings = this.detector.detect(content);
    return {
      requiresApproval: findings.length > 0,
      findings,
      summary: createSummary(findings),
    };
  }
}

export const createSummary = (findings: readonly SafetyFinding[]): string => {
  if (findings.length === 0) {
    return "no safety issues detected";
  }

  const high = findings.filter((finding) => finding.severity === "high").length;
  const medium = findings.filter((finding) => finding.severity === "medium").length;
  return `safety review found ${findings.length} issue(s): ${high} high, ${medium} medium`;
};
