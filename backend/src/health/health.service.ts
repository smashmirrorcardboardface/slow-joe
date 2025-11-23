import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ExchangeService } from '../exchange/exchange.service';
import { ConfigService } from '@nestjs/config';
import { AlertsService } from '../alerts/alerts.service';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  checks: {
    database: {
      status: 'up' | 'down';
      responseTime?: number;
      error?: string;
    };
    redis: {
      status: 'up' | 'down';
      responseTime?: number;
      error?: string;
    };
    exchange: {
      status: 'up' | 'down' | 'unknown';
      responseTime?: number;
      error?: string;
    };
  };
  queues: {
    [queueName: string]: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
  };
}

@Injectable()
export class HealthService {
  private startTime: number;

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectQueue('signal-poller') private signalPollerQueue: Queue,
    @InjectQueue('strategy-evaluate') private strategyEvaluateQueue: Queue,
    @InjectQueue('order-execute') private orderExecuteQueue: Queue,
    @InjectQueue('reconcile') private reconcileQueue: Queue,
    private exchangeService: ExchangeService,
    private configService: ConfigService,
    private alertsService: AlertsService,
  ) {
    this.startTime = Date.now();
  }

  async checkHealth(): Promise<HealthCheckResult> {
    const checks = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      exchange: await this.checkExchange(),
    };

    const queues = await this.getQueueStats();

    // Determine overall status
    const hasDown = Object.values(checks).some(c => c.status === 'down');
    const hasUnknown = Object.values(checks).some(c => c.status === 'unknown');
    
    let status: 'healthy' | 'unhealthy' | 'degraded';
    if (hasDown) {
      status = 'unhealthy';
    } else if (hasUnknown) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000), // seconds
      checks,
      queues,
    };
  }

  private async checkDatabase(): Promise<{ status: 'up' | 'down'; responseTime?: number; error?: string }> {
    try {
      const start = Date.now();
      await this.connection.query('SELECT 1');
      const responseTime = Date.now() - start;
      
      return {
        status: 'up',
        responseTime,
      };
    } catch (error: any) {
      const errorMsg = error.message || 'Database connection failed';
      // Alert on database failure
      this.alertsService.alertHealthCheckFailed('database', errorMsg).catch(() => {});
      return {
        status: 'down',
        error: errorMsg,
      };
    }
  }

  private async checkRedis(): Promise<{ status: 'up' | 'down'; responseTime?: number; error?: string }> {
    try {
      const start = Date.now();
      // Check Redis connectivity by trying to get queue counts
      // This will fail if Redis is down
      await Promise.all([
        this.signalPollerQueue.getWaitingCount(),
        this.signalPollerQueue.getActiveCount(),
      ]);
      const responseTime = Date.now() - start;
      
      return {
        status: 'up',
        responseTime,
      };
    } catch (error: any) {
      const errorMsg = error.message || 'Redis connection failed';
      // Alert on Redis failure
      this.alertsService.alertHealthCheckFailed('redis', errorMsg).catch(() => {});
      return {
        status: 'down',
        error: errorMsg,
      };
    }
  }

  private async checkExchange(): Promise<{ status: 'up' | 'down' | 'unknown'; responseTime?: number; error?: string }> {
    try {
      const apiKey = this.configService.get<string>('KRAKEN_API_KEY');
      const apiSecret = this.configService.get<string>('KRAKEN_API_SECRET');
      
      // If no API credentials, mark as unknown (not configured)
      if (!apiKey || !apiSecret) {
        return {
          status: 'unknown',
          error: 'Exchange API credentials not configured',
        };
      }

      const start = Date.now();
      // Try to get ticker for a common pair (public endpoint, doesn't require auth)
      await this.exchangeService.getTicker('BTC-USD');
      const responseTime = Date.now() - start;
      
      return {
        status: 'up',
        responseTime,
      };
    } catch (error: any) {
      return {
        status: 'down',
        error: error.message || 'Exchange API connection failed',
      };
    }
  }

  private async getQueueStats(): Promise<{
    [queueName: string]: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
  }> {
    const queues = {
      'signal-poller': this.signalPollerQueue,
      'strategy-evaluate': this.strategyEvaluateQueue,
      'order-execute': this.orderExecuteQueue,
      'reconcile': this.reconcileQueue,
    };

    const stats: {
      [queueName: string]: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
      };
    } = {};

    for (const [name, queue] of Object.entries(queues)) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        stats[name] = {
          waiting,
          active,
          completed,
          failed,
          delayed,
        };
      } catch (error) {
        // If queue check fails, set all to 0
        stats[name] = {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        };
      }
    }

    return stats;
  }

  async getPrometheusMetrics(): Promise<string> {
    const health = await this.checkHealth();
    
    const metrics: string[] = [];
    
    // Health status (1 = healthy, 0 = unhealthy/degraded)
    metrics.push(`# HELP slow_joe_health_status Health status of the application (1 = healthy, 0 = unhealthy)`);
    metrics.push(`# TYPE slow_joe_health_status gauge`);
    metrics.push(`slow_joe_health_status{status="${health.status}"} ${health.status === 'healthy' ? 1 : 0}`);
    
    // Uptime
    metrics.push(`# HELP slow_joe_uptime_seconds Application uptime in seconds`);
    metrics.push(`# TYPE slow_joe_uptime_seconds gauge`);
    metrics.push(`slow_joe_uptime_seconds ${health.uptime}`);
    
    // Database check
    metrics.push(`# HELP slow_joe_database_status Database connection status (1 = up, 0 = down)`);
    metrics.push(`# TYPE slow_joe_database_status gauge`);
    metrics.push(`slow_joe_database_status ${health.checks.database.status === 'up' ? 1 : 0}`);
    if (health.checks.database.responseTime !== undefined) {
      metrics.push(`# HELP slow_joe_database_response_time_ms Database response time in milliseconds`);
      metrics.push(`# TYPE slow_joe_database_response_time_ms gauge`);
      metrics.push(`slow_joe_database_response_time_ms ${health.checks.database.responseTime}`);
    }
    
    // Redis check
    metrics.push(`# HELP slow_joe_redis_status Redis connection status (1 = up, 0 = down)`);
    metrics.push(`# TYPE slow_joe_redis_status gauge`);
    metrics.push(`slow_joe_redis_status ${health.checks.redis.status === 'up' ? 1 : 0}`);
    if (health.checks.redis.responseTime !== undefined) {
      metrics.push(`# HELP slow_joe_redis_response_time_ms Redis response time in milliseconds`);
      metrics.push(`# TYPE slow_joe_redis_response_time_ms gauge`);
      metrics.push(`slow_joe_redis_response_time_ms ${health.checks.redis.responseTime}`);
    }
    
    // Exchange check
    metrics.push(`# HELP slow_joe_exchange_status Exchange API status (1 = up, 0 = down, -1 = unknown)`);
    metrics.push(`# TYPE slow_joe_exchange_status gauge`);
    const exchangeStatus = health.checks.exchange.status === 'up' ? 1 : health.checks.exchange.status === 'down' ? 0 : -1;
    metrics.push(`slow_joe_exchange_status ${exchangeStatus}`);
    if (health.checks.exchange.responseTime !== undefined) {
      metrics.push(`# HELP slow_joe_exchange_response_time_ms Exchange API response time in milliseconds`);
      metrics.push(`# TYPE slow_joe_exchange_response_time_ms gauge`);
      metrics.push(`slow_joe_exchange_response_time_ms ${health.checks.exchange.responseTime}`);
    }
    
    // Queue metrics
    for (const [queueName, stats] of Object.entries(health.queues)) {
      metrics.push(`# HELP slow_joe_queue_jobs Queue job counts`);
      metrics.push(`# TYPE slow_joe_queue_jobs gauge`);
      metrics.push(`slow_joe_queue_jobs{queue="${queueName}",state="waiting"} ${stats.waiting}`);
      metrics.push(`slow_joe_queue_jobs{queue="${queueName}",state="active"} ${stats.active}`);
      metrics.push(`slow_joe_queue_jobs{queue="${queueName}",state="completed"} ${stats.completed}`);
      metrics.push(`slow_joe_queue_jobs{queue="${queueName}",state="failed"} ${stats.failed}`);
      metrics.push(`slow_joe_queue_jobs{queue="${queueName}",state="delayed"} ${stats.delayed}`);
    }
    
    return metrics.join('\n') + '\n';
  }
}

