# Architecture Deep Dive

## Design Philosophy

The Energy Ingestion Engine is built on three core principles:

1. **Separation of Concerns**: Hot data (current state) vs Cold data (historical audit trail)
2. **Write Optimization**: High-throughput ingestion with minimal latency
3. **Read Optimization**: Fast analytics without full table scans

## Data Correlation Strategy

### The Challenge

We receive two independent telemetry streams:

```
Smart Meter Stream:
- Measures AC power consumed from grid
- Reports: kwhConsumedAc, voltage
- Billing-side measurement

EV Vehicle Stream:
- Measures DC power delivered to battery
- Reports: kwhDeliveredDc, SoC, batteryTemp
- Vehicle-side measurement
```

### The Correlation Problem

**Physical Reality**: `AC Consumed > DC Delivered` (always)

Why? Energy loss during AC→DC conversion (heat, inefficiency)

**Business Logic**:
- Efficiency = DC Delivered / AC Consumed
- Healthy system: ~85-95% efficiency
- Below 85%: Potential hardware fault or energy leakage

### Implementation Approach

**Option 1: Direct Join (Not Scalable)**
```sql
-- BAD: Requires full table scan and temporal correlation
SELECT 
  v.vehicle_id,
  SUM(m.kwh_consumed_ac) as total_ac,
  SUM(v.kwh_delivered_dc) as total_dc
FROM vehicle_telemetry_history v
JOIN meter_telemetry_history m 
  ON ABS(EXTRACT(EPOCH FROM (v.timestamp - m.timestamp))) < 60
WHERE v.vehicle_id = 'VEHICLE_001'
  AND v.timestamp >= NOW() - INTERVAL '24 hours';
```

**Problem**: 
- Cross-partition joins on billions of rows
- Time-based correlation is fuzzy (±60 seconds)
- No clear vehicle-to-meter mapping

**Option 2: Aggregation with Time Windows (Current Implementation)**
```sql
-- GOOD: Separate aggregations with partition pruning
-- Vehicle data
SELECT SUM(kwh_delivered_dc) as total_dc
FROM vehicle_telemetry_history
WHERE vehicle_id = $1
  AND timestamp >= $2 AND timestamp <= $3;

-- Meter data  
SELECT SUM(kwh_consumed_ac) as total_ac
FROM meter_telemetry_history
WHERE timestamp >= $2 AND timestamp <= $3;
```

**Advantages**:
- Each query uses partition pruning + index
- No complex joins
- Can correlate at application layer

**Option 3: Mapping Table (Production Enhancement)**
```sql
CREATE TABLE vehicle_meter_mapping (
  vehicle_id VARCHAR(50) PRIMARY KEY,
  meter_id VARCHAR(50) NOT NULL,
  charger_id VARCHAR(50),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ
);

-- Query with specific meter correlation
SELECT SUM(kwh_consumed_ac) as total_ac
FROM meter_telemetry_history
WHERE meter_id = (
  SELECT meter_id FROM vehicle_meter_mapping 
  WHERE vehicle_id = $1
)
AND timestamp >= $2 AND timestamp <= $3;
```

## Hot vs Cold Storage Architecture

### Hot Storage (Current State)

**Tables**:
- `current_meter_status`
- `current_vehicle_status`

**Characteristics**:
```sql
-- Primary key on device ID ensures single row per device
PRIMARY KEY (vehicle_id)

-- UPSERT operation (ON CONFLICT DO UPDATE)
INSERT INTO current_vehicle_status (...)
VALUES (...)
ON CONFLICT (vehicle_id) 
DO UPDATE SET 
  soc = EXCLUDED.soc,
  kwh_delivered_dc = EXCLUDED.kwh_delivered_dc,
  ...;
```

**Use Cases**:
- Dashboard: "What is the current SoC of all vehicles?"
- Monitoring: "Which vehicles need charging?"
- Alerts: "Any meters showing voltage anomalies?"

**Why Not Use History Tables?**
```sql
-- BAD: Scanning millions of rows for latest state
SELECT DISTINCT ON (vehicle_id)
  vehicle_id, soc, kwh_delivered_dc
FROM vehicle_telemetry_history
ORDER BY vehicle_id, timestamp DESC;

-- GOOD: Direct lookup in hot table
SELECT vehicle_id, soc, kwh_delivered_dc
FROM current_vehicle_status;
```

