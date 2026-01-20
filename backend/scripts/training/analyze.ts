/**
 * Analyze training data to identify patterns
 * Finds what works, what fails, and generates insights
 */

import Anthropic from '@anthropic-ai/sdk';
import type { TrainingDataExport, ConversationExport, CorrectionExport } from './export.ts';

export interface AnalysisResult {
  analyzedAt: string;
  summary: {
    totalConversationsAnalyzed: number;
    successPatterns: string[];
    failurePatterns: string[];
    commonCorrections: string[];
    suggestedImprovements: string[];
  };
  detailedPatterns: {
    goodPatterns: PatternAnalysis[];
    badPatterns: PatternAnalysis[];
    correctionThemes: CorrectionTheme[];
  };
  promptSuggestions: PromptSuggestion[];
  fewShotCandidates: FewShotCandidate[];
}

export interface PatternAnalysis {
  pattern: string;
  frequency: number;
  examples: string[];
  impact: 'high' | 'medium' | 'low';
}

export interface CorrectionTheme {
  theme: string;
  corrections: Array<{
    original: string;
    corrected: string;
  }>;
  suggestedRule: string;
}

export interface PromptSuggestion {
  section: string;
  currentIssue: string;
  suggestedAddition: string;
  reasoning: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface FewShotCandidate {
  userMessage: string;
  assistantResponse: string;
  quality: number;
  tags: string[];
}

/**
 * Use Claude to analyze conversation patterns
 */
async function analyzeWithClaude(
  client: Anthropic,
  data: TrainingDataExport
): Promise<{
  successPatterns: string[];
  failurePatterns: string[];
  suggestedImprovements: string[];
}> {
  // Prepare condensed data for analysis
  const goodSample = data.goodConversations.slice(0, 20).map((c) => ({
    messages: c.messages.slice(-6), // Last 6 messages
    rating: c.rating,
    outcomes: c.outcomes,
  }));

  const badSample = data.badConversations.slice(0, 20).map((c) => ({
    messages: c.messages.slice(-6),
    rating: c.rating,
    feedback: c.feedback,
    outcomes: c.outcomes,
  }));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: `You are analyzing chat conversations from "Juicy", an AI assistant that helps users fund projects on the Juicebox protocol. Your job is to identify patterns that lead to success or failure.

Analyze the provided good and bad conversation samples. Focus on:
1. What the AI does well in successful conversations
2. What goes wrong in failed conversations
3. Specific improvements to make

Be concrete and actionable. Reference specific message patterns.`,
    messages: [
      {
        role: 'user',
        content: `Analyze these conversations and provide insights:

## Good Conversations (rated 4-5 stars, successful outcomes)
${JSON.stringify(goodSample, null, 2)}

## Bad Conversations (rated 1-2 stars, errors, abandonment)
${JSON.stringify(badSample, null, 2)}

## Overall Stats
- Avg rating: ${data.stats.avgRating.toFixed(2)}
- Helpful rate: ${(data.stats.helpfulRate * 100).toFixed(1)}%
- Completion rate: ${(data.stats.completionRate * 100).toFixed(1)}%

Provide your analysis as JSON:
{
  "successPatterns": ["pattern 1", "pattern 2", ...],
  "failurePatterns": ["pattern 1", "pattern 2", ...],
  "suggestedImprovements": ["improvement 1", "improvement 2", ...]
}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { successPatterns: [], failurePatterns: [], suggestedImprovements: [] };
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Analyze corrections to identify common mistakes
 */
async function analyzeCorrections(
  client: Anthropic,
  corrections: CorrectionExport[]
): Promise<CorrectionTheme[]> {
  if (corrections.length === 0) return [];

  const sample = corrections.slice(0, 30);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: `You are analyzing user corrections to an AI assistant. Group the corrections by theme and suggest rules to prevent similar mistakes.`,
    messages: [
      {
        role: 'user',
        content: `Analyze these user corrections and group them by theme:

${sample.map((c) => `Original: ${c.originalContent.slice(0, 500)}\nCorrection: ${c.userCorrection}`).join('\n\n---\n\n')}

Provide your analysis as JSON array:
[
  {
    "theme": "theme description",
    "corrections": [{"original": "...", "corrected": "..."}],
    "suggestedRule": "rule to add to system prompt"
  }
]`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  return JSON.parse(jsonMatch[0]);
}

/**
 * Generate prompt improvement suggestions
 */
async function generatePromptSuggestions(
  client: Anthropic,
  patterns: { successPatterns: string[]; failurePatterns: string[]; suggestedImprovements: string[] },
  correctionThemes: CorrectionTheme[]
): Promise<PromptSuggestion[]> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: `You are helping improve the system prompt for "Juicy", an AI funding assistant. Based on analysis of conversations, generate specific additions to the system prompt.`,
    messages: [
      {
        role: 'user',
        content: `Based on this analysis, generate specific prompt improvements:

## Success Patterns
${patterns.successPatterns.join('\n')}

## Failure Patterns
${patterns.failurePatterns.join('\n')}

## Suggested Improvements
${patterns.suggestedImprovements.join('\n')}

## Common Correction Themes
${correctionThemes.map((t) => `Theme: ${t.theme}\nRule: ${t.suggestedRule}`).join('\n\n')}

Generate prompt suggestions as JSON array:
[
  {
    "section": "which section of prompt this belongs in",
    "currentIssue": "what's wrong currently",
    "suggestedAddition": "exact text to add to prompt",
    "reasoning": "why this helps",
    "priority": "critical|high|medium|low"
  }
]`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  return JSON.parse(jsonMatch[0]);
}

/**
 * Select best conversations for few-shot examples
 */
function selectFewShotCandidates(conversations: ConversationExport[]): FewShotCandidate[] {
  const candidates: FewShotCandidate[] = [];

  for (const conv of conversations) {
    // Find good user-assistant pairs
    for (let i = 0; i < conv.messages.length - 1; i++) {
      const userMsg = conv.messages[i];
      const assistantMsg = conv.messages[i + 1];

      if (userMsg.role !== 'user' || assistantMsg.role !== 'assistant') continue;

      // Skip very short exchanges
      if (userMsg.content.length < 20 || assistantMsg.content.length < 50) continue;

      // Calculate quality score
      let quality = 50; // Base score

      // Boost for high ratings
      if (conv.rating && conv.rating >= 4) quality += 20;
      if (conv.rating && conv.rating === 5) quality += 10;

      // Boost for successful outcomes
      if (conv.outcomes.completedPayment) quality += 15;
      if (conv.outcomes.foundProject) quality += 10;

      // Detect tags based on content
      const tags: string[] = [];
      const lowerContent = (userMsg.content + assistantMsg.content).toLowerCase();

      if (lowerContent.includes('pay') || lowerContent.includes('contribute')) tags.push('payment');
      if (lowerContent.includes('project')) tags.push('project-discovery');
      if (lowerContent.includes('token') || lowerContent.includes('cash out')) tags.push('tokens');
      if (lowerContent.includes('create') || lowerContent.includes('launch')) tags.push('project-creation');
      if (lowerContent.includes('juice-component')) tags.push('ui-components');

      candidates.push({
        userMessage: userMsg.content,
        assistantResponse: assistantMsg.content,
        quality,
        tags,
      });
    }
  }

  // Sort by quality and dedupe similar ones
  candidates.sort((a, b) => b.quality - a.quality);

  // Take top examples, ensuring variety in tags
  const selected: FewShotCandidate[] = [];
  const tagCounts: Record<string, number> = {};

  for (const candidate of candidates) {
    if (selected.length >= 20) break;

    // Check if we have too many of this tag already
    const dominated = candidate.tags.some((tag) => (tagCounts[tag] || 0) >= 4);
    if (dominated && selected.length > 5) continue;

    selected.push(candidate);
    for (const tag of candidate.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  return selected;
}

/**
 * Run full analysis
 */
export async function analyzeTrainingData(
  data: TrainingDataExport,
  anthropicApiKey: string
): Promise<AnalysisResult> {
  console.log('Analyzing training data...');

  const client = new Anthropic({ apiKey: anthropicApiKey });

  // Run analyses in parallel
  const [patterns, correctionThemes] = await Promise.all([
    analyzeWithClaude(client, data),
    analyzeCorrections(client, data.corrections),
  ]);

  // Generate prompt suggestions based on analysis
  const promptSuggestions = await generatePromptSuggestions(client, patterns, correctionThemes);

  // Select few-shot candidates from good conversations
  const fewShotCandidates = selectFewShotCandidates(data.goodConversations);

  console.log(`Analysis complete:
  - ${patterns.successPatterns.length} success patterns
  - ${patterns.failurePatterns.length} failure patterns
  - ${correctionThemes.length} correction themes
  - ${promptSuggestions.length} prompt suggestions
  - ${fewShotCandidates.length} few-shot candidates`);

  return {
    analyzedAt: new Date().toISOString(),
    summary: {
      totalConversationsAnalyzed: data.goodConversations.length + data.badConversations.length,
      successPatterns: patterns.successPatterns,
      failurePatterns: patterns.failurePatterns,
      commonCorrections: correctionThemes.map((t) => t.theme),
      suggestedImprovements: patterns.suggestedImprovements,
    },
    detailedPatterns: {
      goodPatterns: patterns.successPatterns.map((p) => ({
        pattern: p,
        frequency: 1,
        examples: [],
        impact: 'medium' as const,
      })),
      badPatterns: patterns.failurePatterns.map((p) => ({
        pattern: p,
        frequency: 1,
        examples: [],
        impact: 'medium' as const,
      })),
      correctionThemes,
    },
    promptSuggestions,
    fewShotCandidates,
  };
}
