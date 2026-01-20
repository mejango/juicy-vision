FROM denoland/deno:2.1.4

WORKDIR /app

# Cache dependencies first
COPY deno.json .
RUN deno cache --reload npm:hono@4 npm:zod@3 npm:jose@5 npm:viem@2 npm:@anthropic-ai/sdk@0.39 npm:postgres@3

# Copy source
COPY . .

# Cache main entry
RUN deno cache main.ts

USER deno

EXPOSE 8080
ENV PORT=8080
ENV DENO_ENV=production

CMD ["run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
