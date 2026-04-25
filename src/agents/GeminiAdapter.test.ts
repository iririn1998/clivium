/**
 * Gemini Adapter の振る舞い: Codex と同じ Adapter 型で、Gemini 設定を起動できること。
 */
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../config/agents.js";
import { GeminiAdapter } from "./GeminiAdapter.js";
import type { PtyAgentProcessOptions, PtyReadOptions, PtyReadResult } from "./PtyAgentProcess.js";

const config: AgentConfig = {
  command: "gemini-bin",
  args: ["run"],
  cwd: null,
  color: "#F59E0B",
  timeoutMs: 4567,
};

class FakeProcess {
  eventCount = 3;
  sent: string[] = [];
  readOptions: PtyReadOptions | undefined;

  async start(): Promise<void> {}

  async send(input: string): Promise<void> {
    this.sent.push(input);
  }

  async read(options?: PtyReadOptions): Promise<PtyReadResult> {
    this.readOptions = options;
    return {
      output: "gemini answer",
      events: [],
      exitCode: 0,
      signal: null,
      completed: true,
      timedOut: false,
    };
  }

  async interrupt(): Promise<void> {}

  async stop(): Promise<void> {}

  onOutput(): () => void {
    return () => {};
  }
}

describe("GeminiAdapter（振る舞い）", () => {
  it("Gemini の名前と設定で起動し、同じ send/read 契約で応答を返す", async () => {
    const fake = new FakeProcess();
    let spawnOptions: PtyAgentProcessOptions | undefined;
    const adapter = new GeminiAdapter(config, {
      createProcess: (options) => {
        spawnOptions = options;
        return fake;
      },
    });

    await adapter.start();
    await adapter.send("hello\n");
    const result = await adapter.read({ idleMs: 20 });

    expect(spawnOptions).toMatchObject({
      agent: "gemini",
      command: "gemini-bin",
      args: ["run"],
      cwd: null,
      timeoutMs: 4567,
    });
    expect(fake.sent).toEqual(["hello\n"]);
    expect(fake.readOptions).toMatchObject({
      timeoutMs: 4567,
      idleMs: 20,
      fromEventIndex: 3,
    });
    expect(result.message).toMatchObject({
      role: "agent",
      agent: "gemini",
      content: "gemini answer",
    });
  });
});
