# Backend deployment

The canonical release, migration, health, rollback, scheduler, and configuration
runbook is [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

Backend-specific local checks use Deno 2.6.5:

```sh
deno task fmt:check
deno task lint
deno task check
deno task test
```

Production configuration and migrations are explicit commands:

```sh
deno task config:check
deno task migrate
```

`deno task start` never runs migrations. Production hook compilation is
intentionally unavailable; do not mount a Docker socket into the API service.
