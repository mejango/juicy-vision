FROM denoland/deno:latest

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

USER deno

EXPOSE 8080
ENV PORT=8080
ENV DENO_ENV=production

CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
