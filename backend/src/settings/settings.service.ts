import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Setting } from '../entities/setting.entity';
import { LoggerService } from '../logger/logger.service';

export interface StrategySettings {
  universe: string;
  cadenceHours: number;
  maxAllocFraction: number;
  maxPositions: number;
  minOrderUsd: number;
  minBalanceUsd: number;
  volatilityPausePct: number;
  rsiLow: number;
  rsiHigh: number;
  emaShort: number;
  emaLong: number;
  cooldownCycles: number;
  minProfitUsd: number;
}

@Injectable()
export class SettingsService {
  private readonly defaultSettings: Record<string, { value: string; description: string }> = {
    UNIVERSE: { value: 'BTC-USD,ETH-USD', description: 'Comma-separated list of trading pairs' },
    CADENCE_HOURS: { value: '6', description: 'How often to evaluate strategy (hours)' },
    MAX_ALLOC_FRACTION: { value: '0.2', description: 'Maximum allocation per asset (0-1)' },
    MAX_POSITIONS: { value: '3', description: 'Maximum number of positions to hold simultaneously' },
    MIN_ORDER_USD: { value: '5', description: 'Minimum order size in USD' },
    MIN_BALANCE_USD: { value: '20', description: 'Stop trading if NAV drops below this' },
    VOLATILITY_PAUSE_PCT: { value: '18', description: 'Pause if 24h return exceeds this percentage' },
    RSI_LOW: { value: '40', description: 'RSI filter lower bound' },
    RSI_HIGH: { value: '70', description: 'RSI filter upper bound' },
    EMA_SHORT: { value: '12', description: 'Short EMA period' },
    EMA_LONG: { value: '26', description: 'Long EMA period' },
    COOLDOWN_CYCLES: { value: '2', description: 'Number of cycles to wait before re-entering same asset' },
    MIN_PROFIT_USD: { value: '0.15', description: 'Minimum profit in USD to trigger automatic position exit' },
  };

  constructor(
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
    private configService: ConfigService,
    private logger: LoggerService,
  ) {
    this.logger.setContext('SettingsService');
  }

  /**
   * Get a setting value from database, falling back to env var, then default
   */
  async getSetting(key: string): Promise<string> {
    // Try database first
    const dbSetting = await this.settingRepository.findOne({ where: { key } });
    if (dbSetting) {
      return dbSetting.value;
    }

    // Fall back to environment variable
    const envValue = this.configService.get<string>(key);
    if (envValue) {
      return envValue;
    }

    // Fall back to default
    const defaultValue = this.defaultSettings[key];
    if (defaultValue) {
      return defaultValue.value;
    }

    throw new BadRequestException(`Unknown setting key: ${key}`);
  }

  /**
   * Get setting as number
   */
  async getSettingNumber(key: string): Promise<number> {
    const value = await this.getSetting(key);
    const num = parseFloat(value);
    if (isNaN(num)) {
      throw new BadRequestException(`Setting ${key} is not a valid number: ${value}`);
    }
    return num;
  }

