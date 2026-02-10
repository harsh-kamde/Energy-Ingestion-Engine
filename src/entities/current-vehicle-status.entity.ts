import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TelemetryStatus } from './current-meter-status.entity';

@Entity('current_vehicle_status')
export class CurrentVehicleStatus {
  @PrimaryColumn({ name: 'vehicle_id', type: 'varchar', length: 50 })
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

  @Column({ name: 'last_update_timestamp', type: 'timestamptz' })
  lastUpdateTimestamp: Date;

  @Column({
    name: 'status',
    type: 'enum',
    enum: TelemetryStatus,
    default: TelemetryStatus.VALID,
  })
  status: TelemetryStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
