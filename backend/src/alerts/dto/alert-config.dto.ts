export interface AlertConfig {
  enabled: boolean;
  emailEnabled: boolean;
  emailRecipients: string[];
  thresholds: {
    lowBalanceUsd: number;
    largeDrawdownPct: number;
  };
  cooldownMinutes: {
    orderFailure: number;
    exchangeUnreachable: number;
    lowBalance: number;
    largeDrawdown: number;
    jobFailure: number;
  };
}

