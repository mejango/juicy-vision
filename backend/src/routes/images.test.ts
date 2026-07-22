import { assertEquals } from 'std/assert/mod.ts';
import type { MiddlewareHandler } from 'hono';
import { createImagesRouter, GenerateImageSchema } from './images.ts';

Deno.test('image generation payload enforces prompt and context size bounds', () => {
  assertEquals(GenerateImageSchema.safeParse({}).success, false);
  assertEquals(GenerateImageSchema.safeParse({ prompt: 'x'.repeat(2001) }).success, false);
  assertEquals(
    GenerateImageSchema.safeParse({ context: { name: 'x'.repeat(256) } }).success,
    false,
  );
  assertEquals(GenerateImageSchema.safeParse({ prompt: 'safe prompt' }).success, true);
});

Deno.test('image generation does not invoke providers when the quota is exhausted', async () => {
  let generated = false;
  const authenticate: MiddlewareHandler = async (_c, next) => await next();
  const denyQuota: MiddlewareHandler = (c) =>
    Promise.resolve(c.json({ success: false, error: 'Rate limit exceeded' }, 429));
  const generate = () => {
    generated = true;
    return Promise.resolve({ ipfsUri: 'ipfs://unused', httpUrl: 'https://example.invalid' });
  };
  const router = createImagesRouter({
    authenticate,
    rateLimit: denyQuota,
    generateFromPrompt: generate,
    generateFromContext: generate,
  });

  const response = await router.request('/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'safe prompt' }),
  });

  assertEquals(response.status, 429);
  assertEquals(generated, false);
});
