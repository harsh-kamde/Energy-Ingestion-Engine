import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { TelemetryStatus } from './current-meter-status.entity';

@Entity('meter_telemetry_history')
export class MeterTelemetryHistory {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ name: 'meter_id', type: 'varchar', length: 50 })
  meterId: string;

  @Column({
    name: 'kwh_consumed_ac',
    type: 'decimal',
    precision: 10,
    scale: 3,
  })
  kwhConsumedAc: number;

  @Column({ name: 'voltage', type: 'decimal', precision: 6, scale: 2 })
  voltage: number;

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
