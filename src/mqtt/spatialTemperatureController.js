const mqtt = require("mqtt");
const pool = require("../config/db");
const { performance } = require('perf_hooks');

class SpatialTemperatureController {
    constructor(io) {
        this.io = io;
        this.mqttClient = null;
        this.sensorData = new Map(); // Real-time sensor cache
        this.actuatorStates = new Map(); // Real-time actuator states
        this.pidControllers = new Map(); // PID controllers per actuator
        this.spatialCache = new Map(); // Spatial interpolation cache
        this.performanceMetrics = new Map();


        // 🆕 NEW: Optimized data structures
        this.spatialGrid = new SpatialHashGrid(2.0); // For fast neighbor lookup
        this.coordinatedController = new CoordinatedController(); // For smart control
        this.emaMetrics = new EMAMetrics(0.1); // For efficient metrics

        // Configuration
        this.config = {
            controlFrequency: 30000, // 30 seconds
            temperatureTolerance: 0.5,
            maxActuatorOutput: 100,
            spatialInfluence: 0.15,
            adaptiveTuning: true
        };

        // Performance monitoring
        this.metrics = {
            processedReadings: 0,
            controlCommands: 0,
            avgResponseTime: 0,
            energyEfficiency: 0
        };
    }

    async connect() {
        const connectOptions = {
            clientId: `spatial-controller-${Math.random().toString(16).substr(2, 8)}`,
            keepalive: 60,
            clean: true,
            reconnectPeriod: 5000
        };

        this.mqttClient = mqtt.connect(process.env.MQTT_HOST || "mqtt://broker.hivemq.com", connectOptions);

        this.mqttClient.on("connect", () => {
            console.log("🌐 Spatial Temperature Controller connected to MQTT");

            // Subscribe to sensor data with QoS 1 for reliability
            this.mqttClient.subscribe("home/+/+/sensors/+/data", { qos: 1 });
            this.mqttClient.subscribe("home/+/+/actuators/+/status", { qos: 1 });

            // 🆕 NEW: Also subscribe to direct real sensor topics for backup
            this.mqttClient.subscribe("ESPX", { qos: 1 });
            this.mqttClient.subscribe("ESPX2", { qos: 1 });
            this.mqttClient.subscribe("ESPX3", { qos: 1 });

            this.startSpatialControlLoop();
        });

        this.mqttClient.on("message", async (topic, message) => {
            const startTime = performance.now();
            await this.handleMqttMessage(topic, message);
            this.updatePerformanceMetrics('message_processing', performance.now() - startTime);
        });

        this.mqttClient.on("error", (error) => {

        });
    }

    //Routes incoming MQTT messages to appropriate handlers
    async handleMqttMessage(topic, message) {
        try {
            const topicParts = topic.split("/");
            const data = JSON.parse(message.toString());

            if (topicParts.length >= 6 && topicParts[3] === "sensors") {
                await this.processSensorData(
                    parseInt(topicParts[1]), // userId
                    topicParts[2],           // location
                    topicParts[4],           // sensorId
                    data
                );
            } else if (topicParts.length >= 6 && topicParts[3] === "actuators") {
                await this.processActuatorStatus(
                    parseInt(topicParts[1]), // userId
                    topicParts[2],           // location
                    topicParts[4],           // actuatorId
                    data
                );
            }
        } catch (error) {
            console.error("Error processing MQTT message:", error);
        }
    }

