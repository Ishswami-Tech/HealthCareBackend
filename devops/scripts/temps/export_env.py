#!/usr/bin/env python3
"""Export one Temps environment's env vars as KEY=VALUE lines.

Runs ON the Temps control-plane host (needs the encryption key at
/home/deploy/.temps/data/encryption_key and the temps-timescaledb container).

Manually-run containers (the worker wrapper, the oracle-main replicas) sit
outside Temps's own network wiring. The DB hostname (*.temps.local) now
resolves fine on every node, including oracle-main, once each node's Docker
daemon forwards unresolved queries to the mesh DNS server (172.20.5.1) in
addition to public resolvers — see /etc/docker/daemon.json on that node.
DRAGONFLY_HOST/PORT are still rewritten to a fixed mesh address since the
cache hostname Temps injects is a different, still-unresolvable name for
manually-run containers.
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
    if key == "DRAGONFLY_HOST":
        plain = "10.201.0.1"
    if key == "DRAGONFLY_PORT":
        plain = "6512"
    if key == "PORT":
        has_port = True
    print(f"{key}={plain}")

if not has_port:
    print("PORT=8088")
