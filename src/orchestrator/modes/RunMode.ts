/**
 * @file 単体エージェントへ一回質問する run モード。
 * @module orchestrator/modes/RunMode
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

export type RunModeAdapterFactory = (name: AgentName, config: AgentConfig) => AgentAdapter;

export type RunModeStore = {
  createSession(input: CreateStoredSessionInput): { id: string };
  addMessage(input: AddStoredMessageInput): unknown;
  addAgentEvent?(input: AddStoredAgentEventInput): unknown;
  close?(): void;
};

export type RunModeOptions = {
  agent?: string;
  prompt: string;
  config?: CliviumConfig;
  stdout?: OutputWriter;
  createAdapter?: RunModeAdapterFactory;
  store?: RunModeStore;
  safetyPolicy?: SafetyPolicy;
  approvalGate?: ApprovalGate;
};

export class RunModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunModeError";
  }
}

const defaultCreateAdapter: RunModeAdapterFactory = (name, config) => {
  switch (name) {
    case "codex":
      return new CodexAdapter(config);
    case "gemini":
      return new GeminiAdapter(config);
    case "copilot":
    case "cursor":
      throw new RunModeError(
        `agent "${name}" は run モードではまだ利用できません。対応: codex, gemini`,
      );
  }
};

export class RunMode {
  async execute(options: RunModeOptions): Promise<AgentReadResult> {
    const config = options.config ?? getCliviumConfig();
    const agentName = resolveRunAgent(options.agent, config);
    const prompt = options.prompt.trim();
    if (prompt.length === 0) {
      throw new RunModeError('質問を指定してください。例: clivium run --agent codex "hello"');
    }

    const adapter = (options.createAdapter ?? defaultCreateAdapter)(
      agentName,
      config.agents[agentName],
    );
    const store = options.store ?? new SessionStore();
    const shouldCloseStore = options.store === undefined;

    try {
      const session = store.createSession({
        mode: "run",
        workspacePath: process.cwd(),
      });
      store.addMessage({
        sessionId: session.id,
        sender: "user",
        recipient: agentName,
        content: prompt,
      });

      await adapter.start();
      await adapter.send(prompt);
      const result = await adapter.read();
      writeRunOutput(options.stdout ?? process.stdout, result.output);
      store.addMessage({
        sessionId: session.id,
        sender: agentName,
        content: result.message.content,
      });
      await enforceSafetyApproval({
        sessionId: session.id,
        agentName,
        content: result.message.content,
        store,
        safetyPolicy: options.safetyPolicy,
        approvalGate: options.approvalGate,
      });
      if (!result.completed) {
        throw new RunModeError(`agent "${agentName}" の応答がタイムアウトしました。`);
      }
      return result;
    } finally {
      await adapter.stop();
      if (shouldCloseStore) {
        store.close?.();
      }
    }
  }
}

const resolveRunAgent = (agent: string | undefined, config: CliviumConfig): AgentName => {
  if (agent === undefined || agent.trim().length === 0) {
    throw new RunModeError(
      'run では --agent を指定してください。例: clivium run --agent codex "hello"',
    );
  }

  if (!isAgentName(agent) || !Object.hasOwn(config.agents, agent)) {
    throw new RunModeError(`対象 agent が設定にありません: ${agent}`);
  }

  return agent;
};

const writeRunOutput = (stdout: OutputWriter, output: string): void => {
  if (output.length === 0) {
    return;
  }
  stdout.write(output.endsWith("\n") ? output : `${output}\n`);
};

type EnforceSafetyApprovalInput = {
  sessionId: string;
  agentName: AgentName;
  content: string;
  store: RunModeStore;
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
    throw new RunModeError(`agent "${input.agentName}" の出力は承認されませんでした。`);
  }
};
