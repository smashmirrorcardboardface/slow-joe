import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

@Entity('ohlcv')
@Index(['symbol', 'interval', 'time'], { unique: true })
export class OHLCV {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string; // e.g., BTC-USD

  @Column()
  interval: string; // e.g., 1h, 6h, 1d

  @Column('timestamp')
  time: Date;

  @Column('decimal', { precision: 18, scale: 8 })
  open: string;

  @Column('decimal', { precision: 18, scale: 8 })
  high: string;

  @Column('decimal', { precision: 18, scale: 8 })
  low: string;

  @Column('decimal', { precision: 18, scale: 8 })
  close: string;

  @Column('decimal', { precision: 18, scale: 8 })
  volume: string;

  @CreateDateColumn()
  createdAt: Date;
}

