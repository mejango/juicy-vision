# Official multi-platform Deno image, pinned to the reviewed manifest digest.
FROM denoland/deno:2.9.3@sha256:6288db6be1c26473bb9d1843f906d9a219c0dda57fd85de4aac90296951cf6ef AS cache

WORKDIR /app/backend
COPY --chown=deno:deno backend/ ./
COPY --chown=deno:deno shared/ /app/shared/
# transactionPolicy imports these contract-derived ABIs from the repository root.
COPY --chown=deno:deno src/constants/abis/jbOmnichainDeployer.ts src/constants/abis/revDeployer.ts /app/src/constants/abis/

USER deno
RUN deno cache --frozen main.ts run_migrate.ts
RUN deno check --frozen main.ts run_migrate.ts scripts/validate-config.ts

FROM denoland/deno:2.9.3@sha256:6288db6be1c26473bb9d1843f906d9a219c0dda57fd85de4aac90296951cf6ef

ARG BUILD_SHA
ARG RAILWAY_GIT_COMMIT_SHA
ENV BUILD_SHA=${BUILD_SHA:-${RAILWAY_GIT_COMMIT_SHA}}
ENV DENO_ENV=production \
    FORGE_DOCKER_ENABLED=false \
    SEMGREP_ENABLED=false \
    APP_REVISION=${BUILD_SHA} \
    PORT=8080
LABEL org.opencontainers.image.revision=${BUILD_SHA}
WORKDIR /app/backend

COPY --from=cache --chown=deno:deno /deno-dir /deno-dir
COPY --from=cache --chown=deno:deno /app /app

USER deno
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["deno", "eval", "const r=await fetch('http://127.0.0.1:8080/livez');if(!r.ok)Deno.exit(1)"]

# Migrations are an explicit one-shot: `deno task migrate`. The API container
# has no Docker socket, subprocess, or filesystem-write capability.
ENTRYPOINT ["deno"]
CMD ["run", "--frozen", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
