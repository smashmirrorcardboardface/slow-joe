import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string; // e.g. BTC-USD

  @Column()
  displayName: string; // BTC

  @Column({ default: true })
  enabled: boolean;
}

