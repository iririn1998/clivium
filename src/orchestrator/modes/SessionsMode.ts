/**
 * @file 保存済みセッションの一覧表示と再表示。
 * @module orchestrator/modes/SessionsMode
 */

import { SessionStore } from "../../store/SessionStore.js";
import type { StoredSession, StoredSessionWithMessages } from "../../store/SessionStore.js";

type OutputWriter = {
  write(chunk: string): unknown;
};

export type SessionsModeStore = {
  listSessions(limit?: number): StoredSession[];
  getSession(sessionId: string): StoredSessionWithMessages | null;
  close?(): void;
};

export type SessionsListOptions = {
  limit?: number;
  stdout?: OutputWriter;
  store?: SessionsModeStore;
};

export type ReplayOptions = {
  sessionId: string;
  stdout?: OutputWriter;
  store?: SessionsModeStore;
};

export class SessionsModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionsModeError";
  }
}

export class SessionsMode {
  list(options: SessionsListOptions = {}): StoredSession[] {
    const { store, shouldCloseStore } = createStore(options.store);
    try {
      const sessions = store.listSessions(options.limit ?? 50);
      (options.stdout ?? process.stdout).write(formatSessions(sessions));
      return sessions;
    } finally {
      if (shouldCloseStore) {
        store.close?.();
      }
    }
  }

  replay(options: ReplayOptions): StoredSessionWithMessages {
    const sessionId = options.sessionId.trim();
    if (sessionId.length === 0) {
      throw new SessionsModeError("session id を指定してください。");
    }

    const { store, shouldCloseStore } = createStore(options.store);
    try {
      const session = store.getSession(sessionId);
      if (session === null) {
        throw new SessionsModeError(`session が見つかりません: ${sessionId}`);
      }
      (options.stdout ?? process.stdout).write(formatReplay(session));
      return session;
    } finally {
      if (shouldCloseStore) {
        store.close?.();
      }
    }
  }
}

const createStore = (
  provided: SessionsModeStore | undefined,
): { store: SessionsModeStore; shouldCloseStore: boolean } => {
  if (provided !== undefined) {
    return { store: provided, shouldCloseStore: false };
  }
  return { store: new SessionStore(), shouldCloseStore: true };
};

export const formatSessions = (sessions: StoredSession[]): string => {
  if (sessions.length === 0) {
    return "保存済みセッションはありません。\n";
  }

  const rows = [
    ["session id", "mode", "created_at", "updated_at", "workspace_path"],
    ...sessions.map((session) => [
      session.id,
      session.mode,
      session.createdAt,
      session.updatedAt,
      session.workspacePath,
    ]),
  ];
  const widths = rows[0]!.map((_cell, i) => Math.max(...rows.map((row) => row[i]!.length)));

  return `${rows
    .map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd())
    .join("\n")}\n`;
};

export const formatReplay = (session: StoredSessionWithMessages): string => {
  const lines = [
    `session: ${session.id}`,
    `mode: ${session.mode}`,
    `created_at: ${session.createdAt}`,
    `updated_at: ${session.updatedAt}`,
    `workspace_path: ${session.workspacePath}`,
    "",
  ];

  if (session.messages.length === 0) {
    lines.push("メッセージはありません。");
    return `${lines.join("\n")}\n`;
  }

  for (const message of session.messages) {
    const recipient = message.recipient === null ? "" : ` -> ${message.recipient}`;
    lines.push(`[${message.createdAt}] ${message.sender}${recipient}`);
    lines.push(message.content);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
};
