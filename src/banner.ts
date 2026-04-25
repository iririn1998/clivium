/**
 * 起動時に `stdout` へ出す ASCII ロゴ＋タグライン。
 *
 * @see {@link printBanner}
 */
export const BANNER_LINES = [
  "",
  "   ________      _       _",
  "  / ____/ /___  (_)   __(_)_  ______ ___",
  " / /   / / __ \\/ / | / / / / / / __ `__ \\",
  "/ /___/ / /_/ / /| |/ / / /_/ / / / / / /",
  "\\____/_/\\____/_/ |___/_/\\__,_/_/ /_/ /_/",
  "",
  "CLI agents, gathered.",
  "",
] as const;

/**
 * {@link BANNER_LINES} を改行で連結して 1 回だけ `console.log` する。先頭・末尾の空行を保持する。
 */
export function printBanner(): void {
  console.log(BANNER_LINES.join("\n"));
}
