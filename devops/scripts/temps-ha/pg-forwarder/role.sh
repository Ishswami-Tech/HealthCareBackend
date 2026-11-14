#!/bin/sh
# HAProxy agent-check reply for this node's postgres-main member: "up" when it is
# the primary (not in recovery), "down" otherwise or when it cannot be asked.
r=$(docker exec -u postgres "$MEMBER" psql -p "$PGPORT" -Atc 'select pg_is_in_recovery()' 2>/dev/null)
if [ "$r" = "f" ]; then echo "up"; else echo "down"; fi
