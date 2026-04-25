/**
 * @file Safety Policy / ApprovalGate / Store を接続する小さな実行ヘルパー。
 * @module safety/SafetyHooks
 */

import type { AgentName } from "../config/agents.js";
import type { AddStoredAgentEventInput } from "../store/SessionStore.js";
import { ConsoleApprovalGate, type ApprovalGate, type ApprovalResult } from "./ApprovalGate.js";
import { SafetyPolicy, type SafetyDecision } from "./SafetyPolicy.js";

export type SafetyEventStore = {
  addAgentEvent?(input: AddStoredAgentEventInput): unknown;
};

export type SafetyReviewInput = {
  sessionId: string;
  agent: AgentName;
  content: string;
  store: SafetyEventStore;
  policy?: SafetyPolicy;
  approvalGate?: ApprovalGate;
};

export type SafetyReviewResult = {
  decision: SafetyDecision;
  approval: ApprovalResult | null;
};

export const reviewSafety = async (input: SafetyReviewInput): Promise<SafetyReviewResult> => {
  const policy = input.policy ?? new SafetyPolicy();
  const decision = policy.evaluate(input.content);
  if (!decision.requiresApproval) {
    return {
      decision,
      approval: null,
    };
  }

  input.store.addAgentEvent?.({
    sessionId: input.sessionId,
    agent: input.agent,
    eventType: "safety.detected",
    payload: JSON.stringify({
      summary: decision.summary,
      findings: decision.findings,
    }),
  });

  const gate = input.approvalGate ?? new ConsoleApprovalGate();
  const approval = await gate.requestApproval({
    sessionId: input.sessionId,
    agent: input.agent,
    content: input.content,
    decision,
  });
  input.store.addAgentEvent?.({
    sessionId: input.sessionId,
    agent: input.agent,
    eventType: approval.approved ? "safety.approved" : "safety.denied",
    payload: JSON.stringify(approval),
  });

  return {
    decision,
    approval,
  };
};
