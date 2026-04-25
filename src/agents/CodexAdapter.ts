/**
 * @file Codex CLI 用 Adapter。
 * @module agents/CodexAdapter
 */

import type { AgentConfig } from "../config/agents.js";
import { CliAgentAdapter, type CliAgentAdapterDeps } from "./CliAgentAdapter.js";

export class CodexAdapter extends CliAgentAdapter {
  constructor(config: AgentConfig, deps: CliAgentAdapterDeps = {}) {
    super("codex", config, deps);
  }
}
