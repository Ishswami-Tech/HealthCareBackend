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
 * Fail-safe by design: any missing env var, query failure, or no-match returns
 * null, and callers fall back to DATABASE_URL unchanged.
 */

import { Client } from 'pg';

/**
 * Maps every TEMPS_NODE_NAME alias this cluster uses to its mesh IP. The same physical
 * host can report different names depending on which deploy path started the container —
 * e.g. temps-worker-ubuntu's host answers to "temps-worker" from the manually-synced
 * container (sync-manual-replicas.sh) and "temps-worker-ubuntu" from Temps's own managed
 * deployment. List every alias you've seen for a host, not just one.
 */
const MESH_IP_BY_NODE_NAME: Readonly<Record<string, string>> = {
  'contabo-healthcare': '10.201.0.1',
  'oracle-main': '10.201.0.2',
  'temps-worker': '10.201.0.5',
  'temps-worker-ubuntu': '10.201.0.5',
  'temps-control-plane': '10.201.0.6',
};

const CONNECT_TIMEOUT_MS = 2000;

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

  const client = new Client({
    connectionString: monitorUri,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: CONNECT_TIMEOUT_MS,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const result = await client.query<{ nodehost: string; nodeport: number }>(
      'SELECT nodehost, nodeport FROM pgautofailover.node ORDER BY nodeid'
    );

    const localMember = result.rows.find(row => row.nodehost === myMeshIp);
    if (!localMember) {
      return null;
    }

    const url = new URL(databaseUrl);
    url.hostname = localMember.nodehost;
    url.port = String(localMember.nodeport);
    return url.toString();
  } catch {
    // Any failure (monitor unreachable, bad URL, etc.) - fall back to DATABASE_URL.
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}
