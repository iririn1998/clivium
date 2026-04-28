# Clivium

複数のAI CLIエージェントをひとつのターミナルUIから扱うためのツールです。

操作はTUI上で行います。

## セットアップ

このプロジェクトでは、Node.js と pnpm のバージョン管理に [mise](https://mise.jdx.dev/) を使います。
必要なバージョンは `mise.toml` に定義されています。

miseをインストール済みの場合は、以下のコマンドで開発に必要なツールと依存パッケージをまとめて用意できます。

```bash
mise run setup
```

miseを使わない場合は、Node.js `24.15.0` 以上と pnpm `10.33.2` 以上を用意してから依存をインストールします。

```bash
pnpm install
```

## 起動

開発中はビルドした `dist/index.js` からTUIを起動します。

```bash
pnpm run build
pnpm start
```

## 起動オプション

TUI起動時に作業ディレクトリや設定ファイルを指定できます。

```bash
pnpm start --cwd /path/to/project
pnpm start --config clivium.config.json
pnpm start --no-banner --verbose
```

主なオプション:

```bash
--config <path>   設定JSONを読み込む
--cwd <path>      実行時の作業ディレクトリを切り替える
--no-banner       起動バナーを表示しない
--verbose         冗長ログ用の環境変数を有効化する
```

## 開発用コマンド

```bash
pnpm test
pnpm run build
pnpm run lint
pnpm run format:check
```