    //Processes temperature sensor readings
    async processSensorData(userId, location, sensorId, data) {
        try {
            // Get sensor configuration from database
            const [sensorRows] = await pool.execute(
                "SELECT * FROM sensor_nodes WHERE user_id = ? AND sensor_id = ? AND location = ? AND is_active = TRUE",
                [userId, sensorId, location]
            );

            if (sensorRows.length === 0) {
                console.warn(`Unknown sensor: ${sensorId} in ${location}`);
                return;
            }

            const sensor = sensorRows[0];
            const sensorKey = `${userId}-${location}-${sensorId}`;

            // Apply calibration offset
            const calibratedTemperature = data.temperature + sensor.calibration_offset;

            // Cache sensor data for spatial processing
            this.sensorData.set(sensorKey, {
                userId,
                location,
                sensorId,
                temperature: calibratedTemperature,
                humidity: data.humidity,
                airflow: data.airflow,
                x: sensor.x_coordinate,
                y: sensor.y_coordinate,
                timestamp: new Date(),
                quality: this.assessDataQuality(data)
            });

            //Algotiyhmic improvements for spatial data handling
            // 🆕 NEW: Also add to spatial grid for fast lookup
            this.spatialGrid.insert({
                x: sensor.x_coordinate,
                y: sensor.y_coordinate,
                temperature: calibratedTemperature,
                sensorId: sensorId
            });

            // Store in database with spatial coordinates
            await pool.execute(
                `INSERT INTO measurements
                 (user_id, temperature, humidity, airflow, location, sensor_id, x_coordinate, y_coordinate)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, calibratedTemperature, data.humidity, data.airflow,
                    location, sensorId, sensor.x_coordinate, sensor.y_coordinate]
            );

            // Update sensor last reading
            await pool.execute(
                "UPDATE sensor_nodes SET last_reading = ?, last_update = NOW() WHERE id = ?",
                [calibratedTemperature, sensor.id]
            );

            // Emit real-time update to frontend
            this.io.to(`user_${userId}_${location}`).emit("spatialSensorUpdate", {
                sensorId,
                location,
                temperature: calibratedTemperature,
                humidity: data.humidity,
                x: sensor.x_coordinate,
                y: sensor.y_coordinate,
                quality: this.assessDataQuality(data),
                timestamp: new Date()
            });

            this.metrics.processedReadings++;

        } catch (error) {
            console.error("Error processing sensor data:", error);
        }
    }

    assessDataQuality(data) {
        let quality = "good";

        // Check for reasonable temperature range
        if (data.temperature < -40 || data.temperature > 80) {
            quality = "poor";
        } else if (data.temperature < 0 || data.temperature > 50) {
            quality = "fair";
        }

        // Check for data freshness and consistency
        if (!data.timestamp || Date.now() - new Date(data.timestamp).getTime() > 120000) {
            quality = quality === "good" ? "fair" : "poor";
        }

        return quality;
    }

    startSpatialControlLoop() {
        console.log("🎯 Starting spatial temperature control loop");

        setInterval(async () => {
            try {
                await this.executeSpatialControl();
                await this.updateSystemMetrics();
            } catch (error) {
                console.error("Error in spatial control loop:", error);
            }
        }, this.config.controlFrequency);
    }

    async executeSpatialControl() {
        const userLocations = this.groupSensorsByUserLocation();

        for (const [userLocationKey, sensors] of userLocations) {
            const [userId, location] = userLocationKey.split('-');
            await this.controlUserLocation(parseInt(userId), location, sensors);
        }
    }

    groupSensorsByUserLocation() {
        const grouped = new Map();

        for (const [key, sensor] of this.sensorData) {
            // Only process recent data (< 5 minutes)
            if (Date.now() - sensor.timestamp.getTime() > 300000) continue;

            const userLocationKey = `${sensor.userId}-${sensor.location}`;

            if (!grouped.has(userLocationKey)) {
                grouped.set(userLocationKey, []);
            }
            grouped.get(userLocationKey).push(sensor);
        }

        return grouped;
    }

    async controlUserLocation(userId, location, sensors) {
        if (sensors.length < 2) return; // Need at least 2 sensors for spatial control

        try {
            // Get target temperature for this user
            const [userRows] = await pool.execute(
                "SELECT desired_temperature, desired_humidity, desired_airflow FROM users WHERE id = ?",
                [userId]
            );

            if (userRows.length === 0) return;

            const targets = {
                temperature: userRows[0].desired_temperature || 22.0,
                humidity: userRows[0].desired_humidity || 55.0,
                airflow: userRows[0].desired_airflow || 2.0
            };

            // Get actuators for this location
            const [actuatorRows] = await pool.execute(
                "SELECT * FROM actuator_nodes WHERE user_id = ? AND location = ? AND is_active = TRUE",
                [userId, location]
            );

            if (actuatorRows.length === 0) return;

            // Perform spatial analysis
            const spatialAnalysis = this.performSpatialAnalysis(sensors, targets);

            // Calculate control commands for each actuator
            const controlCommands = await this.calculateSpatialControlCommands(
                userId, location, sensors, actuatorRows, spatialAnalysis, targets
            );

            // Execute control commands
            for (const command of controlCommands) {
                await this.executeControlCommand(command);
            }

        } catch (error) {
            console.error(`Error controlling location ${location}:`, error);
        }
    }

    performSpatialAnalysis(sensors, targets) {
        const temperatures = sensors.map(s => s.temperature);
        const positions = sensors.map(s => ({ x: s.x, y: s.y }));

        // Calculate spatial statistics
        const avgTemp = temperatures.reduce((sum, t) => sum + t, 0) / temperatures.length;
        const tempVariance = temperatures.reduce((sum, t) => sum + Math.pow(t - avgTemp, 2), 0) / temperatures.length;
        const tempStdDev = Math.sqrt(tempVariance);

        // Identify hot and cold spots
        const hotspots = sensors.filter(s => s.temperature > targets.temperature + this.config.temperatureTolerance);
        const coldspots = sensors.filter(s => s.temperature < targets.temperature - this.config.temperatureTolerance);

        // Calculate temperature gradients
        const gradients = this.calculateTemperatureGradients(sensors);

        return {
            averageTemperature: avgTemp,
            temperatureVariance: tempVariance,
            temperatureStdDev: tempStdDev,
            uniformityIndex: 1 - (tempStdDev / Math.abs(avgTemp)), // 1 = perfect uniformity
            hotspots,
            coldspots,
            gradients,
            sensors
        };
    }

    calculateTemperatureGradients(sensors) {
        const gradients = [];

        for (let i = 0; i < sensors.length; i++) {
            for (let j = i + 1; j < sensors.length; j++) {
                const s1 = sensors[i];
                const s2 = sensors[j];

                const distance = Math.sqrt(
                    Math.pow(s2.x - s1.x, 2) + Math.pow(s2.y - s1.y, 2)
                );

                if (distance > 0) {
                    const gradient = (s2.temperature - s1.temperature) / distance;
                    gradients.push({
                        from: s1,
                        to: s2,
                        gradient,
                        distance
                    });
                }
            }
        }

        return gradients;
    }

    async calculateSpatialControlCommands(userId, location, sensors, actuators, analysis, targets) {
        // 🆕 NEW: Use coordinated controller instead of individual PIDs
        return this.coordinatedController.calculateOptimalCommands(actuators, sensors, targets, userId, location);
    }

    findNearestSensors(actuator, sensors, maxCount = 3) {
        // 🆕 NEW: Use spatial hashing for O(1) lookup
        const nearby = this.spatialGrid.findNearby(
            actuator.x_coordinate,
            actuator.y_coordinate,
            5.0 // search radius
        );

        return nearby.slice(0, maxCount).map(item => item.sensor);
    }

    calculateWeightedAverageTemperature(actuator, sensors) {
        // 🆕 NEW: Use IDW (Inverse Distance Weighting) algorithm
        let totalWeight = 0;
        let weightedSum = 0;

        for (const sensor of sensors) {
            const distance = Math.sqrt(
                Math.pow(sensor.x - actuator.x_coordinate, 2) +
                Math.pow(sensor.y - actuator.y_coordinate, 2)
            );

            if (distance < 0.01) { // At sensor location
                return sensor.temperature;
            }

            // IDW with power parameter = 2 (more accurate than linear)
            const weight = 1 / Math.pow(distance, 2);
            totalWeight += weight;
            weightedSum += sensor.temperature * weight;
        }

        return totalWeight > 0 ? weightedSum / totalWeight : sensors[0].temperature;
    }

    calculateSpatialInfluence(actuator, analysis, targetTemp) {
        let influence = 0;

        // Influence from nearby hot spots
        for (const hotspot of analysis.hotspots) {
            const distance = Math.sqrt(
                Math.pow(hotspot.x - actuator.x_coordinate, 2) +
                Math.pow(hotspot.y - actuator.y_coordinate, 2)
            );

            if (distance <= actuator.influence_radius) {
                const weight = 1 - (distance / actuator.influence_radius);
                influence -= (hotspot.temperature - targetTemp) * weight * this.config.spatialInfluence;
            }
        }

        // Influence from nearby cold spots
        for (const coldspot of analysis.coldspots) {
            const distance = Math.sqrt(
                Math.pow(coldspot.x - actuator.x_coordinate, 2) +
                Math.pow(coldspot.y - actuator.y_coordinate, 2)
            );

            if (distance <= actuator.influence_radius) {
                const weight = 1 - (distance / actuator.influence_radius);
                influence += (targetTemp - coldspot.temperature) * weight * this.config.spatialInfluence;
            }
        }

        return influence;
    }

    convertToActuatorCommand(userId, location, actuator, pidOutput, currentTemp, targetTemp) {
        let commandType = '';
        let commandValue = 0;

        switch (actuator.actuator_type) {
            case 'heater':
                if (pidOutput > 0) {
                    commandType = 'heating';
                    commandValue = Math.min(pidOutput, actuator.max_power);
                }
                break;

            case 'cooler':
                if (pidOutput < 0) {
                    commandType = 'cooling';
                    commandValue = Math.min(Math.abs(pidOutput), actuator.max_power);
                }
                break;

            case 'fan':
                commandType = 'fan_speed';
                commandValue = Math.min(Math.abs(pidOutput) * 0.6, actuator.max_power);
                break;

            default:
                return null;
        }

        if (commandValue === 0) return null;

        return {
            userId,
            location,
            actuatorId: actuator.actuator_id,
            commandType,
            commandValue,
            targetTemperature: targetTemp,
            actualTemperature: currentTemp,
            pidOutput,
            energyCost: this.estimateEnergyCost(actuator.actuator_type, commandValue)
        };
    }

    estimateEnergyCost(actuatorType, commandValue) {
        const basePower = {
            'heater': 2000,   // 2kW
            'cooler': 1500,   // 1.5kW
            'fan': 200        // 200W
        };

        const powerUsage = (basePower[actuatorType] || 1000) * (commandValue / 100);
        const energyCost = powerUsage * 0.12 / 1000; // $0.12/kWh

        return energyCost * (this.config.controlFrequency / 3600000); // Cost per control period
    }

    async executeControlCommand(command) {
        try {
            // Log command to database
            await pool.execute(
                `INSERT INTO control_commands
                 (user_id, actuator_id, location, command_type, command_value,
                  target_temperature, actual_temperature, energy_cost)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [command.userId, command.actuatorId, command.location,
                command.commandType, command.commandValue,
                command.targetTemperature, command.actualTemperature, command.energyCost]
            );

            // Update actuator state
            await pool.execute(
                "UPDATE actuator_nodes SET current_output = ?, last_command = ?, last_update = NOW() WHERE user_id = ? AND actuator_id = ? AND location = ?",
                [command.commandValue, command.commandValue, command.userId, command.actuatorId, command.location]
            );

            // Send MQTT command
            const mqttTopic = `home/${command.userId}/${command.location}/actuators/${command.actuatorId}/command`;
            const mqttPayload = {
                type: command.commandType,
                value: command.commandValue,
                target: command.targetTemperature,
                actual: command.actualTemperature,
                timestamp: new Date().toISOString()
            };

            this.mqttClient.publish(mqttTopic, JSON.stringify(mqttPayload), { qos: 1 });

            // Emit to frontend
            this.io.to(`user_${command.userId}_${command.location}`).emit("spatialControlCommand", {
                actuatorId: command.actuatorId,
                type: command.commandType,
                value: command.commandValue,
                target: command.targetTemperature,
                actual: command.actualTemperature,
                energyCost: command.energyCost,
                timestamp: new Date()
            });

            this.metrics.controlCommands++;
            console.log(`🎛️ Executed: ${command.actuatorId} ${command.commandType} = ${command.commandValue.toFixed(1)}%`);

        } catch (error) {
            console.error("Error executing control command:", error);
        }
    }