### Cold Storage (Historical Audit Trail)

**Tables**:
- `meter_telemetry_history` (partitioned by day)
- `vehicle_telemetry_history` (partitioned by day)

**Partitioning Strategy**:
```sql
-- Parent table
CREATE TABLE vehicle_telemetry_history (
  id BIGSERIAL,
  vehicle_id VARCHAR(50),
  timestamp TIMESTAMPTZ,
  ...
) PARTITION BY RANGE (timestamp);

-- Child partitions (one per day)
CREATE TABLE vehicle_telemetry_history_2026_02_09
  PARTITION OF vehicle_telemetry_history
  FOR VALUES FROM ('2026-02-09 00:00:00+00') 
               TO ('2026-02-10 00:00:00+00');
```

**Query Optimization**:
```sql
-- Partition pruning in action
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM vehicle_telemetry_history
WHERE vehicle_id = 'VEHICLE_001'
  AND timestamp >= '2026-02-09 00:00:00'
  AND timestamp < '2026-02-10 00:00:00';

-- Result: Only scans vehicle_telemetry_history_2026_02_09
-- Skips all other 364 partitions!
```

**Index Strategy**:
```sql
-- Composite index for time-range queries
CREATE INDEX idx_vehicle_history_vehicle_time 
ON vehicle_telemetry_history(vehicle_id, timestamp DESC);

-- Usage pattern
WHERE vehicle_id = 'VEHICLE_001'  -- Uses index
  AND timestamp >= $1              -- Index range scan
  AND timestamp <= $2              -- Index range scan
```

## Handling 14.4 Million Records Daily

### Scale Calculation

```
10,000 meters × 1,440 readings/day  = 14,400,000 meter records
10,000 vehicles × 1,440 readings/day = 14,400,000 vehicle records
───────────────────────────────────────────────────────────────
Total: 28,800,000 records/day
```

### Write Performance

**Single Transaction (Hot + Cold Write)**:
```
1. BEGIN TRANSACTION
2. UPSERT current_vehicle_status  (~2ms)
3. INSERT vehicle_telemetry_history (~3ms)
4. COMMIT TRANSACTION (~1ms)
───────────────────────────────────
Total: ~6ms per reading
```

**Theoretical Throughput**:
```
1 second / 6ms = ~166 readings/second
166 × 60 × 60 = ~600,000 readings/hour
600,000 × 24 = ~14.4 million readings/day per instance
```

**Batch Optimization**:
```typescript
// Process 1000 readings at once
await manager
  .createQueryBuilder()
  .insert()
  .into(CurrentVehicleStatus)
  .values(hotValues)  // 1000 values
  .orUpdate([...], ['vehicle_id'])
  .execute();

// Result: ~200ms for 1000 readings
// Throughput: 5000 readings/second
// Daily capacity: 432 million readings/day
```

### Storage Growth

**Per Record Storage**:
```
vehicle_telemetry_history:
- id (bigint): 8 bytes
- vehicle_id (varchar 50): ~15 bytes
- soc (decimal 5,2): 8 bytes  
- kwh_delivered_dc (decimal 10,3): 8 bytes
- battery_temp (decimal 5,2): 8 bytes
- timestamp (timestamptz): 8 bytes
- status (enum): 4 bytes
- created_at (timestamptz): 8 bytes
─────────────────────────────────
Subtotal: ~67 bytes

+ Index overhead: ~50 bytes
+ PostgreSQL overhead: ~30 bytes
─────────────────────────────────
Total: ~150 bytes/record
```

**Growth Projections**:
```
Daily:   28.8M × 150 bytes = 4.3 GB
Weekly:  4.3 GB × 7         = 30 GB
Monthly: 4.3 GB × 30        = 129 GB
Yearly:  4.3 GB × 365       = 1.6 TB
```

### Partition Management

