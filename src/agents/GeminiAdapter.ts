/**
 * @file Gemini CLI 用 Adapter。
 * @module agents/GeminiAdapter
 */

import type { AgentConfig } from "../config/agents.js";
import {
  normalizePromptArgumentOutput,
  PromptArgumentAgentAdapter,
  type PromptArgumentAgentAdapterDeps,
} from "./PromptArgumentAgentAdapter.js";

export type GeminiAdapterDeps = PromptArgumentAgentAdapterDeps;

const PROMPT_FLAGS = new Set(["-p", "--prompt"]);
const OUTPUT_FORMAT_FLAGS = new Set(["-o", "--output-format"]);

type GeminiJsonOutput = {
  response?: unknown;
};

export const buildGeminiPromptArgs = (args: string[], prompt: string): string[] => {
  const withOutputFormat = ensureJsonOutputFormat(args);
  if (withOutputFormat.some((arg) => PROMPT_FLAGS.has(arg))) {
    return [...withOutputFormat, prompt];
  }
  return [...withOutputFormat, "-p", prompt];
};

export const normalizeGeminiOutput = (output: string): string => {
  const text = normalizePromptArgumentOutput(output);
  const jsonText = extractJsonObject(text);
  if (jsonText !== null) {
    try {
      const data = JSON.parse(jsonText) as GeminiJsonOutput;
      if (typeof data.response === "string") {
        return data.response.trim();
      }
    } catch {
      // テキスト出力へフォールバックする。
    }
  }

  return text
    .split("\n")
    .filter((line) => !line.startsWith("[ERROR] [IDEClient]"))
    .join("\n")
    .replace(/[⠙⠹⠸⠼]+/g, "")
    .trim();
};

export class GeminiAdapter extends PromptArgumentAgentAdapter {
  constructor(config: AgentConfig, deps: GeminiAdapterDeps = {}) {
    super("gemini", config, deps, buildGeminiPromptArgs, normalizeGeminiOutput);
  }
}

const hasOutputFormatArg = (args: string[]): boolean =>
  args.some((arg) => OUTPUT_FORMAT_FLAGS.has(arg) || arg.startsWith("--output-format="));

const ensureJsonOutputFormat = (args: string[]): string[] => {
  if (hasOutputFormatArg(args)) {
    return [...args];
  }
  const promptFlagIndex = args.findIndex((arg) => PROMPT_FLAGS.has(arg));
  if (promptFlagIndex === -1) {
    return [...args, "--output-format", "json"];
  }
  return [
    ...args.slice(0, promptFlagIndex),
    "--output-format",
    "json",
    ...args.slice(promptFlagIndex),
  ];
};

const extractJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
};
