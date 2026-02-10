import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { TelemetryStatus } from './current-meter-status.entity';

@Entity('vehicle_telemetry_history')
export class VehicleTelemetryHistory {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ name: 'vehicle_id', type: 'varchar', length: 50 })
  vehicleId: string;

  @Column({ name: 'soc', type: 'decimal', precision: 5, scale: 2 })
  soc: number;

  @Column({
    name: 'kwh_delivered_dc',
    type: 'decimal',
    precision: 10,
    scale: 3,
  })
  kwhDeliveredDc: number;

  @Column({
    name: 'battery_temp',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  batteryTemp: number | null;

  @Column({ name: 'timestamp', type: 'timestamptz' })
  timestamp: Date;

  @Column({
    name: 'status',
    type: 'enum',
    enum: TelemetryStatus,
    default: TelemetryStatus.VALID,
  })
  status: TelemetryStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
