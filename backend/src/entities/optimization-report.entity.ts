import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('optimization_reports')
export class OptimizationReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'timestamp' })
  runDate: Date;

  @Column({ type: 'jsonb' })
  metrics: any;

  @Column({ type: 'jsonb' })
  currentSettings: any;

  @Column({ type: 'jsonb' })
  recommendations: any;

  @Column({ type: 'jsonb' })
  appliedChanges: any;

  @Column({ type: 'varchar', default: 'completed' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}

