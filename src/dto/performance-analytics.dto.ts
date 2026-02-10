import { ApiProperty } from '@nestjs/swagger';

export class PerformanceAnalyticsDto {
  @ApiProperty({
    description: 'Vehicle identifier',
    example: 'VEHICLE_001',
  })
  vehicleId: string;

  @ApiProperty({
    description: 'Analysis period start time',
    example: '2026-02-08T10:30:00Z',
  })
  periodStart: string;

  @ApiProperty({
    description: 'Analysis period end time',
    example: '2026-02-09T10:30:00Z',
  })
  periodEnd: string;

  @ApiProperty({
    description: 'Total AC energy consumed from grid in kWh',
    example: 125.456,
  })
  totalKwhConsumedAc: number;

  @ApiProperty({
    description: 'Total DC energy delivered to battery in kWh',
    example: 106.638,
  })
  totalKwhDeliveredDc: number;

  @ApiProperty({
    description: 'Energy conversion efficiency ratio (DC/AC)',
    example: 0.85,
  })
  efficiencyRatio: number;

  @ApiProperty({
    description: 'Average battery temperature in Celsius',
    example: 35.2,
  })
  avgBatteryTemp: number;

  @ApiProperty({
    description: 'Number of telemetry readings in period',
    example: 1440,
  })
  readingCount: number;

  @ApiProperty({
    description: 'Health status based on efficiency',
    example: 'healthy',
    enum: ['healthy', 'degraded', 'critical'],
  })
  healthStatus: 'healthy' | 'degraded' | 'critical';
}
