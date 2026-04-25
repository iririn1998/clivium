/**
 * @file 2エージェントを交互に応答させる debate モード。
 * @module orchestrator/modes/DebateMode
 */

import type { AgentConfig, AgentName } from "../../config/agents.js";
import { isAgentName } from "../../config/agents.js";
import type { CliviumConfig } from "../../config/defaults.js";
import { getCliviumConfig } from "../../config/load.js";
import type { AgentAdapter, AgentReadResult } from "../../agents/AgentAdapter.js";
import { CodexAdapter } from "../../agents/CodexAdapter.js";
import { GeminiAdapter } from "../../agents/GeminiAdapter.js";
import { SessionStore } from "../../store/SessionStore.js";
import type { AddStoredMessageInput, CreateStoredSessionInput } from "../../store/SessionStore.js";

type OutputWriter = {
  write(chunk: string): unknown;
};

export type DebateModeAdapterFactory = (name: AgentName, config: AgentConfig) => AgentAdapter;

export type DebateModeStore = {
  createSession(input: CreateStoredSessionInput): { id: string };
  addMessage(input: AddStoredMessageInput): unknown;
  close?(): void;
};

export type DebateModeOptions = {
  agents?: string;
  rounds?: string | number;
  theme: string;
  maxChars?: string | number;
  timeoutMs?: string | number;
  config?: CliviumConfig;
  stdout?: OutputWriter;
  createAdapter?: DebateModeAdapterFactory;
  store?: DebateModeStore;
};

export type DebateTurn = {
  round: number;
  agent: AgentName;
  result: AgentReadResult;
  content: string;
};

export type DebateModeResult = {
  sessionId: string;
  turns: DebateTurn[];
};

export class DebateModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebateModeError";
  }
}

export const DEFAULT_DEBATE_ROUNDS = 3;
export const DEFAULT_DEBATE_MAX_CHARS = 12_000;

const defaultCreateAdapter: DebateModeAdapterFactory = (name, config) => {
  switch (name) {
    case "codex":
      return new CodexAdapter(config);
    case "gemini":
      return new GeminiAdapter(config);
    case "copilot":
    case "cursor":
      throw new DebateModeError(
        `agent "${name}" は debate モードではまだ利用できません。対応: codex, gemini`,
      );
  }
};

export class DebateMode {
  async execute(options: DebateModeOptions): Promise<DebateModeResult> {
    const config = options.config ?? getCliviumConfig();
    const agentNames = resolveDebateAgents(options.agents, config);
    const rounds = resolvePositiveInt(options.rounds, "--rounds", DEFAULT_DEBATE_ROUNDS);
    const maxChars = resolvePositiveInt(options.maxChars, "--max-chars", DEFAULT_DEBATE_MAX_CHARS);
    const timeoutMs = resolveOptionalPositiveInt(options.timeoutMs, "--timeout-ms");
    const theme = limitContent(options.theme.trim(), maxChars);
    if (theme.length === 0) {
      throw new DebateModeError(
        'テーマを指定してください。例: clivium debate --agents codex,gemini --rounds 3 "theme"',
      );
    }

    const stdout = options.stdout ?? process.stdout;
    const createAdapter = options.createAdapter ?? defaultCreateAdapter;
    const store = options.store ?? new SessionStore();
    const shouldCloseStore = options.store === undefined;

    try {
      const session = store.createSession({
        mode: "debate",
        workspacePath: process.cwd(),
      });
      store.addMessage({
        sessionId: session.id,
        sender: "user",
        recipient: agentNames[0],
        content: theme,
      });

      const turns: DebateTurn[] = [];
      let nextInput = theme;

      for (let round = 1; round <= rounds; round += 1) {
        for (const agentName of agentNames) {
          const nextAgent = nextRecipient(agentNames, agentName, round, rounds);
          const turn = await runDebateTurn({
            agentName,
            nextAgent,
            round,
            prompt: nextInput,
            maxChars,
            timeoutMs,
            config,
            stdout,
            createAdapter,
            store,
            sessionId: session.id,
          });
          turns.push(turn);
          nextInput = turn.content;
        }
      }

      return {
        sessionId: session.id,
        turns,
      };
    } finally {
      if (shouldCloseStore) {
        store.close?.();
      }
    }
  }
}

