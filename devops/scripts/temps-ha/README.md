# Temps HA: mesh rules, replica watchdog and automatic failback

Production runs as a whole-site pair on Temps:

| Layer | Default (preferred) | Standby | Failover | Failback |
|---|---|---|---|---|
| Postgres | temps-worker `postgres-postgres-main-1` (10.201.0.5:6261) | contabo-ds main-2 (10.201.0.7:6262) | pg_auto_failover, automatic | `ha-failback.sh` |
| Dragonfly | temps-worker 10.201.0.5:6512 (replica-priority 10) | contabo-ds 10.201.0.7:6512 | Sentinel on the control plane (10.201.0.1:6579), automatic | `ha-failback.sh` |
| API / worker | 1 replica on each node (`targetNodes [6, 9]`, replicas 2) | — | proxy retries on the other copy; Temps reschedules after 90 s | `ha-failback.sh` redeploys |

The app follows both data moves without a restart (`primary-tracker.ts`, `CACHE_SENTINELS`).

Requests enter through the Temps proxy on the control plane, which round-robins across
both API copies. Per the Temps docs it health-checks a copy only at deploy time and
retries a request once on another copy only when it cannot connect. Drill 2026-11-13
(probe every second through the public domain):

| Copy on temps-worker | Result |
|---|---|
| stopped / crashed | 66/66 OK, all served by contabo-ds, worst 6.5 s |
| frozen (process hung, container running) | no retry: every other request hung until it recovered |
| frozen, with `node-watchdog` | restarted after ~40 s; 22 × 503 (requests stuck on it), then normal |

## mesh-ha-allow (every node)

The Temps agent installs `table inet temps_mesh`, which drops every new connection a
container opens over the WireGuard mesh, and rebuilds that table each time it starts.
Postgres keepers, streaming replication and Dragonfly replicas all connect out from
containers to mesh ports 6000-6999, so after any reboot a node could not rejoin until
the allow rules were added back by hand. `hcb-mesh-ha-allow.timer` re-inserts them
(tagged `hcb-ha-egress` / `hcb-ha-replies`) at boot and every 30 s.

```bash
sudo bash install-mesh-ha-allow.sh                              # worker nodes
sudo HA_EXTRA_SOURCES=10.0.1.0/24 bash install-mesh-ha-allow.sh # extra container subnets, if any
```

Installed on temps-worker, contabo-ds and the control plane (2026-11-13).

## node-watchdog (every worker node)

`hcb-node-watchdog.service` turns "hung" into "restarting", which the proxy handles:

- API copies: `GET /infra-health` (no DB/cache/queue checks, so a database or cache
  failover never triggers it) every 5 s; 3 misses in a row → `docker restart`.
- Worker copies: Docker's own HEALTHCHECK says `unhealthy` → `docker restart`.
- Only containers built from this repo's image (OCI `image.source` label); never in
  their first 180 s; each at most once per 10 minutes.
- Starts `temps-agent` if it is not running (Docker can take many minutes to start on
  the temps-worker VM, and a slow start makes systemd cancel the agent for good).

```bash
sudo bash install-node-watchdog.sh
journalctl -u hcb-node-watchdog -f
```

## ha-failback (control plane only)

Runs every minute as `deploy`. For each layer, once the preferred node has been a
healthy, caught-up replica for `STABLE_SECS` (300) in a row, it moves the primary back,
at most once per `COOLDOWN_SECS` (1800) per layer so a flapping node cannot bounce it:

1. Postgres: `pgautofailover.perform_promotion('default', 'postgres-postgres-main-1')`
   (planned switchover; writes pause for a few seconds).
2. Dragonfly: `SENTINEL FAILOVER dragonfly`, only if Sentinel would pick the preferred node.
3. Apps, once both data primaries are home: redeploys the current image of each app
   that has no running copy on `temps-worker-ubuntu`, one app at a time (Temps never
   rebalances on its own). Uses the Temps CLI pinned to `@temps-sdk/cli@0.1.38`.

```bash
sudo bash install-ha-failback.sh
DRY_RUN=1 STATE_DIR=/tmp/hcb-failback-dry /usr/local/bin/hcb-ha-failback   # see what it would do
journalctl -u hcb-ha-failback.service -f                                      # watch it act
```

To change the default site, set `PREFERRED_PG_NODE`, `PREFERRED_CACHE` and
`PREFERRED_NODE_NAME` in a drop-in for `hcb-ha-failback.service` (and give the new
preferred Dragonfly node the lowest replica-priority).

## Upgrade safety

Nothing here edits a file Temps owns or reads Temps' internal database, so upgrading
Temps (server, agent or CLI) does not overwrite or break it:

| Ours (survives Temps upgrades) | Talks to Temps / others through |
|---|---|
| `hcb-mesh-ha-allow` timer + `/usr/local/sbin/hcb-mesh-ha-allow` | nftables; inserts tagged rules into `inet temps_mesh`, never edits Temps' rules |
| `hcb-node-watchdog` + `/usr/local/sbin/hcb-node-watchdog` | Docker CLI, systemctl |
| `hcb-ha-failback` timer + `/usr/local/bin/hcb-ha-failback` | pg_auto_failover monitor SQL API, Sentinel commands, Temps CLI (pinned) |
| `/etc/sysctl.d/90-temps-mesh-bind.conf` (temps-worker) | kernel |
| `dragonfly-sentinel` container, `redis-dragonfly-cache` on the worker nodes | not managed by Temps (no Temps labels) |

After a Temps upgrade, check:

1. `journalctl -u hcb-mesh-ha-allow -n 5` on each node. If the agent changes the
   lockdown layout, the script refuses to patch and logs
   `lockdown layout changed, not patching` (and the unit shows failed), instead of
   guessing. Postgres/Dragonfly rejoin after a reboot depends on it.
2. `DRY_RUN=1 STATE_DIR=/tmp/fb /usr/local/bin/hcb-ha-failback` on the control plane
   runs without "Temps CLI failed". If the CLI's JSON changed, bump
   `TEMPS_CLI_VERSION` only after re-testing this dry run.
3. Temps docs to re-read: [multi-node](https://temps.sh/docs/multi-node),
   [networking](https://temps.sh/docs/networking), [HA databases](https://temps.sh/docs/ha-databases).
   A built-in failback, preferred node or runtime health check would make parts of this
   folder unnecessary.

## Related host fix on temps-worker (not in this folder)

- `net.ipv4.ip_nonlocal_bind=1` (`/etc/sysctl.d/90-temps-mesh-bind.conf`): containers
  publish on 10.201.0.5, which only exists once the agent brings the mesh up.
  `temps-agent.service` itself is left exactly as Temps installs it; the node watchdog
  starts the agent if a slow Docker start made systemd give up on it.
