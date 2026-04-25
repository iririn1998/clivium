/**
 * SQLite Storeの振る舞い: セッション作成、メッセージ保存、一覧・再取得を確認する。
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { generateSessionId, resolveSessionDbPath, SessionStore } from "./SessionStore.js";

let tempDirs: string[] = [];

const trackTemp = (d: string) => {
  tempDirs.push(d);
  return d;
};

afterEach(() => {
  for (const d of tempDirs) {
    if (existsSync(d)) {
      rmSync(d, { recursive: true, force: true });
    }
  }
  tempDirs = [];
});

describe("SessionStore", () => {
  it("保存先は CLIVIUM_DB_PATH で上書きでき、未指定では作業ディレクトリ配下になる", () => {
    const cwd = "/tmp/project";

    expect(resolveSessionDbPath({}, cwd)).toBe("/tmp/project/.clivium/sessions.sqlite");
    expect(resolveSessionDbPath({ CLIVIUM_DB_PATH: "state.sqlite" }, cwd)).toBe(
      "/tmp/project/state.sqlite",
    );
  });

  it("日時とランダム値からセッションIDを作る", () => {
    const id = generateSessionId(
      new Date("2026-04-25T01:02:03.456Z"),
      () => "12345678-aaaa-bbbb-cccc-123456789abc",
    );

    expect(id).toBe("20260425T010203Z-12345678");
  });

  it("セッションとメッセージをSQLiteに保存して再取得できる", () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-store-")));
    const path = join(d, "sessions.sqlite");
    let tick = 0;
    const store = new SessionStore({
      path,
      randomId: () => `id-${++tick}`,
      now: () => new Date(`2026-04-25T00:00:0${tick}.000Z`),
    });

    const session = store.createSession({
      mode: "run",
      workspacePath: "/workspace",
    });
    const userMessage = store.addMessage({
      sessionId: session.id,
      sender: "user",
      recipient: "codex",
      content: "hello",
    });
    const agentMessage = store.addMessage({
      sessionId: session.id,
      sender: "codex",
      content: "answer",
    });
    const event = store.addAgentEvent({
      sessionId: session.id,
      agent: "codex",
      eventType: "safety.detected",
      payload: JSON.stringify({ kind: "dangerous-command" }),
    });

    expect(session.id).toBe("20260425T000000Z-id1");
    expect(userMessage.recipient).toBe("codex");
    expect(agentMessage.sender).toBe("codex");
    expect(event.eventType).toBe("safety.detected");
    expect(store.listSessions()).toMatchObject([
      {
        id: session.id,
        mode: "run",
        workspacePath: "/workspace",
        updatedAt: "2026-04-25T00:00:04.000Z",
      },
    ]);
    expect(store.getSession(session.id)).toMatchObject({
      id: session.id,
      messages: [
        { sender: "user", recipient: "codex", content: "hello" },
        { sender: "codex", recipient: null, content: "answer" },
      ],
    });
    expect(store.listAgentEvents(session.id)).toMatchObject([
      {
        sessionId: session.id,
        agent: "codex",
        eventType: "safety.detected",
        payload: JSON.stringify({ kind: "dangerous-command" }),
      },
    ]);

    store.close();
  });

  it("存在しないセッションは null として扱う", () => {
    const store = new SessionStore({ path: ":memory:" });

    expect(store.getSession("missing")).toBeNull();
    store.close();
  });
});
