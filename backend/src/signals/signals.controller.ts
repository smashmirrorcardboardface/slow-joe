import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/signals')
@UseGuards(JwtAuthGuard)
export class SignalsController {
  constructor(private signalsService: SignalsService) {}

  @Get()
  findAll(@Query('symbol') symbol?: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    return this.signalsService.findLatest(symbol, limitNum);
  }
}

