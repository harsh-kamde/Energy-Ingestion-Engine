import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrentMeterStatus } from '../entities/current-meter-status.entity';
import { CurrentVehicleStatus } from '../entities/current-vehicle-status.entity';
import { MeterTelemetryHistory } from '../entities/meter-telemetry-history.entity';
import { VehicleTelemetryHistory } from '../entities/vehicle-telemetry-history.entity';
import { IngestionService } from '../services/ingestion.service';
import { AnalyticsService } from '../services/analytics.service';
import { IngestionController } from '../controllers/ingestion.controller';
import { AnalyticsController } from '../controllers/analytics.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CurrentMeterStatus,
      CurrentVehicleStatus,
      MeterTelemetryHistory,
      VehicleTelemetryHistory,
    ]),
  ],
  controllers: [IngestionController, AnalyticsController],
  providers: [IngestionService, AnalyticsService],
  exports: [IngestionService, AnalyticsService],
})
export class TelemetryModule {}
