DROP TABLE latest_limit_windows;
CREATE TABLE hub_accounts (
  hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_key TEXT NOT NULL,
  source_device_id TEXT,
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
  base_received_at TEXT NOT NULL,
  base_remaining_percent REAL NOT NULL,
  window_minutes REAL,
  PRIMARY KEY (hub_id, provider, account_key, kind, limit_key),
  FOREIGN KEY (hub_id, provider, account_key) REFERENCES hub_accounts(hub_id, provider, account_key) ON DELETE CASCADE
) STRICT;
CREATE TABLE limit_window_baseline_costs (
  hub_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  account_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  limit_key TEXT NOT NULL,
  device_id TEXT NOT NULL,
  model TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  PRIMARY KEY (hub_id, provider, account_key, kind, limit_key, device_id, model),
  FOREIGN KEY (hub_id, provider, account_key, kind, limit_key) REFERENCES latest_limit_windows(hub_id, provider, account_key, kind, limit_key) ON DELETE CASCADE
) STRICT;
