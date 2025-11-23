import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum AlertType {
  ORDER_FAILURE = 'order_failure',
  EXCHANGE_UNREACHABLE = 'exchange_unreachable',
  LOW_BALANCE = 'low_balance',
  LARGE_DRAWDOWN = 'large_drawdown',
  JOB_FAILURE = 'job_failure',
  HEALTH_CHECK_FAILED = 'health_check_failed',
}

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: AlertType,
  })
  type: AlertType;

  @Column({
    type: 'enum',
    enum: AlertSeverity,
    default: AlertSeverity.WARNING,
  })
  severity: AlertSeverity;

  @Column()
  title: string;

  @Column('text')
  message: string;

  @Column('jsonb', { nullable: true })
  metadata: any; // Additional context (symbol, orderId, etc.)

  @Column({ default: false })
  sent: boolean; // Whether alert was successfully sent

  @Column({ nullable: true })
  sentAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

