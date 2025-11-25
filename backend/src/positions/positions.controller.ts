import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PositionsService } from './positions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { getBotId } from '../common/utils/bot.utils';

@Controller('api/positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(
    private positionsService: PositionsService,
    private configService: ConfigService,
  ) {}

  @Get()
  async findAll() {
    const botId = getBotId(this.configService);
    return this.positionsService.findAllByBot(botId);
  }
}

