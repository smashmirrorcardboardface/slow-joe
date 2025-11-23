import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class JobsService {
  constructor(
    @InjectQueue('signal-poller') private signalPollerQueue: Queue,
    @InjectQueue('strategy-evaluate') private strategyEvaluateQueue: Queue,
    @InjectQueue('order-execute') private orderExecuteQueue: Queue,
    @InjectQueue('reconcile') private reconcileQueue: Queue,
  ) {}

  async enqueueSignalPoller() {
    await this.signalPollerQueue.add('poll-signals', {});
  }

  async enqueueStrategyEvaluate() {
    await this.strategyEvaluateQueue.add('evaluate-strategy', {});
  }

  async enqueueOrderExecute(symbol: string, side: 'buy' | 'sell', quantity: number, price: number) {
    await this.orderExecuteQueue.add('execute-order', {
      symbol,
      side,
      quantity,
      price,
    });
  }

  async enqueueReconcile() {
    await this.reconcileQueue.add('reconcile', {});
  }
}

