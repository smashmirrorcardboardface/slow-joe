import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { BacktesterService } from './backtester.service';
import { BacktestRequestDto } from './dto/backtest-request.dto';
import { BacktestResultDto } from './dto/backtest-result.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/backtest')
@UseGuards(JwtAuthGuard)
export class BacktesterController {
  constructor(private backtesterService: BacktesterService) {}

  @Post()
  async runBacktest(@Body() request: BacktestRequestDto): Promise<BacktestResultDto> {
    return this.backtesterService.runBacktest(request);
  }
}

