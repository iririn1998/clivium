/**
 * @file TUI の入力欄表示。
 * @module tui/InputBox
 */

import { Box, Text } from "ink";

export type InputBoxProps = {
  value: string;
  focused?: boolean;
  disabled?: boolean;
};

export const InputBox = ({
  value,
  focused = true,
  disabled = false,
}: InputBoxProps): React.JSX.Element => {
  const cursor = focused && !disabled ? "_" : "";
  const color = disabled ? "gray" : "white";

  return (
    <Box borderStyle="single" borderColor={disabled ? "gray" : "cyan"} paddingX={1}>
      <Text color={disabled ? "gray" : "cyan"}>{"> "}</Text>
      <Text color={color} wrap="truncate-end">
        {value}
        {cursor}
      </Text>
    </Box>
  );
};
