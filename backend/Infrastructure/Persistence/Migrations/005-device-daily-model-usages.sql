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
