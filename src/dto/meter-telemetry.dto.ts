import { IsString, IsNumber, IsDateString, Min, IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class MeterTelemetryDto {
  @ApiProperty({
    description: 'Unique identifier for the smart meter',
    example: 'METER_001',
  })
  @IsString()
  @IsNotEmpty()
  meterId: string;

  @ApiProperty({
    description: 'Total AC energy consumed in kWh',
    example: 125.456,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  kwhConsumedAc: number;

  @ApiProperty({
    description: 'Current voltage reading in Volts',
    example: 240.5,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  voltage: number;

  @ApiProperty({
    description: 'Timestamp of the reading in ISO 8601 format',
    example: '2026-02-09T10:30:00Z',
  })
  @IsDateString()
  timestamp: string;
}

export class MeterTelemetryBatchDto {
  @ApiProperty({
    description: 'Array of meter telemetry readings',
    type: [MeterTelemetryDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeterTelemetryDto)
  readings: MeterTelemetryDto[];
}