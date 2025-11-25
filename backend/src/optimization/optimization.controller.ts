import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptimizationService } from './optimization.service';

@Controller('api/optimization')
@UseGuards(JwtAuthGuard)
export class OptimizationController {
  constructor(private optimizationService: OptimizationService) {}

  @Post('run')
  async runOptimization() {
    const report = await this.optimizationService.runOptimization();
    return {
      message: 'Optimization completed',
      reportId: report.id,
      runDate: report.runDate,
      recommendationsCount: report.recommendations?.length || 0,
      appliedChangesCount: report.appliedChanges?.length || 0,
      report,
    };
  }

  @Get('latest')
  async getLatestReport() {
    const report = await this.optimizationService.getLatestReport();
    if (!report) {
      return { message: 'No optimization reports found' };
    }
    return report;
  }

  @Get('reports')
  async getAllReports() {
    const reports = await this.optimizationService.getAllReports();
    return reports;
  }
}

