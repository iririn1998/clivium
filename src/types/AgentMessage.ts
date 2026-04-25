/**
 * @file Agent Adapter、Orchestrator、Store が共有する会話メッセージ型。
 * @module types/AgentMessage
 */

import type { AgentName } from "../config/agents.js";

export type AgentMessageRole = "user" | "agent" | "system";

export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
  createdAt: string;
  agent?: AgentName;
};

export type AgentOutputStream = "stdout" | "stderr";

export type AgentOutputChunkEvent = {
  type: "chunk";
  agent: AgentName;
  stream: AgentOutputStream;
  data: string;
  occurredAt: string;
};

export type AgentExitEvent = {
  type: "exit";
  agent: AgentName;
  exitCode: number | null;
  signal: string | null;
  occurredAt: string;
};

export type AgentErrorEvent = {
  type: "error";
  agent: AgentName;
  message: string;
  occurredAt: string;
};

export type AgentOutputEvent = AgentOutputChunkEvent | AgentExitEvent | AgentErrorEvent;

export type AgentMessageInput = {
  role: AgentMessageRole;
  content: string;
  agent?: AgentName;
  now?: Date;
};

const toIso = (d: Date): string => d.toISOString();

export const createAgentMessage = (input: AgentMessageInput): AgentMessage => {
  return {
    role: input.role,
    content: input.content,
    createdAt: toIso(input.now ?? new Date()),
    ...(input.agent === undefined ? {} : { agent: input.agent }),
  };
};

export const createAgentOutputChunkEvent = (
  agent: AgentName,
  stream: AgentOutputStream,
  data: string,
  now = new Date(),
): AgentOutputChunkEvent => ({
  type: "chunk",
  agent,
  stream,
  data,
  occurredAt: toIso(now),
});

export const createAgentExitEvent = (
  agent: AgentName,
  exitCode: number | null,
  signal: string | null,
  now = new Date(),
): AgentExitEvent => ({
  type: "exit",
  agent,
  exitCode,
  signal,
  occurredAt: toIso(now),
});

export const createAgentErrorEvent = (
  agent: AgentName,
  message: string,
  now = new Date(),
): AgentErrorEvent => ({
  type: "error",
  agent,
  message,
  occurredAt: toIso(now),
});
