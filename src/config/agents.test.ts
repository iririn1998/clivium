/**
 * エージェント名の振る舞い: 案内上の内蔵名と未知の名の扱い。
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENT_NAMES, isAgentName } from "./agents.js";

describe("agents（振る舞い）", () => {
  it("案内上の内蔵名はすべて、正式名として通る", () => {
    for (const n of BUILTIN_AGENT_NAMES) {
      expect(isAgentName(n)).toBe(true);
    }
  });

  it("定義外の名は、内蔵名として扱われない", () => {
    expect(isAgentName("other-agent")).toBe(false);
  });
});
