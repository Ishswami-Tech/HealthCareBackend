import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Public } from '@core/decorators/public.decorator';
import { WORKER_LIFECYCLE } from '../queue.constants';
import { evaluateHeartbeat, heartbeatFilePath, readHeartbeat } from './worker-heartbeat';

/**
 * GET /health on the worker's HTTP server (the one Bull Board is mounted on). It reports the same
 * verdict as the container healthcheck (`worker-bootstrap.js --healthcheck`), from the heartbeat
 * the running worker writes: Redis/Dragonfly and database pings, at least one BullMQ worker
 * running, not shutting down. 200 when healthy, 503 with the reasons otherwise.
 */
@Controller()
export class WorkerHealthController {
  @Get('health')
  @Public()
  getHealth(@Res() reply: FastifyReply): void {
    const now = Date.now();
    const heartbeat = readHeartbeat(heartbeatFilePath());
    const verdict = evaluateHeartbeat(heartbeat, now, WORKER_LIFECYCLE.heartbeatMaxAgeMs);
    void reply.code(verdict.healthy ? 200 : 503).send({
      status: verdict.healthy ? 'healthy' : 'unhealthy',
      service: 'worker',
      timestamp: new Date(now).toISOString(),
      ...(verdict.healthy ? {} : { reasons: verdict.reasons }),
      ...(heartbeat && {
        heartbeatAgeMs: now - heartbeat.ts,
        redisOk: heartbeat.redisOk,
        dbOk: heartbeat.dbOk,
        runningWorkers: heartbeat.runningWorkers,
        totalWorkers: heartbeat.totalWorkers,
      }),
      uptimeSeconds: Math.round(process.uptime()),
      ...(process.env['GIT_SHA'] && { gitSha: process.env['GIT_SHA'] }),
    });
  }
}
