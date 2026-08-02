# Architecture & Deployment: The Source of Truth

This document outlines the **Hybrid Enterprise Architecture** for the Healthcare
Backend. It exists to prevent confusion regarding the roles of Coolify, Nginx,
and GitHub Actions on our single-VPS setup.

## The Problem (Why this architecture?)

We wanted a true **Zero-Downtime (Blue-Green) Deployment** strategy so that
users are never dropped when we ship new code. However, we also wanted the
convenience of **Automatic SSL (HTTPS) Certificates** provided by Coolify.
Coolify natively causes downtime when it deploys (tearing down old containers to
start new ones).

To get the best of both worlds, we split responsibilities into three distinct
layers.

---

## 1. Edge Proxy & SSL (Coolify Traefik)

**Role:** The Front Door & Certificate Manager

- **What it does:** Coolify's Traefik proxy listens on ports `80` and `443` to
  the public internet. It handles the automatic generation and renewal of Let's
  Encrypt SSL certificates.
- **What it DOES NOT do:** It does **not** know about blue-green deployments or
  our specific application logic.
- **Routing:** Once it decrypts the HTTPS traffic, it blindly routes it
  internally to our Nginx router on port `8088`.

## 2. Blue-Green Traffic Switcher (Internal Nginx)

**Role:** The Zero-Downtime Router

- **What it does:** Listens strictly on the internal port `8088`. It holds the
  `upstream` configuration that tells traffic whether to go to the `latest-api`
  container or the `latest-api-next` container.
- **What it DOES NOT do:** It does **not** handle SSL/HTTPS. It assumes traffic
  hitting it has already been decrypted by Coolify Traefik.
- **Routing:** When GitHub Actions completes a health check on new code, it
  hot-swaps this Nginx configuration and reloads Nginx, switching the traffic
  instantly without dropping connections.

## 3. The Deployment Owner (GitHub Actions)

**Role:** The Absolute Orchestrator

- **What it does:** Owns the complete CI/CD lifecycle. It builds the Docker
  images, pushes them to GHCR, SSHs into the VPS, runs database migrations,
  starts new containers (`latest-api-next`), waits for them to become healthy,
  and triggers the Nginx hot-swap.
- **What it DOES NOT do:** It does not rely on Coolify's API to trigger
  deployments. Coolify's "Auto Deploy" feature must remain turned OFF.

## 4. Host-Managed Services (PostgreSQL & Dragonfly)

- **Role:** Persistent runtime infrastructure.
- These are defined in `devops/docker/docker-compose.prod.yml` alongside the API
  and Nginx router. They are strictly separated from application redeploys to
  ensure data integrity.

---

## The Request Flow

1. User makes a request to `https://api.yourdomain.com`
2. **Coolify Traefik** (Port 443) receives the request and decrypts the SSL.
3. **Coolify Traefik** forwards the raw HTTP request to `localhost:8088`.
4. **Internal Nginx** (Port 8088) receives the request.
5. **Internal Nginx** checks its `upstream.conf` and forwards the request to the
   currently active API container (`latest-api`).

## Why not just use Coolify for everything?

If we used Coolify to deploy our code, we would lose Zero-Downtime deployments,
self-healing rollbacks, and tight integration with our GitHub testing pipelines.
Coolify is an excellent operational dashboard and SSL manager, but GitHub
Actions is a far superior, enterprise-grade deployment orchestrator.
