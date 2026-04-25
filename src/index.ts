#!/usr/bin/env node

/** @see Plan.md 起動バナー案 */
function printBanner(): void {
  const line3 = " / /   / / __ \\/ / | / / / / / / __ `__ \\";

  const lines = [
    "",
    "   ________      _       _",
    "  / ____/ /___  (_)   __(_)_  ______ ___",
    line3,
    "/ /___/ / /_/ / /| |/ / / /_/ / / / / / /",
    "\\____/_/\\____/_/ |___/_/\\__,_/_/ /_/ /_/",
    "",
    "CLI agents, gathered.",
    "",
  ];
  console.log(lines.join("\n"));
}

printBanner();
