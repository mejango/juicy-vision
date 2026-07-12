FROM denoland/deno:latest

# Install Docker CLI for Forge execution (optional - see FORGE_DOCKER_ENABLED)
USER root
RUN apt-get update && apt-get install -y \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Cache dependencies first
COPY backend/deno.json .
RUN deno cache --reload npm:hono@4 npm:zod@3 npm:jose@5 npm:viem@2 npm:@anthropic-ai/sdk@0.39 npm:postgres@3

# Copy source
COPY backend/ .
COPY shared/ /app/shared/
# Keep the repository-relative ABI imports used by transactionPolicy intact.
# These generated ABIs are the protocol source of truth shared with the frontend.
COPY src/constants/abis/jbOmnichainDeployer.ts src/constants/abis/revDeployer.ts /app/src/constants/abis/

# Cache main entry
RUN deno cache main.ts

# Create temp directory for Forge jobs
RUN mkdir -p /tmp/forge && chown deno:deno /tmp/forge

USER deno

EXPOSE 8080
ENV PORT=8080
ENV DENO_ENV=production

CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write=/tmp", "--allow-run=docker", "main.ts"]