    async updateSystemMetrics() {
        // Calculate system performance metrics
        const userLocations = this.groupSensorsByUserLocation();

        for (const [userLocationKey, sensors] of userLocations) {
            const [userId, location] = userLocationKey.split('-');

            try {
                // Calculate uniformity metrics
                const temperatures = sensors.map(s => s.temperature);
                const avgTemp = temperatures.reduce((sum, t) => sum + t, 0) / temperatures.length;
                const variance = temperatures.reduce((sum, t) => sum + Math.pow(t - avgTemp, 2), 0) / temperatures.length;
                const uniformityIndex = 1 - (Math.sqrt(variance) / Math.abs(avgTemp));

                // Store metrics
                await pool.execute(
                    "INSERT INTO system_performance (user_id, location, metric_name, metric_value) VALUES (?, ?, ?, ?)",
                    [parseInt(userId), location, 'temperature_uniformity', uniformityIndex]
                );

                await pool.execute(
                    "INSERT INTO system_performance (user_id, location, metric_name, metric_value) VALUES (?, ?, ?, ?)",
                    [parseInt(userId), location, 'average_temperature', avgTemp]
                );

            } catch (error) {
                console.error("Error updating system metrics:", error);
            }
        }
    }

    updatePerformanceMetrics(metricName, value) {
        // 🆕 NEW: Use EMA instead of array storage
        this.emaMetrics.update(metricName, value);
    }

