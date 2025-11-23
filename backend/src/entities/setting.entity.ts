import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('settings')
export class Setting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string; // e.g., 'UNIVERSE', 'CADENCE_HOURS', 'MAX_ALLOC_FRACTION'

  @Column('text')
  value: string; // Stored as string, parsed by service

  @Column('text', { nullable: true })
  description: string; // Human-readable description

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

