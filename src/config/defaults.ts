/**
 * @file リポジトリ同梱のデフォルト設定。
 * @module config/defaults
 */

import { BUILTIN_AGENT_NAMES, type AgentConfig, type AgentName } from "./agents.js";

/**
 * Clivium 全体の設定。JSON ルートは主に `agents` を持つ。
 */
export type CliviumConfig = {
  agents: Record<AgentName, AgentConfig>;
};

const cloneConfig = (c: CliviumConfig): CliviumConfig =>
  JSON.parse(JSON.stringify(c)) as CliviumConfig;

const codexDefault = (): AgentConfig => ({
  command: "npx",
  args: ["-y", "@openai/codex", "exec"],
  cwd: null,
  color: "#3B82F6",
  timeoutMs: 600_000,
});

const geminiDefault = (): AgentConfig => ({
  command: "npx",
  args: ["-y", "@google/gemini-cli", "run"],
  cwd: null,
  color: "#F59E0B",
  timeoutMs: 600_000,
});

const copilotDefault = (): AgentConfig => ({
  command: "npx",
  args: ["-y", "@github/copilot", "chat"],
  cwd: null,
  color: "#A855F7",
  timeoutMs: 600_000,
});

const cursorDefault = (): AgentConfig => ({
  command: "npx",
  args: ["-y", "cursor", "open"],
  cwd: null,
  color: "#22C55E",
  timeoutMs: 600_000,
});

const defaultFactories: Record<AgentName, () => AgentConfig> = {
  codex: codexDefault,
  gemini: geminiDefault,
  copilot: copilotDefault,
  cursor: cursorDefault,
};

const createDefaultCliviumConfig = (): CliviumConfig => ({
  agents: {
    codex: codexDefault(),
    gemini: geminiDefault(),
    copilot: copilotDefault(),
    cursor: cursorDefault(),
  },
});

/**
 * 全ビルトインエージェントのデフォルト定義。設定ファイル未指定時のベース。
 */
export const getDefaultCliviumConfig = (): CliviumConfig =>
  cloneConfig(createDefaultCliviumConfig());

/**
 * デフォルトをベースに、検証済みの部分 `agents` だけ上書きする。
 */
export const mergeAgentsIntoConfig = (
  base: CliviumConfig,
  userAgents: Partial<Record<AgentName, Partial<AgentConfig> | undefined>> | undefined
): CliviumConfig => {
  if (!userAgents) {
    return cloneConfig(base);
  }
  const out = cloneConfig(base);
  for (const name of BUILTIN_AGENT_NAMES) {
    const p = userAgents[name];
    if (p === undefined) continue;
    out.agents[name] = mergeOneAgentConfig(out.agents[name]!, p);
  }
  return out;
};

const mergeOneAgentConfig = (base: AgentConfig, p: Partial<AgentConfig>): AgentConfig => {
  return {
    command: p.command !== undefined ? p.command : base.command,
    args: p.args !== undefined ? [...p.args] : [...base.args],
    cwd: p.cwd !== undefined ? p.cwd : base.cwd,
    color: p.color !== undefined ? p.color : base.color,
    timeoutMs: p.timeoutMs !== undefined ? p.timeoutMs : base.timeoutMs,
  };
};
