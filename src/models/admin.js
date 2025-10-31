// models/admin.js
// ✅ UPDATED FOR redesigned_iot_database schema
const pool = require("../config/db");

class Admin {
  // ============================================
  // SYSTEM HEALTH QUERIES
  // ============================================

  static getActiveDevicesCount = async () => {
    console.log(`🔵 [Admin] Getting active sensors count`);
    const [result] = await pool.execute(`
      SELECT COUNT(DISTINCT s.id) as active_sensors
      FROM sensors s
      WHERE s.last_reading_at >= NOW() - INTERVAL 5 MINUTE 
        AND s.is_active = 1
    `);
    console.log(`✅ [Admin] Active sensors: ${result[0].active_sensors}`);
    return result[0];
  };

  static getTotalDevicesCount = async () => {
    console.log(`🔵 [Admin] Getting total sensors count`);
    const [result] = await pool.execute(`
      SELECT COUNT(*) as total_sensors FROM sensors WHERE is_active = 1
    `);
    console.log(`✅ [Admin] Total sensors: ${result[0].total_sensors}`);
    return result[0];
  };

  static getRecentMeasurementsCount = async () => {
    console.log(`🔵 [Admin] Getting recent measurements (1 hour)`);
    const [result] = await pool.execute(`
      SELECT COUNT(*) as recent_measurements 
      FROM sensor_measurements 
      WHERE measured_at >= NOW() - INTERVAL 1 HOUR
    `);
    console.log(`✅ [Admin] Recent measurements: ${result[0].recent_measurements}`);
    return result[0];
  };

  static getMqttConnections = async () => {
    console.log(`🔵 [Admin] Getting MQTT connections (1 hour)`);
    try {
      const [result] = await pool.execute(`
        SELECT action, COUNT(*) as count 
        FROM connection_logs 
        WHERE created_at >= NOW() - INTERVAL 1 HOUR 
        GROUP BY action
      `);
      console.log(`✅ [Admin] MQTT connections retrieved: ${result.length} types`);
      return result;
    } catch (error) {
      console.warn(`⚠️ [Admin] connection_logs table not found, returning empty array`);
      return [];
    }
  };

  static getAnomaliesCount = async () => {
    console.log(`🔵 [Admin] Getting anomalies count (1 hour)`);
    const [result] = await pool.execute(`
      SELECT COUNT(*) as anomalies
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      WHERE sm.measured_at >= NOW() - INTERVAL 1 HOUR 
        AND (
          (st.type_code = 'temperature' AND (sm.measured_value < 10 OR sm.measured_value > 40))
          OR
          (st.type_code = 'humidity' AND (sm.measured_value < 20 OR sm.measured_value > 80))
        )
    `);
    console.log(`✅ [Admin] Anomalies: ${result[0].anomalies}`);
    return result[0];
  };

  // ============================================
  // USER MANAGEMENT QUERIES
  // ============================================

