# Temps HA: mesh rules, replica watchdog and automatic failback

Production runs as a whole-site pair on Temps:

| Layer        | Default (preferred)                                       | Standby                             | Failover                                                      | Failback                   |
| ------------ | --------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------- | -------------------------- |
| Postgres     | temps-worker `postgres-postgres-main-1` (10.201.0.5:6261) | contabo-ds main-2 (10.201.0.7:6262) | pg_auto_failover, automatic                                   | `ha-failback.sh`           |
| Dragonfly    | temps-worker 10.201.0.5:6512 (replica-priority 10)        | contabo-ds 10.201.0.7:6512          | Sentinel on the control plane (10.201.0.1:6579), automatic    | `ha-failback.sh`           |
| API / worker | 1 replica on each node (`targetNodes [6, 9]`, replicas 2) | —                                   | proxy retries on the other copy; Temps reschedules after 90 s | `ha-failback.sh` redeploys |

The app follows both data moves without a restart (`primary-tracker.ts`,
`CACHE_SENTINELS`).

Requests enter through the Temps proxy on the control plane, which round-robins
across both API copies. Per the Temps docs it health-checks a copy only at
deploy time and retries a request once on another copy only when it cannot
connect. Drill 2026-11-13 (probe every second through the public domain):

| Copy on temps-worker                     | Result                                                              |
| ---------------------------------------- | ------------------------------------------------------------------- |
| stopped / crashed                        | 66/66 OK, all served by contabo-ds, worst 6.5 s                     |
| frozen (process hung, container running) | no retry: every other request hung until it recovered               |
| frozen, with `node-watchdog`             | restarted after ~40 s; 22 × 503 (requests stuck on it), then normal |

## mesh-ha-allow (every node)

The Temps agent installs `table inet temps_mesh`, which drops every new
connection a container opens over the WireGuard mesh, and rebuilds that table
each time it starts. Postgres keepers, streaming replication and Dragonfly
replicas all connect out from containers to mesh ports 6000-6999, so after any
reboot a node could not rejoin until the allow rules were added back by hand.
`hcb-mesh-ha-allow.timer` re-inserts them (tagged `hcb-ha-egress` /
`hcb-ha-replies`) at boot and every 30 s.

```bash
sudo bash install-mesh-ha-allow.sh                              # worker nodes
sudo HA_EXTRA_SOURCES=10.0.1.0/24 bash install-mesh-ha-allow.sh # extra container subnets, if any
```

Installed on temps-worker, contabo-ds and the control plane (2026-11-13).

## node-watchdog (every worker node)

`hcb-node-watchdog.service` turns "hung" into "restarting", which the proxy
handles:

- API copies: `GET /infra-health` (no DB/cache/queue checks, so a database or
  cache failover never triggers it) every 5 s with a 5 s timeout. Restarted only
  when 5 probes in a row failed **and** Docker's own health check is failing too
  (two independent observers, ~50 s), so a copy that is merely slow under a
  traffic spike is left alone.
- Worker copies: Docker's own HEALTHCHECK says `unhealthy` -> `docker restart`.
- Only containers built from this repo's image (OCI `image.source` label); never
  while Docker reports them `starting` or in their first 180 s; at most once per
  2 minutes and 3 times per hour per copy (then it logs and leaves the copy
  alone).
- Starts `temps-agent` if it is not running, but only in the first hour after
  boot (a slow Docker start makes systemd cancel the agent for good). Later a
  stopped agent is left alone: maintenance or a Temps upgrade stops it on
  purpose. Disable entirely with `touch /etc/hcb/temps-agent-guard.disabled`.
- Every docker call has a timeout, so a stuck dockerd cannot freeze the loop.

Live drill 2026-11-13 (API process frozen with SIGSTOP on temps-worker):
detected and restarted; the copy came back healthy. Requests stuck on the frozen
copy get 503 when it is restarted - the proxy never retries a request it already
sent.

```bash
sudo bash install-node-watchdog.sh          # also restarts a running watchdog on reinstall
journalctl -u hcb-node-watchdog -f
```

## ha-failback (control plane only)

Runs every minute as `deploy`. For each layer, once the preferred node has been
a healthy, caught-up replica for `STABLE_SECS` (300) in a row, it moves the
primary back, at most once per `COOLDOWN_SECS` (1800) per layer so a flapping
node cannot bounce it:

1. Postgres:
   `pgautofailover.perform_promotion('default', 'postgres-postgres-main-1')`
   (planned switchover; writes pause for a few seconds).
2. Dragonfly: `SENTINEL FAILOVER dragonfly`, only if Sentinel would pick the
   preferred node.
3. Apps, once both data primaries are home: redeploys the current image of each
   app that has no running copy on `temps-worker-ubuntu`, one app at a time
   (Temps never rebalances on its own). If Temps still places no copy there
   (drained or offline - the CLI key cannot read node settings), it backs off
   for 6 h instead of redeploying every cooldown. A deployment unfinished for
   over 2 h (e.g. paused) is logged as stuck and does not block failback. Uses
   the Temps CLI pinned to `@temps-sdk/cli@0.1.38`, installed once under
   `~deploy/.local/share/hcb-temps-cli` (npx only as a fallback).

