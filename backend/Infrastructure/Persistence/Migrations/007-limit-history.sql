CREATE TABLE plan_prices (
  provider TEXT NOT NULL,
  plan TEXT NOT NULL COLLATE NOCASE,
  monthly_usd REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, plan)
) STRICT;
CREATE TABLE daily_monthly_limits (
  hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_key TEXT NOT NULL,
  limit_group TEXT NOT NULL,
  date TEXT NOT NULL,
  plan TEXT,
  monthly_limit_usd REAL NOT NULL,
  price_usd REAL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (hub_id, provider, account_key, limit_group, date)
) STRICT;
