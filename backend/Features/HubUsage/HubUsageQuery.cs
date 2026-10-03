using System.Globalization;
using Dapper;
using MultiTokenMonitor.Infrastructure.Persistence;
using MultiTokenMonitor.Presentation.Http;

namespace MultiTokenMonitor.Features.HubUsage;

internal static class HubUsageQuery
{
    internal static Task<HubUsageDataOutput> ReadAsync(Database database) =>
        database.InReadTransactionAsync(async connection =>
        {
            var hubs = (await connection.QueryAsync<HubRow>(
                """
                SELECT h.hub_id AS HubId, h.name AS Name, h.connected AS Connected,
                       s.received_at AS ReceivedAt
                FROM hubs h LEFT JOIN hub_states s USING (hub_id)
                ORDER BY h.rowid
                """)).AsList();
            var devices = (await connection.QueryAsync<DeviceRow>(
                """
                SELECT hub_id AS HubId, device_id AS DeviceId, hostname AS Hostname,
                       os_name AS OsName, updated_at AS UpdatedAt, stale AS Stale
                FROM devices ORDER BY hub_id, hostname, device_id
                """)).ToLookup(row => row.HubId);
            var days = (await connection.QueryAsync<DayRow>(
                """
                SELECT hub_id AS HubId, device_id AS DeviceId, date AS Date, model AS Model,
                       tokens AS Tokens, cost_usd AS CostUsd
                FROM device_daily_model_usages ORDER BY hub_id, date, device_id, model
                """)).ToLookup(row => row.HubId);
            return new HubUsageDataOutput(
                DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                hubs.Select(hub => new HubUsageHubOutput(
                    hub.HubId, hub.Name, hub.Connected != 0, hub.ReceivedAt,
                    devices[hub.HubId].Select(device => new HubUsageDeviceOutput(
                        device.DeviceId, device.Hostname, device.OsName, device.UpdatedAt, device.Stale != 0)).ToList(),
                    days[hub.HubId].Select(day => new HubUsageDayOutput(
                        day.Date, day.DeviceId, day.Model, day.Tokens, day.CostUsd)).ToList())).ToList());
        });

    private sealed record HubRow(string HubId, string Name, long Connected, string? ReceivedAt);
    private sealed record DeviceRow(string HubId, string DeviceId, string Hostname, string? OsName, string UpdatedAt, long Stale);
    private sealed record DayRow(string HubId, string DeviceId, string Date, string Model, long Tokens, double? CostUsd);
}
