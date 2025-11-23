import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { Alert, AlertType, AlertSeverity } from '../entities/alert.entity';
import { AlertConfig } from './dto/alert-config.dto';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class AlertsService {
  private transporter: nodemailer.Transporter | null = null;
  private lastAlertTimes: Map<string, number> = new Map(); // Track last alert time per type+key
  private config: AlertConfig;

  constructor(
    @InjectRepository(Alert)
    private alertRepository: Repository<Alert>,
    private configService: ConfigService,
    private logger: LoggerService,
  ) {
    this.logger.setContext('AlertsService');
    this.initializeConfig();
    this.initializeEmail();
  }

  private initializeConfig() {
    this.config = {
      enabled: this.configService.get<string>('ALERTS_ENABLED', 'true') === 'true',
      emailEnabled: this.configService.get<string>('ALERTS_EMAIL_ENABLED', 'true') === 'true',
      emailRecipients: (this.configService.get<string>('ALERTS_EMAIL_RECIPIENTS') || '').split(',').map(e => e.trim()).filter(e => e),
      thresholds: {
        lowBalanceUsd: parseFloat(this.configService.get<string>('ALERTS_LOW_BALANCE_USD') || '50'),
        largeDrawdownPct: parseFloat(this.configService.get<string>('ALERTS_LARGE_DRAWDOWN_PCT') || '10'),
      },
      cooldownMinutes: {
        orderFailure: parseInt(this.configService.get<string>('ALERTS_COOLDOWN_ORDER_FAILURE') || '60', 10),
        exchangeUnreachable: parseInt(this.configService.get<string>('ALERTS_COOLDOWN_EXCHANGE') || '30', 10),
        lowBalance: parseInt(this.configService.get<string>('ALERTS_COOLDOWN_LOW_BALANCE') || '1440', 10), // 24 hours
        largeDrawdown: parseInt(this.configService.get<string>('ALERTS_COOLDOWN_DRAWDOWN') || '60', 10),
        jobFailure: parseInt(this.configService.get<string>('ALERTS_COOLDOWN_JOB_FAILURE') || '60', 10),
      },
    };
  }

  private initializeEmail() {
    if (!this.config.emailEnabled || this.config.emailRecipients.length === 0) {
      this.logger.warn('Email alerts disabled or no recipients configured');
      return;
    }

    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10);
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPassword = this.configService.get<string>('SMTP_PASSWORD');
    const smtpSecure = this.configService.get<string>('SMTP_SECURE', 'false') === 'true';

    if (!smtpHost || !smtpUser || !smtpPassword) {
      this.logger.warn('SMTP configuration incomplete, email alerts disabled');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    });

    this.logger.log('Email transporter initialized', {
      host: smtpHost,
      port: smtpPort,
      recipients: this.config.emailRecipients.length,
    });
  }

  private getCooldownKey(type: AlertType, key?: string): string {
    return `${type}:${key || 'default'}`;
  }

  private shouldSendAlert(type: AlertType, key?: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const cooldownMinutes = this.config.cooldownMinutes[type] || 60;
    const cooldownKey = this.getCooldownKey(type, key);
    const lastAlertTime = this.lastAlertTimes.get(cooldownKey) || 0;
    const now = Date.now();
    const cooldownMs = cooldownMinutes * 60 * 1000;

    if (now - lastAlertTime < cooldownMs) {
      return false; // Still in cooldown
    }

    return true;
  }

  private updateLastAlertTime(type: AlertType, key?: string) {
    const cooldownKey = this.getCooldownKey(type, key);
    this.lastAlertTimes.set(cooldownKey, Date.now());
  }

  async sendAlert(
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    metadata?: any,
    key?: string,
  ): Promise<void> {
    try {
      // Check cooldown
      if (!this.shouldSendAlert(type, key)) {
        this.logger.debug('Alert suppressed due to cooldown', { type, key });
        // Still save the alert but mark as not sent
        await this.saveAlert(type, severity, title, message, metadata, false);
        return;
      }

      // Save alert to database
      const alert = await this.saveAlert(type, severity, title, message, metadata, true);

      // Send email if configured
      if (this.config.emailEnabled && this.transporter && this.config.emailRecipients.length > 0) {
        await this.sendEmail(alert);
      }

      // Update cooldown
      this.updateLastAlertTime(type, key);

      this.logger.log('Alert sent', { type, severity, title });
    } catch (error: any) {
      this.logger.error('Error sending alert', error.stack, {
        type,
        severity,
        title,
        error: error.message,
      });
    }
  }

  private async saveAlert(
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    metadata?: any,
    sent: boolean = false,
  ): Promise<Alert> {
    const alert = this.alertRepository.create({
      type,
      severity,
      title,
      message,
      metadata,
      sent,
      sentAt: sent ? new Date() : null,
    });

    return await this.alertRepository.save(alert);
  }

  private async sendEmail(alert: Alert): Promise<void> {
    if (!this.transporter || this.config.emailRecipients.length === 0) {
      return;
    }

    const severityEmoji = {
      [AlertSeverity.INFO]: 'ℹ️',
      [AlertSeverity.WARNING]: '⚠️',
      [AlertSeverity.ERROR]: '❌',
      [AlertSeverity.CRITICAL]: '🚨',
    };

    const emoji = severityEmoji[alert.severity] || '📢';

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #f4f4f4; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
            .content { background-color: #ffffff; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
            .metadata { background-color: #f9f9f9; padding: 15px; margin-top: 15px; border-radius: 5px; }
            .metadata pre { margin: 0; font-size: 12px; }
            .footer { margin-top: 20px; font-size: 12px; color: #666; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${emoji} ${alert.title}</h1>
              <p><strong>Type:</strong> ${alert.type}</p>
              <p><strong>Severity:</strong> ${alert.severity}</p>
              <p><strong>Time:</strong> ${alert.createdAt.toISOString()}</p>
            </div>
            <div class="content">
              <p>${alert.message.replace(/\n/g, '<br>')}</p>
              ${alert.metadata ? `
                <div class="metadata">
                  <strong>Additional Details:</strong>
                  <pre>${JSON.stringify(alert.metadata, null, 2)}</pre>
                </div>
              ` : ''}
            </div>
            <div class="footer">
              <p>Slow Joe Trading Bot Alert System</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const text = `
${alert.title}

Type: ${alert.type}
Severity: ${alert.severity}
Time: ${alert.createdAt.toISOString()}

${alert.message}

${alert.metadata ? `Additional Details:\n${JSON.stringify(alert.metadata, null, 2)}` : ''}
    `.trim();

    const mailOptions = {
      from: this.configService.get<string>('SMTP_FROM') || this.configService.get<string>('SMTP_USER'),
      to: this.config.emailRecipients.join(', '),
      subject: `${emoji} Slow Joe Alert: ${alert.title}`,
      text,
      html,
    };

    await this.transporter.sendMail(mailOptions);
    this.logger.debug('Email alert sent', {
      alertId: alert.id,
      recipients: this.config.emailRecipients.length,
    });
  }

  // Convenience methods for specific alert types
  async alertOrderFailure(symbol: string, error: string, orderId?: string) {
    await this.sendAlert(
      AlertType.ORDER_FAILURE,
      AlertSeverity.ERROR,
      `Order Failed: ${symbol}`,
      `Failed to execute order for ${symbol}.\n\nError: ${error}`,
      { symbol, orderId, error },
      symbol,
    );
  }

  async alertExchangeUnreachable(error: string) {
    await this.sendAlert(
      AlertType.EXCHANGE_UNREACHABLE,
      AlertSeverity.CRITICAL,
      'Exchange Unreachable',
      `Cannot connect to exchange API.\n\nError: ${error}`,
      { error },
    );
  }

  async alertLowBalance(balance: number, threshold: number) {
    await this.sendAlert(
      AlertType.LOW_BALANCE,
      AlertSeverity.WARNING,
      'Low Balance Alert',
      `Account balance ($${balance.toFixed(2)}) is below threshold ($${threshold.toFixed(2)}).`,
      { balance, threshold },
    );
  }

  async alertLargeDrawdown(drawdownPct: number, currentNav: number, peakNav: number) {
    await this.sendAlert(
      AlertType.LARGE_DRAWDOWN,
      AlertSeverity.WARNING,
      `Large Drawdown: ${drawdownPct.toFixed(2)}%`,
      `Portfolio has experienced a ${drawdownPct.toFixed(2)}% drawdown.\n\nCurrent NAV: $${currentNav.toFixed(2)}\nPeak NAV: $${peakNav.toFixed(2)}`,
      { drawdownPct, currentNav, peakNav },
    );
  }

  async alertJobFailure(jobName: string, error: string, jobId?: string) {
    await this.sendAlert(
      AlertType.JOB_FAILURE,
      AlertSeverity.ERROR,
      `Job Failed: ${jobName}`,
      `Job "${jobName}" failed to execute.\n\nError: ${error}`,
      { jobName, jobId, error },
      jobName,
    );
  }

  async alertHealthCheckFailed(component: string, error: string) {
    await this.sendAlert(
      AlertType.HEALTH_CHECK_FAILED,
      AlertSeverity.CRITICAL,
      `Health Check Failed: ${component}`,
      `Health check failed for ${component}.\n\nError: ${error}`,
      { component, error },
      component,
    );
  }

  // Get alert history
  async getAlertHistory(limit: number = 50): Promise<Alert[]> {
    return await this.alertRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // Get alerts by type
  async getAlertsByType(type: AlertType, limit: number = 50): Promise<Alert[]> {
    return await this.alertRepository.find({
      where: { type },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}

