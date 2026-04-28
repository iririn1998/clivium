/**
 * @file Codex CLI 用 Adapter。
 * @module agents/CodexAdapter
 */

import type { AgentConfig } from "../config/agents.js";
import {
  normalizePromptArgumentOutput,
  PromptArgumentAgentAdapter,
  type PromptArgumentAgentAdapterDeps,
} from "./PromptArgumentAgentAdapter.js";

export type CodexAdapterDeps = PromptArgumentAgentAdapterDeps;

type CodexJsonEvent = {
  type?: unknown;
  item?: {
    type?: unknown;
    text?: unknown;
  };
};

const JSON_FLAG = "--json";
const END_OF_OPTIONS = "--";

export const buildCodexPromptArgs = (args: string[], prompt: string): string[] => {
  const withJson = args.includes(JSON_FLAG) ? [...args] : insertBeforeEndOfOptions(args, JSON_FLAG);
  if (withJson.includes(END_OF_OPTIONS)) {
    return [...withJson, prompt];
  }
  return [...withJson, END_OF_OPTIONS, prompt];
};

export const normalizeCodexOutput = (output: string): string => {
  const text = normalizePromptArgumentOutput(output);
  const agentMessages: string[] = [];
  const fallbackLines: string[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed === "Reading additional input from stdin...") {
      continue;
    }

    if (trimmed.startsWith("{")) {
      try {
        const event = JSON.parse(trimmed) as CodexJsonEvent;
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message" &&
          typeof event.item.text === "string"
        ) {
          agentMessages.push(event.item.text);
        }
        continue;
      } catch {
        // JSONL でない通常出力として扱う。
      }
    }

    fallbackLines.push(line);
  }

  const lastAgentMessage = agentMessages.at(-1);
  if (lastAgentMessage !== undefined) {
    return lastAgentMessage.trim();
  }

  return fallbackLines.join("\n").trim();
};

export class CodexAdapter extends PromptArgumentAgentAdapter {
  constructor(config: AgentConfig, deps: CodexAdapterDeps = {}) {
    super("codex", config, deps, buildCodexPromptArgs, normalizeCodexOutput);
  }
}

const insertBeforeEndOfOptions = (args: string[], value: string): string[] => {
  const endIndex = args.indexOf(END_OF_OPTIONS);
  if (endIndex === -1) {
    return [...args, value];
  }
  return [...args.slice(0, endIndex), value, ...args.slice(endIndex)];
};
