/**
 * メッセージ型の振る舞い: Store や Adapter が受け取る形を、呼び出し側が安定して作れること。
 */
import { describe, expect, it } from "vitest";
import {
  createAgentExitEvent,
  createAgentMessage,
  createAgentOutputChunkEvent,
} from "./AgentMessage.js";

describe("AgentMessage（振る舞い）", () => {
  it("ユーザー入力を、保存しやすい時刻付きメッセージとして扱える", () => {
    const msg = createAgentMessage({
      role: "user",
      content: "hello",
      now: new Date("2026-04-25T01:02:03.000Z"),
    });

    expect(msg).toEqual({
      role: "user",
      content: "hello",
      createdAt: "2026-04-25T01:02:03.000Z",
    });
  });

  it("どのエージェントから届いた出力か、ストリーム単位で残せる", () => {
    const ev = createAgentOutputChunkEvent(
      "codex",
      "stdout",
      "answer",
      new Date("2026-04-25T01:02:03.000Z"),
    );

    expect(ev).toMatchObject({
      type: "chunk",
      agent: "codex",
      stream: "stdout",
      data: "answer",
      occurredAt: "2026-04-25T01:02:03.000Z",
    });
  });

  it("終了もイベントとして扱えるため、成功・失敗の境界を Adapter 外へ渡せる", () => {
    const ev = createAgentExitEvent("gemini", 0, null, new Date("2026-04-25T01:02:03.000Z"));

    expect(ev).toEqual({
      type: "exit",
      agent: "gemini",
      exitCode: 0,
      signal: null,
      occurredAt: "2026-04-25T01:02:03.000Z",
    });
  });
});
