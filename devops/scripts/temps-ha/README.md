# Temps HA: mesh rules, replica watchdog and automatic failback

Production runs as a whole-site pair on Temps:

| Layer        | Default (preferred)                                       | Standby, in failover order                                                                                     | Failover                                                         | Failback                                |
| ------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------- |
| Postgres     | temps-worker `postgres-postgres-main-1` (10.201.0.5:6261) | oracle-main main-3 (10.201.0.8:6263, priority 50), oracle-vm2-dss main-4 (10.201.0.6:6264, 30), contabo-ds main-2 (10.201.0.7:6262, 10) | pg_auto_failover (monitor on the control plane), automatic        | `ha-failback.sh`                        |
| Dragonfly    | temps-worker 10.201.0.5:6512 (replica-priority 10)        | oracle-main (20), oracle-vm2-dss 10.201.0.6:6512 (30), contabo-ds (50); control-plane copy priority 0 (never) | 3 Sentinels (control plane, oracle-main, contabo-ds; quorum 2)    | `ha-failback.sh`                        |
| Apps         | 1 replica on each of temps-worker, oracle-main and oracle-vm2-dss (`targetNodes [6, 10, 11]`, replicas 3) | contabo-ds, only while all three are down                                                      | the other two copies keep serving; `ds-fallback.sh` moves to contabo-ds after 5 min | `ds-fallback.sh`, then `ha-failback.sh` |

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

Installed on temps-worker, contabo-ds and the control plane (2026-11-13), oracle-main (2026-11-14)
and oracle-vm2-dss (2026-11-22).

### Cluster DNS rule (added 2026-11-14)

On a host whose INPUT chain ends in REJECT/DROP (Oracle Cloud images), app containers
could not reach Temps' own `*.temps.local` resolver on the node (172.20.<n>.1:53), so
every cluster name failed there. mesh-ha-allow also allows exactly that: container
subnets -> this node's Temps resolver, port 53 (comment `hcb-cluster-dns`).
It also remembers the egress sources it applied (`/run/hcb-mesh-ha-allow.egress-sources`):
nft merges adjacent subnets in the set, which made every run delete and re-insert the
egress rule.

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

## ds-fallback (control plane only)

Every Temps app (HealthCareBackend API and worker, DSSOne, social-media web and
worker, Governance Ops, Vishwayog) targets the two primaries, temps-worker and
oracle-main (`targetNodes [6, 10]`); Temps moves a copy between them by itself.
contabo-ds is the last resort and stays out of the targets: Temps would place
copies there in normal operation, and a Europe copy serving beside the India ones
broke doctor loading on 2026-11-17. `temps-ds-fallback.timer` runs `ds-fallback.sh`
every minute as `deploy`:

- A node is up while its Temps agent accepts a TCP connection on port 3100 over
  the mesh (a stopped, rebooting or frozen VM does not).
- Fallback: once all of an app's primaries have been down for `DOWN_SECS` (300),
  its public URL no longer answers (so the control plane merely losing the mesh
  moves nothing) and contabo-ds is up, it sets the app's `target_nodes` to `[9]`
  and redeploys the current deployment (Temps' rollback to it: same image, no
  rebuild, no new code), one app at a time, API first.
- Restore: once one of its primaries has been up for `UP_SECS` (300), it sets
  `[6, 10]` again and redeploys the current deployment, which lands on the
  primaries. Postgres and Dragonfly then move home through `ha-failback`.
- Apps built only for amd64 (Governance Ops and Vishwayog, built by Temps on the
  amd64 control plane) list only temps-worker as their primary: Temps never places
  them on the arm64 oracle-main, so for them temps-worker down is "both down".
- A failed move is retried after `RETRY_SECS` (600). State is in
  `~deploy/.local/state/temps-ds-fallback` (`<app>.on-fallback` while moved,
  `<app>.deploy` = the target nodes and id of the deployment a move started).
