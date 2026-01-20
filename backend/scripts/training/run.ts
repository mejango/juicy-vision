#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

/**
 * Main training pipeline entry point
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --allow-write scripts/training/run.ts
 *
 * Environment variables:
 *   DATABASE_URL - PostgreSQL connection string
 *   ANTHROPIC_API_KEY - Anthropic API key for analysis
 *   TRAINING_OUTPUT_DIR - Where to save outputs (default: ./training-output)
 */

import { exportAllTrainingData } from './export.ts';
import { analyzeTrainingData } from './analyze.ts';
import { generateOptimizedOutput } from './optimize.ts';
import { getPool, closePool } from '../../src/db/index.ts';
import { query } from '../../src/db/index.ts';

interface TrainingRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  conversations_analyzed: number;
  suggestions_generated: number;
  output_path: string | null;
  error_message: string | null;
}

async function recordTrainingRun(
  status: 'running' | 'completed' | 'failed',
  data?: {
    conversationsAnalyzed?: number;
    suggestionsGenerated?: number;
    outputPath?: string;
    errorMessage?: string;
  }
): Promise<string> {
  // Try to create table if not exists
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS training_runs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'running',
        conversations_analyzed INTEGER DEFAULT 0,
        suggestions_generated INTEGER DEFAULT 0,
        output_path TEXT,
        error_message TEXT
      )
    `, []);
  } catch {
    // Table might already exist
  }

  if (status === 'running') {
    const [row] = await query<{ id: string }>(
      `INSERT INTO training_runs (status) VALUES ('running') RETURNING id`,
      []
    );
    return row.id;
  }

  return '';
}

async function updateTrainingRun(
  id: string,
  status: 'completed' | 'failed',
  data: {
    conversationsAnalyzed?: number;
    suggestionsGenerated?: number;
    outputPath?: string;
    errorMessage?: string;
  }
) {
  await query(
    `UPDATE training_runs SET
      status = $1,
      completed_at = NOW(),
      conversations_analyzed = COALESCE($2, conversations_analyzed),
      suggestions_generated = COALESCE($3, suggestions_generated),
      output_path = COALESCE($4, output_path),
      error_message = COALESCE($5, error_message)
    WHERE id = $6`,
    [
      status,
      data.conversationsAnalyzed ?? null,
      data.suggestionsGenerated ?? null,
      data.outputPath ?? null,
      data.errorMessage ?? null,
      id,
    ]
  );
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              JUICY VISION TRAINING PIPELINE               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicApiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable required');
    Deno.exit(1);
  }

  const outputDir = Deno.env.get('TRAINING_OUTPUT_DIR') || './training-output';

  // Create output directory
  try {
    await Deno.mkdir(outputDir, { recursive: true });
  } catch {
    // Directory might already exist
  }

  let runId = '';
  try {
    // Record training run start
    runId = await recordTrainingRun('running');
    console.log(`Training run: ${runId}`);
    console.log('');

    // Step 1: Export training data
    console.log('Step 1/3: Exporting training data...');
    const trainingData = await exportAllTrainingData();

    const exportPath = `${outputDir}/export-${Date.now()}.json`;
    await Deno.writeTextFile(exportPath, JSON.stringify(trainingData, null, 2));
    console.log(`  → Saved to ${exportPath}`);
    console.log('');

    // Step 2: Analyze patterns
    console.log('Step 2/3: Analyzing patterns...');
    const analysis = await analyzeTrainingData(trainingData, anthropicApiKey);

    const analysisPath = `${outputDir}/analysis-${Date.now()}.json`;
    await Deno.writeTextFile(analysisPath, JSON.stringify(analysis, null, 2));
    console.log(`  → Saved to ${analysisPath}`);
    console.log('');

    // Step 3: Generate optimized outputs
    console.log('Step 3/3: Generating optimized outputs...');
    const optimized = await generateOptimizedOutput(analysis, anthropicApiKey);

    // Save individual outputs
    const timestamp = Date.now();

    const fewShotPath = `${outputDir}/few-shot-examples-${timestamp}.md`;
    await Deno.writeTextFile(fewShotPath, optimized.fewShotExamples);
    console.log(`  → Few-shot examples: ${fewShotPath}`);

    const additionsPath = `${outputDir}/prompt-additions-${timestamp}.md`;
    await Deno.writeTextFile(additionsPath, optimized.promptAdditions);
    console.log(`  → Prompt additions: ${additionsPath}`);

    const patchesPath = `${outputDir}/prompt-patches-${timestamp}.json`;
    await Deno.writeTextFile(patchesPath, JSON.stringify(optimized.fullPromptPatch, null, 2));
    console.log(`  → Prompt patches: ${patchesPath}`);

    const reportPath = `${outputDir}/training-report-${timestamp}.md`;
    await Deno.writeTextFile(reportPath, optimized.trainingReport);
    console.log(`  → Training report: ${reportPath}`);
    console.log('');

    // Print summary
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                    TRAINING COMPLETE                      ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  Conversations analyzed: ${(trainingData.goodConversations.length + trainingData.badConversations.length).toString().padEnd(32)}║`);
    console.log(`║  Corrections processed:  ${trainingData.corrections.length.toString().padEnd(32)}║`);
    console.log(`║  Prompt suggestions:     ${analysis.promptSuggestions.length.toString().padEnd(32)}║`);
    console.log(`║  Few-shot examples:      ${analysis.fewShotCandidates.length.toString().padEnd(32)}║`);
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  Output directory: ${outputDir.padEnd(38)}║`);
    console.log('╚═══════════════════════════════════════════════════════════╝');

    // Print training report summary
    console.log('');
    console.log('Training Report:');
    console.log('────────────────');
    console.log(optimized.trainingReport.slice(0, 1000));
    if (optimized.trainingReport.length > 1000) {
      console.log(`... (see full report at ${reportPath})`);
    }

    // Record success
    if (runId) {
      await updateTrainingRun(runId, 'completed', {
        conversationsAnalyzed: trainingData.goodConversations.length + trainingData.badConversations.length,
        suggestionsGenerated: analysis.promptSuggestions.length,
        outputPath: outputDir,
      });
    }

  } catch (error) {
    console.error('Training pipeline failed:', error);

    if (runId) {
      await updateTrainingRun(runId, 'failed', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    Deno.exit(1);
  } finally {
    await closePool();
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}
