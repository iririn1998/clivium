/**
 * セッション型の振る舞い: 実行モード・対象 agent・メッセージ列を保存単位にまとめられること。
 */
import { describe, expect, it } from "vitest";
import { createSession } from "./Session.js";

describe("Session（振る舞い）", () => {
  it("run 実行の保存単位として、時刻と対象 agent を含む空セッションを作れる", () => {
    const session = createSession({
      id: "s1",
      mode: "run",
      agents: ["codex"],
      workspacePath: "/workspace",
      now: new Date("2026-04-25T01:02:03.000Z"),
    });

    expect(session).toEqual({
      id: "s1",
      mode: "run",
      agents: ["codex"],
      workspacePath: "/workspace",
      createdAt: "2026-04-25T01:02:03.000Z",
      updatedAt: "2026-04-25T01:02:03.000Z",
      messages: [],
    });
  });

  it("呼び出し元の agent 配列を後から変更しても、作成済みセッションは変わらない", () => {
    const agents = ["codex"] as const;
    const mutableAgents = [...agents];
    const session = createSession({
      id: "s1",
      mode: "chat",
      agents: mutableAgents,
      workspacePath: "/workspace",
      now: new Date("2026-04-25T01:02:03.000Z"),
    });

    mutableAgents.push("gemini");

    expect(session.agents).toEqual(["codex"]);
  });
});
