const express = require("express");
const authenticate = require("../middleware/auth");
const pool = require('../config/db');
const { getSystemHealth } = require("../main/admin/get-system-health");
const { getAllUsersAdmin } = require("../main/admin/get-all-users-admin");
const { createUserAdmin } = require("../main/admin/create-user-admin");
const { updateUserAdmin } = require("../main/admin/update-user-admin");
const { deleteUserAdmin } = require("../main/admin/delete-user-admin");
const { getActivityLogs } = require("../main/admin/get-activity-logs");
const { getTemperatureAnalytics } = require("../main/admin/get-temperature-analytics");

const Admin = require("../models/admin");

const adminRouter = express.Router();

// System Health
adminRouter.get("/system-health", authenticate.adminOnly, async (req, res) => {
    try {
        // Get original system health data
        const originalHealthData = await getSystemHealth();

        // Get enhanced audit data
        const enhancedHealthData = await Admin.getEnhancedSystemHealth();

        // Merge both datasets
        const mergedData = {
            ...originalHealthData.data,
            ...enhancedHealthData,
            audit: enhancedHealthData.audit,
            timestamp: new Date().toISOString()
        };

        return res.status(200).json({
            status: 'success',
            message: 'System health retrieved successfully',
            data: mergedData
        });

    } catch (error) {
        console.error('❌ Error fetching enhanced system health:', error);

        // Fallback to original system health if audit fails
        try {
            const fallbackData = await getSystemHealth();
            return res.status(200).json({
                ...fallbackData,
                audit: { recent_actions: 0 }, // Add empty audit data
                fallback: true
            });
        } catch (fallbackError) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to fetch system health data'
            });
        }
    }
});

// User Management
adminRouter.get("/users", authenticate.adminOnly, async (req, res) => {
    getAllUsersAdmin()
        .then((data) => {
            return res.status(200).send({
                status: data.status,
                message: data.message,
                users: data.users,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});

adminRouter.post("/users", authenticate.adminOnly, async (req, res) => {
    createUserAdmin(req.body)
        .then((data) => {
            return res.status(201).send({
                status: data.status,
                message: data.message,
                userId: data.userId,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});

adminRouter.put("/users/:id", authenticate.adminOnly, async (req, res) => {
    updateUserAdmin(req.params.id, req.body, req.user)
        .then((data) => {
            return res.status(200).send({
                status: data.status,
                message: data.message,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});

adminRouter.delete("/users/:id", authenticate.adminOnly, async (req, res) => {
    deleteUserAdmin(req.params.id, req.user)
        .then((data) => {
            return res.status(200).send({
                status: data.status,
                message: data.message,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});

// Activity Logs
adminRouter.get("/activity-logs", authenticate.adminOnly, async (req, res) => {
    getActivityLogs(req.query)
        .then((data) => {
            return res.status(200).send({
                status: data.status,
                message: data.message,
                data: data.data,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});

// Temperature Analytics
adminRouter.get("/temperature-analytics", authenticate.adminOnly, async (req, res) => {
    getTemperatureAnalytics(req.query)
        .then((data) => {
            return res.status(200).send({
                status: data.status,
                message: data.message,
                data: data.data,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});

// Audit Trail Route
adminRouter.get('/audit-trail', authenticate.adminOnly, async (req, res) => {
    try {
        console.log('🔍 Fetching audit trail for admin user:', req.user.id || req.user.username);

        const filters = {
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0,
            actionType: req.query.type || 'ALL',
            location: req.query.location || 'ALL',
            userId: req.query.userId || null,
            days: parseInt(req.query.days) || 30
        };

        const auditData = await Admin.getAuditTrail(filters);
        const totalCount = await Admin.getAuditTrailCount(filters);

        return res.json({
            status: 'success',
            data: auditData,
            pagination: {
                limit: filters.limit,
                offset: filters.offset,
                total: totalCount.total,
                hasMore: auditData.length === filters.limit
            },
            filters: {
                actionType: filters.actionType,
                location: filters.location,
                days: filters.days
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error fetching audit trail:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch audit trail data',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Audit Statistics Route
adminRouter.get('/audit-statistics', authenticate.adminOnly, async (req, res) => {
    try {
        console.log('📊 Fetching audit statistics for admin user:', req.user.id || req.user.username);

        const timeframe = req.query.timeframe || 'today';
        const statistics = await Admin.getAuditStatistics(timeframe);

        return res.json({
            status: 'success',
            data: statistics,
            timeframe,
            generatedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error fetching audit statistics:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch audit statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Real-time Audit Stream Route (Bonus)
adminRouter.get('/audit-stream', authenticate.adminOnly, async (req, res) => {
    try {
        const recentActions = await Admin.getAuditTrail({
            limit: parseInt(req.query.limit) || 20,
            offset: 0,
            days: 1
        });

        return res.json({
            status: 'success',
            data: recentActions,
            count: recentActions.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error fetching audit stream:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch audit stream'
        });
    }
});

// Audit Trail Export Route (Additional feature)
adminRouter.get('/audit-export', authenticate.adminOnly, async (req, res) => {
    try {
        const filters = {
            limit: parseInt(req.query.limit) || 1000,
            offset: 0,
            actionType: req.query.type || 'ALL',
            location: req.query.location || 'ALL',
            days: parseInt(req.query.days) || 30
        };

        const auditData = await Admin.getAuditTrail(filters);

        // Set headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="audit-trail-${new Date().toISOString().split('T')[0]}.csv"`);

        // Create CSV content
        const csvHeaders = 'ID,User ID,Username,Action Type,Description,Old Value,New Value,Location,IP Address,Timestamp\n';
        const csvRows = auditData.map(row => [
            row.id,
            row.user_id,
            row.username,
            row.action_type,
            row.action_description,
            row.old_value || '',
            row.new_value,
            row.location,
            row.ip_address || '',
            row.created_at
        ].join(',')).join('\n');

        res.send(csvHeaders + csvRows);

    } catch (error) {
        console.error('❌ Error exporting audit trail:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to export audit trail'
        });
    }
});


module.exports = adminRouter;