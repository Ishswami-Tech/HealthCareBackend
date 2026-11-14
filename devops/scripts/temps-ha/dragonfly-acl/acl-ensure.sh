#!/bin/sh
# Keeps the social_media login on this node's HA Dragonfly copy. Dragonfly keeps
# ACL users in memory only (lost on restart, not replicated), so this re-creates
# it whenever it is missing. The login is locked to database 5 ($5): it cannot
# select HealthcareBackend's databases 0/1, and admin commands are removed.
# The password is read from a root-only file and sent over stdin, never argv.
C=redis-dragonfly-cache
while true; do
  DEF=$(docker inspect "$C" --format '{{range .Args}}{{println .}}{{end}}' 2>/dev/null \
        | awk 'f{print; exit} /^--requirepass=/{sub(/^--requirepass=/,""); print; exit} /^--requirepass$/{f=1}')
  if [ -n "$DEF" ] && [ -s /acl/social_media.pass ]; then
    if ! docker exec -e REDISCLI_AUTH="$DEF" "$C" redis-cli -p 6379 acl users 2>/dev/null | grep -qx social_media; then
      # Dragonfly v2.0 has no FAILOVER command; an unknown name rejects the whole rule.
      reply=$({ printf 'ACL SETUSER social_media on >'; cat /acl/social_media.pass;
        printf ' ~* &* +@all -flushall -config -shutdown -replicaof -slaveof -acl -debug -monitor -save -bgsave $5\n'; } \
        | docker exec -i -e REDISCLI_AUTH="$DEF" "$C" redis-cli -p 6379 2>&1 | tr -d '\r')
      if [ "$reply" = "OK" ]; then echo "$(date -u +%FT%TZ) created social_media on $C";
      else echo "$(date -u +%FT%TZ) FAILED to create social_media on $C: $reply"; fi
    fi
  fi
  sleep 30
done
