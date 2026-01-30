/**
 * Hook Templates Index
 *
 * Provides starter templates for Juicebox V5 hook development.
 * These templates include:
 * - Properly structured Solidity contracts
 * - Security best practices (terminal validation, project ID checks)
 * - Test files with example test cases
 * - Foundry configuration with remappings
 */

import { PAY_HOOK_TEMPLATE } from './pay-hook.ts';
import { CASH_OUT_HOOK_TEMPLATE } from './cash-out-hook.ts';
import { SPLIT_HOOK_TEMPLATE } from './split-hook.ts';

export { PAY_HOOK_TEMPLATE, CASH_OUT_HOOK_TEMPLATE, SPLIT_HOOK_TEMPLATE };

export type HookType = 'pay-hook' | 'cash-out-hook' | 'split-hook';

export interface HookTemplate {
  name: string;
  description: string;
  files: Array<{
    path: string;
    content: string;
  }>;
}

/**
 * Get a hook template by type.
 */
export function getHookTemplate(type: HookType): HookTemplate {
  switch (type) {
    case 'pay-hook':
      return PAY_HOOK_TEMPLATE;
    case 'cash-out-hook':
      return CASH_OUT_HOOK_TEMPLATE;
    case 'split-hook':
      return SPLIT_HOOK_TEMPLATE;
    default:
      throw new Error(`Unknown hook type: ${type}`);
  }
}

/**
 * Get all available hook templates.
 */
export function getAllTemplates(): Record<HookType, HookTemplate> {
  return {
    'pay-hook': PAY_HOOK_TEMPLATE,
    'cash-out-hook': CASH_OUT_HOOK_TEMPLATE,
    'split-hook': SPLIT_HOOK_TEMPLATE,
  };
}

/**
 * Customize a template with project-specific values.
 */
export function customizeTemplate(
  template: HookTemplate,
  options: {
    contractName?: string;
    projectId?: number;
    directoryAddress?: string;
  }
): HookTemplate {
  const { contractName, projectId, directoryAddress } = options;

  const customizedFiles = template.files.map((file) => {
    let content = file.content;
    let path = file.path;

    // Replace contract name if provided
    if (contractName) {
      // Update contract name in Solidity files
      content = content.replace(/My(PayHook|CashOutHook|SplitHook)/g, contractName);

      // Update file paths
      path = path.replace(/My(PayHook|CashOutHook|SplitHook)/g, contractName);

      // Update import paths in test files
      content = content.replace(
        /from "\.\.\/src\/My/g,
        `from "../src/${contractName.replace(/(Hook|Test)$/g, '')}`
      );
    }

    // Replace project ID placeholder if provided
    if (projectId !== undefined) {
      content = content.replace(
        /uint256 projectId = 1;/g,
        `uint256 projectId = ${projectId};`
      );
    }

    // Replace directory address placeholder if provided
    if (directoryAddress) {
      content = content.replace(
        /address mockDirectory = address\(0x1\);/g,
        `address mockDirectory = ${directoryAddress};`
      );
    }

    return { path, content };
  });

  return {
    ...template,
    files: customizedFiles,
  };
}

/**
 * Template metadata for UI display.
 */
export const TEMPLATE_METADATA: Record<HookType, {
  icon: string;
  color: string;
  useCases: string[];
}> = {
  'pay-hook': {
    icon: '💰',
    color: '#22c55e', // green
    useCases: [
      'Payment caps',
      'Allowlists',
      'NFT minting on payment',
      'Custom token distribution',
    ],
  },
  'cash-out-hook': {
    icon: '📤',
    color: '#f59e0b', // amber
    useCases: [
      'Redemption caps',
      'Time-locked redemptions',
      'Vesting schedules',
      'Custom redemption curves',
    ],
  },
  'split-hook': {
    icon: '🔀',
    color: '#8b5cf6', // purple
    useCases: [
      'Revenue sharing',
      'Automatic token swaps',
      'Multi-sig routing',
      'Automated buybacks',
    ],
  },
};