```bash
sudo bash install-ha-failback.sh
DRY_RUN=1 STATE_DIR=/tmp/hcb-failback-dry /usr/local/bin/hcb-ha-failback   # see what it would do
journalctl -u hcb-ha-failback.service -f                                      # watch it act
```

To change the default site, set `PREFERRED_PG_NODE`, `PREFERRED_CACHE` and
`PREFERRED_NODE_NAME` in a drop-in for `hcb-ha-failback.service` (and give the
new preferred Dragonfly node the lowest replica-priority).

## direct-link (temps-worker <-> oracle-main)

The Temps mesh is hub-and-spoke: workers only peer with the control plane, so
temps-worker (Pune) and oracle-main (Mumbai) reached each other through Europe
at ~280 ms although they are ~9 ms apart. `hcb-direct-link` adds a second
WireGuard interface (`hcb-wg1`, UDP 51830) between just these two and routes
the peer's mesh IP as a /32 over it. Everything else stays on `temps-wg0`.

- oracle-main listens on UDP 51830 (Oracle Cloud security list rule +
  host iptables rule added by the script); temps-worker is behind NAT and
  connects out with a 25 s keepalive.
- Every 10 s each side pings the peer through the tunnel (ICMP between the two
  mesh IPs is pinned to the tunnel by `ip rule` pref 10201 / table 201). No
  reply: the /32 route is removed and traffic falls back to the hub; replies
  again: the route comes back. Tested 2026-11-14: fallback ~7 s, recovery ~1 s.
- `table inet hcb_direct` mirrors the Temps mesh lockdown for `hcb-wg1`, and a
  tagged `hcb-direct-vxlan` rule in `inet temps_network` accepts the overlay
  (VXLAN) from the peer; it is re-inserted after the agent rebuilds that table.

```bash
sudo bash install-direct-link.sh pubkey        # on both nodes, exchange keys
# oracle-main (public IP):
sudo DL_LOCAL_IP=10.201.0.8 DL_PEER_IP=10.201.0.5 DL_PEER_PUBKEY=<temps-worker key> \
  DL_LISTEN_PORT=51830 bash install-direct-link.sh
# temps-worker (behind NAT):
sudo DL_LOCAL_IP=10.201.0.5 DL_PEER_IP=10.201.0.8 DL_PEER_PUBKEY=<oracle-main key> \
  DL_PEER_ENDPOINT=137.23.47.48:51830 bash install-direct-link.sh
hcb-direct-link status                          # route should say dev hcb-wg1
sudo hcb-direct-link down                       # remove; all traffic back on temps-wg0
```

Installed on temps-worker and oracle-main (2026-11-14).

## Upgrade safety

Nothing here edits a file Temps owns or reads Temps' internal database, so
upgrading Temps (server, agent or CLI) does not overwrite or break it:

| Ours (survives Temps upgrades)                                              | Talks to Temps / others through                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `hcb-mesh-ha-allow` timer + `/usr/local/sbin/hcb-mesh-ha-allow`             | nftables; inserts tagged rules into `inet temps_mesh`, never edits Temps' rules |
| `hcb-node-watchdog` + `/usr/local/sbin/hcb-node-watchdog`                   | Docker CLI, systemctl                                                           |
| `hcb-direct-link` timer + `/usr/local/sbin/hcb-direct-link`                 | own WireGuard iface + `inet hcb_direct`; one tagged rule in `inet temps_network` |
| `hcb-ha-failback` timer + `/usr/local/bin/hcb-ha-failback`                  | pg_auto_failover monitor SQL API, Sentinel commands, Temps CLI (pinned)         |
| `/etc/sysctl.d/90-temps-mesh-bind.conf` (temps-worker)                      | kernel                                                                          |
| `dragonfly-sentinel` container, `redis-dragonfly-cache` on the worker nodes | not managed by Temps (no Temps labels)                                          |

After a Temps upgrade, check:

1. `journalctl -u hcb-mesh-ha-allow -n 5` on each node. If the agent changes the
   lockdown layout, the script refuses to patch and logs
   `lockdown layout changed, not patching` (and the unit shows failed), instead
   of guessing. Postgres/Dragonfly rejoin after a reboot depends on it.
2. `journalctl -u hcb-direct-link -n 5` on temps-worker and oracle-main, and
   `hcb-direct-link status` shows the peer via `hcb-wg1`. If Temps changes its
   VXLAN drop rule the script logs `layout changed; not patching`.
3. `DRY_RUN=1 STATE_DIR=/tmp/fb /usr/local/bin/hcb-ha-failback` on the control
   plane runs without "Temps CLI failed". If the CLI's JSON changed, bump
   `TEMPS_CLI_VERSION` only after re-testing this dry run.
4. Temps docs to re-read: [multi-node](https://temps.sh/docs/multi-node),
   [networking](https://temps.sh/docs/networking),
   [HA databases](https://temps.sh/docs/ha-databases). A built-in failback,
   preferred node or runtime health check would make parts of this folder
   unnecessary.

## Related host fix on temps-worker (not in this folder)

- `net.ipv4.ip_nonlocal_bind=1` (`/etc/sysctl.d/90-temps-mesh-bind.conf`):
  containers publish on 10.201.0.5, which only exists once the agent brings the
  mesh up. `temps-agent.service` itself is left exactly as Temps installs it;
  the node watchdog starts the agent if a slow Docker start made systemd give up
  on it.
