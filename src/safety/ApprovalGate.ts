/**
 * @file Safety Hooks の承認プロンプト。
 * @module safety/ApprovalGate
 */

import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import type { Readable, Writable } from "node:stream";
import type { AgentName } from "../config/agents.js";
import type { SafetyDecision } from "./SafetyPolicy.js";

export type ApprovalRequest = {
  sessionId: string;
  agent: AgentName;
  content: string;
  decision: SafetyDecision;
};

export type ApprovalResult = {
  approved: boolean;
  response: string;
  decidedAt: string;
};

export interface ApprovalGate {
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;
}

export type ConsoleApprovalGateOptions = {
  input?: Readable;
  output?: Writable;
  now?: () => Date;
};

export class ConsoleApprovalGate implements ApprovalGate {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly now: () => Date;

  constructor(options: ConsoleApprovalGateOptions = {}) {
    this.input = options.input ?? defaultStdin;
    this.output = options.output ?? defaultStdout;
    this.now = options.now ?? (() => new Date());
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    if (!isTty(this.input) || !isTty(this.output)) {
      return {
        approved: false,
        response: "non-interactive",
        decidedAt: this.now().toISOString(),
      };
    }

    this.output.write(formatApprovalPrompt(request));
    const rl = createInterface({
      input: this.input,
      output: this.output,
    });
    try {
      const answer = await rl.question("approve? [y/N] ");
      return {
        approved: /^y(?:es)?$/i.test(answer.trim()),
        response: answer.trim(),
        decidedAt: this.now().toISOString(),
      };
    } finally {
      rl.close();
    }
  }
}

export const formatApprovalPrompt = (request: ApprovalRequest): string => {
  const lines = [
    "",
    `Safety review for ${request.agent} in ${request.sessionId}`,
    request.decision.summary,
    ...request.decision.findings.map(
      (finding) => `- ${finding.severity} ${finding.ruleId}: ${finding.match}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
};

const isTty = (stream: Readable | Writable): boolean =>
  Boolean((stream as { isTTY?: boolean }).isTTY);
