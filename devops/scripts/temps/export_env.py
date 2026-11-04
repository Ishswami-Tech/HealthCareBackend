#!/usr/bin/env python3
"""Export one Temps environment's env vars as KEY=VALUE lines.

Runs ON the Temps control-plane host (needs the encryption key at
/home/deploy/.temps/data/encryption_key and the temps-timescaledb container).

Manually-run containers (the worker wrapper, the oracle-main replicas) sit
outside Temps's own network wiring, so the *.temps.local DB/cache hostnames
Temps injects don't resolve for them. Every manual replica this project runs
already uses the same mesh-wide addresses instead, so the rewrite here is
host-independent — the same output works for temps-worker and oracle-main.
"""
import base64
import subprocess
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENVIRONMENT_ID = sys.argv[1]
KEY = bytes.fromhex(open("/home/deploy/.temps/data/encryption_key").read().strip())


def psql(sql):
    return subprocess.run(
        ["docker", "exec", "-i", "temps-timescaledb", "psql", "-U", "temps", "-d", "temps",
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout


def decrypt(b64):
    raw = base64.b64decode(b64)
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(KEY).decrypt(nonce, ct, None).decode("utf-8")


rows = psql(
    "SELECT ev.key, ev.value, ev.is_encrypted FROM env_vars ev "
    "JOIN env_var_environments eve ON eve.env_var_id = ev.id "
    f"WHERE eve.environment_id = {ENVIRONMENT_ID} ORDER BY ev.key;"
)

has_port = False
for line in rows.strip().split("\n"):
    if not line.strip():
        continue
    key, value, is_encrypted = line.split("\t")
    plain = decrypt(value) if is_encrypted == "t" else value
    if key in ("DATABASE_URL", "DIRECT_URL"):
        plain = plain.replace("postgres-u2lu-1.postgres-u2lu.temps.local", "172.20.3.2")
    if key == "DRAGONFLY_HOST":
        plain = "10.201.0.1"
    if key == "DRAGONFLY_PORT":
        plain = "6512"
    if key == "PORT":
        has_port = True
    print(f"{key}={plain}")

if not has_port:
    print("PORT=8088")
