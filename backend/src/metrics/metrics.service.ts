import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Metric } from '../entities/metric.entity';

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(Metric)
    private metricRepository: Repository<Metric>,
  ) {}

  async create(key: string, value: any): Promise<Metric> {
    return this.metricRepository.save({ key, value });
  }

  async findLatest(key: string): Promise<Metric | null> {
    return this.metricRepository.findOne({
      where: { key },
      order: { createdAt: 'DESC' },
    });
  }

  async findHistory(
    key: string,
    limit = 100,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Metric[]> {
    const queryBuilder = this.metricRepository
      .createQueryBuilder('metric')
      .where('metric.key = :key', { key })
      .orderBy('metric.createdAt', 'DESC')
      .take(limit);

    if (startDate) {
      queryBuilder.andWhere('metric.createdAt >= :startDate', { startDate });
    }
    if (endDate) {
      queryBuilder.andWhere('metric.createdAt <= :endDate', { endDate });
    }

    return queryBuilder.getMany();
  }

  async findHistoryByKeys(
    keys: string[],
    limit = 100,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Metric[]> {
    const queryBuilder = this.metricRepository
      .createQueryBuilder('metric')
      .where('metric.key IN (:...keys)', { keys })
      .orderBy('metric.createdAt', 'DESC')
      .take(limit);

    if (startDate) {
      queryBuilder.andWhere('metric.createdAt >= :startDate', { startDate });
    }
    if (endDate) {
      queryBuilder.andWhere('metric.createdAt <= :endDate', { endDate });
    }

    return queryBuilder.getMany();
  }

  async getNAV(): Promise<number> {
    const navMetric = await this.findLatest('NAV');
    return navMetric ? navMetric.value : 0;
  }

  async updateNAV(nav: number): Promise<Metric> {
    return this.create('NAV', nav);
  }

  async getTotalFees(): Promise<number> {
    const feeMetric = await this.findLatest('TOTAL_FEES');
    return feeMetric ? feeMetric.value : 0;
  }

  async updateTotalFees(fees: number): Promise<Metric> {
    return this.create('TOTAL_FEES', fees);
  }
}

