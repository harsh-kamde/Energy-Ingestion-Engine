import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IngestionService } from '../services/ingestion.service';
import {
  MeterTelemetryDto,
  MeterTelemetryBatchDto,
} from '../dto/meter-telemetry.dto';
import {
  VehicleTelemetryDto,
  VehicleTelemetryBatchDto,
} from '../dto/vehicle-telemetry.dto';

@ApiTags('Ingestion')
@Controller('v1/ingest')
@UsePipes(new ValidationPipe({ transform: true }))
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(private readonly ingestionService: IngestionService) {}

  @Post('meter')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest meter telemetry',
    description:
      'Accepts smart meter readings and stores them in hot and cold storage',
  })
  @ApiResponse({ status: 202, description: 'Telemetry accepted for processing' })
  @ApiResponse({ status: 400, description: 'Invalid telemetry data' })
  async ingestMeter(@Body() data: MeterTelemetryDto): Promise<{ status: string }> {
    this.logger.log(`Ingesting meter telemetry for ${data.meterId}`);
    await this.ingestionService.ingestMeterTelemetry(data);
    return { status: 'accepted' };
  }

  @Post('vehicle')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ingest vehicle telemetry',
    description:
      'Accepts EV/charger readings and stores them in hot and cold storage',
  })
  @ApiResponse({ status: 202, description: 'Telemetry accepted for processing' })
  @ApiResponse({ status: 400, description: 'Invalid telemetry data' })
  async ingestVehicle(@Body() data: VehicleTelemetryDto): Promise<{ status: string }> {
    this.logger.log(`Ingesting vehicle telemetry for ${data.vehicleId}`);
    await this.ingestionService.ingestVehicleTelemetry(data);
    return { status: 'accepted' };
  }

  @Post('meter/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Batch ingest meter telemetry',
    description:
      'Accepts multiple meter readings in a single request for high-throughput scenarios',
  })
  @ApiResponse({ status: 202, description: 'Batch accepted for processing' })
  @ApiResponse({ status: 400, description: 'Invalid batch data' })
  async ingestMeterBatch(
    @Body() data: MeterTelemetryBatchDto,
  ): Promise<{ status: string; count: number }> {
    this.logger.log(`Ingesting batch of ${data.readings.length} meter readings`);
    await this.ingestionService.ingestMeterBatch(data.readings);
    return { status: 'accepted', count: data.readings.length };
  }

  @Post('vehicle/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Batch ingest vehicle telemetry',
    description:
      'Accepts multiple vehicle readings in a single request for high-throughput scenarios',
  })
  @ApiResponse({ status: 202, description: 'Batch accepted for processing' })
  @ApiResponse({ status: 400, description: 'Invalid batch data' })
  async ingestVehicleBatch(
    @Body() data: VehicleTelemetryBatchDto,
  ): Promise<{ status: string; count: number }> {
    this.logger.log(`Ingesting batch of ${data.readings.length} vehicle readings`);
    await this.ingestionService.ingestVehicleBatch(data.readings);
    return { status: 'accepted', count: data.readings.length };
  }
}
