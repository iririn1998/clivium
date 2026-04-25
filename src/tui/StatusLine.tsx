/**
 * @file TUI のセッション/agent状態表示。
 * @module tui/StatusLine
 */

import { Box, Text } from "ink";
import type { TuiAgentState, TuiMode } from "./types.js";

export type StatusLineProps = {
  mode: TuiMode;
  sessionId?: string;
  agents: TuiAgentState[];
  error?: string | null;
};

export const StatusLine = ({
  mode,
  sessionId,
  agents,
  error = null,
}: StatusLineProps): React.JSX.Element => {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={error ? "red" : "gray"}
      paddingX={1}
    >
      <Box columnGap={1} flexWrap="wrap">
        <Text color="white">mode: {mode}</Text>
        {sessionId !== undefined && <Text color="gray">session: {sessionId}</Text>}
        {agents.map((agent) => (
          <Text key={agent.name} color={agent.status === "error" ? "red" : agent.color}>
            {agent.name}: {agent.status}
            {agent.detail !== undefined && ` (${agent.detail})`}
          </Text>
        ))}
      </Box>
      {error !== null && <Text color="red">{error}</Text>}
    </Box>
  );
};
