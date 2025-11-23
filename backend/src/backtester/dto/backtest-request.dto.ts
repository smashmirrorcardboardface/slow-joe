import { IsString, IsNumber, IsArray, IsOptional, Min, Max } from 'class-validator';

export class BacktestRequestDto {
  @IsString()
  startDate: string; // ISO date string or 'YYYY-MM-DD'

  @IsString()
  endDate: string; // ISO date string or 'YYYY-MM-DD'

  @IsNumber()
  @Min(1)
  initialCapital: number; // Starting capital in USD

  @IsArray()
  @IsString({ each: true })
  universe: string[]; // e.g., ['BTC-USD', 'ETH-USD']

  @IsNumber()
  @Min(1)
  @IsOptional()
  cadenceHours?: number; // Default: 6

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  maxAllocFraction?: number; // Default: 0.1

  @IsNumber()
  @IsOptional()
  rsiLow?: number; // Default: 40

  @IsNumber()
  @IsOptional()
  rsiHigh?: number; // Default: 70

  @IsNumber()
  @IsOptional()
  volatilityPausePct?: number; // Default: 18

  @IsNumber()
  @IsOptional()
  minOrderUsd?: number; // Default: 5

  @IsNumber()
  @IsOptional()
  slippagePct?: number; // Default: 0.001 (0.1%)

  @IsNumber()
  @IsOptional()
  feeRate?: number; // Default: 0.0016 (0.16% maker fee)

  @IsNumber()
  @IsOptional()
  cooldownCycles?: number; // Default: 2

  @IsString()
  @IsOptional()
  ohlcvData?: string; // CSV data if provided, otherwise will fetch from exchange
}

