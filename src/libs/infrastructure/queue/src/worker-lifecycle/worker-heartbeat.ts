/**
 * Worker heartbeat: the running worker process proves it is healthy by writing a small JSON file
 * every few seconds, and `node dist/worker-bootstrap.js --healthcheck` (or the lighter
 * `node dist/worker-healthcheck.js`) only reads and judges that file.
 *
 * Why a file and not a live check from the healthcheck process: the checker would have to boot
 * its own DB and Redis clients (a second Node process every 30s inside a 1 GB container) and it
 * would still not know whether the REAL process has a running BullMQ worker. The running process
 * pings Dragonfly/Redis and the DB itself and records the result.
 *
 * Deliberately dependency-free (node:fs, node:os, node:path only): the healthcheck entry point must
 * not load the Nest module graph.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface WorkerHeartbeat {
  /** Epoch ms when the heartbeat was written. */
  readonly ts: number;
  readonly pid: number;
  readonly redisOk: boolean;
  readonly dbOk: boolean;
  /** BullMQ workers that report `isRunning()`. */
  readonly runningWorkers: number;
  readonly totalWorkers: number;
  /** Set once SIGTERM/SIGINT was received; a draining worker reports unhealthy. */
  readonly shuttingDown: boolean;
  readonly errors?: readonly string[];
}

export interface HeartbeatVerdict {
  readonly healthy: boolean;
  readonly reasons: readonly string[];
}

export const HEARTBEAT_FILE_ENV = 'WORKER_HEARTBEAT_FILE';

export function heartbeatFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[HEARTBEAT_FILE_ENV]?.trim();
  return configured && configured.length > 0
    ? configured
    : join(tmpdir(), 'healthcare-worker-heartbeat.json');
}

function isHeartbeat(value: unknown): value is WorkerHeartbeat {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['ts'] === 'number' &&
    typeof record['redisOk'] === 'boolean' &&
    typeof record['dbOk'] === 'boolean' &&
    typeof record['runningWorkers'] === 'number'
  );
}

/** Pure verdict over a heartbeat (or its absence). */
export function evaluateHeartbeat(
  heartbeat: WorkerHeartbeat | null,
  now: number,
  maxAgeMs: number
): HeartbeatVerdict {
  if (!heartbeat) return { healthy: false, reasons: ['no heartbeat written yet'] };
  const reasons: string[] = [];
  const ageMs = now - heartbeat.ts;
  if (ageMs > maxAgeMs) reasons.push(`heartbeat is stale (${Math.round(ageMs / 1000)}s old)`);
  if (!heartbeat.redisOk) reasons.push('Redis/Dragonfly ping failed');
  if (!heartbeat.dbOk) reasons.push('database ping failed');
  if (heartbeat.runningWorkers < 1) reasons.push('no BullMQ worker is running');
  if (heartbeat.shuttingDown) reasons.push('worker is shutting down');
  return { healthy: reasons.length === 0, reasons };
}

export function readHeartbeat(filePath: string): WorkerHeartbeat | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return isHeartbeat(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Atomic write (temp file + rename) so the checker never reads a half-written file. */
export function writeHeartbeat(filePath: string, heartbeat: WorkerHeartbeat): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(heartbeat), 'utf8');
  renameSync(tempPath, filePath);
}

/** Exit code for the healthcheck CLI: 0 healthy, 1 unhealthy. Prints the reasons to stderr. */
export function runHeartbeatCheck(
  maxAgeMs: number,
  filePath: string = heartbeatFilePath(),
  now: number = Date.now()
): number {
  const verdict = evaluateHeartbeat(readHeartbeat(filePath), now, maxAgeMs);
  if (verdict.healthy) {
    console.error('Worker health check passed');
    return 0;
  }
  console.error(`Worker health check failed: ${verdict.reasons.join('; ')}`);
  return 1;
}
