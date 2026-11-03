# Running on Oracle Cloud (Ampere A1 / arm64)

The API image is published as a multi-arch manifest (`linux/amd64` +
`linux/arm64`) by `.github/workflows/ci.yml` (QEMU + buildx). The same tag works
on x86 (Contabo) and ARM (Oracle Ampere A1); Docker pulls the right variant.

All base images are multi-arch: `node:24-bookworm-slim`, `postgres:16/18`,
`nginx:alpine`, Dragonfly (`docker.dragonflydb.io/dragonflydb/dragonfly`, arm64
supported, needs Linux kernel >= 5.10 — Ubuntu 22.04/24.04 on OCI is fine). No
dependency ships an x86-only binary (Prisma uses `native` target; `@swc/core`
and `esbuild` have arm64 packages in `yarn.lock`).

## Deploy

1. Create an Ampere A1 VM (Ubuntu 24.04 aarch64), install Docker + compose
   plugin.
2. Open ports in BOTH the OCI security list/NSG and the VM firewall (OCI Ubuntu
   images ship restrictive iptables rules).
3. `docker compose -f devops/docker/docker-compose.prod.yml pull && docker compose -f devops/docker/docker-compose.prod.yml up -d`.
4. Size memory: the API sets `--max-old-space-size=6144`; on a small A1 shape
   lower it via `NODE_OPTIONS` to ~75% of RAM.

## Building locally for ARM

`docker buildx build --platform linux/arm64 -f devops/docker/Dockerfile -t healthcare-api:arm64 .`
(on an x86 machine this runs under QEMU and is slow; prefer building natively on
the ARM VM).

## Dev note

`docker-compose.dev.yml` pins `postgres` to `linux/amd64` for Windows/x86 dev
only; remove that line on an ARM dev machine.
