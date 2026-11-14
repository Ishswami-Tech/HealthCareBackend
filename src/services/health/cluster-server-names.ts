/**
 * Maps the WireGuard mesh IPs (10.201.0.0/16) that cluster members report to the
 * human-readable server they run on, for the dashboard's Database and Cache cluster tables.
 * Worker nodes use their Temps node name, so they match the replica table's Node column.
 * There is no live discovery for this - these are internal mesh addresses the app has no
 * other way to resolve to a friendly name - so it's a short, hand-maintained table. Update it
 * if a node moves to a different physical host or a new node joins the mesh.
 */
const SERVER_NAME_BY_HOST: Readonly<Record<string, string>> = {
  '10.201.0.1': 'contabo-healthcare',
  '10.201.0.5': 'temps-worker-ubuntu',
  '10.201.0.6': 'temps-control-plane',
  '10.201.0.7': 'contabo-ds',
  '10.201.0.8': 'main-server',
};

export function resolveServerName(host: string): string {
  return SERVER_NAME_BY_HOST[host] ?? host;
}
