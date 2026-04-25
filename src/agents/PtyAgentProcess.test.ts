/**
 * PTY 制御の振る舞い: 外部 CLI を起動し、入力・出力・停止を扱えること。
 */
import { describe, expect, it } from "vitest";
import { PtyAgentProcess, stripAnsiSequences } from "./PtyAgentProcess.js";

const nodeArgs = (script: string): string[] => ["-e", script];

describe("PtyAgentProcess（振る舞い）", () => {
  it("PTY 経由でコマンドを起動し、文字列を送って出力を受け取れる", async () => {
    const proc = new PtyAgentProcess({
      agent: "codex",
      command: process.execPath,
      args: nodeArgs(`
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => {
          process.stdout.write("answer:" + chunk.trim());
          process.exit(0);
        });
      `),
      timeoutMs: 2_000,
    });

    await proc.start();
    await proc.send("hello\n");
    const result = await proc.read({ timeoutMs: 2_000, idleMs: 50 });

    expect(result.output).toMatch(/answer:hello/);
    expect(result.completed).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it("出力イベントを購読でき、解除後は追加通知されない", async () => {
    const proc = new PtyAgentProcess({
      agent: "gemini",
      command: process.execPath,
      args: nodeArgs(`
        process.stdout.write("one");
        setTimeout(() => {
          process.stdout.write("two");
          process.exit(0);
        }, 50);
      `),
      timeoutMs: 2_000,
    });
    const events: string[] = [];
    const off = proc.onOutput((event) => {
      if (event.type === "chunk") {
        events.push(event.data);
        off();
      }
    });

    await proc.start();
    await proc.read({ timeoutMs: 2_000, idleMs: 120 });

    expect(events.join("")).toBe("one");
  });

  it("ANSI escape sequence は既定で出力から除去される", async () => {
    const proc = new PtyAgentProcess({
      agent: "codex",
      command: process.execPath,
      args: nodeArgs(`
        process.stdout.write("\\x1b[31mred\\x1b[0m");
        process.exit(0);
      `),
      timeoutMs: 2_000,
    });

    await proc.start();
    const result = await proc.read({ timeoutMs: 2_000, idleMs: 50 });

    expect(result.output).toContain("red");
    expect(result.output).not.toContain("\x1b[31m");
    expect(stripAnsiSequences("\x1b[32mok\x1b[0m")).toBe("ok");
  });

  it("応答がないプロセスは timeout として扱い、指定時は停止できる", async () => {
    const proc = new PtyAgentProcess({
      agent: "codex",
      command: process.execPath,
      args: nodeArgs("setInterval(() => {}, 1000);"),
      timeoutMs: 100,
    });

    await proc.start();
    const result = await proc.read({ timeoutMs: 100, idleMs: 20, killOnTimeout: true });

    expect(result.timedOut).toBe(true);
    expect(proc.exited).toBe(true);
  });
});
