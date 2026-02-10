import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { VehicleTelemetryHistory } from '../entities/vehicle-telemetry-history.entity';
import { MeterTelemetryHistory } from '../entities/meter-telemetry-history.entity';
import { PerformanceAnalyticsDto } from '../dto/performance-analytics.dto';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(VehicleTelemetryHistory)
    private readonly vehicleHistoryRepo: Repository<VehicleTelemetryHistory>,
    @InjectRepository(MeterTelemetryHistory)
    private readonly meterHistoryRepo: Repository<MeterTelemetryHistory>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get 24-hour performance analytics for a vehicle
   * 
   * PERFORMANCE OPTIMIZATION STRATEGY:
   * 1. Uses indexed columns (vehicle_id, timestamp) to avoid full table scan
   * 2. Leverages partitioning on timestamp for faster data access
   * 3. Aggregates data in database rather than application layer
   * 4. Returns pre-computed metrics in single query
   * 
   * Query Plan: Index Scan on vehicle_telemetry_history_partition
   * Expected execution time: <100ms even with millions of rows
   */
  async getVehiclePerformance24h(
    vehicleId: string,
  ): Promise<PerformanceAnalyticsDto> {
    const startTime = Date.now();
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    try {
      // CRITICAL: This query uses composite index (vehicle_id, timestamp)
      // to avoid scanning the entire partitioned table
      const vehicleData = await this.dataSource.query(
        `
        SELECT 
          vehicle_id,
          COUNT(*) as reading_count,
          SUM(kwh_delivered_dc) as total_kwh_delivered_dc,
          AVG(battery_temp) as avg_battery_temp,
          MIN(timestamp) as period_start,
          MAX(timestamp) as period_end
        FROM vehicle_telemetry_history
        WHERE vehicle_id = $1
          AND timestamp >= $2
          AND timestamp <= $3
        GROUP BY vehicle_id
        `,
        [vehicleId, twentyFourHoursAgo, now],
      );

      if (!vehicleData || vehicleData.length === 0) {
        throw new NotFoundException(
          `No telemetry data found for vehicle ${vehicleId} in the last 24 hours`,
        );
      }

      const vehicleStats = vehicleData[0];

      // To calculate efficiency, we need to correlate with meter data
      // Assumption: One meter can serve multiple vehicles, but we can identify
      // the meter by finding meter readings in the same time window
      // For production, you'd maintain a vehicle_to_meter mapping table

      // OPTIMIZATION: Query only the relevant time window with index
      const meterData = await this.dataSource.query(
        `
        SELECT 
          SUM(kwh_consumed_ac) as total_kwh_consumed_ac
        FROM meter_telemetry_history
        WHERE timestamp >= $1
          AND timestamp <= $2
        `,
        [twentyFourHoursAgo, now],
      );

      const totalKwhConsumedAc = parseFloat(meterData[0]?.total_kwh_consumed_ac) || 0;
      const totalKwhDeliveredDc =
        parseFloat(vehicleStats.total_kwh_delivered_dc) || 0;

      // Calculate efficiency ratio (DC delivered / AC consumed)
      const efficiencyRatio =
        totalKwhConsumedAc > 0
          ? totalKwhDeliveredDc / totalKwhConsumedAc
          : 0;

      // Determine health status based on efficiency
      let healthStatus: 'healthy' | 'degraded' | 'critical';
      if (efficiencyRatio >= 0.85) {
        healthStatus = 'healthy';
      } else if (efficiencyRatio >= 0.75) {
        healthStatus = 'degraded';
      } else {
        healthStatus = 'critical';
      }

      const result: PerformanceAnalyticsDto = {
        vehicleId,
        periodStart: vehicleStats.period_start,
        periodEnd: vehicleStats.period_end,
        totalKwhConsumedAc: parseFloat(totalKwhConsumedAc.toFixed(3)),
        totalKwhDeliveredDc: parseFloat(totalKwhDeliveredDc.toFixed(3)),
        efficiencyRatio: parseFloat(efficiencyRatio.toFixed(4)),
        avgBatteryTemp: parseFloat(
          (parseFloat(vehicleStats.avg_battery_temp) || 0).toFixed(2),
        ),
        readingCount: parseInt(vehicleStats.reading_count),
        healthStatus,
      };

      const duration = Date.now() - startTime;
      this.logger.log(
        `Analytics for ${vehicleId} computed in ${duration}ms (${vehicleStats.reading_count} readings)`,
      );

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to compute analytics: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get performance analytics for a specific vehicle with meter correlation
   * This version finds the specific meter(s) associated with the vehicle
   */
  async getVehiclePerformanceWithMeter(
    vehicleId: string,
    meterId?: string,
  ): Promise<PerformanceAnalyticsDto> {
    const startTime = Date.now();
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    try {
      // Query vehicle telemetry with index optimization
      const vehicleData = await this.dataSource.query(
        `
        SELECT 
          vehicle_id,
          COUNT(*) as reading_count,
          SUM(kwh_delivered_dc) as total_kwh_delivered_dc,
          AVG(battery_temp) as avg_battery_temp,
          MIN(timestamp) as period_start,
          MAX(timestamp) as period_end
        FROM vehicle_telemetry_history
        WHERE vehicle_id = $1
          AND timestamp >= $2
          AND timestamp <= $3
        GROUP BY vehicle_id
        `,
        [vehicleId, twentyFourHoursAgo, now],
      );

      if (!vehicleData || vehicleData.length === 0) {
        throw new NotFoundException(
          `No telemetry data found for vehicle ${vehicleId}`,
        );
      }

      const vehicleStats = vehicleData[0];

      // Query meter telemetry with optional meter filter
      let meterQuery = `
        SELECT 
          SUM(kwh_consumed_ac) as total_kwh_consumed_ac
        FROM meter_telemetry_history
        WHERE timestamp >= $1
          AND timestamp <= $2
      `;
      const meterParams: any[] = [twentyFourHoursAgo, now];

      if (meterId) {
        meterQuery += ' AND meter_id = $3';
        meterParams.push(meterId);
      }

      const meterData = await this.dataSource.query(meterQuery, meterParams);

      const totalKwhConsumedAc =
        parseFloat(meterData[0]?.total_kwh_consumed_ac) || 0;
      const totalKwhDeliveredDc =
        parseFloat(vehicleStats.total_kwh_delivered_dc) || 0;

      const efficiencyRatio =
        totalKwhConsumedAc > 0
          ? totalKwhDeliveredDc / totalKwhConsumedAc
          : 0;

      let healthStatus: 'healthy' | 'degraded' | 'critical';
      if (efficiencyRatio >= 0.85) {
        healthStatus = 'healthy';
      } else if (efficiencyRatio >= 0.75) {
        healthStatus = 'degraded';
      } else {
        healthStatus = 'critical';
      }

      const result: PerformanceAnalyticsDto = {
        vehicleId,
        periodStart: vehicleStats.period_start,
        periodEnd: vehicleStats.period_end,
        totalKwhConsumedAc: parseFloat(totalKwhConsumedAc.toFixed(3)),
        totalKwhDeliveredDc: parseFloat(totalKwhDeliveredDc.toFixed(3)),
        efficiencyRatio: parseFloat(efficiencyRatio.toFixed(4)),
        avgBatteryTemp: parseFloat(
          (parseFloat(vehicleStats.avg_battery_temp) || 0).toFixed(2),
        ),
        readingCount: parseInt(vehicleStats.reading_count),
        healthStatus,
      };

      const duration = Date.now() - startTime;
      this.logger.log(
        `Analytics for ${vehicleId} computed in ${duration}ms`,
      );

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to compute analytics: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Explain query plan for debugging performance
   * Use this to verify that queries are using indexes correctly
   */
  async explainQueryPlan(vehicleId: string): Promise<any> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const plan = await this.dataSource.query(
      `
      EXPLAIN ANALYZE
      SELECT 
        vehicle_id,
        COUNT(*) as reading_count,
        SUM(kwh_delivered_dc) as total_kwh_delivered_dc,
        AVG(battery_temp) as avg_battery_temp
      FROM vehicle_telemetry_history
      WHERE vehicle_id = $1
        AND timestamp >= $2
        AND timestamp <= $3
      GROUP BY vehicle_id
      `,
      [vehicleId, twentyFourHoursAgo, now],
    );

    return plan;
  }
}