- The rollback call answers only after Temps has copied the image to the node
  (minutes for Governance Ops' 4 GB image), though the deployment already exists.
  On 2026-11-22 a 60 s client timeout made every attempt look failed: the
  deployment came up at 13:17, yet each retry started a new one over it (seven
  needless restarts until 14:27). Now a rollback that has not answered after
  `ROLLBACK_TIMEOUT_SECS` (300) is followed up by finding the deployment it created,
  a later run follows the deployment in `<app>.deploy` instead of starting another,
  and a deployment superseded by a newer one hands over to that one.
- Uses the Temps API with the `temps-local` CLI context's key; only the
  `target_nodes` field is sent (never the console's Save, which unpublishes the
  tunnels).

```bash
sudo bash install-ds-fallback.sh            # first install: DRY_RUN=1 (logs only)
journalctl -u temps-ds-fallback.service -f
sudo sed -i 's/^DRY_RUN=.*/DRY_RUN=0/' /etc/default/temps-ds-fallback   # go live
```

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

## pg-forwarder (all nodes) — one Postgres for every app

governance-ops, vishwayog and social-media used their own Postgres
(`postgres-postgres-pzxq`), which ran as two unconnected copies (temps-worker and
contabo-ds) that had diverged. On 2026-11-14 their data was merged (union; the
newer `updatedAt` won on the 13 rows edited on both sides) and loaded into
`postgres-main` as separate databases owned by their existing logins
(`governanceops`, `social_ai`, `vishwayogayurveda_app_production`; password hashes
copied, so no app secret changed). `userdb` was not touched.

The apps still connect to `postgres-postgres-pzxq:5432`; new apps should use the second
name, `postgres-primary:5432` (same forwarder, added 2026-11-14), so no app config
needs an IP for the database. That name is now answered
by `hcb-pg-forwarder` (HAProxy, network alias on `temps-app-network` and every
`temps<N>` network) which forwards to whichever member is primary, preferring
temps-worker, then Oracle, then contabo-ds. Each node's `hcb-pg-role` agent
(published on `<mesh-ip>:6268`) answers `up` only when its member is not in
recovery, so writes never go to a standby and the apps follow failovers.

```bash
# per node; contabo-ds has no passwordless sudo: add DIR=$HOME/hcb-pg-forwarder
sudo MESH_IP=10.201.0.5 MEMBER=postgres-postgres-main-1 PGPORT=6261 bash pg-forwarder/install.sh
```

The old `postgres-postgres-pzxq` containers are stopped (restart=no), not removed.
Backups: `/var/backups/pzxq/` (temps-worker), `~/backups/pzxq/` (contabo-ds and the
control plane), merge workspace `~/pzxq-merge/` on contabo-ds.

## dragonfly-acl (all nodes) — social-media on the HA Dragonfly

social-media uses the HA Dragonfly as login `social_media`, locked to database 5
(ACL `$5`: it cannot select HealthcareBackend's databases 0/1; FLUSHALL, CONFIG,
ACL, SHUTDOWN, replication and persistence commands removed). Dragonfly keeps ACL
users in memory only, so `hcb-dragonfly-acl` re-creates the login on each node's
copy whenever it is missing. `hcb-redis-forwarder` answers `dragonfly:6379` on
`temps-app-network` and every `temps<N>` network and forwards to whichever copy
reports `role:master`, so social-media follows cache failovers.

The password lives only in `social_media.pass` (0600; `/etc/hcb-dragonfly-acl/` on
temps-worker, oracle-main and oracle-vm2-dss, `~/hcb-dragonfly-acl/` on contabo-ds). The app's REDIS_URL
(`redis://social_media:<pw>@dragonfly:6379/5`) is in `~/social-media-redis-url.txt`
on the control plane. The old standalone `dragonfly` container on temps-worker is
stopped (restart=no) with a snapshot of its keys on its volume; its stale queue
jobs were deliberately not loaded into the live queues.

```bash
sudo ACL_DIR=/etc/hcb-dragonfly-acl bash dragonfly-acl/install.sh            # reconciler
sudo ACL_DIR=/etc/hcb-dragonfly-acl bash dragonfly-acl/install-forwarder.sh  # forwarder
```

## dragonfly-start (every copy, incl. the control plane) — start as Sentinel's replica

Dragonfly cannot persist a Sentinel `REPLICAOF` (no `CONFIG REWRITE`), so a fixed
`--replicaof` flag is wrong after the first failover. Each HA copy's
`redis-dragonfly-cache` starts through `start.sh`, which asks the Sentinels which node is
master and starts as its replica. It never starts as master by itself: a copy that
did would load its old on-disk snapshot and the replicas would resync that stale
data. If the Sentinels still name this copy as master (a quick restart), it waits
until they promote another copy, then replicates from it; `hcb-ha-failback` moves the
primary back to temps-worker once it is a healthy replica again.

`install.sh` copies image, flags, ports, volume and logging from the running
container, drops `--replicaof`, and refuses on the current master (run
`SENTINEL FAILOVER dragonfly` first). Sentinel password: `~/hcb-dragonfly/sentinel.password`
(0600) on each node.

The control plane's copy (Temps service `dragonfly-cache`, which `backup.sh`
snapshots) was created before the announce flags existed, with a fixed
`--replicaof` to temps-worker and no `--replica_announce_ip`. It registered with the
master as `10.201.0.1:6379` (its in-container port; the published one is 6512), so the
Sentinels marked it `s_down` and never repointed it: after the 2026-11-22 failover it
kept asking temps-worker, by then a replica, and failed with "Replicating a replica"
until failback. It was recreated through `start.sh` the same day, announcing
`10.201.0.1:6512` with `--replica_priority=0` so it is never promoted. `install.sh`
takes the missing flags from `ANNOUNCE_IP`/`ANNOUNCE_PORT`/`REPLICA_PRIORITY`; flags the
container already has win. Afterwards run `SENTINEL RESET dragonfly` on one Sentinel at
a time (wait until it lists the replicas again) to drop the old `:6379` entry.
Temps still owns this service's record; if Temps ever recreates the container, it comes
back with a fixed `--replicaof`, so run this again.

