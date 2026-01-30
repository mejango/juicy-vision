FROM denoland/deno:latest

# Install Docker CLI for Forge execution (optional - see FORGE_DOCKER_ENABLED)
USER root
RUN apt-get update && apt-get install -y \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependencies first
COPY backend/deno.json .
RUN deno cache --reload npm:hono@4 npm:zod@3 npm:jose@5 npm:viem@2 npm:@anthropic-ai/sdk@0.39 npm:postgres@3

# Copy source
COPY backend/ .
COPY shared/ /shared/

# Update import map for container paths
RUN sed -i 's|"@shared/": "../shared/"|"@shared/": "/shared/"|' deno.json

# Cache main entry
RUN deno cache main.ts

# Create temp directory for Forge jobs
RUN mkdir -p /tmp/forge && chown deno:deno /tmp/forge

USER deno

EXPOSE 8080
ENV PORT=8080
ENV DENO_ENV=production

CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write=/tmp", "--allow-run=docker", "main.ts"]
