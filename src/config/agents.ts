/**
 * @file エージェント名と、各AI CLI 向けの {@link AgentConfig} 定義。
 * @module config/agents
 */

/**
 * タスク T2 時点で扱うビルトインエージェント識別子（設定JSONのキーと一致させる）。
 */
export const BUILTIN_AGENT_NAMES = ["codex", "gemini", "copilot", "cursor"] as const;
export type AgentName = (typeof BUILTIN_AGENT_NAMES)[number];

/**
 * 単一エージェントの起動・表示パラメータ。JSON 設定の `agents.<name>` と対応。
 */
export type AgentConfig = {
  /** プロセス起動に使う argv[0]（例: `npx`, 絶対パス） */
  command: string;
  /** `command` に続く引数（先頭のオプションからサブコマンドまで） */
  args: string[];
  /**
   * 子プロセスのカレント。`null` のときは呼び出し元プロセス（`--cwd` 適用後）を使う。
   */
  cwd: string | null;
  /** ターミナル表示用。HEX 推奨（例: `#3B82F6`） */
  color: string;
  /** 応答待ちの上限（ミリ秒）。正の整数。 */
  timeoutMs: number;
};

/**
 * ビルトイン名かどうかを実行時に検査する。
 */
export const isAgentName = (s: string): s is AgentName =>
  (BUILTIN_AGENT_NAMES as readonly string[]).includes(s);
