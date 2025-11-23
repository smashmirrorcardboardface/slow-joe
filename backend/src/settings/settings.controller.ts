import { Controller, Put, Body, Get, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from './settings.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api/settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    private settingsService: SettingsService,
    private realtimeService: RealtimeService,
  ) {}

  @Get()
  async getSettings() {
    return await this.settingsService.getStrategySettings();
  }

  @Put()
  async updateSettings(@Body() settings: Partial<SettingsService['getStrategySettings'] extends Promise<infer T> ? T : never>) {
    try {
      const updated = await this.settingsService.updateSettings(settings);
      const newSettings = await this.settingsService.getStrategySettings();
      
      // Broadcast settings update to all connected clients
      this.realtimeService.broadcast('settings_update', {
        settings: newSettings,
        updatedKeys: updated.map(s => s.key),
      });
      
      return {
        message: 'Settings updated successfully',
        updated: updated.length,
        settings: newSettings,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to update settings');
    }
  }
}

