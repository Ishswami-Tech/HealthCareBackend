# Cloudflare Edge Rules

This document captures the current Cloudflare custom rules for the backend and
video hosts.

Use this as the source of truth when editing edge access policy.

## Hosts

- Main API: `backend-service-v1.ishswami.in`
- Video/OpenVidu: `backend-service-v1-video.ishswami.in`

## Rule Order

1. Public routes + video
2. Protected API
3. Block everyone else except trusted IPs

## Rule 1: Public routes + video

**Name**

`Allow trusted server requests public rules + video`

**Action**

`Skip`

**Skip components**

- All remaining custom rules
- All rate limiting rules
- All managed rules
- All Super Bot Fight Mode Rules
- Browser Integrity Check
- Security Level

**Expression**

```txt
(
  http.host eq "backend-service-v1.ishswami.in"
  and (
    http.request.uri.path eq "/health"
    or http.request.uri.path eq "/api/v1/health"
    or http.request.uri.path contains "/api/v1/auth/"
    or http.request.uri.path contains "/socket.io"
    or (
      http.request.method eq "POST"
      and (
        http.request.uri.path contains "/webhooks/"
        or http.request.uri.path contains "/payments/"
      )
    )
  )
)
or
(
  http.host eq "backend-service-v1-video.ishswami.in"
  and (
    http.request.uri.path eq "/"
    or http.request.uri.path contains "/openvidu"
  )
)
```

## Rule 2: Protected API

This rule covers both of the trusted backend API paths:

- server-to-server calls using `x-internal-request-token`
- authenticated dashboard/app calls using `Authorization: Bearer ...`

**Name**

`Protected internal API`

**Action**

`Skip`

**Skip components**

- All remaining custom rules
- All rate limiting rules
- All managed rules
- All Super Bot Fight Mode Rules
- Browser Integrity Check
- Security Level

**Expression**

```txt
(
  http.host eq "backend-service-v1.ishswami.in"
  and (
    (
      http.request.uri.path contains "/api/v1/"
      and any(http.request.headers["x-internal-request-token"][*] eq "TOKEN")
    )
    or
    (
      starts_with(http.request.uri.path, "/api/v1/")
      and any(http.request.headers["authorization"][*] contains "Bearer ")
    )
  )
)
```

Replace `TOKEN` with the real internal-request token value in Cloudflare.

## Rule 3: Block everyone else except trusted IPs

**Name**

`Block everyone else except your IPs`

**Action**

`Block`

**Expression**

```txt
(http.host eq "backend-service-v1.ishswami.in"
 and not ip.src in {31.220.79.219 36.255.182.39 152.58.17.143 36.255.182.36 103.187.81.147}
 and not any(http.request.headers["x-internal-request-token"][*] eq "TOKEN"))
```

## Notes

- Keep the public/auth rule before the protected API rule.
- Keep the block rule last.
- If a new public route is added in the backend, add it explicitly to Rule 1.
- If a new authenticated dashboard endpoint is added, it should already be
  covered by Rule 2 as long as it is under `/api/v1/` and sends
  `Authorization: Bearer ...`.
- Do not store real secrets in this document. Use the placeholder `TOKEN`.
