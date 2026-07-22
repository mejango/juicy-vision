import { assertEquals, assertRejects } from 'std/assert/mod.ts';
import { buildImagePrompt, fetchImageGenerationResource } from './imageGeneration.ts';

Deno.test('image generation fetch aborts at its deadline', async () => {
  const hangingFetch: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });

  await assertRejects(
    () => fetchImageGenerationResource('https://example.invalid', {}, 1, hangingFetch),
    Error,
    'timed out',
  );
});

Deno.test('generated image prompts remain bounded by validated context fields', () => {
  const prompt = buildImagePrompt({
    name: 'Project',
    description: 'Description',
    projectTheme: 'Theme',
    style: 'illustration',
  });
  assertEquals(prompt.includes('Project'), true);
  assertEquals(prompt.includes('illustration'), true);
  assertEquals(prompt.length < 2_000, true);
});
