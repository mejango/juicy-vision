/**
 * The omnichain knowledge base must appear EXACTLY ONCE in every assembled
 * system prompt. The chat pipeline builds an enhanced prompt whose Knowledge
 * Base section is injected by contextManager.buildEnhancedSystemPrompt, then
 * hands it to the provider's streaming entrypoint — which historically
 * appended OMNICHAIN_CONTEXT a second time.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildSystemPromptSync } from './claude.ts';
import { OMNICHAIN_CONTEXT } from '../context/omnichain.ts';

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

Deno.test('default system prompt embeds the knowledge base exactly once', () => {
  const prompt = buildSystemPromptSync(undefined, true);
  assertEquals(occurrences(prompt, OMNICHAIN_CONTEXT), 1);
});

Deno.test('an enhanced prompt that already embeds the knowledge base is not doubled', () => {
  // Same shape contextManager.buildEnhancedSystemPrompt produces: base prompt
  // followed by the Knowledge Base section.
  const enhanced = `base prompt\n\n---\n\n# Knowledge Base\n${OMNICHAIN_CONTEXT}\n\n---\n\nmore context`;
  const prompt = buildSystemPromptSync(enhanced, true);
  assertEquals(occurrences(prompt, OMNICHAIN_CONTEXT), 1);
  // The enhanced prompt's other sections survive untouched.
  assertEquals(prompt, enhanced);
});

Deno.test('a custom prompt without the knowledge base still receives it once', () => {
  const prompt = buildSystemPromptSync('You generate chat titles.', true);
  assertEquals(occurrences(prompt, OMNICHAIN_CONTEXT), 1);
});

Deno.test('includeOmnichain=false never injects the knowledge base', () => {
  const prompt = buildSystemPromptSync('summarize things', false);
  assertEquals(occurrences(prompt, OMNICHAIN_CONTEXT), 0);
});
