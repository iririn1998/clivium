/**
 * @file node-pty を使った外部 CLI プロセス制御。
 * @module agents/PtyAgentProcess
 */

import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { AgentName } from "../config/agents.js";
import type { AgentOutputEvent } from "../types/AgentMessage.js";
import {
  createAgentErrorEvent,
  createAgentExitEvent,
  createAgentOutputChunkEvent,
} from "../types/AgentMessage.js";

export type PtyAgentProcessOptions = {
  agent: AgentName;
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cols?: number;
  rows?: number;
  stripAnsi?: boolean;
};

export type PtyReadOptions = {
  timeoutMs?: number;
  idleMs?: number;
  fromEventIndex?: number;
  killOnTimeout?: boolean;
};

export type PtyReadResult = {
  output: string;
  events: AgentOutputEvent[];
  exitCode: number | null;
  signal: string | null;
  completed: boolean;
  timedOut: boolean;
};

type ExitInfo = {
  exitCode: number | null;
  signal: string | null;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_MS = 250;

const ESC = "\\x1B";
const BEL = "\\x07";
const ANSI_SEQUENCE = new RegExp(
  `${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\))`,
  "g",
);
const require = createRequire(import.meta.url);

export const stripAnsiSequences = (s: string): string => s.replace(ANSI_SEQUENCE, "");

const ensureSpawnHelperExecutable = (): void => {
  if (process.platform === "win32") {
    return;
  }

  try {
    const nodePtyMain = require.resolve("node-pty");
    const packageRoot = resolve(dirname(nodePtyMain), "..");
    const helper = resolve(
      packageRoot,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    );
    const st = statSync(helper);
    if ((st.mode & 0o111) === 0) {
      chmodSync(helper, st.mode | 0o755);
    }
  } catch {
    // node-pty 自身が spawn 時に詳細なエラーを返すため、ここでは補正失敗を握りつぶす。
  }
};

/**
 * PTY は stdout/stderr を分離せず 1 本の疑似端末出力として返す。
 * Clivium ではこの合流済み出力を stdout chunk として扱う。
 */
export class PtyAgentProcess {
  private proc: IPty | null = null;
  private readonly listeners = new Set<(event: AgentOutputEvent) => void>();
  private readonly eventLog: AgentOutputEvent[] = [];
  private readonly outputChunks: string[] = [];
  private exitInfo: ExitInfo | null = null;

  constructor(private readonly options: PtyAgentProcessOptions) {}

  get eventCount(): number {
    return this.eventLog.length;
  }

  get output(): string {
    return this.outputChunks.join("");
  }

  get exited(): boolean {
    return this.exitInfo !== null;
  }

  onOutput(listener: (event: AgentOutputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.proc !== null) {
      return;
    }

    try {
      ensureSpawnHelperExecutable();
      this.proc = pty.spawn(this.options.command, this.options.args ?? [], {
        name: "xterm-256color",
        cols: this.options.cols ?? 120,
        rows: this.options.rows ?? 30,
        cwd: this.options.cwd ?? process.cwd(),
        env: { ...process.env, ...this.options.env },
        encoding: "utf8",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.publish(createAgentErrorEvent(this.options.agent, message));
      throw e;
    }

    this.proc.onData((data) => {
      const text = this.options.stripAnsi === false ? data : stripAnsiSequences(data);
      if (text.length === 0) {
        return;
      }
      this.outputChunks.push(text);
      this.publish(createAgentOutputChunkEvent(this.options.agent, "stdout", text));
    });

    this.proc.onExit(({ exitCode, signal }) => {
      const signalText = signal === undefined || signal === 0 ? null : String(signal);
      this.exitInfo = { exitCode, signal: signalText };
      this.publish(createAgentExitEvent(this.options.agent, exitCode, signalText));
    });
  }

  async send(input: string): Promise<void> {
    this.requireRunning();
    this.proc!.write(input);
  }

  async interrupt(): Promise<void> {
    await this.send("\x03");
  }

  async stop(signal = "SIGHUP"): Promise<void> {
    if (this.proc === null || this.exitInfo !== null) {
      return;
    }

    try {
      this.proc.kill(signal);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.publish(createAgentErrorEvent(this.options.agent, message));
      try {
        this.proc.kill();
      } catch {
        // 既に終了している場合は cleanup 済みとして扱う。
      }
    }

    await this.waitForExit(500);
  }

  async read(options: PtyReadOptions = {}): Promise<PtyReadResult> {
    this.requireStarted();

    const fromEventIndex = options.fromEventIndex ?? 0;
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;

    if (this.exitInfo !== null) {
      return this.resultFrom(fromEventIndex, false);
    }

    return await new Promise<PtyReadResult>((resolve) => {
      let finished = false;
      let idleTimer: NodeJS.Timeout | undefined;

      const finish = async (timedOut: boolean): Promise<void> => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeoutTimer);
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
        }
        off();
        if (timedOut && options.killOnTimeout) {
          await this.stop();
        }
        resolve(this.resultFrom(fromEventIndex, timedOut));
      };

      const scheduleIdle = (): void => {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
          void finish(false);
        }, idleMs);
      };

      const timeoutTimer = setTimeout(() => {
        void finish(true);
      }, timeoutMs);

      const off = this.onOutput((event) => {
        if (event.type === "exit") {
          void finish(false);
          return;
        }
        scheduleIdle();
      });

      if (this.eventLog.length > fromEventIndex) {
        scheduleIdle();
      }
    });
  }

  private async waitForExit(timeoutMs: number): Promise<void> {
    if (this.exitInfo !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const off = this.onOutput((event) => {
        if (event.type !== "exit") {
          return;
        }
        clearTimeout(timer);
        off();
        resolve();
      });
    });
  }

  private requireStarted(): void {
    if (this.proc === null) {
      throw new Error("PTY process has not been started.");
    }
  }

  private requireRunning(): void {
    this.requireStarted();
    if (this.exitInfo !== null) {
      throw new Error("PTY process has already exited.");
    }
  }

  private publish(event: AgentOutputEvent): void {
    this.eventLog.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private resultFrom(fromEventIndex: number, timedOut: boolean): PtyReadResult {
    const events = this.eventLog.slice(fromEventIndex);
    const output = events
      .filter((event) => event.type === "chunk")
      .map((event) => event.data)
      .join("");
    return {
      output,
      events,
      exitCode: this.exitInfo?.exitCode ?? null,
      signal: this.exitInfo?.signal ?? null,
      completed: this.exitInfo !== null,
      timedOut,
    };
  }
}
