/**
 * Gemini Adapter の振る舞い: Codex と同じ Adapter 型で、Gemini 設定を起動できること。
 */
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../config/agents.js";
import { buildGeminiPromptArgs, GeminiAdapter, normalizeGeminiOutput } from "./GeminiAdapter.js";
import type { PtyAgentProcessOptions, PtyReadOptions, PtyReadResult } from "./PtyAgentProcess.js";

const config: AgentConfig = {
  command: "gemini-bin",
  args: ["--skip-trust"],
  cwd: null,
  color: "#F59E0B",
  timeoutMs: 4567,
};

class FakeProcess {
  readOptions: PtyReadOptions | undefined;

  async start(): Promise<void> {}

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
  it("Gemini の名前と設定で起動し、prompt 引数で応答を返す", async () => {
    const fake = new FakeProcess();
    let spawnOptions: PtyAgentProcessOptions | undefined;
    const adapter = new GeminiAdapter(config, {
      createProcess: (options) => {
        spawnOptions = options;
        return fake;
      },
    });

    await adapter.start();
    await adapter.send("hello");
    const result = await adapter.read({ idleMs: 20 });

    expect(spawnOptions).toMatchObject({
      agent: "gemini",
      command: "gemini-bin",
      args: ["--skip-trust", "--output-format", "json", "-p", "hello"],
      cwd: null,
      timeoutMs: 4567,
    });
    expect(fake.readOptions).toMatchObject({
      timeoutMs: 4567,
      idleMs: 20,
      fromEventIndex: 0,
      waitForExit: true,
    });
    expect(result.message).toMatchObject({
      role: "agent",
      agent: "gemini",
      content: "gemini answer",
    });
  });

  it("設定済みの prompt flag は重複させない", () => {
    expect(buildGeminiPromptArgs(["--skip-trust", "--prompt"], "hello")).toEqual([
      "--skip-trust",
      "--output-format",
      "json",
      "--prompt",
      "hello",
    ]);
  });

  it("設定済みの output format は重複させない", () => {
    expect(buildGeminiPromptArgs(["--output-format", "text"], "hello")).toEqual([
      "--output-format",
      "text",
      "-p",
      "hello",
    ]);
  });

  it("JSON 出力では response だけを本文として扱う", () => {
    expect(
      normalizeGeminiOutput(
        '[ERROR] [IDEClient] Failed to connect to IDE companion extension.\n{"response":"gemini answer","stats":{}}',
      ),
    ).toBe("gemini answer");
  });
});
