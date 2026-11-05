# Observability stack

Temps deploys the apps. Next to it:

| Tool                                                   | Role                                                                       | Runs where                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **ClickStack** (ClickHouse + HyperDX + OTel collector) | traces, logs, metrics from API, worker and web; search, dashboards, alerts | self-hosted, `clickstack/`                                                             |
| **OpenTelemetry**                                      | instrumentation in the apps, OTLP/HTTP to ClickStack                       | `src/instrument/otel.ts`, `@infrastructure/logging/otel-log-sink`; web: `@vercel/otel` |
| **PostHog**                                            | product analytics in the web app (PHI-safe defaults)                       | PostHog Cloud EU recommended (see below)                                               |
| **Uptime Kuma**                                        | external uptime checks, TLS expiry, alert fan-out                          | self-hosted, `uptime-kuma/`, on a different host                                       |

Sentry stays the error tracker. Temps web analytics keeps working; PostHog adds
funnels and product events.

```
 web (Next.js) ──OTLP traces──┐                     ┌── HyperDX UI (observe.<domain>)
 API (Nest)   ──OTLP traces, logs, metrics──► otel.<domain> ─► ClickStack collector ─► ClickHouse
 worker       ──OTLP traces, logs, metrics──┘
 browser ──HTTPS (CSP connect-src)──► PostHog Cloud EU
 Uptime Kuma (separate host) ──HTTPS──► web, API /health, /infra-health, otel.<domain>, observe.<domain>
```

## 1. ClickStack

Upstream says the all-in-one image is not for production; this uses upstream's
Docker Compose stack (separate ClickHouse, HyperDX, collector, MongoDB
containers) at a pinned commit, plus `clickstack/docker-compose.override.yml`.

Host: a dedicated small VPS is best (4 vCPU / 8-16 GB RAM / SSD sized for
retention). On the app host it competes with Postgres for memory.

```bash
sudo HYPERDX_PUBLIC_URL=https://observe.example.com devops/observability/clickstack/setup.sh
```

Then:

1. Reverse proxy with TLS (nginx/Caddy/Traefik on the host):
   - `https://observe.<domain>` → `127.0.0.1:8080` (HyperDX UI, has its own
     login)
   - `https://otel.<domain>` → `127.0.0.1:4318` (OTLP/HTTP; paths `/v1/traces`,
     `/v1/logs`, `/v1/metrics`)
   - Do not expose 4317, 8123, 9000 or 27017. The override publishes only 4318,
     13133 and the UI, on 127.0.0.1.
2. Open the UI, create the first user, copy the ingestion key from **Team
   Settings → API Keys**.
3. Retention: check the TTL on the ClickHouse tables
   (`SHOW CREATE TABLE otel_logs` etc.) and set it to your log-retention policy
   before data piles up.
4. Backups: include `/opt/clickstack/.volumes` in host backups.

Known upstream defaults to be aware of: ClickHouse `default` user and MongoDB
have no password but are only reachable on the compose `internal` network.

## 2. Wire the apps (Temps environment)

API and worker: the variables in `otel.env.example`, with
`OTEL_SERVICE_NAME=healthcare-api` and `healthcare-worker`. The ingestion key
goes in as a Temps secret.

- Traces are on whenever `OTEL_EXPORTER_OTLP_ENDPOINT` is set (unchanged
  behaviour).
- Logs: `OTEL_LOGS_EXPORTER=otlp`. LoggingService forwards each entry that
  passes `LOG_LEVEL`, after its central redaction (phones, emails, OTPs,
  tokens), with `log.type`, `log.context` and bounded metadata attributes,
  linked to the active trace.
- Metrics: `OTEL_METRICS_EXPORTER=otlp` (HTTP server/client durations from the
  instrumentations).

Web (`frontend-Healthcare`): `OTEL_EXPORTER_OTLP_ENDPOINT` +
`OTEL_EXPORTER_OTLP_HEADERS` on the web project turn on `@vercel/otel` server
traces (`healthcarefrontend-web`).

Temps note: if Temps injects its own `OTEL_EXPORTER_OTLP_ENDPOINT` for its
traces view, setting ours sends traces to ClickStack instead. To keep both, run
a collector that fans out to the two.

## 3. Uptime Kuma

```bash
docker compose -f devops/observability/uptime-kuma/docker-compose.yml up -d
```

Publish `127.0.0.1:3001` over TLS, create the admin user, add notification
channels (e-mail/Slack/WhatsApp/Telegram) and these monitors:

| Monitor       | Type                 | Target                             | Pass condition                        | Interval |
| ------------- | -------------------- | ---------------------------------- | ------------------------------------- | -------- |
| Web           | HTTP(s)              | `https://<web>/auth/login`         | 200, cert expiry alert on             | 60 s     |
| API liveness  | HTTP(s)              | `https://<api>/infra-health`       | 200                                   | 60 s     |
| API readiness | HTTP(s)              | `https://<api>/health`             | 200 (503 = DB down)                   | 60 s     |
| API degraded  | HTTP(s) - Json Query | `https://<api>/health`, `$.status` | `== "healthy"` (alerts on `degraded`) | 120 s    |
| OTLP ingest   | HTTP(s)              | `https://otel.<domain>/`           | reachable (any HTTP status)           | 300 s    |
| HyperDX UI    | HTTP(s)              | `https://observe.<domain>`         | 200                                   | 300 s    |

The worker has no HTTP health route. Alert on it from ClickStack instead: a
saved search `ServiceName = 'healthcare-worker'` with an alert when the count is
0 over 5 minutes.

## 4. PostHog

Self-hosted PostHog ("hobby" deploy) is officially unsupported for production,
has no support, and needs at least 4 vCPU / 16 GB RAM. Recommended: **PostHog
Cloud EU**. Project settings:

- Discard client IP data: on
- Session replay, surveys, heatmaps: off
- Autocapture: off (the app only sends sanitized page views and explicit events)

Web env (`frontend-Healthcare`, build time): `NEXT_PUBLIC_POSTHOG_KEY` (project
API key, public), `NEXT_PUBLIC_POSTHOG_HOST` (e.g. `https://eu.i.posthog.com`;
also added to the CSP `connect-src`), `NEXT_PUBLIC_ENABLE_ANALYTICS=true`.
Without the key and host, nothing loads. The browser talks to PostHog directly;
ad blockers will drop some events. A same-origin reverse proxy would recover
them but needs `skipTrailingSlashRedirect` in `next.config.ts` (PostHog paths
end in `/`), so it is left out for now.

If you do self-host it anyway:
`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/posthog/posthog/HEAD/bin/deploy-hobby)"`
on its own VM, then point `NEXT_PUBLIC_POSTHOG_HOST` at it.

## PHI rules for this stack

- Never put names, phones, emails, diagnoses, prescriptions or free-text notes
  in span attributes, log metadata keys you add, or PostHog event properties.
  IDs (UUIDs), roles, clinic ids, counts and durations are fine.
- The API sends redacted log entries only; no request/response bodies or headers
  in traces.
- PostHog: memory-only persistence (no cookies/localStorage), no autocapture, no
  recording; URLs are stripped of query strings and ID-like path segments before
  sending.
