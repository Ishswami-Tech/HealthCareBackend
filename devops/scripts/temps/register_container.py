#!/usr/bin/env python3
"""Point an existing deployment_containers row at a manually-run replacement
container, or insert a new row for a node Temps's scheduler never reaches
(oracle-main's arm64 node). Runs ON the Temps control-plane host.

Usage (update an existing row, e.g. after swapping out Temps's own
wrongly-commanded worker container on temps-worker):
  register_container.py update <row_id> <container_id> <container_name> <image_name> <host_port> <container_port>

Usage (insert — oracle-main's replicas, which Temps never creates a row for
on its own):
  register_container.py insert <deployment_id> <node_id> <container_id> <container_name> <image_name> <host_port> <container_port>
"""
import subprocess
import sys


def psql(sql):
    subprocess.run(
        ["docker", "exec", "-i", "temps-timescaledb", "psql", "-U", "temps", "-d", "temps", "-c", sql],
        check=True,
    )


def psql_q(sql):
    return subprocess.run(
        ["docker", "exec", "-i", "temps-timescaledb", "psql", "-U", "temps", "-d", "temps",
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout


mode = sys.argv[1]

if mode == "update":
    _, _, row_id, container_id, container_name, image_name, host_port, container_port = sys.argv
    psql(f"""
        UPDATE deployment_containers SET
          container_id = '{container_id}',
          container_name = '{container_name}',
          image_name = '{image_name}',
          container_port = {container_port},
          host_port = {host_port},
          port_bindings = '[{{"host_port": {host_port}, "container_port": {container_port}}}]'::jsonb,
          status = 'running',
          health_state = 'healthy',
          health_checked_at = now(),
          deployed_at = now(),
          ready_at = now()
        WHERE id = {row_id};
    """)
    print(psql_q(f"SELECT id, container_name, status, health_state FROM deployment_containers WHERE id = {row_id};"))

elif mode == "insert":
    _, _, deployment_id, node_id, container_id, container_name, image_name, host_port, container_port = sys.argv
    existing = psql_q(f"SELECT id FROM deployment_containers WHERE container_name = '{container_name}';").strip()
    if existing:
        row_id = existing.split("\n")[0].split("\t")[0]
        psql(f"""
            UPDATE deployment_containers SET
              container_id = '{container_id}',
              image_name = '{image_name}',
              container_port = {container_port},
              host_port = {host_port},
              port_bindings = '[{{"host_port": {host_port}, "container_port": {container_port}}}]'::jsonb,
              status = 'running',
              health_state = 'healthy',
              health_checked_at = now(),
              deployed_at = now(),
              ready_at = now()
            WHERE id = {row_id};
        """)
        print(psql_q(f"SELECT id, container_name, status, health_state FROM deployment_containers WHERE id = {row_id};"))
    else:
        psql(f"""
            INSERT INTO deployment_containers
              (deployment_id, container_id, container_name, container_port, created_at, deployed_at, ready_at,
               host_port, image_name, status, node_id, port_bindings, health_state, health_checked_at)
            VALUES
              ({deployment_id}, '{container_id}', '{container_name}', {container_port}, now(), now(), now(),
               {host_port}, '{image_name}', 'running', {node_id},
               '[{{"host_port": {host_port}, "container_port": {container_port}}}]'::jsonb, 'healthy', now());
        """)
        print(psql_q(f"SELECT id, container_name, status, health_state FROM deployment_containers WHERE container_name = '{container_name}';"))

else:
    print(f"unknown mode: {mode}", file=sys.stderr)
    sys.exit(1)