  static getAllUsersWithStats = async () => {
    console.log(`🔵 [Admin] Getting all users with stats`);
    const [result] = await pool.execute(`
      SELECT 
        u.id, 
        u.username, 
        u.email,
        u.full_name,
        u.role, 
        u.created_at, 
        u.is_active,
        COUNT(DISTINCT r.id) as room_count,
        COUNT(DISTINCT s.id) as sensor_count,
        COUNT(DISTINCT sm.id) as measurement_count,
        MAX(sm.measured_at) as last_activity
      FROM users u 
      LEFT JOIN rooms r ON u.id = r.user_id AND r.is_active = 1
      LEFT JOIN sensors s ON u.id = s.user_id AND s.is_active = 1
      LEFT JOIN sensor_measurements sm ON s.id = sm.sensor_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    console.log(`✅ [Admin] Retrieved ${result.length} users`);
    return result;
  };

  static createUser = async (userData) => {
    console.log(`🔵 [Admin] Creating user: ${userData.username}`);
    const { username, password, email, full_name, role } = userData;
    const [result] = await pool.execute(
      "INSERT INTO users (username, password_hash, email, full_name, role, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, NOW())",
      [username, password, email || `${username}@example.com`, full_name || username, role || 'user']
    );
    console.log(`✅ [Admin] User created with ID: ${result.insertId}`);
    return result;
  };

  static updateUser = async (userId, userData) => {
    console.log(`🔵 [Admin] Updating user: ${userId}`);
    const { username, role, email, full_name, is_active } = userData;
    const [result] = await pool.execute(
      "UPDATE users SET username = ?, role = ?, email = ?, full_name = ?, is_active = ?, updated_at = NOW() WHERE id = ?",
      [username, role, email, full_name, is_active, userId]
    );
    console.log(`✅ [Admin] User ${userId} updated`);
    return result;
  };

  static deleteUser = async (userId) => {
    console.log(`🔵 [Admin] Deleting user: ${userId}`);
    // Soft delete
    const [result] = await pool.execute(
      "UPDATE users SET is_active = 0, updated_at = NOW() WHERE id = ?",
      [userId]
    );
    console.log(`✅ [Admin] User ${userId} deleted (soft)`);
    return result;
  };

  static getUsersCount = async () => {
    console.log(`🔵 [Admin] Getting users count`);
    const [result] = await pool.execute("SELECT COUNT(*) as total FROM users WHERE is_active = 1");
    console.log(`✅ [Admin] Total users: ${result[0].total}`);
    return result[0];
  };

  static getOnlineUsersCount = async () => {
    console.log(`🔵 [Admin] Getting online users count`);
    try {
      const [result] = await pool.execute(`
        SELECT COUNT(DISTINCT user_id) as online_users 
        FROM user_sessions 
        WHERE last_activity >= NOW() - INTERVAL 30 MINUTE 
          AND is_active = 1
      `);
      console.log(`✅ [Admin] Online users: ${result[0].online_users}`);
      return result[0];
    } catch (error) {
      console.warn(`⚠️ [Admin] user_sessions table not found, returning 0`);
      return { online_users: 0 };
    }
  };

  // ============================================
  // ACTIVITY LOGS QUERIES
  // ============================================

  static getActivityLogs = async (filters) => {
    console.log(`🔵 [Admin] Getting activity logs with filters:`, filters);
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

    try {
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

      console.log(`✅ [Admin] Retrieved ${logs.length} activity logs`);
      return { logs, params, whereClause };
    } catch (error) {
      console.warn(`⚠️ [Admin] connection_logs table not found`);
      return { logs: [], params, whereClause };
    }
  };

  static getActivityLogsCount = async (whereClause, params) => {
    try {
      const [result] = await pool.execute(`
        SELECT COUNT(*) as total
        FROM connection_logs cl
        LEFT JOIN mqtt_users mu ON cl.username = mu.username  
        LEFT JOIN users u ON mu.username = u.username
        WHERE ${whereClause}
      `, params);
      return result[0];
    } catch (error) {
      return { total: 0 };
    }
  };

  static getActivitySummary = async (days = 7) => {
    console.log(`🔵 [Admin] Getting activity summary (${days} days)`);
    try {
      const [result] = await pool.execute(`
        SELECT 
          cl.action,
          COUNT(*) as count,
          COUNT(DISTINCT cl.client_id) as unique_clients
        FROM connection_logs cl
        WHERE cl.created_at >= NOW() - INTERVAL ${days} DAY
        GROUP BY cl.action
      `);
      console.log(`✅ [Admin] Activity summary retrieved`);
      return result;
    } catch (error) {
      return [];
    }
  };

  // ============================================
  // TEMPERATURE ANALYTICS QUERIES
  // ============================================

  static getTemperatureTrends = async (filters) => {
    console.log(`🔵 [Admin] Getting temperature trends with filters:`, filters);
    const { days = 7, location, userId } = filters;

    let whereConditions = [`sm.measured_at >= NOW() - INTERVAL ${days} DAY`];
    let params = [];

    if (location) {
      whereConditions.push('r.room_code = ?');
      params.push(location);
    }

    if (userId) {
      whereConditions.push('s.user_id = ?');
      params.push(userId);
    }

    whereConditions.push("st.type_code IN ('temperature', 'bowl_temp')");

    const whereClause = whereConditions.join(' AND ');

    const [result] = await pool.execute(`
      SELECT 
        DATE_FORMAT(sm.measured_at, '%Y-%m-%d %H:00:00') as hour,
        AVG(sm.measured_value) as avg_temp,
        MIN(sm.measured_value) as min_temp,
        MAX(sm.measured_value) as max_temp,
        COUNT(*) as reading_count
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE ${whereClause}
      GROUP BY DATE_FORMAT(sm.measured_at, '%Y-%m-%d %H:00:00')
      ORDER BY hour ASC
    `, params);

    console.log(`✅ [Admin] Retrieved ${result.length} temperature trend records`);
    return { result, params, whereClause };
  };

  static getLocationStats = async (whereClause, params) => {
    console.log(`🔵 [Admin] Getting location stats`);
    const [result] = await pool.execute(`
      SELECT 
        r.room_code as location,
        r.room_name,
        COUNT(*) as total_readings,
        AVG(sm.measured_value) as avg_temp,
        MIN(sm.measured_value) as min_temp,
        MAX(sm.measured_value) as max_temp,
        STDDEV(sm.measured_value) as temp_stddev
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      WHERE ${whereClause}
      GROUP BY r.room_code, r.room_name
      ORDER BY total_readings DESC
    `, params);
    console.log(`✅ [Admin] Retrieved ${result.length} location stats`);
    return result;
  };

  static getTemperatureAnomalies = async (whereClause, params) => {
    console.log(`🔵 [Admin] Getting temperature anomalies`);
    const [result] = await pool.execute(`
      SELECT 
        sm.id,
        sm.measured_value as temperature,
        sm.measured_at as created_at,
        s.sensor_name,
        s.user_id,
        u.username,
        r.room_code as location,
        ABS(sm.measured_value - avg_temp.avg) / NULLIF(avg_temp.stddev, 0) as deviation_score
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      INNER JOIN users u ON s.user_id = u.id
      JOIN (
        SELECT 
          r2.id as room_id,
          AVG(sm2.measured_value) as avg,
          STDDEV(sm2.measured_value) as stddev
        FROM sensor_measurements sm2
        INNER JOIN sensors s2 ON sm2.sensor_id = s2.id
        INNER JOIN sensor_types st2 ON s2.sensor_type_id = st2.id
        INNER JOIN rooms r2 ON s2.room_id = r2.id
        WHERE ${whereClause}
          AND st2.type_code = 'temperature'
        GROUP BY r2.id
      ) avg_temp ON r.id = avg_temp.room_id
      WHERE ${whereClause} 
        AND st.type_code = 'temperature'
        AND ABS(sm.measured_value - avg_temp.avg) > (2 * NULLIF(avg_temp.stddev, 0))
      ORDER BY sm.measured_at DESC
      LIMIT 50
    `, params);
    console.log(`✅ [Admin] Retrieved ${result.length} temperature anomalies`);
    return result;
  };

  static getTemperatureAlerts = async (whereClause, params) => {
    console.log(`🔵 [Admin] Getting temperature alerts`);
    const [result] = await pool.execute(`
      SELECT 
        sm.id,
        sm.measured_value,
        sm.measured_at as created_at,
        s.sensor_name,
        s.user_id,
        u.username,
        r.room_code as location,
        st.type_code as sensor_type,
        CASE 
          WHEN st.type_code = 'temperature' AND sm.measured_value < 15 THEN 'Critical Low Temperature'
          WHEN st.type_code = 'temperature' AND sm.measured_value > 35 THEN 'Critical High Temperature'
          WHEN st.type_code = 'humidity' AND sm.measured_value < 20 THEN 'Low Humidity'
          WHEN st.type_code = 'humidity' AND sm.measured_value > 80 THEN 'High Humidity'
        END as alert_type
      FROM sensor_measurements sm
      INNER JOIN sensors s ON sm.sensor_id = s.id
      INNER JOIN sensor_types st ON s.sensor_type_id = st.id
      INNER JOIN rooms r ON s.room_id = r.id
      INNER JOIN users u ON s.user_id = u.id
      WHERE ${whereClause}
        AND (
          (st.type_code = 'temperature' AND (sm.measured_value < 15 OR sm.measured_value > 35))
          OR
          (st.type_code = 'humidity' AND (sm.measured_value < 20 OR sm.measured_value > 80))
        )
      ORDER BY sm.measured_at DESC
      LIMIT 100
    `, params);
    console.log(`✅ [Admin] Retrieved ${result.length} temperature alerts`);
    return result;
  };

  // ============================================
  // AUDIT TRAIL QUERIES
  // ============================================

  static getAuditTrail = async (filters = {}) => {
    console.log(`🔵 [Admin] Getting audit trail with filters:`, filters);
    const {
      limit = 50,
      offset = 0,
      actionType = 'ALL',
      location = 'ALL',
      userId = null,
      days = 30
    } = filters;

    let whereConditions = [`ual.created_at >= NOW() - INTERVAL ${days} DAY`];
    let params = [];

    if (actionType !== 'ALL') {
      whereConditions.push('ual.action_type = ?');
      params.push(actionType);
    }

    if (location !== 'ALL') {
      whereConditions.push('r.room_code = ?');
      params.push(location);
    }

    if (userId) {
      whereConditions.push('ual.user_id = ?');
      params.push(userId);
    }

    const whereClause = whereConditions.join(' AND ');
    params.push(limit, offset);

    const [auditData] = await pool.execute(`
      SELECT 
        ual.id,
        ual.user_id,
        u.username,
        ual.action_type,
        ual.action_description,
        ual.old_value,
        ual.new_value,
        r.room_code as location,
        r.room_name,
        ual.ip_address,
        ual.user_agent as device_info,
        ual.created_at,
        u.role as user_role
      FROM user_audit_log ual
      LEFT JOIN users u ON ual.user_id = u.id
      LEFT JOIN rooms r ON ual.room_id = r.id
      WHERE ${whereClause}
      ORDER BY ual.created_at DESC 
      LIMIT ? OFFSET ?
    `, params);

    console.log(`✅ [Admin] Retrieved ${auditData.length} audit records`);
    return auditData;
  };

  static getAuditTrailCount = async (filters = {}) => {
    const {
      actionType = 'ALL',
      location = 'ALL',
      userId = null,
      days = 30
    } = filters;

    let whereConditions = [`ual.created_at >= NOW() - INTERVAL ${days} DAY`];
    let params = [];

    if (actionType !== 'ALL') {
      whereConditions.push('ual.action_type = ?');
      params.push(actionType);
    }

    if (location !== 'ALL') {
      whereConditions.push('r.room_code = ?');
      params.push(location);
    }

    if (userId) {
      whereConditions.push('ual.user_id = ?');
      params.push(userId);
    }

    const whereClause = whereConditions.join(' AND ');

    const [result] = await pool.execute(`
      SELECT COUNT(*) as total
      FROM user_audit_log ual
      LEFT JOIN rooms r ON ual.room_id = r.id
      WHERE ${whereClause}
    `, params);

    return result[0];
  };

  static getAuditStatistics = async (timeframe = 'today') => {
    console.log(`🔵 [Admin] Getting audit statistics for: ${timeframe}`);
    let timeCondition = '';

    switch (timeframe) {
      case 'today':
        timeCondition = 'WHERE ual.created_at >= CURDATE()';
        break;
      case 'week':
        timeCondition = 'WHERE ual.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case 'month':
        timeCondition = 'WHERE ual.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
      default:
        timeCondition = 'WHERE ual.created_at >= CURDATE()';
    }

    // Get action type statistics
    const [actionStats] = await pool.execute(`
      SELECT 
        ual.action_type,
        COUNT(*) as action_count,
        COUNT(DISTINCT ual.user_id) as unique_users,
        COUNT(DISTINCT ual.room_id) as unique_locations,
        AVG(CAST(ual.new_value AS DECIMAL(10,2))) as avg_value,
        MIN(CAST(ual.new_value AS DECIMAL(10,2))) as min_value,
        MAX(CAST(ual.new_value AS DECIMAL(10,2))) as max_value
      FROM user_audit_log ual
      ${timeCondition}
      GROUP BY ual.action_type
      ORDER BY action_count DESC
    `);

    // Get total statistics
    const [totalStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_actions,
        COUNT(DISTINCT ual.user_id) as total_unique_users,
        COUNT(DISTINCT ual.room_id) as total_unique_locations,
        COUNT(DISTINCT DATE(ual.created_at)) as active_days,
        MIN(ual.created_at) as first_action,
        MAX(ual.created_at) as last_action
      FROM user_audit_log ual
      ${timeCondition}
    `);

    // Get hourly activity for today
    const [hourlyStats] = await pool.execute(`
      SELECT 
        HOUR(ual.created_at) as hour,
        COUNT(*) as action_count
      FROM user_audit_log ual
      WHERE ual.created_at >= CURDATE()
      GROUP BY HOUR(ual.created_at)
      ORDER BY hour ASC
    `);

    // Get top active users
    const [topUsers] = await pool.execute(`
      SELECT 
        u.username,
        ual.user_id,
        COUNT(*) as action_count,
        COUNT(DISTINCT ual.action_type) as action_types
      FROM user_audit_log ual
      INNER JOIN users u ON ual.user_id = u.id
      ${timeCondition}
      GROUP BY u.username, ual.user_id
      ORDER BY action_count DESC
      LIMIT 10
    `);

    // Get location activity
    const [locationStats] = await pool.execute(`
      SELECT 
        r.room_code as location,
        r.room_name,
        COUNT(*) as action_count,
        COUNT(DISTINCT ual.user_id) as unique_users,
        COUNT(DISTINCT ual.action_type) as action_types
      FROM user_audit_log ual
      INNER JOIN rooms r ON ual.room_id = r.id
      ${timeCondition}
      GROUP BY r.room_code, r.room_name
      ORDER BY action_count DESC
    `);

    console.log(`✅ [Admin] Audit statistics retrieved`);
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
    console.log(`🔵 [Admin] Getting recent audit actions (1 hour)`);
    const [result] = await pool.execute(`
      SELECT COUNT(*) as recent_audit_actions
      FROM user_audit_log 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    `);
    console.log(`✅ [Admin] Recent audit actions: ${result[0].recent_audit_actions}`);
    return result[0];
  };

  // ============================================
  // ENHANCED SYSTEM HEALTH
  // ============================================

  static getEnhancedSystemHealth = async () => {
    console.log(`🔵 [Admin] Getting enhanced system health`);
    try {
      // Get existing system health data
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

      console.log(`✅ [Admin] Enhanced system health retrieved`);
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
      console.error('❌ [Admin] Error in getEnhancedSystemHealth:', error);

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
    console.log(`🔵 [Admin] Getting unique locations count`);
    const [result] = await pool.execute(`
      SELECT COUNT(DISTINCT id) as unique_locations 
      FROM rooms
      WHERE is_active = 1
    `);
    console.log(`✅ [Admin] Unique locations: ${result[0].unique_locations}`);
    return result[0].unique_locations || 0;
  };
}

module.exports = Admin;
