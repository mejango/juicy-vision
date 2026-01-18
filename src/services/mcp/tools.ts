import type Anthropic from '@anthropic-ai/sdk'

// MCP tool definitions for Claude
export const MCP_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_docs',
    description:
      'Search Juicebox documentation for specific topics, concepts, or questions. Use this to find relevant documentation about the protocol, contracts, or how things work.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query - what you want to find in the docs',
        },
        category: {
          type: 'string',
          enum: ['developer', 'user', 'dao', 'ecosystem', 'all'],
          description: 'Category to search within. Default: all',
        },
        version: {
          type: 'string',
          enum: ['v3', 'v4', 'v5', 'all'],
          description: 'Protocol version. Default: v5',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results. Default: 10',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_doc',
    description:
      'Retrieve a complete document by its path or title. Use this when you need the full content of a specific documentation page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Document path like "/dev/v5/core/controller"',
        },
        title: {
          type: 'string',
          description: 'Document title to search for',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_code',
    description:
      'Search for code examples in the Juicebox documentation. Use this to find Solidity contract code, TypeScript/JavaScript integration examples.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Code search query - function names, patterns, etc.',
        },
        language: {
          type: 'string',
          enum: ['solidity', 'typescript', 'javascript', 'all'],
          description: 'Programming language filter. Default: all',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results. Default: 10',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_contracts',
    description:
      'Get contract addresses for Juicebox protocol contracts. Use this to look up specific contract addresses on different chains.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contract: {
          type: 'string',
          description:
            'Contract name like "JBController", "JBMultiTerminal", "REVDeployer"',
        },
        chainId: {
          type: 'string',
          enum: ['1', '10', '8453', '42161', 'testnets', 'all'],
          description:
            'Chain ID: 1 (Ethereum), 10 (Optimism), 8453 (Base), 42161 (Arbitrum), testnets, or all',
        },
        category: {
          type: 'string',
          enum: ['core', 'revnet', 'hooks', 'suckers', 'omnichain', 'all'],
          description: 'Contract category filter',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_patterns',
    description:
      'Get integration patterns and best practices for building with Juicebox. Use this to find recommended approaches for different project types.',
    input_schema: {
      type: 'object' as const,
      properties: {
        projectType: {
          type: 'string',
          description:
            'Type of project: crowdfund, dao, creator, nft, revnet, etc.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_sdk',
    description:
      'Get the Juicebox SDK reference including hooks, utilities, and type definitions. Use this when you need details about the SDK API.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
]

// Check if a tool name is an MCP tool
export function isMcpTool(name: string): boolean {
  return MCP_TOOLS.some((tool) => tool.name === name)
}
