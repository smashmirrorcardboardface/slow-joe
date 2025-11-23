import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface RealtimeEvent {
  type: 'metrics' | 'market-data' | 'positions' | 'trades' | 'signals' | 'alerts' | 'settings_update';
  data: any;
  timestamp: Date;
}

@Injectable()
export class RealtimeService {
  private eventSubject = new Subject<RealtimeEvent>();

  /**
   * Get an observable stream of real-time events
   */
  getEventStream(): Observable<RealtimeEvent> {
    return this.eventSubject.asObservable();
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(type: RealtimeEvent['type'], data: any): void {
    this.eventSubject.next({
      type,
      data,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast metrics update
   */
  broadcastMetrics(metrics: any): void {
    this.broadcast('metrics', metrics);
  }

  /**
   * Broadcast market data update
   */
  broadcastMarketData(marketData: any): void {
    this.broadcast('market-data', marketData);
  }

  /**
   * Broadcast positions update
   */
  broadcastPositions(positions: any): void {
    this.broadcast('positions', positions);
  }

  /**
   * Broadcast trades update
   */
  broadcastTrades(trades: any): void {
    this.broadcast('trades', trades);
  }

  /**
   * Broadcast signals update
   */
  broadcastSignals(signals: any): void {
    this.broadcast('signals', signals);
  }

  /**
   * Broadcast alerts update
   */
  broadcastAlerts(alerts: any): void {
    this.broadcast('alerts', alerts);
  }
}

