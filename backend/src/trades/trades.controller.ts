import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { TradesService } from './trades.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/trade')
@UseGuards(JwtAuthGuard)
export class TradesController {
  constructor(private tradesService: TradesService) {}

  @Get()
  findAll() {
    return this.tradesService.findAll();
  }

  @Post('manual')
  async manualTrade(@Body() tradeDto: { symbol: string; side: 'buy' | 'sell'; quantity: string; price: string }) {
    // This will be implemented with exchange adapter
    return { message: 'Manual trade endpoint - to be implemented' };
  }
}

