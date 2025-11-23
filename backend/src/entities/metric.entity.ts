import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('metrics')
export class Metric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  key: string; // e.g., NAV

  @Column('jsonb')
  value: any;

  @CreateDateColumn()
  createdAt: Date;
}

