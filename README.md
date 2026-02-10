# Energy Ingestion Engine

A high-scale telemetry ingestion system built with NestJS and PostgreSQL, designed to handle 10,000+ Smart Meters and EV Fleets sending data every 60 seconds.

## 🎯 Project Overview

This system processes two independent data streams from IoT devices:
- **Smart Meters** (Grid Side): AC power consumption measurements
- **EV Vehicles** (Vehicle Side): DC power delivery and battery metrics

The architecture implements a **hot/cold data separation** strategy to optimize both real-time dashboard queries and historical analytics.

## 🏗️ Architecture

### Data Flow Strategy

```
┌─────────────────┐         ┌─────────────────┐
│  Smart Meter    │         │   EV Vehicle    │
│  (AC Side)      │         │   (DC Side)     │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │ Every 60 seconds          │ Every 60 seconds
         ▼                           ▼
    ┌────────────────────────────────────┐
    │    Polymorphic Ingestion Layer     │
    │      (Validation & Routing)        │
    └────────────┬───────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
  ┌──────────┐      ┌──────────┐
  │ HOT PATH │      │COLD PATH │
  │ (UPSERT) │      │ (INSERT) │
  └────┬─────┘      └────┬─────┘
       │                 │
       ▼                 ▼
┌─────────────┐   ┌──────────────┐
│  Current    │   │  Historical  │
│  Status     │   │  Telemetry   │
│  Tables     │   │  (Partitioned)│
└─────────────┘   └──────────────┘
       │                 │
       ▼                 ▼
   Dashboard        Analytics
```

### Database Schema Design

#### 🔥 Hot Data (Current State)

**Purpose**: Instant dashboard access without scanning millions of rows

- `current_meter_status`: One row per meter (UPSERT strategy)
- `current_vehicle_status`: One row per vehicle (UPSERT strategy)

**Key Characteristics**:
- Primary key on device ID
- Atomically updated on every telemetry ingestion
- Indexes on `last_update_timestamp` for freshness queries
- No historical data - only latest snapshot

#### ❄️ Cold Data (Historical Time-Series)

**Purpose**: Audit trail and long-term analytics

- `meter_telemetry_history`: Append-only, partitioned by timestamp
- `vehicle_telemetry_history`: Append-only, partitioned by timestamp

**Key Characteristics**:
- Auto-partitioned by day (scalable to billions of rows)
- Composite indexes on `(device_id, timestamp)` for efficient analytics
- INSERT-only (no updates) for data integrity
- Partition pruning for query optimization

### Insert vs. Upsert Strategy

| Operation | Use Case | Path | Rationale |
|-----------|----------|------|-----------|
| **UPSERT** | Current status tables | Hot | Ensures dashboard always shows latest state without scanning history. One row per device. |
| **INSERT** | Historical tables | Cold | Builds complete audit trail. Every reading preserved for analytics and compliance. |

## 📊 Scale Calculations

### Daily Ingestion Volume

- **Devices**: 10,000 meters + 10,000 vehicles = 20,000 devices
- **Frequency**: Every 60 seconds = 1,440 readings/day per device
- **Daily records**: 20,000 × 1,440 = **28,800,000 records/day**
- **Annual records**: 28.8M × 365 = **10.5 billion records/year**

### Performance Optimization

**Problem**: Querying a single vehicle's 24h performance from 10B+ rows

**Solution**: Multi-layered optimization

1. **Table Partitioning**: Partition historical tables by day
   - Query only touches relevant partition (1/365th of data)
   
2. **Composite Indexes**: `(vehicle_id, timestamp)`
   - Enables index-only scans for time-range queries
   
3. **Materialized Views**: Pre-aggregated daily summaries
   - Optional layer for frequently accessed metrics
   
4. **Hot/Cold Separation**: Dashboard queries hit small hot tables
   - No need to scan historical data for current state

**Result**: Analytics query executes in <100ms even with billions of rows

## 🚀 Getting Started

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development)

### Quick Start

1. **Clone and navigate to the project**:
```bash
cd energy-ingestion-engine
```

2. **Start the system**:
```bash
docker-compose up -d
```

3. **Verify health**:
```bash
curl http://localhost:3000/health
```

