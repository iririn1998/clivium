/**
 * @file 設定JSONの読み取り、検証、実行時保持。
 * @module config/load
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILTIN_AGENT_NAMES, isAgentName, type AgentConfig, type AgentName } from "./agents.js";
import { getDefaultCliviumConfig, mergeAgentsIntoConfig, type CliviumConfig } from "./defaults.js";

let activeConfig: CliviumConfig = getDefaultCliviumConfig();

/**
 * 現在のプロセスに適用された {@link CliviumConfig}（T2 以降のモジュールが参照する）。
 */
export const getCliviumConfig = (): CliviumConfig => activeConfig;

/**
 * テスト用。本番の CLI は {@link loadCliviumConfig} を使う。
 */
export const setCliviumConfig = (c: CliviumConfig): void => {
  activeConfig = c;
};

/**
 * デフォルトに戻す（`--config` なしの起動、または同値クリア用）。
 */
export const resetCliviumConfig = (): void => {
  activeConfig = getDefaultCliviumConfig();
};

export class CliviumConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliviumConfigError";
  }
}

const ctx = (path: string, detail: string): string =>
  `設定ファイル: ${path}\n${detail}`;

const mustRecord = (filePath: string, v: unknown, label: string): Record<string, unknown> => {
  if (v === null) {
    throw new CliviumConfigError(
      ctx(filePath, `「${label}」は null にはできません。`)
    );
  }
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new CliviumConfigError(
      ctx(
        filePath,
        `「${label}」はオブジェクトである必要があります。受け取った型: ${typeof v}。`
      )
    );
  }
  return v as Record<string, unknown>;
};

const mustString = (filePath: string, propPath: string, v: unknown): string => {
  if (typeof v !== "string" || v.length === 0) {
    throw new CliviumConfigError(
      ctx(
        filePath,
        `「${propPath}」は空でない文字列である必要があります。受け取り: ${
          v === null ? "null" : typeof v
        }。`
      )
    );
  }
  return v;
};

const mustStringList = (filePath: string, propPath: string, v: unknown): string[] => {
  if (!Array.isArray(v)) {
    throw new CliviumConfigError(
      ctx(
        filePath,
        `「${propPath}」は文字列の配列である必要があります。受け取り: ${typeof v}。`
      )
    );
  }
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string") {
      throw new CliviumConfigError(
        ctx(
          filePath,
          `「${propPath}[${i}]」は文字列である必要があります。受け取り: ${typeof v[i]}。`
        )
      );
    }
  }
  return v as string[];
};

const mustCwd = (filePath: string, propPath: string, v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v === "string") return v;
  throw new CliviumConfigError(
    ctx(
      filePath,
      `「${propPath}」は null か文字列（ディレクトリパス）である必要があります。受け取り: ${typeof v}。`
    )
  );
};

const mustTimeoutMs = (filePath: string, propPath: string, v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) {
    throw new CliviumConfigError(
      ctx(
        filePath,
        `「${propPath}」は正の整数（ミリ秒）である必要があります。受け取り: ${
          typeof v === "number" ? v : String(v)
        }。`
      )
    );
  }
  return v;
};

const AGENT_KNOWN_KEYS = new Set([
  "command",
  "args",
  "cwd",
  "color",
  "timeoutMs",
]);

const parsePartialAgent = (
  filePath: string,
  agentName: string,
  raw: unknown
): Partial<AgentConfig> => {
  if (raw === null || raw === undefined) {
    return {};
  }
  const o = mustRecord(filePath, raw, `agents.${agentName}`);
  for (const k of Object.keys(o)) {
    if (!AGENT_KNOWN_KEYS.has(k)) {
      throw new CliviumConfigError(
        ctx(
          filePath,
          `未知のキー: agents.${agentName}.${k}。許可: ${[...AGENT_KNOWN_KEYS].join(
            ", "
          )}。`
        )
      );
    }
  }
  const out: Partial<AgentConfig> = {};
  if (o["command"] !== undefined) {
    out.command = mustString(filePath, `agents.${agentName}.command`, o["command"]);
  }
  if (o["args"] !== undefined) {
    out.args = mustStringList(filePath, `agents.${agentName}.args`, o["args"]);
  }
  if (o["cwd"] !== undefined) {
    out.cwd = mustCwd(filePath, `agents.${agentName}.cwd`, o["cwd"]);
  }
  if (o["color"] !== undefined) {
    out.color = mustString(filePath, `agents.${agentName}.color`, o["color"]);
  }
  if (o["timeoutMs"] !== undefined) {
    out.timeoutMs = mustTimeoutMs(
      filePath,
      `agents.${agentName}.timeoutMs`,
      o["timeoutMs"]
    );
  }
  return out;
};

