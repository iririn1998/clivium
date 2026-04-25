/**
 * 起動バナーの振る舞い: 目に出る行の有無（描画方法の内側は追わない）。
 */
import { describe, expect, it, vi } from "vitest";
import { BANNER_LINES, printBanner } from "./banner.js";

describe("banner（振る舞い）", () => {
  it("起動用の一括表示は、タグラインの文言を含む", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      lines.push(m === undefined || m === null ? "" : String(m));
    });
    printBanner();
    const text = lines.join("\n");
    expect(text).toMatch(/CLI agents, gathered/);
  });

  it("掲出する可視行は一連のブロックとして扱い、行の区切りが保たれている", () => {
    expect(BANNER_LINES.join("\n")).toContain("_______");
  });
});
