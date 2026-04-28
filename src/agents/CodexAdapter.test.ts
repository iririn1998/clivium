/**
 * Codex Adapter の振る舞い: 設定された CLI を共通インターフェースで扱えること。
 */
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../config/agents.js";
import type { AgentOutputEvent } from "../types/AgentMessage.js";
import { createAgentOutputChunkEvent } from "../types/AgentMessage.js";
import { buildCodexPromptArgs, CodexAdapter, normalizeCodexOutput } from "./CodexAdapter.js";
import type { PtyAgentProcessOptions, PtyReadOptions, PtyReadResult } from "./PtyAgentProcess.js";

const config: AgentConfig = {
  command: "codex-bin",
  args: ["exec"],
  cwd: "/workspace",
  color: "#3B82F6",
  timeoutMs: 1234,
};

class FakeProcess {
  started = false;
  interrupted = false;
  stopped = false;
  readOptions: PtyReadOptions | undefined;
  listeners: ((event: AgentOutputEvent) => void)[] = [];
  readResult: PtyReadResult = {
    output:
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"codex answer"}}\n',
    events: [],
    exitCode: 0,
    signal: null,
    completed: true,
    timedOut: false,
  };

  async start(): Promise<void> {
    this.started = true;
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
  it("Codex の名前と設定で起動し、prompt 引数で応答を返す", async () => {
    const fake = new FakeProcess();
    let spawnOptions: PtyAgentProcessOptions | undefined;
    const adapter = new CodexAdapter(config, {
      createProcess: (options) => {
        spawnOptions = options;
        return fake;
      },
    });

    await adapter.start();
    expect(spawnOptions).toBeUndefined();
    await adapter.send("hello");
    const result = await adapter.read({ idleMs: 10 });

    expect(fake.started).toBe(true);
    expect(spawnOptions).toMatchObject({
      agent: "codex",
      command: "codex-bin",
      args: ["exec", "--json", "--", "hello"],
      cwd: "/workspace",
      timeoutMs: 1234,
    });
    expect(fake.readOptions).toMatchObject({
      timeoutMs: 1234,
      idleMs: 10,
      fromEventIndex: 0,
      killOnTimeout: true,
      waitForExit: true,
    });
    expect(result.completed).toBe(true);
    expect(result.output).toBe("codex answer");
    expect(result.message).toMatchObject({
      role: "agent",
      agent: "codex",
      content: "codex answer",
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
    await adapter.send("hello");
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
    await adapter.send("hello");
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

  it("JSON flag と prompt 区切りは重複させない", () => {
    expect(buildCodexPromptArgs(["exec", "--json", "--"], "-hello")).toEqual([
      "exec",
      "--json",
      "--",
      "-hello",
    ]);
  });

  it("JSONL 出力では最後の agent_message だけを本文として扱う", () => {
    expect(
      normalizeCodexOutput(
        [
          "Reading additional input from stdin...",
          '{"type":"thread.started","thread_id":"t"}',
          '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"first"}}',
          '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"final answer"}}',
          "2026-04-28T14:52:49Z ERROR codex_core::session: ignored",
        ].join("\n"),
      ),
    ).toBe("final answer");
  });
});