    getSystemStatus() {
        return {
            activeSensors: this.sensorData.size,
            activeControllers: this.pidControllers.size,
            metrics: this.metrics,
            performance: {
                avgProcessingTime: this.calculateAverageMetric('message_processing'),
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime()
            }
        };
    }

    calculateAverageMetric(metricName) {
        // 🆕 NEW: Get EMA value directly
        return this.emaMetrics.get(metricName);
    }
}

// Adaptive PID Controller Class
class AdaptivePIDController {
    constructor(id, actuatorType, maxOutput) {
        this.id = id;
        this.actuatorType = actuatorType;
        this.maxOutput = maxOutput;

        // PID parameters - tuned for different actuator types
        this.tuningProfiles = {
            'heater': { kp: 2.5, ki: 0.4, kd: 0.15 },
            'cooler': { kp: 2.0, ki: 0.3, kd: 0.12 },
            'fan': { kp: 1.5, ki: 0.2, kd: 0.08 }
        };

        const profile = this.tuningProfiles[actuatorType] || this.tuningProfiles['heater'];
        this.kp = profile.kp;
        this.ki = profile.ki;
        this.kd = profile.kd;

        // State variables
        this.integral = 0;
        this.previousError = 0;
        this.lastUpdate = Date.now();

        // Performance tracking for adaptive tuning
        this.performanceHistory = [];
        this.lastTuneTime = 0;
    }

