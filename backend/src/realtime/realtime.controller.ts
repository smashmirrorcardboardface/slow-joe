import { Controller, Get, Query, Res, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { RealtimeService } from './realtime.service';

@Controller('api/realtime')
export class RealtimeController {
  constructor(
    private realtimeService: RealtimeService,
    private jwtService: JwtService,
  ) {}

  @Get('events')
  async streamEvents(@Query('token') token: string, @Res() res: Response): Promise<void> {
    // Validate token (EventSource doesn't support custom headers)
    if (!token) {
      throw new UnauthorizedException('Token required');
    }

    try {
      await this.jwtService.verifyAsync(token);
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS for SSE

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    // Subscribe to events
    const subscription = this.realtimeService.getEventStream().subscribe((event) => {
      try {
        const message = JSON.stringify({
          type: event.type,
          data: event.data,
          timestamp: event.timestamp.toISOString(),
        });
        res.write(`data: ${message}\n\n`);
      } catch (error) {
        // Ignore errors if client disconnected
      }
    });

    // Handle client disconnect
    res.on('close', () => {
      subscription.unsubscribe();
      res.end();
    });
  }
}

