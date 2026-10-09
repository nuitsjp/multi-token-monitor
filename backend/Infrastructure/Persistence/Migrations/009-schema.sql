CREATE TABLE hubs (
  hub_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connected INTEGER NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE TABLE hub_states (
  hub_id TEXT PRIMARY KEY REFERENCES hubs(hub_id) ON DELETE CASCADE,
  stats_json TEXT NOT NULL,
  received_at TEXT NOT NULL
) STRICT;
CREATE TABLE hub_summaries (
  hub_id TEXT PRIMARY KEY REFERENCES hubs(hub_id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL,
  active_days INTEGER
) STRICT;
CREATE TABLE devices (
  hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  os_name TEXT,
  updated_at TEXT NOT NULL,
  stale INTEGER NOT NULL,
  PRIMARY KEY (hub_id, device_id)
) STRICT;
CREATE TABLE latest_token_usages (
  hub_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  period TEXT NOT NULL,
  tool TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  cost_usd REAL,
  PRIMARY KEY (hub_id, device_id, period, tool, model),
  FOREIGN KEY (hub_id, device_id) REFERENCES devices(hub_id, device_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE daily_token_usages (
  hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  cost_usd REAL,
  PRIMARY KEY (hub_id, date)
) STRICT;
CREATE TABLE device_daily_model_usages (
  hub_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  cost_usd REAL,
  PRIMARY KEY (hub_id, device_id, date, model),
  FOREIGN KEY (hub_id, device_id) REFERENCES devices(hub_id, device_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE accounts (
  provider TEXT NOT NULL,
  account_key TEXT NOT NULL,
  account_label TEXT,
  plan_label TEXT,
  PRIMARY KEY (provider, account_key)
) STRICT;
CREATE TABLE hub_accounts (
  hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_key TEXT NOT NULL,
  PRIMARY KEY (hub_id, provider, account_key),
  FOREIGN KEY (provider, account_key) REFERENCES accounts(provider, account_key)
) STRICT;
CREATE TABLE latest_limit_windows (
  hub_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  account_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  limit_key TEXT NOT NULL,
  label TEXT,
  remaining_percent REAL NOT NULL,
  used_percent REAL,
  resets_at TEXT,
  meter_changed_at TEXT NOT NULL,
  window_minutes REAL,
  PRIMARY KEY (hub_id, provider, account_key, kind, limit_key),
  FOREIGN KEY (hub_id, provider, account_key) REFERENCES hub_accounts(hub_id, provider, account_key) ON DELETE CASCADE
) STRICT;
