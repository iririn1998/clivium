/**
 * ユーザー向けの振る舞い: 引数・入出力に対する反応（内部実装の分岐名は検証しない）。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { resetCliviumConfig } from "./config/load.js";
import { SessionStore } from "./store/SessionStore.js";

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
  delete process.env.CLIVIUM_DB_PATH;
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
  delete process.env.CLIVIUM_DB_PATH;
  delete process.env.CLIVIUM_VERBOSE;
  resetCliviumConfig();
});

describe("clivium（振る舞い）", () => {
  it("引数を付けずに起動すると、起動感のある表現と、使い方の案内を出力して終了する", async () => {
    const logCalls: string[] = [];
    const outChunks: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logCalls.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      outChunks.push(String(c));
      return true;
    });

    await runCli(["node", "/fake/clivium"]);

    const logged = logCalls.join("\n");
    expect(logged).toMatch(/CLI agents/);
    expect(logged).toMatch(/________/);
    const help = outChunks.join("");
    expect(help).toMatch(/Usage:\s+clivium/);
    expect(help).toMatch(/--help/);
  });

  it("バナーを抑止する指定では、同じ起動条件でも顔出し用の行は出さない", async () => {
    const logCalls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => {
      logCalls.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runCli(["node", "/fake", "--no-banner", "--help"]);

    const joined = logCalls.join("\n");
    expect(joined).not.toMatch(/CLI agents, gathered/);
  });

  it("バージョン表示を求めたときは、セマンティックバージョン表記の文字列が見える", async () => {
    const outChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      outChunks.push(String(c));
      return true;
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "/fake", "-V"]);
    // Commander は通常 stdout に version 相当を出す
    const text = outChunks.join("");
    expect(text).toMatch(/^\d+\.\d+\.\d+$/m);
    expect(log).not.toHaveBeenCalled();
  });

  it("存在しないサブコマンドを使うと、失敗扱いで止まる", async () => {
    const errChunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((m) => {
      errChunks.push(String(m));
      return true;
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    await expect(runCli(["node", "/fake", "unknown"])).rejects.toThrow("exit:1");
    expect(errChunks.join("")).toMatch(/unknown command/);
  });

  it("壊れた設定ファイルのパスを付けたとき、読み取り失敗の旨が出て、失敗扱いで止まる", async () => {
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

    await expect(runCli(["node", "/fake", "-c", path, "run"])).rejects.toThrow("exit:1");
    const combined = errLines.join("\n");
    expect(combined).toMatch(/設定/);
    expect(combined).toMatch(/失敗/);
  });

  it("作業ディレクトリとして存在しないパスを渡すと、開けない旨が出て、失敗扱いで止まる", async () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-cwd-")));
    const ghost = join(d, "nope");
    const errLines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errLines.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    await expect(runCli(["node", "/fake", "--cwd", ghost, "run"])).rejects.toThrow("exit:1");
    expect(errLines.join("\n")).toMatch(/作業ディレクトリ/);
  });

  it("作業ディレクトリとしてファイルを渡すと、ディレクトリでない旨が出る", async () => {
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

    await expect(runCli(["node", "/fake", "--cwd", f, "run"])).rejects.toThrow("exit:1");
    expect(errLines.join("\n")).toMatch(/ディレクトリ/);
  });

  it("存在する作業ディレクトリに移れたあと、サブコマンドの検証へ進む", async () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-ok-")));
    mkdirSync(join(d, "sub"), { recursive: true });
    const errLines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errLines.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    await expect(runCli(["node", "/fake", "--cwd", join(d, "sub"), "run"])).rejects.toThrow(
      "exit:1",
    );
    expect(errLines.join("\n")).toMatch(/--agent/);
  });

  it("run で agent 未指定なら、agent 指定が必要なことを伝えて失敗扱いで止まる", async () => {
    const errLines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errLines.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    await expect(runCli(["node", "/fake", "--no-banner", "run", "hello"])).rejects.toThrow(
      "exit:1",
    );
    expect(errLines.join("\n")).toMatch(/--agent/);
  });

  it("run で設定にない agent を指定すると、対象がないことを伝えて失敗扱いで止まる", async () => {
    const errLines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => {
      errLines.push(m === undefined || m === null ? "" : String(m));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit:${String(code)}`);
    });

    await expect(
      runCli(["node", "/fake", "--no-banner", "run", "--agent", "unknown", "hello"]),
    ).rejects.toThrow("exit:1");
    expect(errLines.join("\n")).toMatch(/設定にありません/);
  });

  it("run で指定した agent の応答をターミナルへ表示できる", async () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-run-")));
    const path = join(d, "run.json");
    process.env.CLIVIUM_DB_PATH = join(d, "sessions.sqlite");
    writeFileSync(
      path,
      JSON.stringify({
        agents: {
          codex: {
            command: process.execPath,
            args: [
              "-e",
              `
              process.stdin.setEncoding("utf8");
              process.stdin.on("data", (chunk) => {
                process.stdout.write("reply:" + chunk.trim());
                process.exit(0);
              });
              `,
            ],
            timeoutMs: 2000,
          },
        },
      }),
      "utf-8",
    );
    const outChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      outChunks.push(String(c));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "/fake", "--no-banner", "-c", path, "run", "--agent", "codex", "hello"]);

    expect(outChunks.join("")).toMatch(/reply:hello/);
  });

  it("chat で複数 agent の応答をagent名付きで表示し、保存できる", async () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-chat-")));
    const path = join(d, "chat.json");
    const dbPath = join(d, "sessions.sqlite");
    process.env.CLIVIUM_DB_PATH = dbPath;
    const agentScript = (prefix: string) => `
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        process.stdout.write("${prefix}:" + chunk.trim());
        process.exit(0);
      });
    `;
    writeFileSync(
      path,
      JSON.stringify({
        agents: {
          codex: {
            command: process.execPath,
            args: ["-e", agentScript("codex")],
            timeoutMs: 2000,
          },
          gemini: {
            command: process.execPath,
            args: ["-e", agentScript("gemini")],
            timeoutMs: 2000,
          },
        },
      }),
      "utf-8",
    );
    const outChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      outChunks.push(String(c));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([
      "node",
      "/fake",
      "--no-banner",
      "-c",
      path,
      "chat",
      "--agents",
      "codex,gemini",
      "hello",
    ]);

    const text = outChunks.join("");
    expect(text).toMatch(/\[codex\]\nhello\ncodex:hello/);
    expect(text).toMatch(/\[gemini\]\nhello\ngemini:hello/);

    const store = new SessionStore({ path: dbPath });
    const session = store.getSession(store.listSessions()[0]!.id);
    store.close();
    expect(session).toMatchObject({
      mode: "chat",
      messages: [
        { sender: "user", recipient: "codex", content: "hello" },
        { sender: "codex", content: "hello\ncodex:hello" },
        { sender: "user", recipient: "gemini", content: "hello" },
        { sender: "gemini", content: "hello\ngemini:hello" },
      ],
    });
  });

  it("debate で2 agentを交互に応答させ、保存できる", async () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-debate-")));
    const path = join(d, "debate.json");
    const dbPath = join(d, "sessions.sqlite");
    process.env.CLIVIUM_DB_PATH = dbPath;
    const agentScript = (prefix: string) => `
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        process.stdout.write("${prefix}:" + chunk.trim());
        process.exit(0);
      });
    `;
    writeFileSync(
      path,
      JSON.stringify({
        agents: {
          codex: {
            command: process.execPath,
            args: ["-e", agentScript("codex")],
            timeoutMs: 2000,
          },
          gemini: {
            command: process.execPath,
            args: ["-e", agentScript("gemini")],
            timeoutMs: 2000,
          },
        },
      }),
      "utf-8",
    );
    const outChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      outChunks.push(String(c));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([
      "node",
      "/fake",
      "--no-banner",
      "-c",
      path,
      "debate",
      "--agents",
      "codex,gemini",
      "--rounds",
      "1",
      "theme",
    ]);

    const text = outChunks.join("");
    expect(text).toMatch(/\[round 1 codex\]/);
    expect(text).toMatch(/\[round 1 gemini\]/);

    const store = new SessionStore({ path: dbPath });
    const session = store.getSession(store.listSessions()[0]!.id);
    store.close();
    expect(session).toMatchObject({
      mode: "debate",
      messages: [
        { sender: "user", recipient: "codex", content: "theme" },
        { sender: "codex", recipient: "gemini" },
        { sender: "gemini", recipient: null },
      ],
    });
  });

  it("sessions で保存済みセッションの一覧を表示できる", async () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-sessions-")));
    process.env.CLIVIUM_DB_PATH = join(d, "sessions.sqlite");
    const store = new SessionStore({ path: process.env.CLIVIUM_DB_PATH });
    store.createSession({
      id: "session-1",
      mode: "run",
      workspacePath: "/workspace",
    });
    store.close();
    const outChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      outChunks.push(String(c));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "/fake", "--no-banner", "sessions"]);

    const text = outChunks.join("");
    expect(text).toMatch(/session id/);
    expect(text).toMatch(/session-1/);
    expect(text).toMatch(/\/workspace/);
  });

  it("replay で保存済みセッションを再表示できる", async () => {
    const d = trackTemp(mkdtempSync(join(tmpdir(), "clivium-replay-")));
    process.env.CLIVIUM_DB_PATH = join(d, "sessions.sqlite");
    const store = new SessionStore({ path: process.env.CLIVIUM_DB_PATH });
    store.createSession({
      id: "session-1",
      mode: "run",
      workspacePath: "/workspace",
    });
    store.addMessage({
      sessionId: "session-1",
      sender: "user",
      recipient: "codex",
      content: "hello",
    });
    store.addMessage({
      sessionId: "session-1",
      sender: "codex",
      content: "answer",
    });
    store.close();
    const outChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      outChunks.push(String(c));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli(["node", "/fake", "--no-banner", "replay", "session-1"]);

    const text = outChunks.join("");
    expect(text).toMatch(/session: session-1/);
    expect(text).toMatch(/user -> codex/);
    expect(text).toMatch(/hello/);
    expect(text).toMatch(/answer/);
  });
});
