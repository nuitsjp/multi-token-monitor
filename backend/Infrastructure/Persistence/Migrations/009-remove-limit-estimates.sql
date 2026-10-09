DROP TABLE limit_window_baseline_costs;
DROP TABLE daily_monthly_limits;
DROP TABLE plan_prices;
ALTER TABLE latest_limit_windows DROP COLUMN base_received_at;
ALTER TABLE latest_limit_windows DROP COLUMN base_remaining_percent;
ALTER TABLE hub_accounts DROP COLUMN source_device_id;
