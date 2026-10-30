CREATE TABLE IF NOT EXISTS entries (
  id         TEXT PRIMARY KEY,           -- client-generated UUID, makes offline retries idempotent
  created_at TEXT NOT NULL,              -- ISO 8601, when the friction happened (client clock)
  device     TEXT NOT NULL,              -- 'laptop' | 'iphone'
  type       TEXT NOT NULL CHECK (type IN ('channel', 'abstraction', 'context')),
  setting    TEXT,                       -- 'desk' | 'sofa' | 'commute' | 'walking' | 'other'
  note       TEXT NOT NULL,
  steps      INTEGER,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS entries_created_at ON entries (created_at);
