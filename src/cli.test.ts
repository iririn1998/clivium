/**
 * ユーザー向けの振る舞い: 引数・入出力に対する反応（内部実装の分岐名は検証しない）。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { resetCliviumConfig } from "./config/load.js";

let cwdBefore: string;
let tempDirs: string[] = [];

const trackTemp = (d: string) => {
  tempDirs.push(d);
  return d;
};

beforeEach(() => {
  cwdBefore = process.cwd();
  tempDirs = [];
  resetCliviumConfig();
  vi.restoreAllMocks();
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
  process.chdir(cwdBefore);
  delete process.env.CLIVIUM_CONFIG;
  delete process.env.CLIVIUM_VERBOSE;
  resetCliviumConfig();
});

describe("clivium（振る舞い）", () => {
  it("引数を付けずに起動すると、起動感のある表現と、使い方の案内を出力して終了する", () => {
    const logCalls: string[] = [];
    const outChunks: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logCalls.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      outChunks.push(String(c));
      return true;
    });

    runCli(["node", "/fake/clivium"]);

    const logged = logCalls.join("\n");
    expect(logged).toMatch(/CLI agents/);
    expect(logged).toMatch(/________/);
    const help = outChunks.join("");
    expect(help).toMatch(/Usage:\s+clivium/);
    expect(help).toMatch(/--help/);
  });

  it("バナーを抑止する指定では、同じ起動条件でも顔出し用の行は出さない", () => {
    const logCalls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logCalls.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    runCli(["node", "/fake", "--no-banner", "--help"]);

    const joined = logCalls.join("\n");
    expect(joined).not.toMatch(/CLI agents, gathered/);
  });

  it("バージョン表示を求めたときは、セマンティックバージョン表記の文字列が見える", () => {
    const outChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      outChunks.push(String(c));
      return true;
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    runCli(["node", "/fake", "-V"]);
    // Commander は通常 stdout に version 相当を出す
    const text = outChunks.join("");
    expect(text).toMatch(/^\d+\.\d+\.\d+$/m);
    expect(log).not.toHaveBeenCalled();
  });

  it("未実装のサブコマンドを使うと、未対応であることが伝えられ、失敗扱いで止まる", () => {
    const errLines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errLines.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    expect(() => runCli(["node", "/fake", "run"])).toThrow("exit:1");
    expect(errLines.join("\n")).toMatch(/未実装/);
  });

  it("壊れた設定ファイルのパスを付けたとき、読み取り失敗の旨が出て、失敗扱いで止まる", () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-b-")));
    const path = join(d, "bad.json");
    writeFileSync(path, "not json at all{", "utf-8");
    const errLines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errLines.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    expect(() => runCli(["node", "/fake", "-c", path, "run"])).toThrow("exit:1");
    const combined = errLines.join("\n");
    expect(combined).toMatch(/設定/);
    expect(combined).toMatch(/失敗/);
  });

  it("作業ディレクトリとして存在しないパスを渡すと、開けない旨が出て、失敗扱いで止まる", () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-cwd-")));
    const ghost = join(d, "nope");
    const errLines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errLines.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    expect(() => runCli(["node", "/fake", "--cwd", ghost, "run"])).toThrow("exit:1");
    expect(errLines.join("\n")).toMatch(/作業ディレクトリ/);
  });

  it("作業ディレクトリとしてファイルを渡すと、ディレクトリでない旨が出る", () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-file-")));
    const f = join(d, "file");
    writeFileSync(f, "x", "utf-8");
    const errLines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errLines.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    expect(() => runCli(["node", "/fake", "--cwd", f, "run"])).toThrow("exit:1");
    expect(errLines.join("\n")).toMatch(/ディレクトリ/);
  });

  it("存在する作業ディレクトリに移れたあと、未実装サブコマンドは従来どおり失敗する", () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-ok-")));
    mkdirSync(join(d, "sub"), { recursive: true });
    const errLines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errLines.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    expect(() => runCli(["node", "/fake", "--cwd", join(d, "sub"), "run"])).toThrow("exit:1");
    expect(errLines.join("\n")).toMatch(/未実装/);
  });
});