  /**
   * Get setting as integer
   */
  async getSettingInt(key: string): Promise<number> {
    const value = await this.getSetting(key);
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      throw new BadRequestException(`Setting ${key} is not a valid integer: ${value}`);
    }
    return num;
  }

  /**
   * Get all strategy settings as a structured object
   */
  async getStrategySettings(): Promise<StrategySettings> {
    const universe = await this.getSetting('UNIVERSE');
    const cadenceHours = await this.getSettingInt('CADENCE_HOURS');
    const maxAllocFraction = await this.getSettingNumber('MAX_ALLOC_FRACTION');
    const maxPositions = await this.getSettingInt('MAX_POSITIONS');
    const minOrderUsd = await this.getSettingNumber('MIN_ORDER_USD');
    const minBalanceUsd = await this.getSettingNumber('MIN_BALANCE_USD');
    const volatilityPausePct = await this.getSettingNumber('VOLATILITY_PAUSE_PCT');
    const rsiLow = await this.getSettingNumber('RSI_LOW');
    const rsiHigh = await this.getSettingNumber('RSI_HIGH');
    const emaShort = await this.getSettingInt('EMA_SHORT');
    const emaLong = await this.getSettingInt('EMA_LONG');
    const cooldownCycles = await this.getSettingInt('COOLDOWN_CYCLES');
    const minProfitUsd = await this.getSettingNumber('MIN_PROFIT_USD');

    return {
      universe,
      cadenceHours,
      maxAllocFraction,
      maxPositions,
      minOrderUsd,
      minBalanceUsd,
      volatilityPausePct,
      rsiLow,
      rsiHigh,
      emaShort,
      emaLong,
      cooldownCycles,
      minProfitUsd,
    };
  }

  /**
   * Update a setting value
   */
  async updateSetting(key: string, value: string, description?: string): Promise<Setting> {
    // Validate key
    if (!this.defaultSettings[key]) {
      throw new BadRequestException(`Unknown setting key: ${key}`);
    }

    // Validate value based on key
    this.validateSetting(key, value);

    // Get or create setting
    let setting = await this.settingRepository.findOne({ where: { key } });
    const oldValue = setting?.value;

    if (setting) {
      setting.value = value;
      if (description) {
        setting.description = description;
      }
    } else {
      setting = this.settingRepository.create({
        key,
        value,
        description: description || this.defaultSettings[key].description,
      });
    }

    const saved = await this.settingRepository.save(setting);

    // Log the change
    this.logger.log(`Setting updated: ${key}`, {
      key,
      oldValue,
      newValue: value,
      changed: oldValue !== value,
    });

    return saved;
  }

  /**
   * Update multiple settings at once
   */
  async updateSettings(updates: Partial<StrategySettings>): Promise<Setting[]> {
    const results: Setting[] = [];
    const updatesMap = new Map<string, string>();

    // First, validate all updates
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;

      // Map frontend keys to database keys
      const dbKey = this.mapFrontendKeyToDbKey(key);
      if (!dbKey) {
        this.logger.warn(`Unknown frontend setting key: ${key}`);
        continue;
      }

      // Validate individual setting
      this.validateSetting(dbKey, String(value));
      updatesMap.set(dbKey, String(value));
    }

    // Validate cross-field constraints after all updates
    if (updatesMap.has('RSI_LOW') || updatesMap.has('RSI_HIGH')) {
      const rsiLow = updatesMap.has('RSI_LOW') 
        ? parseFloat(updatesMap.get('RSI_LOW')!)
        : parseFloat(await this.getSetting('RSI_LOW').catch(() => '40'));
      const rsiHigh = updatesMap.has('RSI_HIGH')
        ? parseFloat(updatesMap.get('RSI_HIGH')!)
        : parseFloat(await this.getSetting('RSI_HIGH').catch(() => '70'));
      
      if (rsiLow >= rsiHigh) {
        throw new BadRequestException('RSI_LOW must be less than RSI_HIGH');
      }
    }

    if (updatesMap.has('EMA_SHORT') || updatesMap.has('EMA_LONG')) {
      const emaShort = updatesMap.has('EMA_SHORT')
        ? parseInt(updatesMap.get('EMA_SHORT')!, 10)
        : parseInt(await this.getSetting('EMA_SHORT').catch(() => '12'), 10);
      const emaLong = updatesMap.has('EMA_LONG')
        ? parseInt(updatesMap.get('EMA_LONG')!, 10)
        : parseInt(await this.getSetting('EMA_LONG').catch(() => '26'), 10);
      
      if (emaShort >= emaLong) {
        throw new BadRequestException('EMA_SHORT must be less than EMA_LONG');
      }
    }

    // Apply all updates
    for (const [dbKey, value] of updatesMap.entries()) {
      const setting = await this.updateSetting(dbKey, value);
      results.push(setting);
    }

    return results;
  }

  /**
   * Validate a setting value
   */
  private validateSetting(key: string, value: string): void {
    switch (key) {
      case 'UNIVERSE':
        if (!value || value.trim().length === 0) {
          throw new BadRequestException('UNIVERSE cannot be empty');
        }
        // Validate format (comma-separated symbols)
        const symbols = value.split(',').map(s => s.trim());
        if (symbols.length === 0) {
          throw new BadRequestException('UNIVERSE must contain at least one symbol');
        }
        break;

      case 'CADENCE_HOURS':
      case 'EMA_SHORT':
      case 'EMA_LONG':
      case 'COOLDOWN_CYCLES':
      case 'MAX_POSITIONS':
        const intValue = parseInt(value, 10);
        if (isNaN(intValue) || intValue < 1) {
          throw new BadRequestException(`${key} must be a positive integer`);
        }
        if (key === 'CADENCE_HOURS' && (intValue < 1 || intValue > 24)) {
          throw new BadRequestException('CADENCE_HOURS must be between 1 and 24');
        }
        if (key === 'MAX_POSITIONS' && intValue > 20) {
          throw new BadRequestException('MAX_POSITIONS cannot exceed 20');
        }
        // EMA validation will be done after both are set
        break;

      case 'MAX_ALLOC_FRACTION':
        const allocValue = parseFloat(value);
        if (isNaN(allocValue) || allocValue <= 0 || allocValue > 1) {
          throw new BadRequestException('MAX_ALLOC_FRACTION must be between 0 and 1');
        }
        break;

      case 'MIN_ORDER_USD':
      case 'MIN_BALANCE_USD':
      case 'MIN_PROFIT_USD':
        const minValue = parseFloat(value);
        if (isNaN(minValue) || minValue < 0) {
          throw new BadRequestException(`${key} must be a non-negative number`);
        }
        break;

      case 'VOLATILITY_PAUSE_PCT':
        const volValue = parseFloat(value);
        if (isNaN(volValue) || volValue < 0 || volValue > 100) {
          throw new BadRequestException('VOLATILITY_PAUSE_PCT must be between 0 and 100');
        }
        break;

      case 'RSI_LOW':
      case 'RSI_HIGH':
        const rsiValue = parseFloat(value);
        if (isNaN(rsiValue) || rsiValue < 0 || rsiValue > 100) {
          throw new BadRequestException(`${key} must be between 0 and 100`);
        }
        // RSI validation will be done after both are set
        break;
    }
  }

  /**
   * Map frontend setting keys to database keys
   */
  private mapFrontendKeyToDbKey(key: string): string | null {
    const mapping: Record<string, string> = {
      universe: 'UNIVERSE',
      cadenceHours: 'CADENCE_HOURS',
      maxAllocFraction: 'MAX_ALLOC_FRACTION',
      maxPositions: 'MAX_POSITIONS',
      minOrderUsd: 'MIN_ORDER_USD',
      minBalanceUsd: 'MIN_BALANCE_USD',
      volatilityPausePct: 'VOLATILITY_PAUSE_PCT',
      rsiLow: 'RSI_LOW',
      rsiHigh: 'RSI_HIGH',
      emaShort: 'EMA_SHORT',
      emaLong: 'EMA_LONG',
      cooldownCycles: 'COOLDOWN_CYCLES',
      minProfitUsd: 'MIN_PROFIT_USD',
    };
    return mapping[key] || null;
  }

  /**
   * Initialize default settings in database if they don't exist
   */
  async initializeDefaults(): Promise<void> {
    for (const [key, { value, description }] of Object.entries(this.defaultSettings)) {
      const existing = await this.settingRepository.findOne({ where: { key } });
      if (!existing) {
        await this.settingRepository.save({
          key,
          value,
          description,
        });
        this.logger.debug(`Initialized default setting: ${key} = ${value}`);
      }
    }
  }
}

