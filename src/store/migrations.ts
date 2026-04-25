/**
 * @file SQLite セッションDBのスキーマ管理。
 * @module store/migrations
 */

import type { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 1;

const migrationV1 = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  workspace_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
  ON sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
  ON messages(session_id, created_at);
`;

export class StoreMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreMigrationError";
  }
}

export const applyMigrations = (db: DatabaseSync): void => {
  db.exec("PRAGMA foreign_keys = ON");

  const currentVersion = readSchemaVersion(db);
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new StoreMigrationError(
      `DBスキーマのバージョンが新しすぎます: ${currentVersion}`,
    );
  }

  if (currentVersion < 1) {
    db.exec(migrationV1);
    db.exec("PRAGMA user_version = 1");
  }
};

const readSchemaVersion = (db: DatabaseSync): number => {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0);
};
