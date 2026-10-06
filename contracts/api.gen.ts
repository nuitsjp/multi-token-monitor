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
    "/api/hub-usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetHubUsage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/limit-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetLimitHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hubs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetHubs"];
        put?: never;
        post: operations["AddHub"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hubs/{hubId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["UpdateHub"];
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
        ActivityDayOutput: {
            date: string;
            /** Format: int64 */
            tokens: number;
            /** Format: double */
            costUsd: number | null;
        };
        AddHubInput: {
            name: string | null;
            url: string | null;
            token: string | null;
        };
        /** @enum {unknown} */
        EstimateStatus: "estimated" | "estimating" | "unavailable";
        HealthOutput: {
            status: string;
        };
        HttpValidationProblemDetails: {
            type?: string | null;
            title?: string | null;
            /** Format: int32 */
            status?: number | null;
            detail?: string | null;
            instance?: string | null;
            errors?: {
                [key: string]: string[];
            };
        };
        HubRegistrationOutput: {
            hubId: string;
            name: string;
            url: string;
            status: string;
        };
        HubUsageDataOutput: {
            today: string;
            hubs: components["schemas"]["HubUsageHubOutput"][];
        };
        HubUsageDayOutput: {
            date: string;
            deviceId: string;
            model: string;
            /** Format: int64 */
            tokens: number;
            /** Format: double */
            costUsd: number | null;
        };
        HubUsageDeviceOutput: {
            deviceId: string;
            hostname: string;
            osName: string | null;
            updatedAt: string;
            stale: boolean;
        };
        HubUsageHubOutput: {
            hubId: string;
            name: string;
            connected: boolean;
            receivedAt: string | null;
            devices: components["schemas"]["HubUsageDeviceOutput"][];
            days: components["schemas"]["HubUsageDayOutput"][];
        };
        HubUsageOutput: {
            hubId: string;
            /** Format: int64 */
            tokens: number;
            /** Format: double */
            costUsd: number | null;
        };
        LimitHistoryContractOutput: {
            key: string;
            hubId: string;
            hubName: string;
            provider: string;
            plan: string | null;
        };
        LimitHistoryDayOutput: {
            contractKey: string;
            date: string;
            /** Format: double */
            monthlyLimitUsd: number;
            /** Format: double */
            priceUsd: number | null;
            lowerBound: boolean;
        };
        LimitHistoryOutput: {
            today: string;
            contracts: components["schemas"]["LimitHistoryContractOutput"][];
            days: components["schemas"]["LimitHistoryDayOutput"][];
        };
        ModelUsageOutput: {
            tool: string;
            model: string;
            /** Format: int64 */
            tokens: number;
            /** Format: double */
            costUsd: number | null;
        };
        OverviewActivityOutput: {
            days: components["schemas"]["ActivityDayOutput"][];
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
            /** Format: double */
            estimatedLimitUsd: number | null;
            estimate: components["schemas"]["EstimateStatus"];
            unavailableReason: (null) | components["schemas"]["UnavailableReason"];
            /** Format: double */
            windowMinutes: number | null;
        };
        OverviewOutput: {
            hubs: components["schemas"]["OverviewHubOutput"][];
            periods: components["schemas"]["OverviewPeriodsOutput"];
            limitWindows: components["schemas"]["OverviewLimitWindowOutput"][];
            devices: components["schemas"]["OverviewDeviceOutput"][];
            activity: components["schemas"]["OverviewActivityOutput"];
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
        /** @enum {unknown} */
        UnavailableReason: "unknown-source-device" | "shared-source-device" | "no-matching-model" | "not-countable" | null;
        UpdateHubInput: {
            name: string | null;
            url: string | null;
            token: string | null;
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
    GetHubUsage: {
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
                    "application/json": components["schemas"]["HubUsageDataOutput"];
                };
            };
        };
    };
    GetLimitHistory: {
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
                    "application/json": components["schemas"]["LimitHistoryOutput"];
                };
            };
        };
    };
    GetHubs: {
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
                    "application/json": components["schemas"]["HubRegistrationOutput"][];
                };
            };
        };
    };
    AddHub: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddHubInput"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HubRegistrationOutput"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["HttpValidationProblemDetails"];
                };
            };
        };
    };
    UpdateHub: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                hubId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateHubInput"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HubRegistrationOutput"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["HttpValidationProblemDetails"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
