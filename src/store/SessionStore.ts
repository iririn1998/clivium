/**
 * @file Clivium の会話セッションをSQLiteへ保存・取得するStore。
 * @module store/SessionStore
 */

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { AgentName } from "../config/agents.js";
import type { SessionMode } from "../types/Session.js";
import { applyMigrations } from "./migrations.js";

export type StoredSession = {
  id: string;
  mode: SessionMode;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
};

export type StoredMessage = {
  id: string;
  sessionId: string;
  sender: string;
  recipient: string | null;
  content: string;
  createdAt: string;
};

export type StoredSessionWithMessages = StoredSession & {
  messages: StoredMessage[];
};

export type CreateStoredSessionInput = {
  id?: string;
  mode: SessionMode;
  workspacePath: string;
};

export type AddStoredMessageInput = {
  id?: string;
  sessionId: string;
  sender: "user" | "system" | AgentName;
  recipient?: AgentName | null;
  content: string;
  createdAt?: string;
};

export type SessionStoreOptions = {
  path?: string;
  now?: () => Date;
  randomId?: () => string;
};

type SessionRow = {
  id: string;
  mode: SessionMode;
  created_at: string;
  updated_at: string;
  workspace_path: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  sender: string;
  recipient: string | null;
  content: string;
  created_at: string;
};

export const CLIVIUM_DB_PATH_ENV = "CLIVIUM_DB_PATH";

export const resolveSessionDbPath = (
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string => {
  const configured = env[CLIVIUM_DB_PATH_ENV]?.trim();
  if (configured && configured.length > 0) {
    return resolve(cwd, configured);
  }
  return join(cwd, ".clivium", "sessions.sqlite");
};

export const generateSessionId = (
  now = new Date(),
  randomId: () => string = randomUUID,
): string => {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${randomId().replace(/-/g, "").slice(0, 8)}`;
};

export class SessionStore {
  readonly path: string;
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly randomId: () => string;

  constructor(options: SessionStoreOptions = {}) {
    this.path = options.path ?? resolveSessionDbPath();
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;

    if (this.path !== ":memory:") {
      mkdirSync(dirname(this.path), { recursive: true });
    }

    this.db = new DatabaseSync(this.path);
    applyMigrations(this.db);
  }

  createSession(input: CreateStoredSessionInput): StoredSession {
    const createdAt = this.now().toISOString();
    const session: StoredSession = {
      id: input.id ?? generateSessionId(new Date(createdAt), this.randomId),
      mode: input.mode,
      createdAt,
      updatedAt: createdAt,
      workspacePath: input.workspacePath,
    };

    this.db
      .prepare(
        `
        INSERT INTO sessions (id, mode, created_at, updated_at, workspace_path)
        VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        session.id,
        session.mode,
        session.createdAt,
        session.updatedAt,
        session.workspacePath,
      );

    return session;
  }

  addMessage(input: AddStoredMessageInput): StoredMessage {
    const message: StoredMessage = {
      id: input.id ?? `msg_${this.randomId()}`,
      sessionId: input.sessionId,
      sender: input.sender,
      recipient: input.recipient ?? null,
      content: input.content,
      createdAt: input.createdAt ?? this.now().toISOString(),
    };

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `
          INSERT INTO messages (id, session_id, sender, recipient, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          message.id,
          message.sessionId,
          message.sender,
          message.recipient,
          message.content,
          message.createdAt,
        );
      this.db
        .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(message.createdAt, message.sessionId);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    return message;
  }

  listSessions(limit = 50): StoredSession[] {
    const rows = this.db
      .prepare(
        `
        SELECT id, mode, created_at, updated_at, workspace_path
        FROM sessions
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
        `,
      )
      .all(limit) as SessionRow[];

    return rows.map(mapSessionRow);
  }

  getSession(sessionId: string): StoredSessionWithMessages | null {
    const row = this.db
      .prepare(
        `
        SELECT id, mode, created_at, updated_at, workspace_path
        FROM sessions
        WHERE id = ?
        `,
      )
      .get(sessionId) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    const messages = this.db
      .prepare(
        `
        SELECT id, session_id, sender, recipient, content, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at ASC, rowid ASC
        `,
      )
      .all(sessionId) as MessageRow[];

    return {
      ...mapSessionRow(row),
      messages: messages.map(mapMessageRow),
    };
  }

  close(): void {
    this.db.close();
  }
}

const mapSessionRow = (row: SessionRow): StoredSession => ({
  id: row.id,
  mode: row.mode,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  workspacePath: row.workspace_path,
});

const mapMessageRow = (row: MessageRow): StoredMessage => ({
  id: row.id,
  sessionId: row.session_id,
  sender: row.sender,
  recipient: row.recipient,
  content: row.content,
  createdAt: row.created_at,
});
