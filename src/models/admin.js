const pool = require("../config/db");

class Admin {
  // System Health Queries
  static getActiveDevicesCount = async () => {
    const [result] = await pool.execute(`
      SELECT COUNT(DISTINCT sensor_id) as active_sensors
      FROM sensor_nodes 
      WHERE last_update >= NOW() - INTERVAL 5 MINUTE AND is_active = 1
    `);
    return result[0];
  };

  static getTotalDevicesCount = async () => {
    const [result] = await pool.execute(`
      SELECT COUNT(*) as total_sensors FROM sensor_nodes
    `);
    return result[0];
  };

  static getRecentMeasurementsCount = async () => {
    const [result] = await pool.execute(`
      SELECT COUNT(*) as recent_measurements 
      FROM measurements 
      WHERE created_at >= NOW() - INTERVAL 1 HOUR
    `);
    return result[0];
  };

  static getMqttConnections = async () => {
    const [result] = await pool.execute(`
      SELECT action, COUNT(*) as count 
      FROM connection_logs 
      WHERE created_at >= NOW() - INTERVAL 1 HOUR 
      GROUP BY action
    `);
    return result;
  };

  static getAnomaliesCount = async () => {
    const [result] = await pool.execute(`
      SELECT COUNT(*) as anomalies
      FROM measurements 
      WHERE created_at >= NOW() - INTERVAL 1 HOUR 
      AND (temperature < 10 OR temperature > 40 OR humidity < 20 OR humidity > 80)
    `);
    return result[0];
  };

  // User Management Queries
  static getAllUsersWithStats = async () => {
    const [result] = await pool.execute(`
      SELECT 
        u.id, u.username, u.role, u.created_at, u.desired_temperature, 
        u.desired_humidity, u.is_active,
        (SELECT COUNT(*) FROM measurements WHERE user_id = u.id) as measurement_count,
        (SELECT MAX(created_at) FROM measurements WHERE user_id = u.id) as last_activity
      FROM users u 
      ORDER BY u.created_at DESC
    `);
    return result;
  };

  static createUser = async (userData) => {
    const { username, password, role, desired_temperature } = userData;
    const [result] = await pool.execute(
      "INSERT INTO users (username, password, role, desired_temperature) VALUES (?, ?, ?, ?)",
      [username, password, role, desired_temperature]
    );
    return result;
  };

  static updateUser = async (userId, userData) => {
    const { username, role, desired_temperature, desired_humidity, is_active } = userData;
    const [result] = await pool.execute(
      "UPDATE users SET username = ?, role = ?, desired_temperature = ?, desired_humidity = ?, is_active = ? WHERE id = ?",
      [username, role, desired_temperature, desired_humidity, is_active, userId]
    );
    return result;
  };

  static deleteUser = async (userId) => {
    const [result] = await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
    return result;
  };

  static getUsersCount = async () => {
    const [result] = await pool.execute("SELECT COUNT(*) as total FROM users");
    return result[0];
  };

  // Add this method to your Admin class
  static getOnlineUsersCount = async () => {
    const [result] = await pool.execute(`
    SELECT COUNT(*) as online_users FROM users WHERE is_active = 1
  `);
    return result[0];
  };

