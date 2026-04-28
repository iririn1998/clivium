/**
 * TUI の静的表示: ログ、入力欄、agent状態が同一画面に載ることを確認する。
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "ink";
import type { AgentConfig, AgentName } from "../config/agents.js";
import { getDefaultCliviumConfig } from "../config/defaults.js";
import type { AgentAdapter, AgentOutputListener, AgentReadResult } from "../agents/AgentAdapter.js";
import { createAgentMessage } from "../types/AgentMessage.js";
import { App, resolveTuiAgentSequence, sendThroughAgents } from "./App.js";
import { selectVisibleMessages } from "./MessageList.js";
import type { TuiAgentState, TuiMessage } from "./types.js";

const agents: TuiAgentState[] = [
  { name: "codex", status: "running", color: "#3B82F6" },
  { name: "gemini", status: "error", color: "#F59E0B", detail: "timeout" },
];

class FakeAdapter implements AgentAdapter {
  sent: string[] = [];
  stopped = false;

  constructor(
    readonly name: AgentName,
    readonly config: AgentConfig,
  ) {}

  async start(): Promise<void> {}

  async send(input: string): Promise<void> {
    this.sent.push(input);
  }

  async read(): Promise<AgentReadResult> {
    const content = `${this.name}<${this.sent.at(-1) ?? ""}>`;
    return {
      output: content,
      events: [],
      completed: true,
      message: createAgentMessage({
        role: "agent",
        agent: this.name,
        content,
      }),
    };
  }

  async interrupt(): Promise<void> {}

  async stop(): Promise<void> {
    this.stopped = true;
  }

  onOutput(_listener: AgentOutputListener): () => void {
    return () => {};
  }
}

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

  it("既定の Gemini 応答を Codex に引き渡す順序を作る", () => {
    expect(resolveTuiAgentSequence("gemini", "codex")).toEqual(["gemini", "codex"]);
    expect(resolveTuiAgentSequence("codex", "codex")).toEqual(["codex"]);
    expect(resolveTuiAgentSequence("gemini", null)).toEqual(["gemini"]);
  });

  it("Gemini の応答本文を次の Codex prompt として渡す", async () => {
    const config = getDefaultCliviumConfig();
    const created: FakeAdapter[] = [];
    const messages: { sender: AgentName; content: string }[] = [];
    const statusEvents: string[] = [];

    await sendThroughAgents({
      agentNames: ["gemini", "codex"],
      initialPrompt: "hello",
      config,
      createAdapter: (name, agentConfig) => {
        const adapter = new FakeAdapter(name, agentConfig);
        created.push(adapter);
        return adapter;
      },
      onAgentStart: (agentName) => {
        statusEvents.push(`start:${agentName}`);
      },
      onMessage: (message) => {
        messages.push(message);
      },
      onAgentError: (agentName, message) => {
        statusEvents.push(`error:${agentName}:${message}`);
      },
      onAgentSuccess: (agentName) => {
        statusEvents.push(`success:${agentName}`);
      },
      onComplete: () => {
        statusEvents.push("complete");
      },
    });

    expect(created.map((adapter) => adapter.name)).toEqual(["gemini", "codex"]);
    expect(created[0]!.sent).toEqual(["hello"]);
    expect(created[1]!.sent).toEqual(["gemini<hello>"]);
    expect(messages).toEqual([
      { sender: "gemini", content: "gemini<hello>" },
      { sender: "codex", content: "codex<gemini<hello>>" },
    ]);
    expect(statusEvents).toEqual([
      "start:gemini",
      "success:gemini",
      "start:codex",
      "success:codex",
      "complete",
    ]);
    expect(created.every((adapter) => adapter.stopped)).toBe(true);
  });
});
