# Temps HA: mesh rules and automatic failback

Production runs as a whole-site pair on Temps:

| Layer | Default (preferred) | Standby | Failover | Failback |
|---|---|---|---|---|
| Postgres | temps-worker `postgres-postgres-main-1` (10.201.0.5:6261) | contabo-ds main-2 (10.201.0.7:6262) | pg_auto_failover, automatic | `ha-failback.sh` |
| Dragonfly | temps-worker 10.201.0.5:6512 (replica-priority 10) | contabo-ds 10.201.0.7:6512 | Sentinel on the control plane (10.201.0.1:6579), automatic | `ha-failback.sh` |
| API / worker | 1 replica on each node (`targetNodes [6, 9]`, replicas 2) | — | Temps reschedules onto the surviving node | `ha-failback.sh` redeploys |

The app follows both data moves without a restart (`primary-tracker.ts`, `CACHE_SENTINELS`).

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

## ha-failback (control plane only)

Runs every minute as `deploy`. For each layer, once the preferred node has been a
healthy, caught-up replica for `STABLE_SECS` (300) in a row, it moves the primary back,
at most once per `COOLDOWN_SECS` (1800) per layer so a flapping node cannot bounce it:

1. Postgres: `pgautofailover.perform_promotion('default', 'postgres-postgres-main-1')`
   (planned switchover; writes pause for a few seconds).
2. Dragonfly: `SENTINEL FAILOVER dragonfly`, only if Sentinel would pick the preferred node.
3. Apps, once both data primaries are home: redeploys the current image of each project
   that has no running replica on node 6, one project at a time.

```bash
sudo bash install-ha-failback.sh
DRY_RUN=1 STATE_DIR=/tmp/hcb-failback-dry /usr/local/bin/hcb-ha-failback   # see what it would do
journalctl -u hcb-ha-failback.service -f                                      # watch it act
```

To change the default site, set `PREFERRED_PG_NODE`, `PREFERRED_CACHE` and
`PREFERRED_TEMPS_NODE` in a drop-in for `hcb-ha-failback.service` (and give the new
preferred Dragonfly node the lowest replica-priority).

## Related host fixes on temps-worker (not in this folder)

- `net.ipv4.ip_nonlocal_bind=1` (`/etc/sysctl.d/90-temps-mesh-bind.conf`): containers
  publish on 10.201.0.5, which only exists once the agent brings the mesh up.
- `temps-agent.service`: `Requires=docker.service` → `Wants=`, plus `Restart=always`
  (drop-in `10-survive-slow-docker.conf`). Docker can take many minutes to start on
  this VM, and a cancelled agent leaves the node off the mesh. A Temps reinstall may
  revert the unit edit.
