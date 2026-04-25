/**
 * 起動バナー（@see Plan.md 起動バナー案）
 * BANNER_LINES の先頭・末尾の空行を含めてそのまま表示する
 */
export const BANNER_LINES = [
  "",
  "   ________      _       _",
  "  / ____/ /___  (_)   __(_)_  ______ ___",
  ' / /   / / __ \\/ / | / / / / / / __ `__ \\',
  "/ /___/ / /_/ / /| |/ / / /_/ / / / / / /",
  "\\____/_/\\____/_/ |___/_/\\__,_/_/ /_/ /_/",
  "",
  "CLI agents, gathered.",
  "",
] as const;

export function printBanner(): void {
  console.log(BANNER_LINES.join("\n"));
}
