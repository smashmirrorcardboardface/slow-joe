export interface BacktestResultDto {
  // Returns
  totalReturn: number; // Percentage
  cagr: number; // Compound Annual Growth Rate
  sharpeRatio: number; // Risk-adjusted return
  maxDrawdown: number; // Largest peak-to-trough decline (percentage)

  // Risk metrics
  volatility: number; // Annualized volatility (percentage)
  winRate: number; // Percentage of profitable trades
  profitFactor: number; // Gross profit / Gross loss

  // Trading metrics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalFees: number; // Total fees paid in USD
  turnover: number; // Portfolio turnover ratio

  // Time series data
  navHistory: Array<{
    date: string;
    nav: number;
    cash: number;
    positionsValue: number;
  }>;

  trades: Array<{
    date: string;
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    fee: number;
    nav: number;
  }>;

  // Summary
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalNav: number;
  days: number;
}

