CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
  body TEXT NOT NULL CHECK(length(body) <= 10000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, title)
) STRICT;
