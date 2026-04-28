/**
 * @file プロンプトをコマンドライン引数として渡す CLI Agent Adapter。
 * @module agents/PromptArgumentAgentAdapter
 */

import type { AgentConfig, AgentName } from "../config/agents.js";
import { createAgentMessage } from "../types/AgentMessage.js";
import type { AgentOutputEvent } from "../types/AgentMessage.js";
import type {
  AgentAdapter,
  AgentOutputListener,
  AgentReadOptions,
  AgentReadResult,
} from "./AgentAdapter.js";
import {
  PtyAgentProcess,
  type PtyAgentProcessOptions,
  type PtyReadOptions,
  type PtyReadResult,
} from "./PtyAgentProcess.js";

type AgentProcessLike = {
  start(): Promise<void>;
  read(options?: PtyReadOptions): Promise<PtyReadResult>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  onOutput(listener: (event: AgentOutputEvent) => void): () => void;
};

export type PromptArgumentAgentAdapterDeps = {
  createProcess?: (options: PtyAgentProcessOptions) => AgentProcessLike;
};

export type PromptArgumentBuilder = (args: string[], prompt: string) => string[];
export type PromptArgumentOutputNormalizer = (output: string) => string;

export const normalizePromptArgumentOutput = (s: string): string => s.replace(/\r\n/g, "\n").trim();

const defaultBuildArgs: PromptArgumentBuilder = (args, prompt) => [...args, prompt];

export class PromptArgumentAgentAdapter implements AgentAdapter {
  private readonly listeners = new Set<AgentOutputListener>();
  private process: AgentProcessLike | null = null;
  private processUnsubscribe: (() => void) | null = null;
  private started = false;

  constructor(
    readonly name: AgentName,
    readonly config: AgentConfig,
    private readonly deps: PromptArgumentAgentAdapterDeps = {},
    private readonly buildArgs: PromptArgumentBuilder = defaultBuildArgs,
    private readonly normalizeOutput: PromptArgumentOutputNormalizer = normalizePromptArgumentOutput,
  ) {}

  async start(): Promise<void> {
    this.started = true;
  }

  async send(input: string): Promise<void> {
    if (!this.started) {
      await this.start();
    }
    if (this.process !== null) {
      throw new Error(`${this.name} adapter already received input.`);
    }

    this.process = (this.deps.createProcess ?? defaultCreateProcess)({
      agent: this.name,
      command: this.config.command,
      args: this.buildArgs(this.config.args, input),
      cwd: this.config.cwd,
      timeoutMs: this.config.timeoutMs,
    });
    this.processUnsubscribe = this.process.onOutput((event) => {
      this.publish(event);
    });
    await this.process.start();
  }

  async read(options: AgentReadOptions = {}): Promise<AgentReadResult> {
    const result = await this.requireProcess().read({
      timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
      idleMs: options.idleMs,
      fromEventIndex: 0,
      killOnTimeout: true,
      waitForExit: true,
    });
    const output = this.normalizeOutput(result.output);
    if (result.exitCode !== null && result.exitCode !== 0) {
      throw new Error(formatExitError(this.name, result.exitCode, output));
    }

    return {
      output,
      events: result.events,
      completed: !result.timedOut,
      message: createAgentMessage({
        role: "agent",
        agent: this.name,
        content: output,
      }),
    };
  }

  async interrupt(): Promise<void> {
    await this.requireProcess().interrupt();
  }

  async stop(): Promise<void> {
    if (this.process === null) {
      return;
    }

    if (this.processUnsubscribe !== null) {
      this.processUnsubscribe();
      this.processUnsubscribe = null;
    }
    await this.process.stop();
    this.process = null;
  }

  onOutput(listener: AgentOutputListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private requireProcess(): AgentProcessLike {
    if (this.process === null) {
      throw new Error(`${this.name} adapter has not been sent input.`);
    }
    return this.process;
  }

  private publish(event: AgentOutputEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

const defaultCreateProcess = (options: PtyAgentProcessOptions): AgentProcessLike =>
  new PtyAgentProcess(options);

const formatExitError = (agent: AgentName, exitCode: number, output: string): string => {
  const firstLine = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const detail = firstLine === undefined ? "" : `: ${firstLine.slice(0, 200)}`;
  return `${agent} exited with code ${exitCode}${detail}`;
};