    calculate(error, deltaTime) {
        // Adaptive tuning every 10 minutes
        if (Date.now() - this.lastTuneTime > 600000) {
            this.adaptivelyTunePID();
        }

        // Calculate PID terms
        this.integral += error * deltaTime;

        // Anti-windup: clamp integral term
        const maxIntegral = this.maxOutput / this.ki;
        this.integral = Math.max(-maxIntegral, Math.min(maxIntegral, this.integral));

        const derivative = (error - this.previousError) / deltaTime;

        // Calculate output
        let output = (this.kp * error) + (this.ki * this.integral) + (this.kd * derivative);

        // Clamp output
        output = Math.max(-this.maxOutput, Math.min(this.maxOutput, output));

        // Store for next iteration
        this.previousError = error;
        this.lastUpdate = Date.now();

        // Track performance
        this.performanceHistory.push({
            error: Math.abs(error),
            output: Math.abs(output),
            timestamp: Date.now()
        });

        // Keep only last 20 values
        if (this.performanceHistory.length > 20) {
            this.performanceHistory.shift();
        }

        return output;
    }

    adaptivelyTunePID() {
        if (this.performanceHistory.length < 10) return;

        // Calculate performance metrics
        const avgError = this.performanceHistory.reduce((sum, p) => sum + p.error, 0) / this.performanceHistory.length;
        const errorTrend = this.calculateErrorTrend();
        const oscillations = this.detectOscillations();

        // Adaptive adjustments
        if (avgError > 1.0) { // High steady-state error
            this.ki *= 1.1; // Increase integral gain
        } else if (avgError < 0.2) { // Very low error, might be sluggish
            this.kp *= 1.05; // Slightly increase proportional gain
        }

        if (oscillations > 3) { // System is oscillating
            this.kp *= 0.9; // Reduce proportional gain
            this.kd *= 1.1; // Increase derivative gain
        }

        // Ensure parameters stay within reasonable bounds
        this.kp = Math.max(0.5, Math.min(5.0, this.kp));
        this.ki = Math.max(0.1, Math.min(2.0, this.ki));
        this.kd = Math.max(0.05, Math.min(0.5, this.kd));

        this.lastTuneTime = Date.now();
    }

