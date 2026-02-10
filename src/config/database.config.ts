import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';

export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: configService.get<string>('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 5432),
  username: configService.get<string>('DB_USERNAME', 'fleet_admin'),
  password: configService.get<string>('DB_PASSWORD', 'fleet_secure_2024'),
  database: configService.get<string>('DB_NAME', 'energy_fleet'),
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false, // Always false in production - use migrations
  logging: configService.get<string>('NODE_ENV') === 'development',
  maxQueryExecutionTime: configService.get<number>(
    'MAX_QUERY_EXECUTION_TIME',
    3000,
  ),
  extra: {
    // Connection pool optimization for high throughput
    max: 100, // Maximum pool size
    min: 20, // Minimum pool size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
});

// DataSource for migrations and CLI
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'fleet_admin',
  password: process.env.DB_PASSWORD || 'fleet_secure_2024',
  database: process.env.DB_NAME || 'energy_fleet',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
