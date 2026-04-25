/**
 * エントリの振る舞い: プロセス引数の受け渡し（実装詳細のテストにしない）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const runCli = vi.hoisted(() => vi.fn());

vi.mock("./cli.js", () => ({
  runCli,
}));

describe("index（振る舞い）", () => {
  beforeEach(() => {
    runCli.mockClear();
    vi.resetModules();
  });

  it("起動用の窓口は、現在のプロセス引数のまま CLI へ委譲する", async () => {
    await import("./index.js");
    expect(runCli).toHaveBeenCalledTimes(1);
    expect(runCli).toHaveBeenCalledWith(process.argv);
  });
});
