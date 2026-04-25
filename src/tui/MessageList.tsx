/**
 * @file TUI の会話ログ表示。
 * @module tui/MessageList
 */

import { Box, Text } from "ink";
import type { TuiAgentState, TuiMessage } from "./types.js";

export type MessageListProps = {
  messages: TuiMessage[];
  agents: TuiAgentState[];
  maxMessages?: number;
};

export const DEFAULT_VISIBLE_MESSAGES = 100;

export const selectVisibleMessages = (
  messages: readonly TuiMessage[],
  maxMessages = DEFAULT_VISIBLE_MESSAGES,
): TuiMessage[] => {
  if (maxMessages <= 0) {
    return [];
  }
  return messages.slice(Math.max(0, messages.length - maxMessages));
};

export const MessageList = ({
  messages,
  agents,
  maxMessages = DEFAULT_VISIBLE_MESSAGES,
}: MessageListProps): React.JSX.Element => {
  const visible = selectVisibleMessages(messages, maxMessages);
  const hiddenCount = Math.max(0, messages.length - visible.length);

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={5}>
      {hiddenCount > 0 && (
        <Text color="gray" wrap="truncate-end">
          ... {hiddenCount} earlier messages hidden
        </Text>
      )}
      {visible.length === 0 ? (
        <Text color="gray">No messages yet.</Text>
      ) : (
        visible.map((message) => (
          <Box key={message.id} flexDirection="column" marginBottom={1}>
            <Text color={resolveSenderColor(message.sender, agents)} bold>
              [{message.sender}]
            </Text>
            <Text wrap="wrap">{message.content}</Text>
          </Box>
        ))
      )}
    </Box>
  );
};

const resolveSenderColor = (sender: TuiMessage["sender"], agents: TuiAgentState[]): string => {
  if (sender === "user") {
    return "cyan";
  }
  if (sender === "system") {
    return "gray";
  }
  return agents.find((agent) => agent.name === sender)?.color ?? "white";
};
