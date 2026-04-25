/**
 * @file Clivium の最小 Ink TUI。
 * @module tui/App
 */

import { useMemo, useState } from "react";
import { Box, useApp, useInput } from "ink";
import { getDefaultCliviumConfig } from "../config/defaults.js";
import { InputBox } from "./InputBox.js";
import { MessageList, DEFAULT_VISIBLE_MESSAGES } from "./MessageList.js";
import { StatusLine } from "./StatusLine.js";
import type { TuiAgentState, TuiMessage, TuiMode } from "./types.js";

export type AppProps = {
  mode?: TuiMode;
  sessionId?: string;
  initialMessages?: TuiMessage[];
  agentStates?: TuiAgentState[];
  maxMessages?: number;
};

export const App = ({
  mode = "tui",
  sessionId,
  initialMessages = [],
  agentStates,
  maxMessages = DEFAULT_VISIBLE_MESSAGES,
}: AppProps): React.JSX.Element => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<TuiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const agents = useMemo(() => agentStates ?? defaultAgentStates(), [agentStates]);

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
    if (key.return) {
      const content = input.trim();
      if (content.length === 0) {
        setError("Input is empty.");
        return;
      }
      setMessages((current) => [
        ...current,
        {
          id: `local-${Date.now()}-${current.length}`,
          sender: "user",
          content,
          createdAt: new Date().toISOString(),
        },
      ]);
      setInput("");
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
      <InputBox value={input} focused />
    </Box>
  );
};

const defaultAgentStates = (): TuiAgentState[] => {
  const config = getDefaultCliviumConfig();
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
