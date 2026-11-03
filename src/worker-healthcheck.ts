#!/usr/bin/env node

/**
 * Lightweight worker healthcheck for the container HEALTHCHECK:
 *
 *   node dist/worker-healthcheck.js
 *
 * Exit 0 when the running worker's heartbeat (written every 15s by worker-bootstrap) is fresh and
 * reports Redis/Dragonfly + DB reachable and at least one BullMQ worker running; exit 1 otherwise.
 * It loads only node:fs/os/path, unlike `node dist/worker-bootstrap.js --healthcheck`, which
 * gives the same verdict but first loads the whole Nest module graph.
 */

import { WORKER_LIFECYCLE } from '@infrastructure/queue/src/queue.constants';
import { runHeartbeatCheck } from '@infrastructure/queue/src/worker-lifecycle/worker-heartbeat';

process.exit(runHeartbeatCheck(WORKER_LIFECYCLE.heartbeatMaxAgeMs));