**Automated Partition Creation**:
```sql
-- Cron job: Create tomorrow's partition
CREATE OR REPLACE FUNCTION create_next_partition()
RETURNS void AS $$
DECLARE
  tomorrow DATE := CURRENT_DATE + INTERVAL '1 day';
  partition_name TEXT;
BEGIN
  partition_name := 'vehicle_telemetry_history_' || 
                   TO_CHAR(tomorrow, 'YYYY_MM_DD');
  
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF vehicle_telemetry_history
     FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    tomorrow,
    tomorrow + INTERVAL '1 day'
  );
END;
$$ LANGUAGE plpgsql;
```

**Partition Archival**:
```sql
-- Detach old partitions (>90 days)
ALTER TABLE vehicle_telemetry_history 
DETACH PARTITION vehicle_telemetry_history_2025_11_10;

-- Export to S3/cold storage
COPY vehicle_telemetry_history_2025_11_10 
TO PROGRAM 'aws s3 cp - s3://archive-bucket/2025-11-10.csv';

-- Drop partition to free disk space
DROP TABLE vehicle_telemetry_history_2025_11_10;
```

## Performance Optimization Techniques

### 1. Connection Pooling

```typescript
extra: {
  max: 100,           // Maximum pool size
  min: 20,            // Always-ready connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
}
```

### 2. Batch Processing

```typescript
// Instead of 1000 individual transactions
for (const reading of readings) {
  await insert(reading);  // BAD: 1000 round trips
}

// Use single batch insert
await manager
  .createQueryBuilder()
  .insert()
  .values(readings)    // GOOD: 1 round trip
  .execute();
```

### 3. Index-Only Scans

```sql
-- Query that can be satisfied entirely from index
SELECT vehicle_id, timestamp 
FROM vehicle_telemetry_history
WHERE vehicle_id = 'VEHICLE_001'
  AND timestamp >= NOW() - INTERVAL '24 hours';

-- Index: (vehicle_id, timestamp)
-- PostgreSQL doesn't need to touch table data!
```

### 4. Materialized Views (Optional)

```sql
-- Pre-computed daily aggregates
CREATE MATERIALIZED VIEW daily_vehicle_performance AS
SELECT 
  vehicle_id,
  DATE(timestamp) as day,
  SUM(kwh_delivered_dc) as total_dc,
  AVG(battery_temp) as avg_temp,
  COUNT(*) as reading_count
FROM vehicle_telemetry_history
GROUP BY vehicle_id, DATE(timestamp);

-- Refresh nightly
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_vehicle_performance;

-- Query hits materialized view instead of raw data
SELECT * FROM daily_vehicle_performance
WHERE vehicle_id = 'VEHICLE_001'
  AND day >= CURRENT_DATE - 30;
```

## Failure Scenarios and Recovery

### 1. Database Connection Lost

```typescript
// Automatic retry with exponential backoff
await this.dataSource.transaction(async (manager) => {
  // Transaction automatically retries on connection error
  await manager.save(...);
});
```

### 2. Partition Does Not Exist

```sql
-- Graceful degradation: Insert fails if no partition
-- Solution: Pre-create partitions for next 7 days
-- Monitoring: Alert if partition creation fails
```

### 3. Disk Space Exhausted

```bash
# Monitoring thresholds
- Warning: 80% disk usage
- Critical: 90% disk usage
- Action: Archive old partitions

# Emergency procedure
SELECT pg_size_pretty(pg_database_size('energy_fleet'));
-- If critical, immediately detach oldest partitions
```

### 4. Index Corruption

```sql
-- Rebuild index without locking table
REINDEX INDEX CONCURRENTLY idx_vehicle_history_vehicle_time;
```

## Future Enhancements

1. **TimescaleDB Extension**: Native time-series optimizations
2. **Read Replicas**: Offload analytics to replica nodes
3. **Kafka Integration**: Async ingestion queue
4. **GraphQL API**: Flexible query interface
5. **Real-time Streaming**: WebSocket for live dashboard
6. **ML Integration**: Anomaly detection on efficiency drops
7. **Multi-region**: Active-active deployment

---

**Key Takeaway**: The architecture balances write throughput (28.8M records/day) with read performance (sub-100ms analytics) through strategic use of hot/cold storage, partitioning, and indexing.
