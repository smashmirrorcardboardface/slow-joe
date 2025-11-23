import { Controller, Get, Header } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('api/health')
export class HealthController {
  constructor(private healthService: HealthService) {}

  @Get()
  async getHealth() {
    return this.healthService.checkHealth();
  }

  @Get('metrics/prometheus')
  @Header('Content-Type', 'text/plain')
  async getPrometheusMetrics() {
    return this.healthService.getPrometheusMetrics();
  }
}

