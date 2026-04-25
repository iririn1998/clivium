/**
 * TUI の静的表示: ログ、入力欄、agent状態が同一画面に載ることを確認する。
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
import { App } from "./App.js";
import { selectVisibleMessages } from "./MessageList.js";
import type { TuiAgentState, TuiMessage } from "./types.js";

const agents: TuiAgentState[] = [
  { name: "codex", status: "running", color: "#3B82F6" },
  { name: "gemini", status: "error", color: "#F59E0B", detail: "timeout" },
];

describe("TUI App", () => {
  it("状態行、会話ログ、入力欄を同時に表示する", () => {
    const output = renderToString(
      <App
        mode="chat"
        sessionId="session-1"
        agentStates={agents}
        initialMessages={[
          { id: "m1", sender: "user", content: "hello" },
          { id: "m2", sender: "codex", content: "answer" },
        ]}
      />,
    );

    expect(output).toContain("mode: chat");
    expect(output).toContain("session: session-1");
    expect(output).toContain("codex: running");
    expect(output).toContain("gemini: error (timeout)");
    expect(output).toContain("[user]");
    expect(output).toContain("hello");
    expect(output).toContain("> _");
  });

  it("長いログは末尾を表示する", () => {
    const messages: TuiMessage[] = [
      { id: "m1", sender: "user", content: "old" },
      { id: "m2", sender: "codex", content: "middle" },
      { id: "m3", sender: "gemini", content: "new" },
    ];

    expect(selectVisibleMessages(messages, 2).map((message) => message.content)).toEqual([
      "middle",
      "new",
    ]);
  });
});
