# Kubernetes Production Setup Checklist

## Summary

This checklist covers the current Kubernetes deployment setup for the Healthcare
Backend.

## Verified Components

- API deployment
- Worker deployment
- ConfigMap
- Secrets template
- Production overlay

## Secrets

Required secrets:

- database-url
- database-migration-url
- postgres-user
- postgres-password
- redis-password
- jwt-secret
- session-secret
- cookie-secret

Optional secrets:

- google-client-id
- google-client-secret
- aws-access-key-id
- aws-secret-access-key
- aws-region
- firebase-project-id
- firebase-private-key
- firebase-client-email

## Notes

- The active video stack is managed by the backend `video` service.
