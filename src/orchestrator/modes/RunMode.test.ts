/**
 * run モードの振る舞い: agent 指定、出力表示、途中終了時の停止を確認する。
 */
import { describe, expect, it } from "vitest";
import type {
  AgentAdapter,
  AgentOutputListener,
  AgentReadResult,
} from "../../agents/AgentAdapter.js";
import type { AgentConfig, AgentName } from "../../config/agents.js";
import { getDefaultCliviumConfig } from "../../config/defaults.js";
import type { ApprovalGate } from "../../safety/ApprovalGate.js";
import { RunMode, RunModeError, type RunModeStore } from "./RunMode.js";

class FakeAdapter implements AgentAdapter {
  readonly config: AgentConfig;
  started = false;
  stopped = false;
  sent: string[] = [];
  result: AgentReadResult = {
    output: "answer",
    events: [],
    completed: true,
    message: {
      role: "agent",
      agent: this.name,
      content: "answer",
      createdAt: "2026-04-25T00:00:00.000Z",
    },
  };
  readError: Error | undefined;

  constructor(readonly name: AgentName) {
    this.config = getDefaultCliviumConfig().agents[name];
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

class FakeStore implements RunModeStore {
  closed = false;
  sessions: { id: string; mode: string; workspacePath: string }[] = [];
  messages: { sessionId: string; sender: string; recipient?: string | null; content: string }[] =
    [];
  events: { sessionId: string; agent: string; eventType: string; payload?: string | null }[] = [];

  createSession(input: { mode: "run"; workspacePath: string }): { id: string } {
    const session = { id: `session-${this.sessions.length + 1}`, ...input };
    this.sessions.push(session);
    return session;
  }

  addMessage(input: {
    sessionId: string;
    sender: string;
    recipient?: string | null;
    content: string;
  }): void {
    this.messages.push(input);
  }

  addAgentEvent(input: Parameters<NonNullable<RunModeStore["addAgentEvent"]>>[0]): void {
    this.events.push(input);
  }

  close(): void {
    this.closed = true;
  }
}

const approvingGate: ApprovalGate = {
  async requestApproval() {
    return {
      approved: true,
      response: "yes",
      decidedAt: "2026-04-25T00:00:00.000Z",
    };
  },
};

describe("RunMode（振る舞い）", () => {
  it("agent 未指定では、どの CLI も起動せずに説明付きで失敗する", async () => {
    const created: AgentName[] = [];

    await expect(
      new RunMode().execute({
        prompt: "hello",
        config: getDefaultCliviumConfig(),
        createAdapter: (name) => {
          created.push(name);
          return new FakeAdapter(name);
        },
      }),
    ).rejects.toThrow(/--agent/);
    expect(created).toEqual([]);
  });

  it("設定にない agent 名は、起動前に失敗する", async () => {
    await expect(
      new RunMode().execute({
        agent: "unknown",
        prompt: "hello",
        config: getDefaultCliviumConfig(),
      }),
    ).rejects.toThrow(/設定にありません/);
  });

  it("指定 agent に一回質問し、応答をターミナル出力として書き出す", async () => {
    const fake = new FakeAdapter("codex");
    const store = new FakeStore();
    const out: string[] = [];

    const result = await new RunMode().execute({
      agent: "codex",
      prompt: " hello ",
      config: getDefaultCliviumConfig(),
      store,
      stdout: {
        write: (chunk) => out.push(chunk),
      },
      createAdapter: () => fake,
    });

    expect(fake.started).toBe(true);
    expect(fake.sent).toEqual(["hello"]);
    expect(out.join("")).toBe("answer\n");
    expect(result.message.content).toBe("answer");
    expect(fake.stopped).toBe(true);
    expect(store.sessions).toHaveLength(1);
    expect(store.messages).toEqual([
      {
        sessionId: "session-1",
        sender: "user",
        recipient: "codex",
        content: "hello",
      },
      {
        sessionId: "session-1",
        sender: "codex",
        content: "answer",
      },
    ]);
  });

  it("Gemini も同じ run 契約で起動できる", async () => {
    const fake = new FakeAdapter("gemini");

    await new RunMode().execute({
      agent: "gemini",
      prompt: "hello",
      config: getDefaultCliviumConfig(),
      store: new FakeStore(),
      stdout: {
        write: () => {},
      },
      createAdapter: (name) => {
        expect(name).toBe("gemini");
        return fake;
      },
    });

    expect(fake.sent).toEqual(["hello"]);
    expect(fake.stopped).toBe(true);
  });

  it("読み取りが失敗しても、起動済み agent を止める", async () => {
    const fake = new FakeAdapter("codex");
    const store = new FakeStore();
    fake.readError = new Error("read failed");

    await expect(
      new RunMode().execute({
        agent: "codex",
        prompt: "hello",
        config: getDefaultCliviumConfig(),
        store,
        createAdapter: () => fake,
      }),
    ).rejects.toThrow(/read failed/);
    expect(fake.stopped).toBe(true);
    expect(store.messages).toEqual([
      {
        sessionId: "session-1",
        sender: "user",
        recipient: "codex",
        content: "hello",
      },
    ]);
  });

  it("timeout 扱いの応答は失敗にし、停止処理も行う", async () => {
    const fake = new FakeAdapter("codex");
    const store = new FakeStore();
    fake.result = {
      output: "partial",
      events: [],
      completed: false,
      message: {
        role: "agent",
        agent: "codex",
        content: "partial",
        createdAt: "2026-04-25T00:00:00.000Z",
      },
    };
    const out: string[] = [];

    await expect(
      new RunMode().execute({
        agent: "codex",
        prompt: "hello",
        config: getDefaultCliviumConfig(),
        store,
        stdout: {
          write: (chunk) => out.push(chunk),
        },
        createAdapter: () => fake,
      }),
    ).rejects.toThrow(RunModeError);
    expect(out.join("")).toBe("partial\n");
    expect(fake.stopped).toBe(true);
    expect(store.messages.at(-1)).toMatchObject({
      sessionId: "session-1",
      sender: "codex",
      content: "partial",
    });
  });

  it("危険操作らしき出力は承認を挟み、検出と結果を保存する", async () => {
    const fake = new FakeAdapter("codex");
    fake.result = {
      output: "git reset --hard",
      events: [],
      completed: true,
      message: {
        role: "agent",
        agent: "codex",
        content: "git reset --hard",
        createdAt: "2026-04-25T00:00:00.000Z",
      },
    };
    const store = new FakeStore();

    await new RunMode().execute({
      agent: "codex",
      prompt: "hello",
      config: getDefaultCliviumConfig(),
      store,
      approvalGate: approvingGate,
      stdout: {
        write: () => {},
      },
      createAdapter: () => fake,
    });

    expect(store.events.map((event) => event.eventType)).toEqual([
      "safety.detected",
      "safety.approved",
    ]);
  });
});
