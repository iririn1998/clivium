/**
 * @file PTY プロセスを背後に持つ CLI Agent Adapter の共通実装。
 * @module agents/CliAgentAdapter
 */

import type { AgentConfig, AgentName } from "../config/agents.js";
import type {
  AgentAdapter,
  AgentOutputListener,
  AgentReadOptions,
  AgentReadResult,
} from "./AgentAdapter.js";
import { createAgentMessage } from "../types/AgentMessage.js";
import type { AgentOutputEvent } from "../types/AgentMessage.js";
import {
  PtyAgentProcess,
  type PtyAgentProcessOptions,
  type PtyReadOptions,
  type PtyReadResult,
} from "./PtyAgentProcess.js";

type AgentProcessLike = {
  readonly eventCount: number;
  start(): Promise<void>;
  send(input: string): Promise<void>;
  read(options?: PtyReadOptions): Promise<PtyReadResult>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  onOutput(listener: (event: AgentOutputEvent) => void): () => void;
};

export type CliAgentAdapterDeps = {
  createProcess?: (options: PtyAgentProcessOptions) => AgentProcessLike;
};

const normalizeAgentOutput = (s: string): string => s.replace(/\r\n/g, "\n").trim();

export class CliAgentAdapter implements AgentAdapter {
  private readonly listeners = new Set<AgentOutputListener>();
  private process: AgentProcessLike | null = null;
  private processUnsubscribe: (() => void) | null = null;
  private readFromEventIndex = 0;

  constructor(
    readonly name: AgentName,
    readonly config: AgentConfig,
    private readonly deps: CliAgentAdapterDeps = {},
  ) {}

  async start(): Promise<void> {
    if (this.process !== null) {
      return;
    }

    this.process = (this.deps.createProcess ?? defaultCreateProcess)({
      agent: this.name,
      command: this.config.command,
      args: this.config.args,
      cwd: this.config.cwd,
      timeoutMs: this.config.timeoutMs,
    });
    this.processUnsubscribe = this.process.onOutput((event) => {
      this.publish(event);
    });
    await this.process.start();
  }

  async send(input: string): Promise<void> {
    const process = this.requireProcess();
    this.readFromEventIndex = process.eventCount;
    await process.send(input.endsWith("\n") ? input : `${input}\n`);
  }

  async read(options: AgentReadOptions = {}): Promise<AgentReadResult> {
    const process = this.requireProcess();
    const result = await process.read({
      timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
      idleMs: options.idleMs,
      fromEventIndex: this.readFromEventIndex,
      killOnTimeout: true,
    });
    const output = normalizeAgentOutput(result.output);

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
      throw new Error(`${this.name} adapter has not been started.`);
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