    calculateErrorTrend() {
        if (this.performanceHistory.length < 5) return 0;

        const recent = this.performanceHistory.slice(-5);
        const older = this.performanceHistory.slice(-10, -5);

        const recentAvg = recent.reduce((sum, p) => sum + p.error, 0) / recent.length;
        const olderAvg = older.reduce((sum, p) => sum + p.error, 0) / older.length;

        return recentAvg - olderAvg; // Positive means error is increasing
    }

    detectOscillations() {
        if (this.performanceHistory.length < 8) return 0;

        let oscillations = 0;
        const errors = this.performanceHistory.map(p => p.error);

        for (let i = 1; i < errors.length - 1; i++) {
            if ((errors[i] > errors[i - 1] && errors[i] > errors[i + 1]) ||
                (errors[i] < errors[i - 1] && errors[i] < errors[i + 1])) {
                oscillations++;
            }
        }

        return oscillations;
    }

    reset() {
        this.integral = 0;
        this.previousError = 0;
        this.performanceHistory = [];
    }
}

// 🆕 NEW: Spatial Hash Grid for fast neighbor lookup
class SpatialHashGrid {
    constructor(cellSize = 2.0) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }

    hash(x, y) {
        const gridX = Math.floor(x / this.cellSize);
        const gridY = Math.floor(y / this.cellSize);
        return `${gridX},${gridY}`;
    }

    clear() {
        this.grid.clear();
    }

    insert(sensor) {
        const key = this.hash(sensor.x, sensor.y);
        if (!this.grid.has(key)) {
            this.grid.set(key, []);
        }
        this.grid.get(key).push(sensor);
    }

    findNearby(x, y, radius = 3.0) {
        const nearby = [];
        const cellRadius = Math.ceil(radius / this.cellSize);

        const centerX = Math.floor(x / this.cellSize);
        const centerY = Math.floor(y / this.cellSize);

        for (let dx = -cellRadius; dx <= cellRadius; dx++) {
            for (let dy = -cellRadius; dy <= cellRadius; dy++) {
                const key = `${centerX + dx},${centerY + dy}`;
                const sensors = this.grid.get(key) || [];

                for (const sensor of sensors) {
                    const distance = Math.sqrt(
                        Math.pow(sensor.x - x, 2) + Math.pow(sensor.y - y, 2)
                    );
                    if (distance <= radius) {
                        nearby.push({ sensor, distance });
                    }
                }
            }
        }

        return nearby.sort((a, b) => a.distance - b.distance);
    }
}

