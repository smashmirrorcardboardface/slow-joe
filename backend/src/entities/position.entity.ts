import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('positions')
export class Position {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  @Column('decimal', { precision: 18, scale: 8 })
  quantity: string;

  @Column('decimal', { precision: 18, scale: 8 })
  entryPrice: string;

  @Column({ type: 'varchar', default: 'open' })
  status: 'open' | 'closed';

  @CreateDateColumn()
  openedAt: Date;

  @Column({ nullable: true })
  closedAt: Date;

  @Column('jsonb', { nullable: true })
  metadata: any;
}

