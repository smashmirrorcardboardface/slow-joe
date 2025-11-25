import { ConfigService } from '@nestjs/config';

export const DEFAULT_BOT_ID = 'slow-joe';
export const DEFAULT_USERREF_PREFIX = '10';

const sanitizeDigits = (value: string): string => value.replace(/\D/g, '');

export const getBotId = (configService: ConfigService): string => {
  const configured = configService.get<string>('BOT_ID');
  return (configured && configured.trim()) || DEFAULT_BOT_ID;
};

export const getUserrefPrefix = (configService: ConfigService): string => {
  const configured = configService.get<string>('BOT_USERREF_PREFIX');
  const sanitized = configured ? sanitizeDigits(configured) : '';
  return sanitized || DEFAULT_USERREF_PREFIX;
};

export const buildBotUserref = (prefix: string): string => {
  const sanitized = sanitizeDigits(prefix) || DEFAULT_USERREF_PREFIX;
  const maxTotalLength = 9; // ensure we stay within 32-bit signed int range
  const trimmedPrefix = sanitized.slice(0, Math.min(sanitized.length, maxTotalLength - 1));
  const timestampPartLength = Math.max(1, maxTotalLength - trimmedPrefix.length);
  const timestampPart = Date.now().toString().slice(-timestampPartLength);
  return `${trimmedPrefix}${timestampPart}`;
};

export const orderBelongsToBot = (order: any, prefix: string): boolean => {
  const sanitized = sanitizeDigits(prefix);
  if (!sanitized) {
    return true;
  }
  const userrefSource = order?.userref ?? order?.clientOrderId;
  if (!userrefSource && userrefSource !== 0) {
    // Backwards compatibility for legacy orders before tagging
    return true;
  }
  const userref = userrefSource.toString();
  return userref.startsWith(sanitized);
};

