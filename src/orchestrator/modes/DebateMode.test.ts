/**
 * debate モードの振る舞い: 2agentの交互応答、ラウンド制御、保存を確認する。
 */
import { describe, expect, it } from "vitest";
import type {
  AgentAdapter,
  AgentOutputListener,
  AgentReadResult,
} from "../../agents/AgentAdapter.js";
import type { AgentConfig, AgentName } from "../../config/agents.js";
import { getDefaultCliviumConfig } from "../../config/defaults.js";
import {
  DebateMode,
  DebateModeError,
  limitContent,
  resolveDebateAgents,
  type DebateModeStore,
} from "./DebateMode.js";

class FakeAdapter implements AgentAdapter {
  readonly config: AgentConfig;
  started = false;
  stopped = false;
  sent: string[] = [];
  completed = true;
  result: AgentReadResult;

  constructor(
    readonly name: AgentName,
    private readonly answer: (input: string) => string,
  ) {
    this.config = getDefaultCliviumConfig().agents[name];
    this.result = this.toResult("");
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async send(input: string): Promise<void> {
    this.sent.push(input);
    this.result = this.toResult(this.answer(input));
    this.result.completed = this.completed;
  }

  async read(): Promise<AgentReadResult> {
    return this.result;
  }

  async interrupt(): Promise<void> {}

  async stop(): Promise<void> {
    this.stopped = true;
  }

  onOutput(_listener: AgentOutputListener): () => void {
    return () => {};
  }

  private toResult(output: string): AgentReadResult {
    return {
      output,
      events: [],
      completed: true,
      message: {
        role: "agent",
        agent: this.name,
        content: output,
        createdAt: "2026-04-25T00:00:00.000Z",
      },
    };
  }
}

class FakeStore implements DebateModeStore {
  sessions: { id: string; mode: string; workspacePath: string }[] = [];
  messages: { sessionId: string; sender: string; recipient?: string | null; content: string }[] =
    [];
  closed = false;

  createSession(input: Parameters<DebateModeStore["createSession"]>[0]): { id: string } {
    const session = { id: `session-${this.sessions.length + 1}`, ...input };
    this.sessions.push(session);
    return session;
  }

  addMessage(input: Parameters<DebateModeStore["addMessage"]>[0]): void {
    this.messages.push(input);
  }

  close(): void {
    this.closed = true;
  }
}

describe("DebateMode", () => {
  it("agent一覧は異なる2件だけ受け付ける", () => {
    expect(resolveDebateAgents(" codex, gemini,codex ", getDefaultCliviumConfig())).toEqual([
      "codex",
      "gemini",
    ]);
    expect(() => resolveDebateAgents(undefined, getDefaultCliviumConfig())).toThrow(/--agents/);
    expect(() => resolveDebateAgents("codex", getDefaultCliviumConfig())).toThrow(/2つ/);
    expect(() => resolveDebateAgents("unknown,gemini", getDefaultCliviumConfig())).toThrow(
      /設定にありません/,
    );
  });

  it("指定ラウンド数だけ2agentへ交互に送り、直前出力を次の入力にする", async () => {
    const created: FakeAdapter[] = [];
    const store = new FakeStore();
    const out: string[] = [];

    const result = await new DebateMode().execute({
      agents: "codex,gemini",
      rounds: 2,
      theme: "theme",
      config: getDefaultCliviumConfig(),
      store,
      stdout: {
        write: (chunk) => out.push(chunk),
      },
      createAdapter: (name) => {
        const adapter = new FakeAdapter(name, (input) => `${name}<${input}>`);
        created.push(adapter);
        return adapter;
      },
    });

    expect(result.turns.map((turn) => `${turn.round}:${turn.agent}`)).toEqual([
      "1:codex",
      "1:gemini",
      "2:codex",
      "2:gemini",
    ]);
    expect(created.map((adapter) => adapter.sent[0])).toEqual([
      "theme",
      "codex<theme>",
      "gemini<codex<theme>>",
      "codex<gemini<codex<theme>>>",
    ]);
    expect(created.every((adapter) => adapter.stopped)).toBe(true);
    expect(out.join("")).toContain("[round 1 codex]\ncodex<theme>");
    expect(store.sessions).toMatchObject([{ id: "session-1", mode: "debate" }]);
    expect(store.messages).toEqual([
      { sessionId: "session-1", sender: "user", recipient: "codex", content: "theme" },
      { sessionId: "session-1", sender: "codex", recipient: "gemini", content: "codex<theme>" },
      {
        sessionId: "session-1",
        sender: "gemini",
        recipient: "codex",
        content: "gemini<codex<theme>>",
      },
      {
        sessionId: "session-1",
        sender: "codex",
        recipient: "gemini",
        content: "codex<gemini<codex<theme>>>",
      },
      {
        sessionId: "session-1",
        sender: "gemini",
        recipient: null,
        content: "gemini<codex<gemini<codex<theme>>>>",
      },
    ]);
  });

  it("最大文字数を超える内容は次agentへ渡す前に切り詰める", async () => {
    const created: FakeAdapter[] = [];
    await new DebateMode().execute({
      agents: "codex,gemini",
      rounds: 1,
      theme: "1234567890",
      maxChars: 5,
      config: getDefaultCliviumConfig(),
      store: new FakeStore(),
      stdout: {
        write: () => {},
      },
      createAdapter: (name) => {
        const adapter = new FakeAdapter(name, (input) => `${name}:${input}:too-long`);
        created.push(adapter);
        return adapter;
      },
    });

    expect(created[0]!.sent).toEqual(["12345"]);
    expect(created[1]!.sent[0]!.length).toBeLessThanOrEqual(5);
  });

  it("timeout 扱いの応答は保存してから失敗にする", async () => {
    const store = new FakeStore();
    const adapter = new FakeAdapter("codex", () => "partial");
    adapter.completed = false;

    await expect(
      new DebateMode().execute({
        agents: "codex,gemini",
        rounds: 1,
        theme: "theme",
        config: getDefaultCliviumConfig(),
        store,
        stdout: {
          write: () => {},
        },
        createAdapter: () => adapter,
      }),
    ).rejects.toThrow(DebateModeError);
    expect(store.messages.at(-2)).toMatchObject({
      sender: "codex",
      content: "partial",
    });
    expect(store.messages.at(-1)).toMatchObject({
      sender: "system",
      recipient: "codex",
    });
    expect(adapter.stopped).toBe(true);
  });

  it("切り詰め後の文字数は指定値を超えない", () => {
    expect(limitContent("abcdef", 4)).toBe("abcd");
  });
});
