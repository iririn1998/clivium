/**
 * sessions / replay の振る舞い: 保存済みセッションの一覧と再表示を確認する。
 */
import { describe, expect, it } from "vitest";
import type { StoredSession, StoredSessionWithMessages } from "../../store/SessionStore.js";
import {
  formatReplay,
  formatSessions,
  SessionsMode,
  SessionsModeError,
  type SessionsModeStore,
} from "./SessionsMode.js";

class FakeStore implements SessionsModeStore {
  closed = false;

  constructor(
    readonly sessions: StoredSession[] = [],
    readonly session: StoredSessionWithMessages | null = null,
  ) {}

  listSessions(): StoredSession[] {
    return this.sessions;
  }

  getSession(_sessionId: string): StoredSessionWithMessages | null {
    return this.session;
  }

  close(): void {
    this.closed = true;
  }
}

const storedSession = (): StoredSessionWithMessages => ({
  id: "20260425T010203Z-abcdef12",
  mode: "run",
  createdAt: "2026-04-25T01:02:03.000Z",
  updatedAt: "2026-04-25T01:02:04.000Z",
  workspacePath: "/workspace",
  messages: [
    {
      id: "m1",
      sessionId: "20260425T010203Z-abcdef12",
      sender: "user",
      recipient: "codex",
      content: "hello",
      createdAt: "2026-04-25T01:02:03.000Z",
    },
    {
      id: "m2",
      sessionId: "20260425T010203Z-abcdef12",
      sender: "codex",
      recipient: null,
      content: "answer",
      createdAt: "2026-04-25T01:02:04.000Z",
    },
  ],
});

describe("SessionsMode", () => {
  it("セッション一覧を指定項目で表示する", () => {
    const out: string[] = [];
    const session = storedSession();

    const result = new SessionsMode().list({
      store: new FakeStore([session]),
      stdout: {
        write: (chunk) => out.push(chunk),
      },
    });

    expect(result).toHaveLength(1);
    expect(out.join("")).toMatch(/session id\s+mode\s+created_at\s+updated_at\s+workspace_path/);
    expect(out.join("")).toMatch(/20260425T010203Z-abcdef12\s+run/);
    expect(out.join("")).toMatch(/\/workspace/);
  });

  it("一覧が空なら空であることを表示する", () => {
    expect(formatSessions([])).toBe("保存済みセッションはありません。\n");
  });

  it("保存済みセッションをメッセージ付きで再表示する", () => {
    const out: string[] = [];
    const session = storedSession();

    const result = new SessionsMode().replay({
      sessionId: session.id,
      store: new FakeStore([], session),
      stdout: {
        write: (chunk) => out.push(chunk),
      },
    });

    expect(result.id).toBe(session.id);
    const text = out.join("");
    expect(text).toMatch(/session: 20260425T010203Z-abcdef12/);
    expect(text).toMatch(/\[2026-04-25T01:02:03.000Z\] user -> codex/);
    expect(text).toMatch(/hello/);
    expect(text).toMatch(/\[2026-04-25T01:02:04.000Z\] codex/);
    expect(text).toMatch(/answer/);
  });

  it("存在しない session id は説明付きで失敗する", () => {
    expect(() =>
      new SessionsMode().replay({
        sessionId: "missing",
        store: new FakeStore(),
      }),
    ).toThrow(SessionsModeError);
  });

  it("replay の整形はメッセージなしでも読める", () => {
    const session = { ...storedSession(), messages: [] };

    expect(formatReplay(session)).toMatch(/メッセージはありません/);
  });
});