type RunDebateTurnInput = {
  agentName: AgentName;
  nextAgent: AgentName | null;
  round: number;
  prompt: string;
  maxChars: number;
  timeoutMs: number | undefined;
  config: CliviumConfig;
  stdout: OutputWriter;
  createAdapter: DebateModeAdapterFactory;
  store: DebateModeStore;
  sessionId: string;
};

const runDebateTurn = async (input: RunDebateTurnInput): Promise<DebateTurn> => {
  let adapter: AgentAdapter | null = null;

  try {
    adapter = input.createAdapter(input.agentName, input.config.agents[input.agentName]);
    await adapter.start();
    await adapter.send(input.prompt);
    const result = await adapter.read({ timeoutMs: input.timeoutMs });
    const content = limitContent(result.message.content, input.maxChars);
    writeDebateOutput(input.stdout, input.round, input.agentName, content);
    input.store.addMessage({
      sessionId: input.sessionId,
      sender: input.agentName,
      recipient: input.nextAgent,
      content,
    });

    if (!result.completed) {
      throw new DebateModeError(`agent "${input.agentName}" の応答がタイムアウトしました。`);
    }

    return {
      round: input.round,
      agent: input.agentName,
      result,
      content,
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    input.store.addMessage({
      sessionId: input.sessionId,
      sender: "system",
      recipient: input.agentName,
      content: `agent "${input.agentName}" failed: ${error.message}`,
    });
    throw error;
  } finally {
    await adapter?.stop();
  }
};

export const resolveDebateAgents = (
  agents: string | undefined,
  config: CliviumConfig,
): [AgentName, AgentName] => {
  if (agents === undefined || agents.trim().length === 0) {
    throw new DebateModeError(
      'debate では --agents を指定してください。例: clivium debate --agents codex,gemini "theme"',
    );
  }

  const resolved: AgentName[] = [];
  for (const raw of agents.split(",")) {
    const name = raw.trim();
    if (name.length === 0) {
      continue;
    }
    if (!isAgentName(name) || !Object.hasOwn(config.agents, name)) {
      throw new DebateModeError(`対象 agent が設定にありません: ${name}`);
    }
    if (!resolved.includes(name)) {
      resolved.push(name);
    }
  }

  if (resolved.length !== 2) {
    throw new DebateModeError("debate では異なる2つの agent を --agents で指定してください。");
  }

  return [resolved[0]!, resolved[1]!];
};

const resolvePositiveInt = (
  raw: string | number | undefined,
  name: string,
  fallback: number,
): number => resolveOptionalPositiveInt(raw, name) ?? fallback;

const resolveOptionalPositiveInt = (
  raw: string | number | undefined,
  name: string,
): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }

  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new DebateModeError(`${name} には正の整数を指定してください。`);
  }
  return value;
};

export const limitContent = (content: string, maxChars: number): string => {
  if (content.length <= maxChars) {
    return content;
  }

  const suffix = "\n[clivium: truncated]";
  if (maxChars <= suffix.length) {
    return content.slice(0, maxChars);
  }
  return `${content.slice(0, maxChars - suffix.length)}${suffix}`;
};

const nextRecipient = (
  agents: readonly [AgentName, AgentName],
  agent: AgentName,
  round: number,
  maxRound: number,
): AgentName | null => {
  if (round === maxRound && agent === agents[1]) {
    return null;
  }
  return agent === agents[0] ? agents[1] : agents[0];
};

const writeDebateOutput = (
  stdout: OutputWriter,
  round: number,
  agentName: AgentName,
  output: string,
): void => {
  stdout.write(`[round ${round} ${agentName}]\n`);
  if (output.length > 0) {
    stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  }
  stdout.write("\n");
};
