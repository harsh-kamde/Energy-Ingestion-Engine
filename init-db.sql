-- Database initialization script for Energy Ingestion Engine
-- This creates optimized tables for hot/cold data separation

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types for data quality
CREATE TYPE telemetry_status AS ENUM ('valid', 'anomaly', 'missing');

-- =====================================================
-- HOT DATA TABLES (Current State - Optimized for UPSERT)
-- =====================================================

-- Current meter status (one row per meter, constantly updated)
CREATE TABLE current_meter_status (
    meter_id VARCHAR(50) PRIMARY KEY,
    kwh_consumed_ac DECIMAL(10, 3) NOT NULL,
    voltage DECIMAL(6, 2) NOT NULL,
    last_update_timestamp TIMESTAMPTZ NOT NULL,
    status telemetry_status DEFAULT 'valid',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_current_meter_last_update ON current_meter_status(last_update_timestamp DESC);

-- Current vehicle status (one row per vehicle, constantly updated)
CREATE TABLE current_vehicle_status (
    vehicle_id VARCHAR(50) PRIMARY KEY,
    soc DECIMAL(5, 2) NOT NULL CHECK (soc >= 0 AND soc <= 100),
    kwh_delivered_dc DECIMAL(10, 3) NOT NULL,
    battery_temp DECIMAL(5, 2),
    last_update_timestamp TIMESTAMPTZ NOT NULL,
    status telemetry_status DEFAULT 'valid',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_current_vehicle_last_update ON current_vehicle_status(last_update_timestamp DESC);
CREATE INDEX idx_current_vehicle_soc ON current_vehicle_status(soc);

-- =====================================================
-- COLD DATA TABLES (Historical - Append-Only, Partitioned)
-- =====================================================

-- Historical meter telemetry (billions of rows, time-series optimized)
CREATE TABLE meter_telemetry_history (
    id BIGSERIAL,
    meter_id VARCHAR(50) NOT NULL,
    kwh_consumed_ac DECIMAL(10, 3) NOT NULL,
    voltage DECIMAL(6, 2) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    status telemetry_status DEFAULT 'valid',
    created_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (timestamp);

-- Create partitions for the next 7 days (can be automated)
CREATE TABLE meter_telemetry_history_2026_02_09 PARTITION OF meter_telemetry_history
    FOR VALUES FROM ('2026-02-09 00:00:00+00') TO ('2026-02-10 00:00:00+00');

CREATE TABLE meter_telemetry_history_2026_02_10 PARTITION OF meter_telemetry_history
    FOR VALUES FROM ('2026-02-10 00:00:00+00') TO ('2026-02-11 00:00:00+00');

CREATE TABLE meter_telemetry_history_2026_02_11 PARTITION OF meter_telemetry_history
    FOR VALUES FROM ('2026-02-11 00:00:00+00') TO ('2026-02-12 00:00:00+00');

-- Indexes on partitions for fast lookups
CREATE INDEX idx_meter_history_meter_time ON meter_telemetry_history(meter_id, timestamp DESC);
CREATE INDEX idx_meter_history_timestamp ON meter_telemetry_history(timestamp DESC);

-- Historical vehicle telemetry (billions of rows, time-series optimized)
CREATE TABLE vehicle_telemetry_history (
    id BIGSERIAL,
    vehicle_id VARCHAR(50) NOT NULL,
    soc DECIMAL(5, 2) NOT NULL CHECK (soc >= 0 AND soc <= 100),
    kwh_delivered_dc DECIMAL(10, 3) NOT NULL,
    battery_temp DECIMAL(5, 2),
    timestamp TIMESTAMPTZ NOT NULL,
    status telemetry_status DEFAULT 'valid',
    created_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (timestamp);

-- Create partitions for the next 7 days
CREATE TABLE vehicle_telemetry_history_2026_02_09 PARTITION OF vehicle_telemetry_history
    FOR VALUES FROM ('2026-02-09 00:00:00+00') TO ('2026-02-10 00:00:00+00');

CREATE TABLE vehicle_telemetry_history_2026_02_10 PARTITION OF vehicle_telemetry_history
    FOR VALUES FROM ('2026-02-10 00:00:00+00') TO ('2026-02-11 00:00:00+00');

CREATE TABLE vehicle_telemetry_history_2026_02_11 PARTITION OF vehicle_telemetry_history
    FOR VALUES FROM ('2026-02-11 00:00:00+00') TO ('2026-02-12 00:00:00+00');

-- Indexes on partitions for fast analytics
CREATE INDEX idx_vehicle_history_vehicle_time ON vehicle_telemetry_history(vehicle_id, timestamp DESC);
CREATE INDEX idx_vehicle_history_timestamp ON vehicle_telemetry_history(timestamp DESC);

-- =====================================================
-- ANALYTICS MATERIALIZED VIEW (Pre-aggregated for Performance)
-- =====================================================

-- Daily performance summary (refreshed periodically)
CREATE MATERIALIZED VIEW daily_vehicle_performance AS
SELECT 
    vehicle_id,
    DATE(timestamp) as performance_date,
    COUNT(*) as reading_count,
    SUM(kwh_delivered_dc) as total_kwh_delivered_dc,
    AVG(battery_temp) as avg_battery_temp,
    MIN(soc) as min_soc,
    MAX(soc) as max_soc,
    AVG(soc) as avg_soc
FROM vehicle_telemetry_history
GROUP BY vehicle_id, DATE(timestamp);

CREATE UNIQUE INDEX idx_daily_perf_vehicle_date ON daily_vehicle_performance(vehicle_id, performance_date DESC);

-- =====================================================
-- TRIGGERS FOR AUTOMATIC TIMESTAMP UPDATES
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_meter_status_timestamp
    BEFORE UPDATE ON current_meter_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vehicle_status_timestamp
    BEFORE UPDATE ON current_vehicle_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- PERFORMANCE OPTIMIZATION SETTINGS
-- =====================================================

-- Analyze tables for query optimization
ANALYZE current_meter_status;
ANALYZE current_vehicle_status;
ANALYZE meter_telemetry_history;
ANALYZE vehicle_telemetry_history;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO fleet_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO fleet_admin;
