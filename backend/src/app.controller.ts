import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { HealthService } from './health/health.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly healthService: HealthService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health() {
    // Simple health check for quick status
    try {
      const health = await this.healthService.checkHealth();
      return {
        status: health.status === 'healthy' ? 'ok' : 'degraded',
        timestamp: health.timestamp,
        uptime: health.uptime,
      };
    } catch (error) {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
      };
    }
  }
}

