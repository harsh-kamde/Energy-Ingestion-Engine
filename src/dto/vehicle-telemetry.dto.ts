import {
  IsString,
  IsNumber,
  IsDateString,
  Min,
  Max,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class VehicleTelemetryDto {
  @ApiProperty({
    description: 'Unique identifier for the vehicle',
    example: 'VEHICLE_001',
  })
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  @ApiProperty({
    description: 'State of Charge (battery percentage)',
    example: 85.5,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  soc: number;

  @ApiProperty({
    description: 'DC energy delivered to battery in kWh',
    example: 42.123,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  kwhDeliveredDc: number;

  @ApiProperty({
    description: 'Battery temperature in Celsius',
    example: 35.5,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  batteryTemp?: number;

  @ApiProperty({
    description: 'Timestamp of the reading in ISO 8601 format',
    example: '2026-02-09T10:30:00Z',
  })
  @IsDateString()
  timestamp: string;
}

export class VehicleTelemetryBatchDto {
  @ApiProperty({
    description: 'Array of vehicle telemetry readings',
    type: [VehicleTelemetryDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehicleTelemetryDto)
  readings: VehicleTelemetryDto[];
}