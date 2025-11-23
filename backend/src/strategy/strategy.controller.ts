import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/strategy')
@UseGuards(JwtAuthGuard)
export class StrategyController {
  constructor(private strategyService: StrategyService) {}

  @Post('toggle')
  toggle(@Body() body: { enabled: boolean }) {
    this.strategyService.toggle(body.enabled);
    return { enabled: this.strategyService.isEnabled() };
  }
}

