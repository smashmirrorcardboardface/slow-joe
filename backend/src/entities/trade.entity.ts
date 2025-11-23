import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  @Column()
  side: 'buy' | 'sell';

  @Column('decimal', { precision: 18, scale: 8 })
  quantity: string;

  @Column('decimal', { precision: 18, scale: 8 })
  price: string;

  @Column('decimal', { precision: 18, scale: 8, default: '0' })
  fee: string; // Fee paid in USD

  @Column()
  exchangeOrderId: string;

  @CreateDateColumn()
  createdAt: Date;
}

