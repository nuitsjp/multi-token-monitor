CREATE TABLE daily_token_usages (
  hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  cost_usd REAL,
  PRIMARY KEY (hub_id, date)
) STRICT;