// 🆕 NEW: EMA Metrics for memory efficiency
class EMAMetrics {
    constructor(alpha = 0.1) {
        this.alpha = alpha;
        this.metrics = new Map();
    }

    update(metricName, value) {
        if (!this.metrics.has(metricName)) {
            this.metrics.set(metricName, value);
        } else {
            const current = this.metrics.get(metricName);
            const updated = this.alpha * value + (1 - this.alpha) * current;
            this.metrics.set(metricName, updated);
        }
    }

    get(metricName) {
        return this.metrics.get(metricName) || 0;
    }
}

// 🆕 NEW: Coordinated Controller for smart control
class CoordinatedController {
    constructor() {
        this.controllers = new Map();
    }

    calculateOptimalCommands(actuators, sensors, targets, userId, location) {
        const commands = [];

        // Sort actuators by priority (most efficient first)
        const sortedActuators = this.prioritizeActuators(actuators, sensors, targets);

        for (const actuator of sortedActuators) {
            const localError = this.calculateLocalError(actuator, sensors, targets);

            // Get or create PID controller
            const controllerId = `${userId}-${location}-${actuator.actuator_id}`;
            if (!this.controllers.has(controllerId)) {
                this.controllers.set(controllerId, new AdaptivePIDController(
                    controllerId,
                    actuator.actuator_type,
                    actuator.max_power
                ));
            }

            const pidController = this.controllers.get(controllerId);
            const pidOutput = pidController.calculate(localError, 30); // 30 second intervals

            // Convert to command
            const command = this.convertToCommand(userId, location, actuator, pidOutput, targets);

            if (command && Math.abs(command.commandValue) > 1) {
                commands.push(command);
            }
        }

        return commands;
    }

    prioritizeActuators(actuators, sensors, targets) {
        return actuators.sort((a, b) => {
            const errorA = Math.abs(this.calculateLocalError(a, sensors, targets));
            const errorB = Math.abs(this.calculateLocalError(b, sensors, targets));
            return errorB - errorA; // Higher error = higher priority
        });
    }

    calculateLocalError(actuator, sensors, targets) {
        // Find nearest sensor
        let nearestSensor = sensors[0];
        let minDistance = Infinity;

        for (const sensor of sensors) {
            const distance = Math.sqrt(
                Math.pow(sensor.x - actuator.x_coordinate, 2) +
                Math.pow(sensor.y - actuator.y_coordinate, 2)
            );
            if (distance < minDistance) {
                minDistance = distance;
                nearestSensor = sensor;
            }
        }

        return targets.temperature - nearestSensor.temperature;
    }

    convertToCommand(userId, location, actuator, pidOutput, targets) {
        let commandType = '';
        let commandValue = 0;

        switch (actuator.actuator_type) {
            case 'heater':
                if (pidOutput > 0) {
                    commandType = 'heating';
                    commandValue = Math.min(pidOutput, actuator.max_power);
                }
                break;
            case 'cooler':
                if (pidOutput < 0) {
                    commandType = 'cooling';
                    commandValue = Math.min(Math.abs(pidOutput), actuator.max_power);
                }
                break;
            case 'fan':
                commandType = 'fan_speed';
                commandValue = Math.min(Math.abs(pidOutput) * 0.6, actuator.max_power);
                break;
        }

        if (commandValue === 0) return null;

        return {
            userId,
            location,
            actuatorId: actuator.actuator_id,
            commandType,
            commandValue,
            targetTemperature: targets.temperature,
            actualTemperature: 0, // Will be filled by calling function
            pidOutput,
            energyCost: 0 // Will be calculated by calling function
        };
    }
}


module.exports = SpatialTemperatureController;
