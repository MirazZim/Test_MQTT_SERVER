const Admin = require("../../models/admin");

const getActivityLogs = async (queryParams) => {
    try {
        const { page = 1, limit = 50, days = 7 } = queryParams;

        // Get logs with filters
        const { logs, params, whereClause } = await Admin.getActivityLogs(queryParams);

        // Get total count for pagination
        const countResult = await Admin.getActivityLogsCount(whereClause, params);

        // Get activity summary
        const summary = await Admin.getActivitySummary(days);

        const summaryData = summary.reduce((acc, item) => {
            acc[item.action] = {
                count: item.count,
                unique_clients: item.unique_clients
            };
            return acc;
        }, {});

        return {
            status: "success",
            message: "Activity logs retrieved successfully",
            data: {
                logs,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult.total,
                    totalPages: Math.ceil(countResult.total / limit)
                },
                summary: summaryData
            }
        };

    } catch (error) {
        console.error("Error getting activity logs:", error);
        return {
            status: "error",
            message: error.message || "Failed to get activity logs"
        };
    }
};

module.exports = { getActivityLogs };
