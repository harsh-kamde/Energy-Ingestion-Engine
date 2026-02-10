import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CurrentMeterStatus } from '../entities/current-meter-status.entity';
import { CurrentVehicleStatus } from '../entities/current-vehicle-status.entity';
import { MeterTelemetryHistory } from '../entities/meter-telemetry-history.entity';
import { VehicleTelemetryHistory } from '../entities/vehicle-telemetry-history.entity';
import { MeterTelemetryDto } from '../dto/meter-telemetry.dto';
import { VehicleTelemetryDto } from '../dto/vehicle-telemetry.dto';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectRepository(CurrentMeterStatus)
    private readonly currentMeterRepo: Repository<CurrentMeterStatus>,
    @InjectRepository(CurrentVehicleStatus)
    private readonly currentVehicleRepo: Repository<CurrentVehicleStatus>,
    @InjectRepository(MeterTelemetryHistory)
    private readonly meterHistoryRepo: Repository<MeterTelemetryHistory>,
    @InjectRepository(VehicleTelemetryHistory)
    private readonly vehicleHistoryRepo: Repository<VehicleTelemetryHistory>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Ingest meter telemetry with dual-path strategy:
   * 1. UPSERT to hot table (current_meter_status) for dashboard
   * 2. INSERT to cold table (meter_telemetry_history) for analytics
   */
  async ingestMeterTelemetry(data: MeterTelemetryDto): Promise<void> {
    const startTime = Date.now();

    try {
      await this.dataSource.transaction(async (manager) => {
        // HOT PATH: UPSERT current status
        // This ensures dashboard always shows latest state without scanning history
        await manager
          .createQueryBuilder()
          .insert()
          .into(CurrentMeterStatus)
          .values({
            meterId: data.meterId,
            kwhConsumedAc: data.kwhConsumedAc,
            voltage: data.voltage,
            lastUpdateTimestamp: new Date(data.timestamp),
          })
          .orUpdate(
            [
              'kwh_consumed_ac',
              'voltage',
              'last_update_timestamp',
              'updated_at',
            ],
            ['meter_id'],
          )
          .execute();

        // COLD PATH: INSERT to history for time-series analytics
        // Append-only design for audit trail and long-term reporting
        await manager
          .createQueryBuilder()
          .insert()
          .into(MeterTelemetryHistory)
          .values({
            meterId: data.meterId,
            kwhConsumedAc: data.kwhConsumedAc,
            voltage: data.voltage,
            timestamp: new Date(data.timestamp),
          })
          .execute();
      });

      const duration = Date.now() - startTime;
      this.logger.debug(
        `Meter ${data.meterId} ingested in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to ingest meter telemetry: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Ingest vehicle telemetry with dual-path strategy:
   * 1. UPSERT to hot table (current_vehicle_status) for live SoC display
   * 2. INSERT to cold table (vehicle_telemetry_history) for efficiency analytics
   */
  async ingestVehicleTelemetry(data: VehicleTelemetryDto): Promise<void> {
    const startTime = Date.now();

    try {
      await this.dataSource.transaction(async (manager) => {
        // HOT PATH: UPSERT current status
        await manager
          .createQueryBuilder()
          .insert()
          .into(CurrentVehicleStatus)
          .values({
            vehicleId: data.vehicleId,
            soc: data.soc,
            kwhDeliveredDc: data.kwhDeliveredDc,
            batteryTemp: data.batteryTemp ?? null,
            lastUpdateTimestamp: new Date(data.timestamp),
          })
          .orUpdate(
            [
              'soc',
              'kwh_delivered_dc',
              'battery_temp',
              'last_update_timestamp',
              'updated_at',
            ],
            ['vehicle_id'],
          )
          .execute();

        // COLD PATH: INSERT to history
        await manager
          .createQueryBuilder()
          .insert()
          .into(VehicleTelemetryHistory)
          .values({
            vehicleId: data.vehicleId,
            soc: data.soc,
            kwhDeliveredDc: data.kwhDeliveredDc,
            batteryTemp: data.batteryTemp ?? null,
            timestamp: new Date(data.timestamp),
          })
          .execute();
      });

      const duration = Date.now() - startTime;
      this.logger.debug(
        `Vehicle ${data.vehicleId} ingested in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to ingest vehicle telemetry: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Batch ingestion for high-throughput scenarios
   * Optimized for 10,000+ devices sending data every 60 seconds
   */
  async ingestMeterBatch(readings: MeterTelemetryDto[]): Promise<void> {
    const startTime = Date.now();
    const batchSize = 1000;

    try {
      // Process in batches to avoid memory overflow
      for (let i = 0; i < readings.length; i += batchSize) {
        const batch = readings.slice(i, i + batchSize);

        await this.dataSource.transaction(async (manager) => {
          // Bulk UPSERT for hot table
          const hotValues = batch.map((r) => ({
            meterId: r.meterId,
            kwhConsumedAc: r.kwhConsumedAc,
            voltage: r.voltage,
            lastUpdateTimestamp: new Date(r.timestamp),
          }));

          await manager
            .createQueryBuilder()
            .insert()
            .into(CurrentMeterStatus)
            .values(hotValues)
            .orUpdate(
              [
                'kwh_consumed_ac',
                'voltage',
                'last_update_timestamp',
                'updated_at',
              ],
              ['meter_id'],
            )
            .execute();

          // Bulk INSERT for cold table
          const coldValues = batch.map((r) => ({
            meterId: r.meterId,
            kwhConsumedAc: r.kwhConsumedAc,
            voltage: r.voltage,
            timestamp: new Date(r.timestamp),
          }));

          await manager
            .createQueryBuilder()
            .insert()
            .into(MeterTelemetryHistory)
            .values(coldValues)
            .execute();
        });

        this.logger.debug(`Processed batch ${i / batchSize + 1}`);
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Batch ingested ${readings.length} meter readings in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to ingest meter batch: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async ingestVehicleBatch(readings: VehicleTelemetryDto[]): Promise<void> {
    const startTime = Date.now();
    const batchSize = 1000;

    try {
      for (let i = 0; i < readings.length; i += batchSize) {
        const batch = readings.slice(i, i + batchSize);

        await this.dataSource.transaction(async (manager) => {
          // Bulk UPSERT for hot table
          const hotValues = batch.map((r) => ({
            vehicleId: r.vehicleId,
            soc: r.soc,
            kwhDeliveredDc: r.kwhDeliveredDc,
            batteryTemp: r.batteryTemp ?? null,
            lastUpdateTimestamp: new Date(r.timestamp),
          }));

          await manager
            .createQueryBuilder()
            .insert()
            .into(CurrentVehicleStatus)
            .values(hotValues)
            .orUpdate(
              [
                'soc',
                'kwh_delivered_dc',
                'battery_temp',
                'last_update_timestamp',
                'updated_at',
              ],
              ['vehicle_id'],
            )
            .execute();

          // Bulk INSERT for cold table
          const coldValues = batch.map((r) => ({
            vehicleId: r.vehicleId,
            soc: r.soc,
            kwhDeliveredDc: r.kwhDeliveredDc,
            batteryTemp: r.batteryTemp ?? null,
            timestamp: new Date(r.timestamp),
          }));

          await manager
            .createQueryBuilder()
            .insert()
            .into(VehicleTelemetryHistory)
            .values(coldValues)
            .execute();
        });

        this.logger.debug(`Processed batch ${i / batchSize + 1}`);
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Batch ingested ${readings.length} vehicle readings in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to ingest vehicle batch: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
