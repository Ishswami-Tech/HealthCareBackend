# Deployment README

This branch is the preprod validation lane for the Healthcare Backend. Its
purpose is to prove the CI/CD and deployment model before the same flow is used
on `main`.

The rule is simple:

- keep deployment, Docker, and infrastructure control changes here
- keep application behavior changes out of this branch
- validate the pipeline here first
- only promote the same pattern to `main` after it is stable

## Ownership

- GitHub Actions owns validation, build, image publish, and release
  verification.
- Coolify owns runtime containers, environment control, logs, and traffic
  switching.
- The app code should not be mixed into preprod pipeline work unless it is
  required for deployment compatibility.

## Branch Intent

- `preprod` is the safe staging lane for CI/CD, blue-green, backup, restore, and
  health verification.
- `main` remains the production lane after preprod is proven stable.

## What This Branch Should Contain

- CI workflow changes
- Docker and compose changes
- nginx routing and blue-green support
- deployment scripts
- backup, restore, and verify scripts
- docs for operators and release flow
- package and lockfile changes required by the pipeline

## What This Branch Should Avoid

- feature work
- functional behavior changes in `src/`
- risky database or contract changes that are not required for the deployment
  workflow itself

## Validation Flow

```text
feature branch -> preprod -> main
```

Each promotion should follow the same shape:

1. validate source
2. build image
3. push image
4. check infra health
5. recover infra if needed
6. deploy to inactive slot
7. verify deployment externally
8. switch traffic
9. keep old slot for rollback
10. create or refresh backup

## Operating Principle

If a change can break runtime behavior, do not introduce it on `preprod` just to
test the pipeline.

That keeps this branch focused on deployment safety rather than app churn.
