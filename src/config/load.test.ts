/**
 * 設定の振る舞い: ファイルや環境に応じて、有効な設定として反映される範囲の見え方。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getCliviumConfig,
  loadCliviumConfig,
  readCliviumConfigFile,
  resetCliviumConfig,
} from "./load.js";
import { BUILTIN_AGENT_NAMES } from "./agents.js";

let tempDirs: string[] = [];

const track = (d: string) => {
  tempDirs.push(d);
  return d;
};

beforeEach(() => {
  tempDirs = [];
  resetCliviumConfig();
});

afterEach(() => {
  for (const d of tempDirs) {
    if (existsSync(d)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
  delete process.env.CLIVIUM_CONFIG;
  resetCliviumConfig();
});

describe("Clivium 設定（load の振る舞い）", () => {
  it("何も指さなければ、知っているエージェント名はすべてそろい、同じ枠の構造を持つ", () => {
    loadCliviumConfig();
    const c = getCliviumConfig();
    for (const name of BUILTIN_AGENT_NAMES) {
      expect(c.agents[name].command).toBeTruthy();
      expect(Array.isArray(c.agents[name].args)).toBe(true);
    }
  });

  it("正当なJSONでコマンドだけ差し替えたとき、差し替えの見え方が残り、他は以前と同系統の形を保つ", () => {
    const d = track(mkdtempSync(join(tmpdir(), "clivium-cfg-")));
    const p = join(d, "c.json");
    writeFileSync(
      p,
      JSON.stringify({ agents: { codex: { command: "my-cli", args: ["x"] } } }),
      "utf-8",
    );
    loadCliviumConfig({ path: p });
    const c = getCliviumConfig();
    expect(c.agents.codex.command).toBe("my-cli");
    expect(c.agents.codex.args).toEqual(["x"]);
    // 触っていないエージェントは、まだ起動用の行が残っている
    expect(c.agents.gemini.command).toBeTruthy();
  });

  it("JSONの形が合わなければ、人がファイルを辿れるようにパス付きの説明付きのエラーに落ちる", () => {
    const d = track(mkdtempSync(join(tmpdir(), "clivium-bad-")));
    const p = join(d, "bad.json");
    writeFileSync(
      p,
      JSON.stringify({ agents: { not_an_agent: { command: "a" } } }),
      "utf-8",
    );
    expect(() => readCliviumConfigFile(p)).toThrow(/未知のキー/);
  });
});