  // Activity Logs Queries
  static getActivityLogs = async (filters) => {
    const { page = 1, limit = 50, userId, action, days = 7 } = filters;
    const offset = (page - 1) * limit;

    let whereConditions = [`cl.created_at >= NOW() - INTERVAL ${days} DAY`];
    let params = [];

    if (userId) {
      whereConditions.push('u.id = ?');
      params.push(userId);
    }

    if (action) {
      whereConditions.push('cl.action = ?');
      params.push(action);
    }

    const whereClause = whereConditions.join(' AND ');

    const [logs] = await pool.execute(`
      SELECT 
        cl.id, cl.client_id, cl.action, cl.topic, cl.ip_address, cl.created_at,
        u.username, u.role,
        CASE 
          WHEN cl.action = 'connect' THEN 'User Connected'
          WHEN cl.action = 'disconnect' THEN 'User Disconnected'  
          WHEN cl.action = 'publish' THEN CONCAT('Published to ', cl.topic)
          WHEN cl.action = 'subscribe' THEN CONCAT('Subscribed to ', cl.topic)
          ELSE cl.action
        END as description
      FROM connection_logs cl
      LEFT JOIN mqtt_users mu ON cl.username = mu.username
      LEFT JOIN users u ON mu.username = u.username
      WHERE ${whereClause}
      ORDER BY cl.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, params);

    return { logs, params, whereClause };
  };

  static getActivityLogsCount = async (whereClause, params) => {
    const [result] = await pool.execute(`
      SELECT COUNT(*) as total
      FROM connection_logs cl
      LEFT JOIN mqtt_users mu ON cl.username = mu.username  
      LEFT JOIN users u ON mu.username = u.username
      WHERE ${whereClause}
    `, params);
    return result[0];
  };

  static getActivitySummary = async (days = 7) => {
    const [result] = await pool.execute(`
      SELECT 
        cl.action,
        COUNT(*) as count,
        COUNT(DISTINCT cl.client_id) as unique_clients
      FROM connection_logs cl
      WHERE cl.created_at >= NOW() - INTERVAL ${days} DAY
      GROUP BY cl.action
    `);
    return result;
  };

  // Temperature Analytics Queries
  static getTemperatureTrends = async (filters) => {
    const { days = 7, location, userId } = filters;

    let whereConditions = [`m.created_at >= NOW() - INTERVAL ${days} DAY`];
    let params = [];

    if (location) {
      whereConditions.push('m.location = ?');
      params.push(location);
    }

    if (userId) {
      whereConditions.push('m.user_id = ?');
      params.push(userId);
    }

    const whereClause = whereConditions.join(' AND ');

    const [result] = await pool.execute(`
      SELECT 
        DATE_FORMAT(m.created_at, '%Y-%m-%d %H:00:00') as hour,
        AVG(m.temperature) as avg_temp,
        MIN(m.temperature) as min_temp,
        MAX(m.temperature) as max_temp,
        COUNT(*) as reading_count,
        AVG(m.humidity) as avg_humidity
      FROM measurements m
      WHERE ${whereClause} AND m.temperature IS NOT NULL
      GROUP BY DATE_FORMAT(m.created_at, '%Y-%m-%d %H:00:00')
      ORDER BY hour ASC
    `, params);

    return { result, params, whereClause };
  };

  static getLocationStats = async (whereClause, params) => {
    const [result] = await pool.execute(`
      SELECT 
        m.location,
        COUNT(*) as total_readings,
        AVG(m.temperature) as avg_temp,
        MIN(m.temperature) as min_temp,
        MAX(m.temperature) as max_temp,
        STDDEV(m.temperature) as temp_stddev,
        AVG(m.humidity) as avg_humidity
      FROM measurements m
      WHERE ${whereClause} AND m.temperature IS NOT NULL
      GROUP BY m.location
      ORDER BY total_readings DESC
    `, params);
    return result;
  };

  static getTemperatureAnomalies = async (whereClause, params) => {
    const [result] = await pool.execute(`
      SELECT 
        m.*,
        u.username,
        ABS(m.temperature - avg_temp.avg) / avg_temp.stddev as deviation_score
      FROM measurements m
      JOIN users u ON m.user_id = u.id
      JOIN (
        SELECT 
          location,
          AVG(temperature) as avg,
          STDDEV(temperature) as stddev
        FROM measurements 
        WHERE ${whereClause} AND temperature IS NOT NULL
        GROUP BY location
      ) avg_temp ON m.location = avg_temp.location
      WHERE ${whereClause} 
        AND m.temperature IS NOT NULL
        AND ABS(m.temperature - avg_temp.avg) > (2 * avg_temp.stddev)
      ORDER BY m.created_at DESC
      LIMIT 50
    `, params);
    return result;
  };

  static getTemperatureAlerts = async (whereClause, params) => {
    const [result] = await pool.execute(`
      SELECT 
        m.*,
        u.username,
        CASE 
          WHEN m.temperature < 15 THEN 'Critical Low'
          WHEN m.temperature > 35 THEN 'Critical High'
          WHEN m.humidity < 20 THEN 'Low Humidity'
          WHEN m.humidity > 80 THEN 'High Humidity'
        END as alert_type
      FROM measurements m
      JOIN users u ON m.user_id = u.id
      WHERE ${whereClause}
        AND (m.temperature < 15 OR m.temperature > 35 OR m.humidity < 20 OR m.humidity > 80)
      ORDER BY m.created_at DESC
      LIMIT 100
    `, params);
    return result;
  };
  // Audit Trail Queries
  static getAuditTrail = async (filters = {}) => {
    const {
      limit = 50,
      offset = 0,
      actionType = 'ALL',
      location = 'ALL',
      userId = null,
      days = 30
    } = filters;

    let whereConditions = [`uat.created_at >= NOW() - INTERVAL ${days} DAY`];
    let params = [];

    if (actionType !== 'ALL') {
      whereConditions.push('uat.action_type = ?');
      params.push(actionType);
    }

    if (location !== 'ALL') {
      whereConditions.push('uat.location = ?');
      params.push(location);
    }

    if (userId) {
      whereConditions.push('uat.user_id = ?');
      params.push(userId);
    }

    const whereClause = whereConditions.join(' AND ');
    params.push(limit, offset);

    const [auditData] = await pool.execute(`
        SELECT 
            uat.id,
            uat.user_id,
            uat.username,
            uat.action_type,
            uat.action_description,
            uat.old_value,
            uat.new_value,
            uat.location,
            uat.device_info,
            uat.ip_address,
            uat.session_id,
            uat.created_at,
            u.role as user_role
        FROM user_action_audit uat
        LEFT JOIN users u ON uat.user_id = u.id
        WHERE ${whereClause}
        ORDER BY uat.created_at DESC 
        LIMIT ? OFFSET ?
    `, params);

    return auditData;
  };

  static getAuditTrailCount = async (filters = {}) => {
    const {
      actionType = 'ALL',
      location = 'ALL',
      userId = null,
      days = 30
    } = filters;

    let whereConditions = [`created_at >= NOW() - INTERVAL ${days} DAY`];
    let params = [];

    if (actionType !== 'ALL') {
      whereConditions.push('action_type = ?');
      params.push(actionType);
    }

    if (location !== 'ALL') {
      whereConditions.push('location = ?');
      params.push(location);
    }

    if (userId) {
      whereConditions.push('user_id = ?');
      params.push(userId);
    }

    const whereClause = whereConditions.join(' AND ');

    const [result] = await pool.execute(`
        SELECT COUNT(*) as total
        FROM user_action_audit 
        WHERE ${whereClause}
    `, params);

    return result[0];
  };

  static getAuditStatistics = async (timeframe = 'today') => {
    let timeCondition = '';

    switch (timeframe) {
      case 'today':
        timeCondition = 'WHERE created_at >= CURDATE()';
        break;
      case 'week':
        timeCondition = 'WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case 'month':
        timeCondition = 'WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
      default:
        timeCondition = 'WHERE created_at >= CURDATE()';
    }

    // Get action type statistics
    const [actionStats] = await pool.execute(`
        SELECT 
            action_type,
            COUNT(*) as action_count,
            COUNT(DISTINCT user_id) as unique_users,
            COUNT(DISTINCT location) as unique_locations,
            AVG(new_value) as avg_value,
            MIN(new_value) as min_value,
            MAX(new_value) as max_value
        FROM user_action_audit 
        ${timeCondition}
        GROUP BY action_type
        ORDER BY action_count DESC
    `);

    // Get total statistics
    const [totalStats] = await pool.execute(`
        SELECT 
            COUNT(*) as total_actions,
            COUNT(DISTINCT user_id) as total_unique_users,
            COUNT(DISTINCT location) as total_unique_locations,
            COUNT(DISTINCT DATE(created_at)) as active_days,
            MIN(created_at) as first_action,
            MAX(created_at) as last_action
        FROM user_action_audit 
        ${timeCondition}
    `);

    // Get hourly activity for today
    const [hourlyStats] = await pool.execute(`
        SELECT 
            HOUR(created_at) as hour,
            COUNT(*) as action_count
        FROM user_action_audit 
        WHERE created_at >= CURDATE()
        GROUP BY HOUR(created_at)
        ORDER BY hour ASC
    `);

    // Get top active users
    const [topUsers] = await pool.execute(`
        SELECT 
            username,
            user_id,
            COUNT(*) as action_count,
            COUNT(DISTINCT action_type) as action_types
        FROM user_action_audit 
        ${timeCondition}
        GROUP BY username, user_id
        ORDER BY action_count DESC
        LIMIT 10
    `);

    // Get location activity
    const [locationStats] = await pool.execute(`
        SELECT 
            location,
            COUNT(*) as action_count,
            COUNT(DISTINCT user_id) as unique_users,
            COUNT(DISTINCT action_type) as action_types
        FROM user_action_audit 
        ${timeCondition}
        GROUP BY location
        ORDER BY action_count DESC
    `);

    return {
      byActionType: actionStats,
      totals: totalStats[0] || {
        total_actions: 0,
        total_unique_users: 0,
        total_unique_locations: 0,
        active_days: 0,
        first_action: null,
        last_action: null
      },
      hourlyActivity: hourlyStats,
      topUsers,
      locationActivity: locationStats
    };
  };

  static getRecentAuditActions = async (limit = 10) => {
    const [result] = await pool.execute(`
        SELECT 
            COUNT(*) as recent_audit_actions
        FROM user_action_audit 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `);

    return result[0];
  };

  // Enhanced system health with audit integration
  static getEnhancedSystemHealth = async () => {
    try {
      // Get existing system health data (correct way - no destructuring)
      const activeDevices = await Admin.getActiveDevicesCount();
      const totalDevices = await Admin.getTotalDevicesCount();
      const recentMeasurements = await Admin.getRecentMeasurementsCount();
      const usersCount = await Admin.getUsersCount();
      const onlineUsers = await Admin.getOnlineUsersCount();
      const anomalies = await Admin.getAnomaliesCount();
      const recentAudit = await Admin.getRecentAuditActions();
      const mqttConnections = await Admin.getMqttConnections();
      const uniqueLocations = await Admin.getUniqueLocationsCount();

      // Process MQTT connections data
      const mqttStats = {
        connect: 0,
        disconnect: 0,
        publish: 0,
        subscribe: 0
      };

      mqttConnections.forEach(conn => {
        if (mqttStats.hasOwnProperty(conn.action)) {
          mqttStats[conn.action] = conn.count;
        }
      });

      return {
        devices: {
          total: totalDevices.total_sensors || 0,
          active: activeDevices.active_sensors || 0,
          offline: (totalDevices.total_sensors || 0) - (activeDevices.active_sensors || 0),
          locations: uniqueLocations
        },
        users: {
          total: usersCount.total || 0,
          active: onlineUsers.online_users || 0
        },
        measurements: {
          recent: recentMeasurements.recent_measurements || 0
        },
        mqtt: mqttStats,
        audit: {
          recent_actions: recentAudit.recent_audit_actions || 0
        },
        anomalies: anomalies.anomalies || 0,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error in getEnhancedSystemHealth:', error);

      // Return safe defaults if anything fails
      return {
        devices: { total: 0, active: 0, offline: 0, locations: 0 },
        users: { total: 0, active: 0 },
        measurements: { recent: 0 },
        mqtt: { connect: 0, disconnect: 0, publish: 0, subscribe: 0 },
        audit: { recent_actions: 0 },
        anomalies: 0,
        timestamp: new Date().toISOString(),
        error: 'System health data unavailable'
      };
    }
  };

  static getUniqueLocationsCount = async () => {
    const [result] = await pool.execute(`
        SELECT COUNT(DISTINCT location) as unique_locations 
        FROM sensor_nodes
    `);
    return result[0].unique_locations || 0;
  };



}

module.exports = Admin;

