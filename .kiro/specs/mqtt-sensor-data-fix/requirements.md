# Requirements Document

## Introduction

This document specifies the requirements for fixing the MQTT sensor data handling system. Currently, CO₂ and sonar sensor data is being received by the backend (confirmed via test scripts) but not being saved to the database. The system needs to handle dynamic topic names and ensure all sensor data is properly persisted.

## Glossary

- **MQTT_Handler**: The main component responsible for receiving and routing MQTT messages from the broker
- **Sensor_Service**: The service that processes sensor data and saves it to the database
- **Topic**: The MQTT topic string that identifies the source of sensor data (e.g., "CO2", "level")
- **Sensor_Measurement**: A database record containing a sensor reading with timestamp and value
- **Dynamic_Topic**: A topic name that may not be pre-registered in the database but should still be processed

## Requirements

### Requirement 1: Dynamic Topic Registration

**User Story:** As a system administrator, I want the system to automatically handle sensor data from topics that aren't pre-registered in the database, so that new sensors can be added without manual database configuration.

#### Acceptance Criteria

1. WHEN the MQTT_Handler receives data from an unregistered topic, THE Sensor_Service SHALL log the topic name and payload for debugging purposes
2. WHEN the MQTT_Handler receives data from an unregistered topic, THE Sensor_Service SHALL attempt to match the topic against known sensor type patterns (e.g., "CO2", "level", "temperature")
3. IF a topic matches a known sensor type pattern but has no database entry, THEN THE Sensor_Service SHALL create a default sensor entry and save the measurement
4. WHEN a new sensor is auto-registered, THE Sensor_Service SHALL log the registration event with sensor details

### Requirement 2: CO₂ Sensor Data Persistence

**User Story:** As a user monitoring fermentation, I want CO₂ sensor readings to be saved to the database, so that I can track fermentation progress over time.

#### Acceptance Criteria

1. WHEN the MQTT_Handler receives a message on a CO₂-related topic (e.g., "CO2", "co2", "CO2_level"), THE Sensor_Service SHALL parse the numeric value from the payload
2. WHEN a valid CO₂ value is parsed, THE Sensor_Service SHALL save it to the sensor_measurements table with the correct sensor_id
3. IF the CO₂ value cannot be parsed as a number, THEN THE Sensor_Service SHALL log a warning and skip the measurement
4. WHEN a CO₂ measurement is saved, THE Sensor_Service SHALL emit a Socket.IO event to connected clients

### Requirement 3: Sonar/Level Sensor Data Persistence

**User Story:** As a user monitoring liquid levels, I want sonar distance readings to be saved to the database, so that I can track tank levels over time.

#### Acceptance Criteria

1. WHEN the MQTT_Handler receives a message on a level-related topic (e.g., "level", "sonar", "distance"), THE Sensor_Service SHALL parse the numeric value from the payload
2. WHEN a valid level value is parsed, THE Sensor_Service SHALL save it to the sensor_measurements table with the correct sensor_id
3. IF the level value cannot be parsed as a number, THEN THE Sensor_Service SHALL log a warning and skip the measurement
4. WHEN a level measurement is saved, THE Sensor_Service SHALL emit a Socket.IO event to connected clients

### Requirement 4: Topic Pattern Matching

**User Story:** As a developer, I want the system to use flexible topic pattern matching, so that sensors with slightly different topic names are still recognized.

#### Acceptance Criteria

1. THE Sensor_Service SHALL maintain a configurable mapping of topic patterns to sensor types
2. WHEN matching topics, THE Sensor_Service SHALL use case-insensitive comparison
3. WHEN a topic matches multiple patterns, THE Sensor_Service SHALL use the most specific match
4. THE Sensor_Service SHALL support wildcard patterns for topic matching (e.g., "sensor/+/co2")

### Requirement 5: Database Fallback Handling

**User Story:** As a system operator, I want the system to gracefully handle database lookup failures, so that sensor data is not lost during transient database issues.

#### Acceptance Criteria

1. IF a database query fails during sensor lookup, THEN THE Sensor_Service SHALL retry the operation up to 3 times with exponential backoff
2. IF all retries fail, THEN THE Sensor_Service SHALL log the error and the raw sensor data for manual recovery
3. WHEN the database connection is restored, THE Sensor_Service SHALL resume normal operation without requiring a restart

### Requirement 6: Logging and Debugging

**User Story:** As a developer debugging sensor issues, I want comprehensive logging of the data flow, so that I can identify where data is being lost.

#### Acceptance Criteria

1. WHEN a message is received from MQTT, THE MQTT_Handler SHALL log the topic, payload, and timestamp
2. WHEN a sensor lookup is performed, THE Sensor_Service SHALL log whether the sensor was found in cache, database, or not found
3. WHEN a measurement is saved, THE Sensor_Service SHALL log the sensor_id, value, and measurement_id
4. WHEN a measurement fails to save, THE Sensor_Service SHALL log the error details including SQL error if applicable
