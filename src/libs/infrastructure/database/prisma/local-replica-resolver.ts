/**
 * Local Replica Resolver
 * ========================
 * Resolves a connection string that targets the Postgres HA member running on
 * THIS process's own host, instead of whatever DATABASE_URL points at (usually
 * the primary, which can be a cross-node WireGuard-mesh hop away).
 *
 * Why: the app's periodic SELECT 1 health pings only need read connectivity, not
 * the primary specifically. On a worker node whose local Postgres member is a
 * secondary, pinging across the mesh to the primary costs a full network round
 * trip per check (measured ~260ms on this cluster's mesh) for no benefit. Pinging
 * the local member instead costs single-digit ms.
 *
 * This never affects the main PrismaClient (real queries still go to DATABASE_URL,
 * i.e. the primary) — only the dedicated health-check client (see
 * PrismaService.getHealthCheckClient()) may use the override this resolves.
 *
 * Fail-safe by design: any missing env var, query failure, no-match, or
 * unreachable candidate returns null, and callers fall back to DATABASE_URL
 * unchanged. The reachability check matters: a node's containers aren't always
 * able to reach that same node's own WireGuard mesh IP directly (confirmed on
 * oracle-main, which rejects it with EHOSTUNREACH, while temps-worker-ubuntu's
 * containers can reach their own host's mesh IP fine) — an asymmetry in this
 * cluster's networking, not something to assume away.
 */

import { connect as netConnect } from 'net';
import {
  MONITOR_NODE_FILTER,
  queryMonitor,
  withResolvedHost,
} from '@infrastructure/database/prisma/monitor-client.util';

/**
 * Maps every TEMPS_NODE_NAME alias this cluster uses to its mesh IP. The same physical
 * host can report different names depending on which deploy path started the container —
 * e.g. temps-worker-ubuntu's host answers to "temps-worker" from the manually-synced
 * container (sync-manual-replicas.sh) and "temps-worker-ubuntu" from Temps's own managed
 * deployment. List every alias you've seen for a host, not just one.
 */
const MESH_IP_BY_NODE_NAME: Readonly<Record<string, string>> = {
  'contabo-healthcare': '10.201.0.1',
  'temps-worker': '10.201.0.5',
  'temps-worker-ubuntu': '10.201.0.5',
  // oracle-vm2-dss (Temps node 11); its OS/Temps name is spelled "oracale".
  'oracale-vm2-dss': '10.201.0.6',
  'oracle-vm2-dss': '10.201.0.6',
  'contabo-ds': '10.201.0.7',
  // oracle-main's Temps node name.
  'main-server': '10.201.0.8',
  'oracle-main': '10.201.0.8',
};

const CONNECT_TIMEOUT_MS = 2000;

/** Quick TCP reachability probe — resolves true only on a successful connect. */
function isReachable(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = netConnect({ host, port, timeout: CONNECT_TIMEOUT_MS });
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Looks up this host's own Postgres HA member via the pg_auto_failover monitor
 * and, if found, returns a connection string identical to `databaseUrl` except
 * for the host/port swapped to that local member. Returns null on any failure
 * or when no local member is found (e.g. MONITOR_URI unset, or this host has no
 * Postgres cluster member of its own).
 */
export async function resolveLocalHealthCheckUrl(databaseUrl: string): Promise<string | null> {
  const monitorUri = process.env['MONITOR_URI'];
  const nodeName = process.env['TEMPS_NODE_NAME'];
  if (!monitorUri || !nodeName) {
    return null;
  }

  const myMeshIp = MESH_IP_BY_NODE_NAME[nodeName];
  if (!myMeshIp) {
    return null;
  }

  try {
    const rows = await queryMonitor(
      monitorUri,
      `SELECT nodehost, nodeport FROM pgautofailover.node WHERE ${MONITOR_NODE_FILTER} ORDER BY nodeid`
    );

    const localMember = rows.find(row => row.nodehost === myMeshIp);
    if (!localMember) {
      return null;
    }

    // The mesh IP is reachable cross-node (that's the whole point of the mesh), but not
    // reliably reachable from a container back to its own host's mesh IP — verify before
    // committing to it instead of assuming.
    const reachable = await isReachable(localMember.nodehost, localMember.nodeport);
    if (!reachable) {
      return null;
    }

    return withResolvedHost(databaseUrl, localMember.nodehost, localMember.nodeport);
  } catch {
    // Any failure (monitor unreachable, bad URL, etc.) - fall back to DATABASE_URL.
    return null;
  }
}
