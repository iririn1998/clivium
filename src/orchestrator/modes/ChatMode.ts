/**
 * @file 複数エージェントへ同じ入力を渡して回答を並べる chat モード。
 * @module orchestrator/modes/ChatMode
 */

import type { AgentConfig, AgentName } from "../../config/agents.js";
import { isAgentName } from "../../config/agents.js";
import type { CliviumConfig } from "../../config/defaults.js";
import { getCliviumConfig } from "../../config/load.js";
import type { AgentAdapter, AgentReadResult } from "../../agents/AgentAdapter.js";
import { CodexAdapter } from "../../agents/CodexAdapter.js";
import { GeminiAdapter } from "../../agents/GeminiAdapter.js";
import { SessionStore } from "../../store/SessionStore.js";
import type {
  AddStoredAgentEventInput,
  AddStoredMessageInput,
  CreateStoredSessionInput,
} from "../../store/SessionStore.js";
import type { ApprovalGate } from "../../safety/ApprovalGate.js";
import { reviewSafety } from "../../safety/SafetyHooks.js";
import type { SafetyPolicy } from "../../safety/SafetyPolicy.js";

type OutputWriter = {
  write(chunk: string): unknown;
};

export type ChatModeAdapterFactory = (name: AgentName, config: AgentConfig) => AgentAdapter;

export type ChatModeStore = {
  createSession(input: CreateStoredSessionInput): { id: string };
  addMessage(input: AddStoredMessageInput): unknown;
  addAgentEvent?(input: AddStoredAgentEventInput): unknown;
  close?(): void;
};

export type ChatModeOptions = {
  agents?: string;
  prompt: string;
  config?: CliviumConfig;
  stdout?: OutputWriter;
  createAdapter?: ChatModeAdapterFactory;
  store?: ChatModeStore;
  safetyPolicy?: SafetyPolicy;
  approvalGate?: ApprovalGate;
};

export type ChatAgentResponse = {
  agent: AgentName;
  result: AgentReadResult;
};

export type ChatAgentFailure = {
  agent: AgentName;
  error: Error;
};

export type ChatModeResult = {
  sessionId: string;
  responses: ChatAgentResponse[];
  failures: ChatAgentFailure[];
};

export class ChatModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatModeError";
  }
}

const defaultCreateAdapter: ChatModeAdapterFactory = (name, config) => {
  switch (name) {
    case "codex":
      return new CodexAdapter(config);
    case "gemini":
      return new GeminiAdapter(config);
    case "copilot":
    case "cursor":
      throw new ChatModeError(
        `agent "${name}" は chat モードではまだ利用できません。対応: codex, gemini`,
      );
  }
};

export class ChatMode {
  async execute(options: ChatModeOptions): Promise<ChatModeResult> {
    const config = options.config ?? getCliviumConfig();
    const agentNames = resolveChatAgents(options.agents, config);
    const prompt = options.prompt.trim();
    if (prompt.length === 0) {
      throw new ChatModeError(
        '質問を指定してください。例: clivium chat --agents codex,gemini "hello"',
      );
    }

    const stdout = options.stdout ?? process.stdout;
    const createAdapter = options.createAdapter ?? defaultCreateAdapter;
    const store = options.store ?? new SessionStore();
    const shouldCloseStore = options.store === undefined;

    try {
      const session = store.createSession({
        mode: "chat",
        workspacePath: process.cwd(),
      });
      const responses: ChatAgentResponse[] = [];
      const failures: ChatAgentFailure[] = [];

      for (const agentName of agentNames) {
        store.addMessage({
          sessionId: session.id,
          sender: "user",
          recipient: agentName,
          content: prompt,
        });

        const outcome = await runOneAgent({
          agentName,
          config,
          prompt,
          stdout,
          createAdapter,
          store,
          sessionId: session.id,
          safetyPolicy: options.safetyPolicy,
          approvalGate: options.approvalGate,
        });
        if ("response" in outcome) {
          responses.push(outcome.response);
        } else {
          failures.push(outcome.failure);
        }
      }

      if (responses.length === 0 && failures.length > 0) {
        throw new ChatModeError("すべての agent が失敗しました。");
      }

      return {
        sessionId: session.id,
        responses,
        failures,
      };
    } finally {
      if (shouldCloseStore) {
        store.close?.();
      }
    }
  }
}