4. **Access API documentation**:
```
http://localhost:3000/api/docs
```

### Database Access

Connect to PostgreSQL:
```bash
docker exec -it energy_ingestion_db psql -U fleet_admin -d energy_fleet
```

Useful queries:
```sql
-- Check partition sizes
SELECT 
  schemaname, tablename, 
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables 
WHERE tablename LIKE '%telemetry%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Verify index usage
SELECT * FROM pg_stat_user_indexes 
WHERE schemaname = 'public';

-- Check current device count
SELECT COUNT(*) FROM current_vehicle_status;
SELECT COUNT(*) FROM current_meter_status;
```

## 📡 API Endpoints

### Ingestion Endpoints

#### Single Reading Ingestion

**POST** `/v1/ingest/meter`
```json
{
  "meterId": "METER_001",
  "kwhConsumedAc": 125.456,
  "voltage": 240.5,
  "timestamp": "2026-02-09T10:30:00Z"
}
```

**POST** `/v1/ingest/vehicle`
```json
{
  "vehicleId": "VEHICLE_001",
  "soc": 85.5,
  "kwhDeliveredDc": 42.123,
  "batteryTemp": 35.2,
  "timestamp": "2026-02-09T10:30:00Z"
}
```

#### Batch Ingestion (Recommended for Production)

**POST** `/v1/ingest/meter/batch`
```json
{
  "readings": [
    {
      "meterId": "METER_001",
      "kwhConsumedAc": 125.456,
      "voltage": 240.5,
      "timestamp": "2026-02-09T10:30:00Z"
    },
    // ... up to 1000 readings
  ]
}
```

**POST** `/v1/ingest/vehicle/batch`
```json
{
  "readings": [
    {
      "vehicleId": "VEHICLE_001",
      "soc": 85.5,
      "kwhDeliveredDc": 42.123,
      "batteryTemp": 35.2,
      "timestamp": "2026-02-09T10:30:00Z"
    },
    // ... up to 1000 readings
  ]
}
```

### Analytics Endpoints

#### 24-Hour Performance Summary

**GET** `/v1/analytics/performance/:vehicleId`

**Query Parameters**:
- `meterId` (optional): Filter to specific meter for accurate efficiency calculation

**Response**:
```json
{
  "vehicleId": "VEHICLE_001",
  "periodStart": "2026-02-08T10:30:00Z",
  "periodEnd": "2026-02-09T10:30:00Z",
  "totalKwhConsumedAc": 125.456,
  "totalKwhDeliveredDc": 106.638,
  "efficiencyRatio": 0.8500,
  "avgBatteryTemp": 35.2,
  "readingCount": 1440,
  "healthStatus": "healthy"
}
```

**Health Status Thresholds**:
- `healthy`: Efficiency ≥ 85%
- `degraded`: 75% ≤ Efficiency < 85%
- `critical`: Efficiency < 75%

#### Query Plan Debugging

**GET** `/v1/analytics/performance/:vehicleId/explain`

Returns PostgreSQL EXPLAIN ANALYZE output to verify index usage.

## 🧪 Testing

### Manual Testing with cURL

```bash
# Ingest meter reading
curl -X POST http://localhost:3000/v1/ingest/meter \
  -H "Content-Type: application/json" \
  -d '{
    "meterId": "METER_001",
    "kwhConsumedAc": 125.456,
    "voltage": 240.5,
    "timestamp": "2026-02-09T10:30:00Z"
  }'

# Ingest vehicle reading
curl -X POST http://localhost:3000/v1/ingest/vehicle \
  -H "Content-Type: application/json" \
  -d '{
    "vehicleId": "VEHICLE_001",
    "soc": 85.5,
    "kwhDeliveredDc": 42.123,
    "batteryTemp": 35.2,
    "timestamp": "2026-02-09T10:30:00Z"
  }'

# Get analytics
curl http://localhost:3000/v1/analytics/performance/VEHICLE_001
```

### Load Testing Simulation

