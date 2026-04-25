/**
 * Codex Adapter の振る舞い: 設定された CLI を共通インターフェースで扱えること。
 */
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../config/agents.js";
import type { AgentOutputEvent } from "../types/AgentMessage.js";
import { createAgentOutputChunkEvent } from "../types/AgentMessage.js";
import { CodexAdapter } from "./CodexAdapter.js";
import type { PtyAgentProcessOptions, PtyReadOptions, PtyReadResult } from "./PtyAgentProcess.js";

const config: AgentConfig = {
  command: "codex-bin",
  args: ["exec"],
  cwd: "/workspace",
  color: "#3B82F6",
  timeoutMs: 1234,
};

class FakeProcess {
  eventCount = 0;
  started = false;
  sent: string[] = [];
  interrupted = false;
  stopped = false;
  readOptions: PtyReadOptions | undefined;
  listeners: ((event: AgentOutputEvent) => void)[] = [];
  readResult: PtyReadResult = {
    output: " answer\r\n",
    events: [],
    exitCode: 0,
    signal: null,
    completed: true,
    timedOut: false,
  };

  async start(): Promise<void> {
    this.started = true;
  }

  async send(input: string): Promise<void> {
    this.sent.push(input);
  }

  async read(options?: PtyReadOptions): Promise<PtyReadResult> {
    this.readOptions = options;
    return this.readResult;
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  onOutput(listener: (event: AgentOutputEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  emit(event: AgentOutputEvent): void {
    this.eventCount += 1;
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe("CodexAdapter（振る舞い）", () => {
  it("config のコマンド・引数・cwd・timeout を使って起動する", async () => {
    const fake = new FakeProcess();
    let spawnOptions: PtyAgentProcessOptions | undefined;
    const adapter = new CodexAdapter(config, {
      createProcess: (options) => {
        spawnOptions = options;
        return fake;
      },
    });

    await adapter.start();

    expect(fake.started).toBe(true);
    expect(spawnOptions).toMatchObject({
      agent: "codex",
      command: "codex-bin",
      args: ["exec"],
      cwd: "/workspace",
      timeoutMs: 1234,
    });
  });

  it("send は一回質問として改行付きで CLI へ渡し、read は応答メッセージに変換する", async () => {
    const fake = new FakeProcess();
    fake.eventCount = 7;
    const adapter = new CodexAdapter(config, {
      createProcess: () => fake,
    });

    await adapter.start();
    await adapter.send("hello");
    const result = await adapter.read({ idleMs: 10 });

    expect(fake.sent).toEqual(["hello\n"]);
    expect(fake.readOptions).toMatchObject({
      timeoutMs: 1234,
      idleMs: 10,
      fromEventIndex: 7,
      killOnTimeout: true,
    });
    expect(result.completed).toBe(true);
    expect(result.output).toBe("answer");
    expect(result.message).toMatchObject({
      role: "agent",
      agent: "codex",
      content: "answer",
    });
  });

  it("timeout した応答は、完了扱いにしない", async () => {
    const fake = new FakeProcess();
    fake.readResult = {
      output: "partial",
      events: [],
      exitCode: null,
      signal: null,
      completed: false,
      timedOut: true,
    };
    const adapter = new CodexAdapter(config, {
      createProcess: () => fake,
    });

    await adapter.start();
    const result = await adapter.read();

    expect(result.completed).toBe(false);
    expect(result.message.content).toBe("partial");
  });

  it("出力イベントを購読でき、interrupt と stop を背後のプロセスへ伝える", async () => {
    const fake = new FakeProcess();
    const seen: AgentOutputEvent[] = [];
    const adapter = new CodexAdapter(config, {
      createProcess: () => fake,
    });
    adapter.onOutput((event) => {
      seen.push(event);
    });

    await adapter.start();
    fake.emit(createAgentOutputChunkEvent("codex", "stdout", "hello"));
    await adapter.interrupt();
    await adapter.stop();
    fake.emit(createAgentOutputChunkEvent("codex", "stdout", "after-stop"));

    expect(seen.map((event) => (event.type === "chunk" ? event.data : event.type))).toEqual([
      "hello",
    ]);
    expect(fake.interrupted).toBe(true);
    expect(fake.stopped).toBe(true);
  });
});
