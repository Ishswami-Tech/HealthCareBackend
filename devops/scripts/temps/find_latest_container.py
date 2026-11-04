#!/usr/bin/env python3
"""Print the latest running deployment_containers row for one environment+node.

Runs ON the Temps control-plane host. Prints "id\tcontainer_id\thost_port"
for the most recent running container Temps's own pipeline created for the
given environment on the given node, or nothing if there isn't one.

Usage: find_latest_container.py <environment_id> <node_id>
"""
import subprocess
import sys

ENVIRONMENT_ID = sys.argv[1]
NODE_ID = sys.argv[2]


def psql(sql):
    return subprocess.run(
        ["docker", "exec", "-i", "temps-timescaledb", "psql", "-U", "temps", "-d", "temps",
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout


print(psql(f"""
    SELECT dc.id, dc.container_id, dc.host_port FROM deployment_containers dc
    JOIN deployments d ON d.id = dc.deployment_id
    WHERE d.environment_id = {ENVIRONMENT_ID} AND dc.node_id = {NODE_ID} AND dc.status = 'running'
    ORDER BY dc.id DESC LIMIT 1;
"""), end="")
