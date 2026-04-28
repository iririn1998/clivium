/**
 * @file Clivium の最小 Ink TUI。
 * @module tui/App
 */

import { useMemo, useState } from "react";
import { Box, useApp, useInput } from "ink";
import type { AgentConfig, AgentName } from "../config/agents.js";
import { getDefaultCliviumConfig, type CliviumConfig } from "../config/defaults.js";
import type { AgentAdapter } from "../agents/AgentAdapter.js";
import { CodexAdapter } from "../agents/CodexAdapter.js";
import { GeminiAdapter } from "../agents/GeminiAdapter.js";
import { InputBox } from "./InputBox.js";
import { MessageList, DEFAULT_VISIBLE_MESSAGES } from "./MessageList.js";
import { StatusLine } from "./StatusLine.js";
import type { TuiAgentState, TuiMessage, TuiMode } from "./types.js";

export type TuiAdapterFactory = (name: AgentName, config: AgentConfig) => AgentAdapter;

export type AppProps = {
  mode?: TuiMode;
  sessionId?: string;
  initialMessages?: TuiMessage[];
  agentStates?: TuiAgentState[];
  maxMessages?: number;
  targetAgent?: AgentName;
  config?: CliviumConfig;
  createAdapter?: TuiAdapterFactory;
};

export const App = ({
  mode = "tui",
  sessionId,
  initialMessages = [],
  agentStates,
  maxMessages = DEFAULT_VISIBLE_MESSAGES,
  targetAgent = "gemini",
  config,
  createAdapter = defaultCreateAdapter,
}: AppProps): React.JSX.Element => {
  const { exit } = useApp();
  const resolvedConfig = useMemo(() => config ?? getDefaultCliviumConfig(), [config]);
  const [messages, setMessages] = useState<TuiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<TuiAgentState[]>(
    () => agentStates ?? defaultAgentStates(resolvedConfig),
  );
  const [busy, setBusy] = useState(false);

  const submit = (content: string): void => {
    const userMessage = createTuiMessage("user", content);
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setBusy(true);
    setAgentStatus(setAgents, targetAgent, "running");
    void sendToAgent({
      agentName: targetAgent,
      prompt: content,
      config: resolvedConfig.agents[targetAgent],
      createAdapter,
      onMessage: (message) => {
        setMessages((current) => [...current, createTuiMessage(message.sender, message.content)]);
      },
      onError: (message) => {
        setError(message);
        setMessages((current) => [...current, createTuiMessage("system", message)]);
        setAgentStatus(setAgents, targetAgent, "error", message);
      },
      onComplete: () => {
        setBusy(false);
      },
      onSuccess: () => {
        setAgentStatus(setAgents, targetAgent, "idle");
      },
    });
  };

  useInput((rawInput, key) => {
    setError(null);
    if (key.ctrl && rawInput === "c") {
      exit();
      return;
    }
    if (key.escape) {
      exit();
      return;
    }
    if (busy) {
      return;
    }
    if (key.return) {
      const content = input.trim();
      if (content.length === 0) {
        setError("Input is empty.");
        return;
      }
      submit(content);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }
    if (rawInput.length > 0) {
      setInput((current) => `${current}${rawInput}`);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
      <StatusLine mode={mode} sessionId={sessionId} agents={agents} error={error} />
      <MessageList messages={messages} agents={agents} maxMessages={maxMessages} />
      <InputBox value={input} focused={!busy} disabled={busy} />
    </Box>
  );
};

type SendToAgentInput = {
  agentName: AgentName;
  prompt: string;
  config: AgentConfig;
  createAdapter: TuiAdapterFactory;
  onMessage(message: { sender: AgentName; content: string }): void;
  onError(message: string): void;
  onSuccess(): void;
  onComplete(): void;
};

const sendToAgent = async (input: SendToAgentInput): Promise<void> => {
  let adapter: AgentAdapter | null = null;
  try {
    adapter = input.createAdapter(input.agentName, input.config);
    await adapter.start();
    await adapter.send(input.prompt);
    const result = await adapter.read();
    input.onMessage({ sender: input.agentName, content: result.message.content });
    if (!result.completed) {
      throw new Error(`agent "${input.agentName}" の応答がタイムアウトしました。`);
    }
    input.onSuccess();
  } catch (e) {
    input.onError(e instanceof Error ? e.message : String(e));
  } finally {
    try {
      await adapter?.stop();
    } finally {
      input.onComplete();
    }
  }
};

const defaultCreateAdapter: TuiAdapterFactory = (name, config) => {
  switch (name) {
    case "codex":
      return new CodexAdapter(config);
    case "gemini":
      return new GeminiAdapter(config);
    case "copilot":
    case "cursor":
      throw new Error(`agent "${name}" は TUI ではまだ利用できません。対応: codex, gemini`);
  }
};

let nextLocalMessageId = 0;

const createTuiMessage = (sender: TuiMessage["sender"], content: string): TuiMessage => ({
  id: `local-${Date.now()}-${nextLocalMessageId++}`,
  sender,
  content,
  createdAt: new Date().toISOString(),
});

const setAgentStatus = (
  setAgents: React.Dispatch<React.SetStateAction<TuiAgentState[]>>,
  name: AgentName,
  status: TuiAgentState["status"],
  detail?: string,
): void => {
  setAgents((current) =>
    current.map((agent) => {
      if (agent.name !== name) {
        return agent;
      }
      if (detail === undefined) {
        const { detail: _detail, ...rest } = agent;
        return { ...rest, status };
      }
      return { ...agent, status, detail };
    }),
  );
};

const defaultAgentStates = (config: CliviumConfig): TuiAgentState[] => {
  return [
    {
      name: "codex",
      status: "idle",
      color: config.agents.codex.color,
    },
    {
      name: "gemini",
      status: "idle",
      color: config.agents.gemini.color,
    },
  ];
};
