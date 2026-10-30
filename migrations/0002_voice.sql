-- Voice entries: allow 'unclassified' when the model can't decide, and record who set the type
-- so model guesses can be reviewed. SQLite can't alter a CHECK constraint, so rebuild the table.
CREATE TABLE entries_new (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  device        TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('channel', 'abstraction', 'context', 'unclassified')),
  setting       TEXT,
  note          TEXT NOT NULL,
  steps         INTEGER,
  source        TEXT NOT NULL DEFAULT 'form',   -- 'form' | 'voice'
  classified_by TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'model'
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO entries_new (id, created_at, device, type, setting, note, steps, received_at)
  SELECT id, created_at, device, type, setting, note, steps, received_at FROM entries;

DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;
CREATE INDEX IF NOT EXISTS entries_created_at ON entries (created_at);
