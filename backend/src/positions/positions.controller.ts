import { Controller, Get, UseGuards } from '@nestjs/common';
import { PositionsService } from './positions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/positions')
@UseGuards(JwtAuthGuard)
export class PositionsController {
  constructor(private positionsService: PositionsService) {}

  @Get()
  findAll() {
    return this.positionsService.findAll();
  }
}