```bash
SENTINEL_PASSWORD_FILE=~/hcb-dragonfly/sentinel.password bash dragonfly-start/install.sh
DOCKER="sudo -n docker" SENTINEL_PASSWORD_FILE=~/hcb-dragonfly/sentinel.password bash dragonfly-start/install.sh  # temps-worker
# control plane (Sentinel password: /data/sentinel.password in the dragonfly-sentinel container)
ANNOUNCE_IP=10.201.0.1 ANNOUNCE_PORT=6512 REPLICA_PRIORITY=0 \
  SENTINEL_PASSWORD_FILE=~/hcb-dragonfly/sentinel.password bash dragonfly-start/install.sh
```

## mesh-recover (every node, incl. the control plane)

Docker starts containers before the Temps agent brings up `temps-wg0`, so every
container that publishes a port on the node's mesh address (app replicas,
`postgres-main-N`, `redis-dragonfly-cache`, `dragonfly-sentinel`,
`hcb-pg-role`) failed at boot with `cannot assign requested address`. Docker
never retries a failed start, and some containers even came back with no network
attached. Seen on oracle-main's reboot 2026-11-22: 9 of 12 containers stayed
down until started by hand.

- `90-temps-mesh-bind.conf`: `net.ipv4.ip_nonlocal_bind=1`, so Docker can bind
  the mesh address before it exists. This alone prevents the failure.
- `hcb-mesh-recover.service` (oneshot at boot): waits for `temps-wg0`, then, for
  containers with restart policy `always`/`unless-stopped` only, reattaches any
  that lost their network (to their `NetworkMode` network) and starts any whose
  last start failed on networking, databases and caches first. Containers
  stopped on purpose have no start error and are left alone. Logs
  `nothing to recover` when the sysctl did its job.

Install on each node with `sudo ./install-mesh-recover.sh` (nothing running is
restarted). Tested 2026-11-22 on oracale-vm2-dss: without the fix a test
container on the mesh address stayed down after reboot; with it, it was up
before the mesh existed.

## Dragonfly backup and restore (control plane)

`docker-infra/backup.sh` (cron `0 */12 * * *` via `run-backup-12h.sh`, log
`/var/log/backups/12h.log`) backs up every Dragonfly database in one file:
db0 (app cache, sessions, token blacklist, locks), db1 (HCB BullMQ queues and their
run-once markers) and db5 (social-media BullMQ). It snapshots the control plane's own
`redis-dragonfly-cache` (Temps service `dragonfly-cache`, a live replica of the
master), so the India master is never asked to snapshot and no S3 key is needed on
any other node. The upload uses the existing rclone remote.