const parseAgentsBlock = (
  filePath: string,
  data: unknown
): Partial<Record<AgentName, Partial<AgentConfig> | undefined>> | undefined => {
  if (data === undefined) {
    return undefined;
  }
  const o = mustRecord(filePath, data, "agents");
  const out: Partial<Record<AgentName, Partial<AgentConfig> | undefined>> = {};
  for (const key of Object.keys(o)) {
    if (!isAgentName(key)) {
      throw new CliviumConfigError(
        ctx(
          filePath,
          `agents の未知のキー: "${key}"。許可: ${BUILTIN_AGENT_NAMES.join(", ")}。`
        )
      );
    }
    out[key] = parsePartialAgent(filePath, key, o[key]);
  }
  return out;
};

/**
 * 任意のJSONルートを検証し、部分エージェント定義にする（ファイルパスはエラーメッセージ用）。
 */
export const parseCliviumConfigData = (
  filePath: string,
  data: unknown
): Partial<Record<AgentName, Partial<AgentConfig> | undefined>> | undefined => {
  if (data === null || data === undefined) {
    return undefined;
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new CliviumConfigError(
      ctx(
        filePath,
        `JSONルートはオブジェクトである必要があります。受け取り: ${typeof data}。`
      )
    );
  }
  const root = data as Record<string, unknown>;
  const allowed = new Set(["agents"]);
  for (const k of Object.keys(root)) {
    if (!allowed.has(k)) {
      throw new CliviumConfigError(
        ctx(
          filePath,
          `ルートの未知のキー: "${k}"。現時点で許可: ${[...allowed].join(", ")}。`
        )
      );
    }
  }
  if (!("agents" in root) || root["agents"] === undefined) {
    return undefined;
  }
  return parseAgentsBlock(filePath, root["agents"]);
};

/**
 * UTF-8 の JSON 設定ファイルを読み、デフォルトとマージした {@link CliviumConfig} を返す。
 */
export const readCliviumConfigFile = (configPath: string): CliviumConfig => {
  const pathAbs = resolve(configPath);
  let text: string;
  try {
    text = readFileSync(pathAbs, "utf-8");
  } catch (e) {
    throw new CliviumConfigError(
      ctx(
        pathAbs,
        `ファイルを開けません: ${e instanceof Error ? e.message : String(e)}`
      )
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (e) {
    throw new CliviumConfigError(
      ctx(
        pathAbs,
        `JSONとして解釈できません: ${
          e instanceof Error ? e.message : String(e)
        }`
      )
    );
  }
  const partial = parseCliviumConfigData(pathAbs, data);
  const def = getDefaultCliviumConfig();
  if (partial === undefined) {
    return def;
  }
  return mergeAgentsIntoConfig(def, partial);
};

/**
 * 環境変数 `CLIVIUM_CONFIG` または `opts.path` を解決し {@link activeConfig} を更新する。
 * `--config` なしのときは {@link resetCliviumConfig} と同じ挙動。
 */
export const loadCliviumConfig = (opts: { path?: string } = {}): void => {
  const p = opts.path ?? process.env.CLIVIUM_CONFIG;
  if (!p) {
    resetCliviumConfig();
    return;
  }
  const resolved = resolve(p);
  activeConfig = readCliviumConfigFile(resolved);
};
