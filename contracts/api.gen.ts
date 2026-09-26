export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        HealthOutput: {
            status: string;
        };
        HubUsageOutput: {
            hubId: string;
            /** Format: int64 */
            tokens: number;
            /** Format: double */
            costUsd: number | null;
        };
        ModelUsageOutput: {
            tool: string;
            model: string;
            /** Format: int64 */
            tokens: number;
            /** Format: double */
            costUsd: number | null;
        };
        OverviewDeviceOutput: {
            hubId: string;
            deviceId: string;
            hostname: string;
            osName: string | null;
            updatedAt: string;
            stale: boolean;
        };
        OverviewHubOutput: {
            hubId: string;
            name: string;
            connected: boolean;
            receivedAt: string | null;
            updatedAt: string | null;
        };
        OverviewLimitWindowOutput: {
            hubId: string;
            provider: string;
            accountKey: string;
            accountLabel: string | null;
            planLabel: string | null;
            kind: string;
            limitKey: string;
            label: string | null;
            /** Format: double */
            remainingPercent: number;
            resetsAt: string | null;
        };
        OverviewOutput: {
            hubs: components["schemas"]["OverviewHubOutput"][];
            periods: components["schemas"]["OverviewPeriodsOutput"];
            limitWindows: components["schemas"]["OverviewLimitWindowOutput"][];
            devices: components["schemas"]["OverviewDeviceOutput"][];
        };
        OverviewPeriodOutput: {
            total: components["schemas"]["UsageOutput"];
            hubs: components["schemas"]["HubUsageOutput"][];
            models: components["schemas"]["ModelUsageOutput"][];
        };
        OverviewPeriodsOutput: {
            today: components["schemas"]["OverviewPeriodOutput"];
            month: components["schemas"]["OverviewPeriodOutput"];
            allTime: components["schemas"]["OverviewPeriodOutput"];
        };
        UsageOutput: {
            /** Format: int64 */
            tokens: number;
            /** Format: double */
            costUsd: number | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    GetHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthOutput"];
                };
            };
        };
    };
    GetOverview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OverviewOutput"];
                };
            };
        };
    };
}
