/**
 * @file Clivium が保存・再表示するセッションの共有型。
 * @module types/Session
 */

import type { AgentName } from "../config/agents.js";
import type { AgentMessage } from "./AgentMessage.js";

export type SessionMode = "run" | "chat" | "debate";

export type Session = {
  id: string;
  mode: SessionMode;
  agents: AgentName[];
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  messages: AgentMessage[];
};

export type CreateSessionInput = {
  id: string;
  mode: SessionMode;
  agents: AgentName[];
  workspacePath: string;
  now?: Date;
};

export const createSession = (input: CreateSessionInput): Session => {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: input.id,
    mode: input.mode,
    agents: [...input.agents],
    workspacePath: input.workspacePath,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
};
