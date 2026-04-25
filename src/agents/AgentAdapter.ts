/**
 * @file 各 AI CLI を同じ形で扱うための最小 Adapter インターフェース。
 * @module agents/AgentAdapter
 */

import type { AgentConfig, AgentName } from "../config/agents.js";
import type { AgentMessage, AgentOutputEvent } from "../types/AgentMessage.js";

export type { AgentName };

export type AgentOutputListener = (event: AgentOutputEvent) => void;

export type AgentReadOptions = {
  timeoutMs?: number;
  idleMs?: number;
};

export type AgentReadResult = {
  message: AgentMessage;
  output: string;
  events: AgentOutputEvent[];
  completed: boolean;
};

export interface AgentAdapter {
  readonly name: AgentName;
  readonly config: AgentConfig;

  start(): Promise<void>;
  send(input: string): Promise<void>;
  read(options?: AgentReadOptions): Promise<AgentReadResult>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  onOutput(listener: AgentOutputListener): () => void;
}
