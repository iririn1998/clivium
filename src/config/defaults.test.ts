/**
 * デフォルトとマージの振る舞い: 上書きの有無に応じた「見た目上の枠」が残ること。
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENT_NAMES } from "./agents.js";
import { getDefaultCliviumConfig, mergeAgentsIntoConfig } from "./defaults.js";

describe("defaults（振る舞い）", () => {
  it("同梱の初期状態では、内蔵名それぞれに npx 経由の起動行と色の表記、待ち時間の枠がある", () => {
    const c = getDefaultCliviumConfig();
    for (const name of BUILTIN_AGENT_NAMES) {
      expect(c.agents[name].command).toBe("npx");
      expect(c.agents[name].args).not.toEqual([]);
      expect(c.agents[name].color).toMatch(/^#/);
    }
  });

  it("上書きで触った欄だけ差し替わり、触っていない欄の既定はそのまま残る", () => {
    const base = getDefaultCliviumConfig();
    const next = mergeAgentsIntoConfig(base, { codex: { command: "my-cli" } });
    expect(next.agents.codex.command).toBe("my-cli");
    expect(next.agents.codex.args).toEqual(base.agents.codex.args);
    expect(next.agents.gemini).toEqual(base.agents.gemini);
  });
});
