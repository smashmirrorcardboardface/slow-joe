import { Injectable, OnModuleInit } from '@nestjs/common';
import { SettingsService } from './settings/settings.service';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private settingsService: SettingsService) {}

  async onModuleInit() {
    // Initialize default settings in database
    await this.settingsService.initializeDefaults();
  }

  getHello(): string {
    return 'Slow Joe Trading Bot API';
  }
}

