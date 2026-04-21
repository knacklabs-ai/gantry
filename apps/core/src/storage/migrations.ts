export const SQLITE_MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS storage_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    name TEXT,
    last_message_time TEXT,
    channel TEXT,
    is_group INTEGER NOT NULL DEFAULT 0
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    sender TEXT,
    sender_name TEXT,
    content TEXT,
    timestamp TEXT,
    PRIMARY KEY (id, chat_jid)
  );
  `,
];

export const POSTGRES_MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS storage_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    name TEXT,
    last_message_time TEXT,
    channel TEXT,
    is_group BOOLEAN NOT NULL DEFAULT FALSE
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    sender TEXT,
    sender_name TEXT,
    content TEXT,
    timestamp TEXT,
    PRIMARY KEY (id, chat_jid)
  );
  `,
];
