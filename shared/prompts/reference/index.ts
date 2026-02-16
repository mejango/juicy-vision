/**
 * Reference Modules Index
 *
 * Single-source-of-truth modules for contracts, currencies, and structures.
 * These modules reduce redundancy and prevent contradictions.
 */

export * from './addresses.ts';
export * from './currencies.ts';
export * from './structures.ts';

import { ADDRESSES_CONTEXT, ADDRESSES_HINTS, ADDRESSES_TOKEN_ESTIMATE } from './addresses.ts';
import { CURRENCIES_CONTEXT, CURRENCIES_HINTS, CURRENCIES_TOKEN_ESTIMATE } from './currencies.ts';
import { STRUCTURES_CONTEXT, STRUCTURES_HINTS, STRUCTURES_TOKEN_ESTIMATE } from './structures.ts';

export interface ReferenceModule {
  id: string;
  content: string;
  hints: string[];
  tokenEstimate: number;
  description: string;
}

export const REFERENCE_MODULES: ReferenceModule[] = [
  {
    id: 'addresses',
    content: ADDRESSES_CONTEXT,
    hints: ADDRESSES_HINTS,
    tokenEstimate: ADDRESSES_TOKEN_ESTIMATE,
    description: 'Contract addresses for V5.0, V5.1, shared, and suckers',
  },
  {
    id: 'currencies',
    content: CURRENCIES_CONTEXT,
    hints: CURRENCIES_HINTS,
    tokenEstimate: CURRENCIES_TOKEN_ESTIMATE,
    description: 'Token currency codes and groupId rules',
  },
  {
    id: 'structures',
    content: STRUCTURES_CONTEXT,
    hints: STRUCTURES_HINTS,
    tokenEstimate: STRUCTURES_TOKEN_ESTIMATE,
    description: 'Juicebox struct definitions',
  },
];

/**
 * Get reference module by ID
 */
export function getReferenceModule(id: string): ReferenceModule | undefined {
  return REFERENCE_MODULES.find(m => m.id === id);
}

/**
 * Get all reference module IDs
 */
export function getReferenceModuleIds(): string[] {
  return REFERENCE_MODULES.map(m => m.id);
}

/**
 * Build combined context from selected reference modules
 */
export function buildReferenceContext(moduleIds: string[]): string {
  const parts: string[] = [];

  for (const id of moduleIds) {
    const module = getReferenceModule(id);
    if (module) {
      parts.push(module.content);
    }
  }

  return parts.join('\n\n');
}

/**
 * Estimate total tokens for selected reference modules
 */
export function estimateReferenceTokens(moduleIds: string[]): number {
  return moduleIds.reduce((total, id) => {
    const module = getReferenceModule(id);
    return total + (module?.tokenEstimate || 0);
  }, 0);
}

/**
 * Get reference modules needed based on keyword matching
 */
export function matchReferenceModulesByKeywords(text: string): string[] {
  const lowerText = text.toLowerCase();
  const matched = new Set<string>();

  for (const module of REFERENCE_MODULES) {
    for (const hint of module.hints) {
      if (lowerText.includes(hint.toLowerCase())) {
        matched.add(module.id);
        break;
      }
    }
  }

  return Array.from(matched);
}
