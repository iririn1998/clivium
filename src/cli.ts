/**
 * @file Clivium の CLI エントリ。
 * パーサは **commander**（サブコマンド・ヘルプ・慣用パターンに適合）。
 *
 * @module cli
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError, type OptionValues } from "commander";
import { printBanner } from "./banner.js";
import { isAgentName, type AgentName } from "./config/agents.js";
import { CliviumConfigError, loadCliviumConfig } from "./config/load.js";
import { ChatMode, ChatModeError } from "./orchestrator/modes/ChatMode.js";
import { DebateMode, DebateModeError } from "./orchestrator/modes/DebateMode.js";
import { RunMode, RunModeError } from "./orchestrator/modes/RunMode.js";
import { SessionsMode, SessionsModeError } from "./orchestrator/modes/SessionsMode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * ビルド成果物の隣にある `package.json` から `version` を読み取る。
 *
 * @returns セマンティックバージョン文字列（例: `0.1.0`）
 */
const getVersion = (): string => {
  const p = join(__dirname, "../package.json");
  return (JSON.parse(readFileSync(p, "utf-8")) as { version: string }).version;
};

/**
 * Commander の `optsWithGlobals()` をこの形にキャストして扱う。
 * 環境変数 `CLIVIUM_CONFIG` / `CLIVIUM_VERBOSE` は {@link applyPreActionContext} が更新する。
 */
type GlobalOpts = OptionValues & {
  config?: string;
  cwd?: string;
  noBanner?: boolean;
  verbose?: boolean;
};

type RunCommandOpts = GlobalOpts & {
  agent?: string;
};

type ChatCommandOpts = GlobalOpts & {
  agents?: string;
};

type DebateCommandOpts = GlobalOpts & {
  agents?: string;
  rounds?: string;
  maxChars?: string;
  timeoutMs?: string;
};

type TuiCommandOpts = GlobalOpts & {
  agent?: string;
};

const startTui = async (agent: string | undefined): Promise<void> => {
  const targetAgent = resolveTuiAgent(agent);
  const [{ render }, { createElement }, { App }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./tui/App.js"),
  ]);
  render(createElement(App, { targetAgent }));
};

const resolveTuiAgent = (agent: string | undefined): AgentName => {
  const name = agent?.trim() || "gemini";
  if (!isAgentName(name) || (name !== "codex" && name !== "gemini")) {
    throw new Error(`agent "${name}" は TUI ではまだ利用できません。対応: codex, gemini`);
  }
  return name;
};

/**
 * ルートおよび（必要なら将来）サブコマンドに同一のグローバル風オプションを付与する。
 *
 * @param c - 対象の `Command` インスタンス
 */
const addCommonOptions = (c: Command): void => {
  c.option("-c, --config <path>", "設定JSONのパス（以降の起動で参照する予定）")
    .option("--cwd <path>", "作業ディレクトリ（このプロセスのカレントを切り替える）")
    .option("--no-banner", "起動バナーを表示しない", false)
    .option("-v, --verbose", "冗長なログ", false);
};

/**
 * 起動バナーを出すかどうか。`parse` の前に評価する（成功・失敗に依らず一度きり）。
 *
 * - `--no-banner` / `-h` / `--help` / `-V` / `--version` が含まれる場合は出さない。
 * - 引数なし（トップの用法表示）は出す（タスク T1 の「通常起動」扱い）。
 * - 第1引数が登録サブコマンド名でない（タイプミス等）ときは出さない。
 * - 第1引数が `-` で始まるときは、グローバル用オプション候補とみなし出す。
 *
 * @param program - 登録済み `Command`（`help` 以外のサブコマンド名を集める）
 * @param dotted - `process.argv` から `node` とスクリプト名を除いた配列
 * @returns バナーを表示してよいとき `true`
 */
const shouldPrintStartupBanner = (program: Command, dotted: string[]): boolean => {
  if (dotted.includes("--no-banner")) return false;
  if (dotted.includes("-h") || dotted.includes("--help")) return false;
  if (dotted.includes("-V") || dotted.includes("--version")) {
    return false;
  }
  if (dotted.length === 0) return true;

  const head = dotted[0]!;
  if (head.startsWith("-")) return true;

  const subNames = new Set(program.commands.map((c) => c.name()).filter((n) => n !== "help"));
  return subNames.has(head);
};

/**
 * 各サブコマンドの action 直前（`preAction`）に、環境とカレントディレクトリを揃える。
 *
 * - `config` → `process.env.CLIVIUM_CONFIG` を更新し、{@link loadCliviumConfig} で反映
 * - `verbose` → `CLIVIUM_VERBOSE=1` が付く
 * - `cwd` → 解決・存在・ディレクトリ検証のうえ `process.chdir`（設定のファイルパス解決のあと）
 *
 * いずれかの検証失敗時はメッセージを出して `process.exit(1)` する。
 *
 * @param opts - 解釈済みの共通オプション
 */
