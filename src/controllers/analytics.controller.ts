import {
  Controller,
  Get,
  Param,
  Query,
  UsePipes,
  ValidationPipe,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from '../services/analytics.service';
import { PerformanceAnalyticsDto } from '../dto/performance-analytics.dto';

@ApiTags('Analytics')
@Controller('v1/analytics')
@UsePipes(new ValidationPipe({ transform: true }))
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('performance/:vehicleId')
  @ApiOperation({
    summary: 'Get 24-hour performance analytics for a vehicle',
    description:
      'Returns energy consumption, efficiency ratio, and battery metrics for the last 24 hours',
  })
  @ApiParam({
    name: 'vehicleId',
    description: 'Unique vehicle identifier',
    example: 'VEHICLE_001',
  })
  @ApiQuery({
    name: 'meterId',
    description: 'Optional meter ID to correlate specific meter data',
    required: false,
    example: 'METER_001',
  })
  @ApiResponse({
    status: 200,
    description: 'Performance analytics retrieved successfully',
    type: PerformanceAnalyticsDto,
  })
  @ApiResponse({ status: 404, description: 'Vehicle not found or no data available' })
  async getPerformance(
    @Param('vehicleId') vehicleId: string,
    @Query('meterId') meterId?: string,
  ): Promise<PerformanceAnalyticsDto> {
    this.logger.log(`Fetching 24h performance for vehicle ${vehicleId}`);

    if (meterId) {
      return this.analyticsService.getVehiclePerformanceWithMeter(
        vehicleId,
        meterId,
      );
    }

    return this.analyticsService.getVehiclePerformance24h(vehicleId);
  }

  @Get('performance/:vehicleId/explain')
  @ApiOperation({
    summary: 'Get query execution plan for performance analytics',
    description:
      'Debug endpoint to verify query optimization and index usage',
  })
  @ApiParam({
    name: 'vehicleId',
    description: 'Unique vehicle identifier',
    example: 'VEHICLE_001',
  })
  @ApiResponse({
    status: 200,
    description: 'Query execution plan',
  })
  async explainQueryPlan(@Param('vehicleId') vehicleId: string): Promise<any> {
    this.logger.log(`Explaining query plan for vehicle ${vehicleId}`);
    return this.analyticsService.explainQueryPlan(vehicleId);
  }
}