What it does: authenticates inside the container (the password never leaves it),
refuses when the copy's master link is down or its master is not the one the
Sentinels name (after a failover, until failback), runs `SAVE RDB hcb-backup-<ts>`,
copies that single RDB file out, removes it from the container, and stores
`dragonfly/<type>/dragonfly-<ts>.rdb.gz` locally and under `backups/dragonfly/` in S3.
The metadata JSON records keys per database and the source copy/master. The old
Coolify `redis-dragonfly` container is stale and is never backed up.

**Check a backup** (safe, any machine with Docker; tested with v2.0.2 and v2.1.0):

```bash
docker volume create df-drill
gunzip -c dragonfly-<ts>.rdb.gz | docker run --rm -i -v df-drill:/data alpine sh -c 'cat > /data/dump.rdb'
docker run -d --name df-drill -v df-drill:/data docker.dragonflydb.io/dragonflydb/dragonfly:v2.0.2 \
  dragonfly --dbfilename=dump --requirepass=drill
docker exec -e REDISCLI_AUTH=drill df-drill redis-cli --no-auth-warning info keyspace   # compare with the metadata "keyspace"
docker rm -f df-drill && docker volume rm df-drill
```

**Restore into the live HA set** (replaces ALL data in db0/db1/db5 on every copy; for
data loss or corruption only, and only with the user's go-ahead). No restart and no
failover: `DFLY LOAD` on the master replaces its dataset online and the replicas
follow over their existing link (verified on scratch v2.0.2: master and replica both
held exactly the snapshot afterwards; ACL users survived).

1. Find the master: `sentinel get-master-addr-by-name dragonfly` (normally temps-worker).
2. Copy the backup into the master copy's data dir:
   `gunzip -c dragonfly-<ts>.rdb.gz > /tmp/hcb-restore.rdb && sudo -n docker cp /tmp/hcb-restore.rdb redis-dragonfly-cache:/data/hcb-restore.rdb`
3. Load it, authenticating inside the container as backup.sh does:
   `redis-cli ... DFLY LOAD hcb-restore.rdb`, then `INFO keyspace` on the master and on
   each replica (oracle-main, oracle-vm2-dss, contabo-ds, control plane) must match the metadata.
4. Remove `/data/hcb-restore.rdb` from the container and `/tmp/hcb-restore.rdb`.
5. Check `hcb-dragonfly-acl` still lists the `social_media` user on each copy (it
   re-creates it if missing) and that the HCB worker and social-media worker resume
   their queues. Sessions and refresh tokens revert to the backup's point in time.

`docker-infra/restore.sh`'s Dragonfly step targets the old single-container layout
(a container named `dragonfly`); do not use it for the HA set.

## Upgrade safety

Nothing here edits a file Temps owns or reads Temps' internal database, so
upgrading Temps (server, agent or CLI) does not overwrite or break it:

| Ours (survives Temps upgrades)                                              | Talks to Temps / others through                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `hcb-mesh-ha-allow` timer + `/usr/local/sbin/hcb-mesh-ha-allow`             | nftables; inserts tagged rules into `inet temps_mesh`, never edits Temps' rules |
| `hcb-node-watchdog` + `/usr/local/sbin/hcb-node-watchdog`                   | Docker CLI, systemctl                                                           |
| `hcb-direct-link` timer + `/usr/local/sbin/hcb-direct-link`                 | own WireGuard iface + `inet hcb_direct`; one tagged rule in `inet temps_network` |
| `hcb-ha-failback` timer + `/usr/local/bin/hcb-ha-failback`                  | pg_auto_failover monitor SQL API, Sentinel commands, Temps CLI (pinned)         |
| `hcb-mesh-recover` + `/etc/sysctl.d/90-temps-mesh-bind.conf` (every node)  | Docker CLI, kernel                                                              |
| `dragonfly-sentinel` container, `redis-dragonfly-cache` on the worker nodes | not managed by Temps (no Temps labels)                                          |
| control plane `redis-dragonfly-cache` flags/entrypoint (`dragonfly-start`)  | Temps service `dragonfly-cache`; a Temps recreate drops them (see above)        |

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

## Related: Temps agent start on temps-worker

`temps-agent.service` itself is left exactly as Temps installs it; the node
watchdog starts the agent if a slow Docker start made systemd give up on it.
The mesh-address bind fix that used to be described here is now
[mesh-recover](#mesh-recover-every-node-incl-the-control-plane), on every node.
