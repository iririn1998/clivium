/**
 * @file Gemini CLI 用 Adapter。
 * @module agents/GeminiAdapter
 */

import type { AgentConfig } from "../config/agents.js";
import { CliAgentAdapter, type CliAgentAdapterDeps } from "./CliAgentAdapter.js";

export class GeminiAdapter extends CliAgentAdapter {
  constructor(config: AgentConfig, deps: CliAgentAdapterDeps = {}) {
    super("gemini", config, deps);
  }
}
