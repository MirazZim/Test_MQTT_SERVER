-- SQL to configure text-based actuators for CO2T, bowlT, sonarT, sugarT
-- Run this in your database to set up the actuators

-- Step 1: Add 'text' to the control_type ENUM (required first!)
ALTER TABLE actuator_types 
MODIFY COLUMN control_type ENUM('binary','continuous','multi-level','analog','text') DEFAULT 'binary';

-- Step 2: Update actuator types 1,2,3,4 to use 'text' control_type
-- These are: bowl_fan_status, sonar_pump_status, co2_fermentation_status, sugar_fermentation_status
UPDATE actuator_types SET control_type = 'text' WHERE id IN (1, 2, 3, 4);

-- Verify the changes
SELECT id, type_code, type_name, control_type 
FROM actuator_types 
WHERE id IN (1, 2, 3, 4);

-- Check actuators with their control types
SELECT a.id, a.actuator_name, a.mqtt_topic, at.type_code, at.control_type
FROM actuators a
INNER JOIN actuator_types at ON a.actuator_type_id = at.id
WHERE a.mqtt_topic IN ('CO2T', 'bowlT', 'sonarT', 'sugarT');
