import { Controller, Get, Post, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlertsService } from './alerts.service';
import { AlertType, AlertSeverity } from '../entities/alert.entity';

@Controller('api/alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private alertsService: AlertsService) {}

  @Get('history')
  async getAlertHistory(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return await this.alertsService.getAlertHistory(limitNum);
  }

  @Get('by-type')
  async getAlertsByType(
    @Query('type') type: AlertType,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return await this.alertsService.getAlertsByType(type, limitNum);
  }

  @Post('test')
  async sendTestAlert() {
    await this.alertsService.sendAlert(
      AlertType.HEALTH_CHECK_FAILED,
      AlertSeverity.INFO,
      'Test Alert - System Check',
      'This is a test alert to verify the email alert system is working correctly.\n\nIf you received this email, your alert configuration is set up properly!',
      {
        test: true,
        timestamp: new Date().toISOString(),
      },
      'test',
    );
    return {
      success: true,
      message: 'Test alert sent! Check your email inbox.',
    };
  }
}

