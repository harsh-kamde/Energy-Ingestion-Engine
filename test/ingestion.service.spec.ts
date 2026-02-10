import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IngestionService } from '../src/services/ingestion.service';
import { CurrentMeterStatus } from '../src/entities/current-meter-status.entity';
import { CurrentVehicleStatus } from '../src/entities/current-vehicle-status.entity';
import { MeterTelemetryHistory } from '../src/entities/meter-telemetry-history.entity';
import { VehicleTelemetryHistory } from '../src/entities/vehicle-telemetry-history.entity';
import { MeterTelemetryDto } from '../src/dto/meter-telemetry.dto';
import { VehicleTelemetryDto } from '../src/dto/vehicle-telemetry.dto';

describe('IngestionService', () => {
  let service: IngestionService;
  let dataSource: DataSource;

  const mockQueryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orUpdate: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };

  const mockManager = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockDataSource = {
    transaction: jest.fn((cb) => cb(mockManager)),
    isInitialized: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionService,
        {
          provide: getRepositoryToken(CurrentMeterStatus),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(CurrentVehicleStatus),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(MeterTelemetryHistory),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(VehicleTelemetryHistory),
          useClass: Repository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<IngestionService>(IngestionService);
    dataSource = module.get<DataSource>(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('ingestMeterTelemetry', () => {
    it('should successfully ingest meter telemetry', async () => {
      const meterData: MeterTelemetryDto = {
        meterId: 'METER_001',
        kwhConsumedAc: 125.456,
        voltage: 240.5,
        timestamp: '2026-02-09T10:30:00Z',
      };

      await expect(
        service.ingestMeterTelemetry(meterData),
      ).resolves.not.toThrow();

      // Verify transaction was called
      expect(dataSource.transaction).toHaveBeenCalled();
      
      // Verify two insert operations (hot + cold)
      expect(mockManager.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('should handle concurrent meter updates correctly', async () => {
      const readings = Array.from({ length: 10 }, (_, i) => ({
        meterId: 'METER_001',
        kwhConsumedAc: 100 + i,
        voltage: 240 + i * 0.1,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }));

      // Send concurrent updates
      await Promise.all(
        readings.map((reading) => service.ingestMeterTelemetry(reading)),
      );

      // All should succeed without conflicts
      expect(dataSource.transaction).toHaveBeenCalledTimes(10);
    });
  });

  describe('ingestVehicleTelemetry', () => {
    it('should successfully ingest vehicle telemetry', async () => {
      const vehicleData: VehicleTelemetryDto = {
        vehicleId: 'VEHICLE_001',
        soc: 85.5,
        kwhDeliveredDc: 42.123,
        batteryTemp: 35.2,
        timestamp: '2026-02-09T10:30:00Z',
      };

      await expect(
        service.ingestVehicleTelemetry(vehicleData),
      ).resolves.not.toThrow();

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(mockManager.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('should handle optional batteryTemp field', async () => {
      const vehicleData: VehicleTelemetryDto = {
        vehicleId: 'VEHICLE_001',
        soc: 85.5,
        kwhDeliveredDc: 42.123,
        timestamp: '2026-02-09T10:30:00Z',
      };

      await expect(
        service.ingestVehicleTelemetry(vehicleData),
      ).resolves.not.toThrow();
    });
  });

  describe('ingestMeterBatch', () => {
    it('should process batch of meter readings', async () => {
      const readings: MeterTelemetryDto[] = Array.from(
        { length: 100 },
        (_, i) => ({
          meterId: `METER_${String(i).padStart(3, '0')}`,
          kwhConsumedAc: 100 + i,
          voltage: 240,
          timestamp: new Date().toISOString(),
        }),
      );

      await expect(
        service.ingestMeterBatch(readings),
      ).resolves.not.toThrow();

      // Should use single transaction for batch
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should handle large batch (>1000 readings)', async () => {
      const readings: MeterTelemetryDto[] = Array.from(
        { length: 2500 },
        (_, i) => ({
          meterId: `METER_${String(i).padStart(4, '0')}`,
          kwhConsumedAc: 100 + i,
          voltage: 240,
          timestamp: new Date().toISOString(),
        }),
      );

      await expect(
        service.ingestMeterBatch(readings),
      ).resolves.not.toThrow();

      // Should process in multiple batches of 1000
      expect(dataSource.transaction).toHaveBeenCalledTimes(3);
    });
  });

  describe('ingestVehicleBatch', () => {
    it('should process batch of vehicle readings', async () => {
      const readings: VehicleTelemetryDto[] = Array.from(
        { length: 100 },
        (_, i) => ({
          vehicleId: `VEHICLE_${String(i).padStart(3, '0')}`,
          soc: 50 + (i % 50),
          kwhDeliveredDc: 30 + i * 0.1,
          batteryTemp: 35 + (i % 10),
          timestamp: new Date().toISOString(),
        }),
      );

      await expect(
        service.ingestVehicleBatch(readings),
      ).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should throw error on database failure', async () => {
      const failingDataSource = {
        transaction: jest.fn(() => Promise.reject(new Error('DB Error'))),
      };

      const moduleWithError = await Test.createTestingModule({
        providers: [
          IngestionService,
          {
            provide: getRepositoryToken(CurrentMeterStatus),
            useClass: Repository,
          },
          {
            provide: getRepositoryToken(CurrentVehicleStatus),
            useClass: Repository,
          },
          {
            provide: getRepositoryToken(MeterTelemetryHistory),
            useClass: Repository,
          },
          {
            provide: getRepositoryToken(VehicleTelemetryHistory),
            useClass: Repository,
          },
          {
            provide: DataSource,
            useValue: failingDataSource,
          },
        ],
      }).compile();

      const failingService = moduleWithError.get<IngestionService>(
        IngestionService,
      );

      const meterData: MeterTelemetryDto = {
        meterId: 'METER_001',
        kwhConsumedAc: 125.456,
        voltage: 240.5,
        timestamp: '2026-02-09T10:30:00Z',
      };

      await expect(
        failingService.ingestMeterTelemetry(meterData),
      ).rejects.toThrow('DB Error');
    });
  });
});
