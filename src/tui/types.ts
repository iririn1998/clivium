/**
 * @file TUI 表示に使う軽量な型。
 * @module tui/types
 */

import type { AgentName } from "../config/agents.js";
import type { SessionMode } from "../types/Session.js";

export type TuiAgentStatus = "idle" | "running" | "error";

export type TuiAgentState = {
  name: AgentName;
  status: TuiAgentStatus;
  color: string;
  detail?: string;
};

export type TuiMessage = {
  id: string;
  sender: "user" | "system" | AgentName;
  content: string;
  createdAt?: string;
};

export type TuiMode = SessionMode | "tui";
