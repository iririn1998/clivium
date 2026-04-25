#!/usr/bin/env node
/**
 * @file プロセス入口。`package.json` の `bin` が指す 1 ファイル。
 */

import { runCli } from "./cli.js";

await runCli(process.argv);