type RunOneAgentInput = {
  agentName: AgentName;
  config: CliviumConfig;
  prompt: string;
  stdout: OutputWriter;
  createAdapter: ChatModeAdapterFactory;
  store: ChatModeStore;
  sessionId: string;
  safetyPolicy: SafetyPolicy | undefined;
  approvalGate: ApprovalGate | undefined;
};

type RunOneAgentOutcome = { response: ChatAgentResponse } | { failure: ChatAgentFailure };

const runOneAgent = async (input: RunOneAgentInput): Promise<RunOneAgentOutcome> => {
  let adapter: AgentAdapter | null = null;

  try {
    adapter = input.createAdapter(input.agentName, input.config.agents[input.agentName]);
    await adapter.start();
    await adapter.send(input.prompt);
    const result = await adapter.read();
    writeAgentOutput(input.stdout, input.agentName, result.output);
    input.store.addMessage({
      sessionId: input.sessionId,
      sender: input.agentName,
      content: result.message.content,
    });
    await enforceSafetyApproval({
      sessionId: input.sessionId,
      agentName: input.agentName,
      content: result.message.content,
      store: input.store,
      safetyPolicy: input.safetyPolicy,
      approvalGate: input.approvalGate,
    });

    if (!result.completed) {
      throw new ChatModeError(`agent "${input.agentName}" の応答がタイムアウトしました。`);
    }

    return {
      response: {
        agent: input.agentName,
        result,
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    writeAgentError(input.stdout, input.agentName, error);
    input.store.addMessage({
      sessionId: input.sessionId,
      sender: "system",
      recipient: input.agentName,
      content: `agent "${input.agentName}" failed: ${error.message}`,
    });
    return {
      failure: {
        agent: input.agentName,
        error,
      },
    };
  } finally {
    await adapter?.stop();
  }
};

export const resolveChatAgents = (
  agents: string | undefined,
  config: CliviumConfig,
): AgentName[] => {
  if (agents === undefined || agents.trim().length === 0) {
    throw new ChatModeError(
      'chat では --agents を指定してください。例: clivium chat --agents codex,gemini "hello"',
    );
  }

  const seen = new Set<AgentName>();
  const resolved: AgentName[] = [];
  for (const raw of agents.split(",")) {
    const name = raw.trim();
    if (name.length === 0) {
      continue;
    }
    if (!isAgentName(name) || !Object.hasOwn(config.agents, name)) {
      throw new ChatModeError(`対象 agent が設定にありません: ${name}`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      resolved.push(name);
    }
  }

  if (resolved.length === 0) {
    throw new ChatModeError("chat で利用する agent が空です。");
  }

  return resolved;
};

const writeAgentOutput = (stdout: OutputWriter, agentName: AgentName, output: string): void => {
  stdout.write(`[${agentName}]\n`);
  if (output.length > 0) {
    stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  }
  stdout.write("\n");
};

const writeAgentError = (stdout: OutputWriter, agentName: AgentName, error: Error): void => {
  stdout.write(`[${agentName}] ERROR: ${error.message}\n\n`);
};

type EnforceSafetyApprovalInput = {
  sessionId: string;
  agentName: AgentName;
  content: string;
  store: ChatModeStore;
  safetyPolicy: SafetyPolicy | undefined;
  approvalGate: ApprovalGate | undefined;
};

const enforceSafetyApproval = async (input: EnforceSafetyApprovalInput): Promise<void> => {
  const review = await reviewSafety({
    sessionId: input.sessionId,
    agent: input.agentName,
    content: input.content,
    store: input.store,
    policy: input.safetyPolicy,
    approvalGate: input.approvalGate,
  });

  if (review.approval !== null && !review.approval.approved) {
    throw new ChatModeError(`agent "${input.agentName}" の出力は承認されませんでした。`);
  }
};
