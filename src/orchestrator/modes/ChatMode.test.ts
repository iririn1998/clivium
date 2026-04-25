/**
 * chat モードの振る舞い: 複数agentへの同一入力、表示、保存、部分失敗を確認する。
 */
import { describe, expect, it } from "vitest";
import type {
  AgentAdapter,
  AgentOutputListener,
  AgentReadResult,
} from "../../agents/AgentAdapter.js";
import type { AgentConfig, AgentName } from "../../config/agents.js";
import { getDefaultCliviumConfig } from "../../config/defaults.js";
import { ChatMode, ChatModeError, resolveChatAgents, type ChatModeStore } from "./ChatMode.js";

class FakeAdapter implements AgentAdapter {
  readonly config: AgentConfig;
  started = false;
  stopped = false;
  sent: string[] = [];
  readError: Error | undefined;
  result: AgentReadResult;

  constructor(
    readonly name: AgentName,
    output: string,
  ) {
    this.config = getDefaultCliviumConfig().agents[name];
    this.result = {
      output,
      events: [],
      completed: true,
      message: {
        role: "agent",
        agent: name,
        content: output,
        createdAt: "2026-04-25T00:00:00.000Z",
      },
    };
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async send(input: string): Promise<void> {
    this.sent.push(input);
  }

  async read(): Promise<AgentReadResult> {
    if (this.readError !== undefined) {
      throw this.readError;
    }
    return this.result;
  }

  async interrupt(): Promise<void> {}

  async stop(): Promise<void> {
    this.stopped = true;
  }

  onOutput(_listener: AgentOutputListener): () => void {
    return () => {};
  }
}

class FakeStore implements ChatModeStore {
  sessions: { id: string; mode: string; workspacePath: string }[] = [];
  messages: { sessionId: string; sender: string; recipient?: string | null; content: string }[] =
    [];
  closed = false;

  createSession(input: Parameters<ChatModeStore["createSession"]>[0]): { id: string } {
    const session = { id: `session-${this.sessions.length + 1}`, ...input };
    this.sessions.push(session);
    return session;
  }

  addMessage(input: Parameters<ChatModeStore["addMessage"]>[0]): void {
    this.messages.push(input);
  }

  close(): void {
    this.closed = true;
  }
}

describe("ChatMode", () => {
  it("agent一覧をカンマ区切りで解釈し、重複を除いて順序を保つ", () => {
    expect(resolveChatAgents(" codex, gemini,codex ", getDefaultCliviumConfig())).toEqual([
      "codex",
      "gemini",
    ]);
  });

  it("agent一覧が未指定なら説明付きで失敗する", () => {
    expect(() => resolveChatAgents(undefined, getDefaultCliviumConfig())).toThrow(/--agents/);
  });

  it("設定にない agent 名は起動前に失敗する", () => {
    expect(() => resolveChatAgents("unknown", getDefaultCliviumConfig())).toThrow(
      /設定にありません/,
    );
  });

  it("複数agentへ同じ質問を順に送り、agent名付きで表示し、入出力を保存する", async () => {
    const codex = new FakeAdapter("codex", "codex answer");
    const gemini = new FakeAdapter("gemini", "gemini answer");
    const adapters: Record<string, FakeAdapter> = { codex, gemini };
    const store = new FakeStore();
    const out: string[] = [];

    const result = await new ChatMode().execute({
      agents: "codex,gemini",
      prompt: " hello ",
      config: getDefaultCliviumConfig(),
      store,
      stdout: {
        write: (chunk) => out.push(chunk),
      },
      createAdapter: (name) => adapters[name]!,
    });

    expect(result.responses.map((response) => response.agent)).toEqual(["codex", "gemini"]);
    expect(codex.sent).toEqual(["hello"]);
    expect(gemini.sent).toEqual(["hello"]);
    expect(codex.stopped).toBe(true);
    expect(gemini.stopped).toBe(true);
    expect(out.join("")).toContain("[codex]\ncodex answer\n\n[gemini]\ngemini answer");
    expect(store.sessions).toMatchObject([{ id: "session-1", mode: "chat" }]);
    expect(store.messages).toEqual([
      { sessionId: "session-1", sender: "user", recipient: "codex", content: "hello" },
      { sessionId: "session-1", sender: "codex", content: "codex answer" },
      { sessionId: "session-1", sender: "user", recipient: "gemini", content: "hello" },
      { sessionId: "session-1", sender: "gemini", content: "gemini answer" },
    ]);
  });

  it("一部agentが失敗しても残りの回答を表示し、失敗内容を保存する", async () => {
    const codex = new FakeAdapter("codex", "codex answer");
    const gemini = new FakeAdapter("gemini", "gemini answer");
    gemini.readError = new Error("boom");
    const adapters: Record<string, FakeAdapter> = { codex, gemini };
    const store = new FakeStore();
    const out: string[] = [];

    const result = await new ChatMode().execute({
      agents: "codex,gemini",
      prompt: "hello",
      config: getDefaultCliviumConfig(),
      store,
      stdout: {
        write: (chunk) => out.push(chunk),
      },
      createAdapter: (name) => adapters[name]!,
    });

    expect(result.responses.map((response) => response.agent)).toEqual(["codex"]);
    expect(result.failures.map((failure) => failure.agent)).toEqual(["gemini"]);
    expect(out.join("")).toMatch(/\[gemini\] ERROR: boom/);
    expect(store.messages.at(-1)).toEqual({
      sessionId: "session-1",
      sender: "system",
      recipient: "gemini",
      content: 'agent "gemini" failed: boom',
    });
  });

  it("全agentが失敗した場合はコマンド全体を失敗にする", async () => {
    const codex = new FakeAdapter("codex", "");
    codex.readError = new Error("boom");

    await expect(
      new ChatMode().execute({
        agents: "codex",
        prompt: "hello",
        config: getDefaultCliviumConfig(),
        store: new FakeStore(),
        stdout: {
          write: () => {},
        },
        createAdapter: () => codex,
      }),
    ).rejects.toThrow(ChatModeError);
  });
});