const applyPreActionContext = (opts: GlobalOpts): void => {
  if (opts.config) {
    process.env.CLIVIUM_CONFIG = opts.config;
  } else {
    delete process.env.CLIVIUM_CONFIG;
  }

  if (opts.verbose) {
    process.env.CLIVIUM_VERBOSE = "1";
  } else {
    delete process.env.CLIVIUM_VERBOSE;
  }

  try {
    loadCliviumConfig({ path: opts.config });
  } catch (e) {
    if (e instanceof CliviumConfigError) {
      console.error(`エラー: 設定の読み込みに失敗しました。\n${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  if (opts.cwd) {
    const path = resolve(opts.cwd);
    try {
      const st = statSync(path);
      if (!st.isDirectory()) {
        console.error(`エラー: --cwd のパスはディレクトリではありません: ${path}`);
        process.exit(1);
      }
    } catch (e) {
      console.error(
        `エラー: 作業ディレクトリを開けません: ${path} — ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      process.exit(1);
    }
    try {
      process.chdir(path);
    } catch (e) {
      console.error(
        `エラー: 作業ディレクトリに移動できません: ${path} — ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      process.exit(1);
    }
  }
};

/**
 * `clivium` ルートコマンドと、T1 時点の全サブコマンド定義を組み立てる。
 *
 * @returns パース用にそのまま `parse` に渡せる `Command`
 */
const buildProgram = (): Command => {
  const program = new Command();

  program
    .name("clivium")
    .description("複数のAI CLIを束ねるターミナル用フロント")
    .showHelpAfterError(true);

  addCommonOptions(program);

  program.hook("preAction", (_p, actionCommand) => {
    const opts = actionCommand.optsWithGlobals() as GlobalOpts;
    applyPreActionContext(opts);
  });

  program
    .command("run [prompt...]")
    .description("単体エージェントへ一回質問する")
    .option("-a, --agent <name>", "起動するagent名（codex / gemini）")
    .action(async (prompt: string[], opts: RunCommandOpts) => {
      try {
        await new RunMode().execute({
          agent: opts.agent,
          prompt: prompt.join(" "),
        });
      } catch (e) {
        if (e instanceof RunModeError) {
          console.error(`エラー: ${e.message}`);
          process.exit(1);
        }
        throw e;
      }
    });

  program
    .command("chat [prompt...]")
    .description("同じ入力を複数エージェントに渡し、回答を並べる")
    .option("--agents <names>", "起動するagent名のカンマ区切り（例: codex,gemini）")
    .action(async (prompt: string[], opts: ChatCommandOpts) => {
      try {
        await new ChatMode().execute({
          agents: opts.agents,
          prompt: prompt.join(" "),
        });
      } catch (e) {
        if (e instanceof ChatModeError) {
          console.error(`エラー: ${e.message}`);
          process.exit(1);
        }
        throw e;
      }
    });

  program
    .command("debate [theme...]")
    .description("2エージェントを指定ラウンドで交互に応答させる")
    .option("--agents <names>", "起動するagent名のカンマ区切り（例: codex,gemini）")
    .option("--rounds <count>", "各agentの応答ラウンド数", "3")
    .option("--max-chars <count>", "次agentへ渡す発言の最大文字数", "12000")
    .option("--timeout-ms <ms>", "各応答のタイムアウト（ミリ秒）")
    .action(async (theme: string[], opts: DebateCommandOpts) => {
      try {
        await new DebateMode().execute({
          agents: opts.agents,
          rounds: opts.rounds,
          maxChars: opts.maxChars,
          timeoutMs: opts.timeoutMs,
          theme: theme.join(" "),
        });
      } catch (e) {
        if (e instanceof DebateModeError) {
          console.error(`エラー: ${e.message}`);
          process.exit(1);
        }
        throw e;
      }
    });

  program
    .command("sessions")
    .description("保存したセッションの一覧")
    .action(() => {
      new SessionsMode().list();
    });

  program
    .command("tui")
    .description("ログ、入力欄、agent状態を同時に確認できる最小TUIを起動する")
    .option("-a, --agent <name>", "会話するagent名（codex / gemini）", "gemini")
    .action(async (opts: TuiCommandOpts) => {
      try {
        await startTui(opts.agent);
      } catch (e) {
        console.error(`エラー: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  program
    .command("replay <sessionId>")
    .description("保存したセッションの再表示")
    .action((sessionId: string) => {
      try {
        new SessionsMode().replay({ sessionId });
      } catch (e) {
        if (e instanceof SessionsModeError) {
          console.error(`エラー: ${e.message}`);
          process.exit(1);
        }
        throw e;
      }
    });

  return program;
};

/**
 * エントリから呼ばれる CLI 本処理。`argv` は通常 `process.argv` をそのまま渡す。
 *
 * 空配列（サブコマンドなし）のときは、タスク上の挙動としてバナー（条件付き）のあと
 * トップのヘルプを表示して終了する。それ以外は Commander に委譲し、
 * `--version` や help 系は `exitCode === 0` の {@link CommanderError} で戻る。
 * 非 0 の {@link CommanderError} は、メッセージは Commander が stderr に既に出すため
 * ここでは重複表示せず `process.exit` のみ行う。
 *
 * @param argv - 少なくとも `[node, scriptPath, ...userArgs]` 形式。`{ from: 'node' }` で parse する。
 */
export const runCli = async (argv: string[]): Promise<void> => {
  const program = buildProgram();
  program.version(getVersion());
  const dotted = argv.slice(2);

  if (dotted.length === 0) {
    if (shouldPrintStartupBanner(program, dotted)) printBanner();
    program.outputHelp();
    return;
  }

  if (shouldPrintStartupBanner(program, dotted)) printBanner();

  program.exitOverride();
  program.configureOutput({
    writeErr: (s) => process.stderr.write(s),
    writeOut: (s) => process.stdout.write(s),
  });

  try {
    await program.parseAsync(argv, { from: "node" });
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.exitCode === 0) {
        return;
      }
      // Commander が stderr へ既に出している。ここでは重複表示しない。
      process.exit(e.exitCode);
    }
    throw e;
  }
};