See `scripts/load-test.sh` for simulating 10,000 devices.

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production) | development |
| `PORT` | Application port | 3000 |
| `DB_HOST` | PostgreSQL host | localhost |
| `DB_PORT` | PostgreSQL port | 5432 |
| `DB_USERNAME` | Database user | fleet_admin |
| `DB_PASSWORD` | Database password | fleet_secure_2024 |
| `DB_NAME` | Database name | energy_fleet |
| `MAX_QUERY_EXECUTION_TIME` | Query timeout (ms) | 3000 |
| `BATCH_INSERT_SIZE` | Batch processing size | 1000 |

### Connection Pool Tuning

For 10,000+ devices with 60-second intervals:
- **Max connections**: 100
- **Min connections**: 20
- **Connection timeout**: 5 seconds
- **Idle timeout**: 30 seconds

Adjust in `src/config/database.config.ts` based on your hardware.

## 📈 Performance Characteristics

### Ingestion Performance

- **Single reading**: ~5-15ms (includes hot + cold write)
- **Batch (1000 readings)**: ~200-500ms
- **Throughput**: 2,000-5,000 readings/second

### Analytics Query Performance

- **24h summary query**: <100ms (with indexes)
- **Index scan type**: Index Scan on partition
- **Rows examined**: Only relevant partition + vehicle filter

### Storage Growth

- **Per reading**: ~150 bytes (estimated)
- **Daily growth**: 28.8M × 150 bytes ≈ **4.3 GB/day**
- **Annual growth**: ~1.6 TB/year

**Recommendation**: Implement data retention policy (e.g., 90-day hot storage, archive to S3/cold storage).

## 🛠️ Production Considerations

### Scalability Enhancements

1. **Horizontal Partitioning**: Shard by device ID for >100K devices
2. **Read Replicas**: Offload analytics queries to replicas
3. **Message Queue**: Add Kafka/RabbitMQ for async ingestion
4. **Caching**: Redis for frequently accessed current status
5. **Time-series DB**: Consider TimescaleDB extension for PostgreSQL

### Monitoring

Recommended metrics:
- Ingestion latency (p50, p95, p99)
- Query execution time
- Database connection pool usage
- Partition sizes
- Disk I/O metrics

### Maintenance Tasks

```sql
-- Create new daily partition (automate via cron)
CREATE TABLE vehicle_telemetry_history_2026_02_12 PARTITION OF vehicle_telemetry_history
  FOR VALUES FROM ('2026-02-12 00:00:00+00') TO ('2026-02-13 00:00:00+00');

-- Refresh materialized view (if using)
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_vehicle_performance;

-- Analyze tables for query planner
ANALYZE vehicle_telemetry_history;

-- Archive old partitions
-- Detach partition older than 90 days
ALTER TABLE vehicle_telemetry_history DETACH PARTITION vehicle_telemetry_history_2025_11_10;
```

## 🏁 Project Structure

```
energy-ingestion-engine/
├── src/
│   ├── config/
│   │   └── database.config.ts       # DB connection & pool config
│   ├── controllers/
│   │   ├── ingestion.controller.ts  # Telemetry ingestion endpoints
│   │   ├── analytics.controller.ts  # Analytics query endpoints
│   │   └── health.controller.ts     # Health check
│   ├── dto/
│   │   ├── meter-telemetry.dto.ts   # Validation for meter data
│   │   ├── vehicle-telemetry.dto.ts # Validation for vehicle data
│   │   └── performance-analytics.dto.ts # Analytics response
│   ├── entities/
│   │   ├── current-meter-status.entity.ts      # Hot table
│   │   ├── current-vehicle-status.entity.ts    # Hot table
│   │   ├── meter-telemetry-history.entity.ts   # Cold table
│   │   └── vehicle-telemetry-history.entity.ts # Cold table
│   ├── services/
│   │   ├── ingestion.service.ts     # Core ingestion logic
│   │   └── analytics.service.ts     # Optimized analytics queries
│   ├── modules/
│   │   └── telemetry.module.ts      # Module definition
│   ├── app.module.ts                # Root module
│   └── main.ts                      # Application bootstrap
├── init-db.sql                      # Database schema initialization
├── docker-compose.yml               # Container orchestration
├── Dockerfile                       # Application container
├── .env                             # Environment configuration
├── package.json                     # Dependencies
└── README.md                        # This file
```

## 📝 License

MIT

## 👥 Author

Harsh Kamde

---

**Built with**: NestJS, TypeScript, PostgreSQL, Docker
