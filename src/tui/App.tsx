/**
 * @file Clivium の最小 Ink TUI。
 * @module tui/App
 */

import { useMemo, useState } from "react";
import { Box, useApp, useInput } from "ink";
import type { AgentConfig, AgentName } from "../config/agents.js";
import { getDefaultCliviumConfig, type CliviumConfig } from "../config/defaults.js";
import type { AgentAdapter, AgentReadResult } from "../agents/AgentAdapter.js";
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
  handoffAgent?: AgentName | null;
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
  handoffAgent = "codex",
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
  const agentSequence = resolveTuiAgentSequence(targetAgent, handoffAgent);

  const submit = (content: string): void => {
    const userMessage = createTuiMessage("user", content);
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setBusy(true);
    void sendThroughAgents({
      agentNames: agentSequence,
      initialPrompt: content,
      config: resolvedConfig,
      createAdapter,
      onAgentStart: (agentName) => {
        setAgentStatus(setAgents, agentName, "running");
      },
      onMessage: (message) => {
        setMessages((current) => [...current, createTuiMessage(message.sender, message.content)]);
      },
      onAgentError: (agentName, message) => {
        setError(message);
        setMessages((current) => [...current, createTuiMessage("system", message)]);
        setAgentStatus(setAgents, agentName, "error", message);
      },
      onAgentSuccess: (agentName) => {
        setAgentStatus(setAgents, agentName, "idle");
      },
      onComplete: () => {
        setBusy(false);
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
};

type SendThroughAgentsInput = {
  agentNames: AgentName[];
  initialPrompt: string;
  config: CliviumConfig;
  createAdapter: TuiAdapterFactory;
  onAgentStart(agentName: AgentName): void;
  onMessage(message: { sender: AgentName; content: string }): void;
  onAgentError(agentName: AgentName, message: string): void;
  onAgentSuccess(agentName: AgentName): void;
  onComplete(): void;
};

export const resolveTuiAgentSequence = (
  targetAgent: AgentName,
  handoffAgent: AgentName | null,
): AgentName[] => {
  if (handoffAgent === null || handoffAgent === targetAgent) {
    return [targetAgent];
  }
  return [targetAgent, handoffAgent];
};

export const sendThroughAgents = async (input: SendThroughAgentsInput): Promise<void> => {
  let nextPrompt = input.initialPrompt;
  let currentAgent: AgentName | null = null;

  try {
    for (const agentName of input.agentNames) {
      currentAgent = agentName;
      input.onAgentStart(agentName);
      const result = await sendToAgent({
        agentName,
        prompt: nextPrompt,
        config: input.config.agents[agentName],
        createAdapter: input.createAdapter,
      });
      input.onMessage({ sender: agentName, content: result.message.content });
      if (!result.completed) {
        throw new Error(`agent "${agentName}" の応答がタイムアウトしました。`);
      }
      input.onAgentSuccess(agentName);
      nextPrompt = result.message.content;
    }
  } catch (e) {
    input.onAgentError(
      currentAgent ?? input.agentNames[0] ?? "codex",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    input.onComplete();
  }
};

const sendToAgent = async (input: SendToAgentInput): Promise<AgentReadResult> => {
  let adapter: AgentAdapter | null = null;
  try {
    adapter = input.createAdapter(input.agentName, input.config);
    await adapter.start();
    await adapter.send(input.prompt);
    return await adapter.read();
  } finally {
    await adapter?.stop();
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
