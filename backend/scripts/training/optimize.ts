/**
 * Generate optimized prompts based on analysis
 * Creates updated system prompt and few-shot examples
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult, PromptSuggestion, FewShotCandidate } from './analyze.ts';

export interface OptimizedOutput {
  generatedAt: string;
  fewShotExamples: string;
  promptAdditions: string;
  fullPromptPatch: PromptPatch[];
  trainingReport: string;
}

export interface PromptPatch {
  section: string;
  priority: string;
  addition: string;
}

/**
 * Format few-shot examples for inclusion in system prompt
 */
function formatFewShotExamples(candidates: FewShotCandidate[]): string {
  const byTag: Record<string, FewShotCandidate[]> = {};

  for (const candidate of candidates) {
    const primaryTag = candidate.tags[0] || 'general';
    if (!byTag[primaryTag]) byTag[primaryTag] = [];
    byTag[primaryTag].push(candidate);
  }

  let output = '## Example Interactions (Auto-Generated)\n\n';
  output += '<!-- These examples were automatically selected from high-rated conversations -->\n\n';

  for (const [tag, examples] of Object.entries(byTag)) {
    output += `### ${tag.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}\n\n`;

    for (const example of examples.slice(0, 2)) {
      output += `**User:** ${example.userMessage.slice(0, 200)}${example.userMessage.length > 200 ? '...' : ''}\n\n`;
      output += `**Assistant:** ${example.assistantResponse.slice(0, 500)}${example.assistantResponse.length > 500 ? '...' : ''}\n\n`;
      output += '---\n\n';
    }
  }

  return output;
}

/**
 * Format prompt additions from suggestions
 */
function formatPromptAdditions(suggestions: PromptSuggestion[]): string {
  // Group by priority
  const byPriority: Record<string, PromptSuggestion[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  for (const s of suggestions) {
    byPriority[s.priority].push(s);
  }

  let output = '## Suggested Prompt Additions\n\n';
  output += '<!-- Review and merge these into the main system prompt -->\n\n';

  for (const priority of ['critical', 'high', 'medium', 'low']) {
    const items = byPriority[priority];
    if (items.length === 0) continue;

    output += `### ${priority.toUpperCase()} Priority\n\n`;

    for (const item of items) {
      output += `**Section:** ${item.section}\n`;
      output += `**Issue:** ${item.currentIssue}\n`;
      output += `**Add:**\n\`\`\`\n${item.suggestedAddition}\n\`\`\`\n`;
      output += `**Reasoning:** ${item.reasoning}\n\n`;
      output += '---\n\n';
    }
  }

  return output;
}

/**
 * Generate a comprehensive training report
 */
async function generateTrainingReport(
  client: Anthropic,
  analysis: AnalysisResult
): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: `You are generating a training report for a chatbot improvement cycle. Be concise and actionable.`,
    messages: [
      {
        role: 'user',
        content: `Generate a markdown training report based on this analysis:

## Summary Stats
- Conversations analyzed: ${analysis.summary.totalConversationsAnalyzed}
- Success patterns found: ${analysis.summary.successPatterns.length}
- Failure patterns found: ${analysis.summary.failurePatterns.length}
- Corrections analyzed: ${analysis.summary.commonCorrections.length}

## Success Patterns
${analysis.summary.successPatterns.join('\n- ')}

## Failure Patterns
${analysis.summary.failurePatterns.join('\n- ')}

## Common Corrections
${analysis.summary.commonCorrections.join('\n- ')}

## Suggested Improvements
${analysis.summary.suggestedImprovements.join('\n- ')}

## Prompt Suggestions
${analysis.promptSuggestions.map((p) => `[${p.priority}] ${p.section}: ${p.currentIssue}`).join('\n')}

Generate a report with:
1. Executive Summary (2-3 sentences)
2. Key Wins (what's working)
3. Priority Fixes (what needs immediate attention)
4. Recommendations (next steps)
5. Metrics to Watch (what to track going forward)`,
      },
    ],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

/**
 * Create patch instructions for the system prompt
 */
function createPromptPatches(suggestions: PromptSuggestion[]): PromptPatch[] {
  return suggestions
    .filter((s) => s.priority === 'critical' || s.priority === 'high')
    .map((s) => ({
      section: s.section,
      priority: s.priority,
      addition: s.suggestedAddition,
    }));
}

/**
 * Generate all optimized outputs
 */
export async function generateOptimizedOutput(
  analysis: AnalysisResult,
  anthropicApiKey: string
): Promise<OptimizedOutput> {
  console.log('Generating optimized outputs...');

  const client = new Anthropic({ apiKey: anthropicApiKey });

  // Format few-shot examples
  const fewShotExamples = formatFewShotExamples(analysis.fewShotCandidates);

  // Format prompt additions
  const promptAdditions = formatPromptAdditions(analysis.promptSuggestions);

  // Create prompt patches
  const fullPromptPatch = createPromptPatches(analysis.promptSuggestions);

  // Generate training report
  const trainingReport = await generateTrainingReport(client, analysis);

  console.log('Optimized output generated');

  return {
    generatedAt: new Date().toISOString(),
    fewShotExamples,
    promptAdditions,
    fullPromptPatch,
    trainingReport,
  };
}
