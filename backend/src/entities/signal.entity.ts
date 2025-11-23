import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('signals')
export class Signal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  @Column('jsonb')
  indicators: any; // {ema12, ema26, rsi, score}

  @Column()
  cadenceWindow: string; // e.g. 6h

  @CreateDateColumn()
  generatedAt: Date;
}

