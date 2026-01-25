import { useThemeStore } from '../../stores'

interface InteractionsSheetProps {
  context: 'app' | 'project'
  projectId?: string
  chainId?: string
}

interface Interaction {
  id: string
  label: string
  description: string
  prompt: string
  icon: string
  requiresWallet?: boolean
  requiresOwner?: boolean
}

interface InteractionCategory {
  id: string
  title: string
  description: string
  interactions: Interaction[]
}

const APP_INTERACTIONS: InteractionCategory[] = [
  {
    id: 'explore',
    title: 'For Anyone',
    description: 'No wallet needed',
    interactions: [
      {
        id: 'trending',
        label: 'Explore trending projects',
        description: 'See what projects are gaining momentum',
        prompt: 'Show me the trending Juicebox projects',
        icon: '🔥',
      },
      {
        id: 'search',
        label: 'Search for a project',
        description: 'Find projects by name or ID',
        prompt: 'Help me find a Juicebox project',
        icon: '🔍',
      },
      {
        id: 'learn',
        label: 'Learn how Juicebox works',
        description: 'Understand treasuries, tokens, and rulesets',
        prompt: 'Explain how Juicebox works',
        icon: '📚',
      },
      {
        id: 'compare',
        label: 'Compare project types',
        description: 'Projects vs Revnets - what\'s the difference?',
        prompt: 'What\'s the difference between a Juicebox project and a Revnet?',
        icon: '⚖️',
      },
    ],
  },
  {
    id: 'contribute',
    title: 'For Contributors',
    description: 'Wallet required',
    interactions: [
      {
        id: 'pay',
        label: 'Pay a project',
        description: 'Contribute ETH and receive project tokens',
        prompt: 'I want to pay a Juicebox project',
        icon: '💸',
        requiresWallet: true,
      },
      {
        id: 'cashout',
        label: 'Cash out tokens',
        description: 'Redeem your tokens for ETH from the treasury',
        prompt: 'How do I cash out my project tokens?',
        icon: '🏧',
        requiresWallet: true,
      },
      {
        id: 'bridge',
        label: 'Bridge tokens cross-chain',
        description: 'Move tokens between Ethereum, Base, Optimism, Arbitrum',
        prompt: 'How do I bridge my Juicebox tokens to another chain?',
        icon: '🌉',
        requiresWallet: true,
      },
      {
        id: 'holdings',
        label: 'Check my holdings',
        description: 'See what project tokens you own',
        prompt: 'What Juicebox tokens do I hold?',
        icon: '👛',
        requiresWallet: true,
      },
    ],
  },
  {
    id: 'create',
    title: 'For Project Owners',
    description: 'Launch and manage projects',
    interactions: [
      {
        id: 'launch-project',
        label: 'Launch a new project',
        description: 'Create a treasury with custom rules',
        prompt: 'I want to launch a new Juicebox project',
        icon: '🚀',
        requiresWallet: true,
      },
      {
        id: 'launch-revnet',
        label: 'Launch a Revnet',
        description: 'Create an autonomous, rule-based network',
        prompt: 'I want to launch a new Revnet',
        icon: '🌐',
        requiresWallet: true,
      },
      {
        id: 'manage',
        label: 'Manage my project',
        description: 'Update rulesets, send payouts, mint tokens',
        prompt: 'Help me manage my Juicebox project',
        icon: '⚙️',
        requiresWallet: true,
        requiresOwner: true,
      },
    ],
  },
  {
    id: 'build',
    title: 'For Builders',
    description: 'Integrate and extend',
    interactions: [
      {
        id: 'landing',
        label: 'Generate a landing page',
        description: 'Export a standalone page for your project',
        prompt: 'Generate a landing page for my project',
        icon: '🎨',
      },
      {
        id: 'query',
        label: 'Query project data',
        description: 'Access on-chain data via GraphQL or RPC',
        prompt: 'How do I query Juicebox project data programmatically?',
        icon: '🔌',
      },
      {
        id: 'hooks',
        label: 'Build custom hooks',
        description: 'Create pay hooks, cash-out hooks, or split hooks',
        prompt: 'How do I build a custom Juicebox hook?',
        icon: '🪝',
      },
      {
        id: 'docs',
        label: 'Browse documentation',
        description: 'Full protocol reference and guides',
        prompt: 'Show me the Juicebox documentation',
        icon: '📖',
      },
    ],
  },
]

function getProjectInteractions(projectId: string, chainId: string): InteractionCategory[] {
  return [
    {
      id: 'view',
      title: 'View',
      description: 'Learn about this project',
      interactions: [
        {
          id: 'overview',
          label: 'Project overview',
          description: 'Key stats and configuration',
          prompt: `Tell me about project ${projectId} on chain ${chainId}`,
          icon: '📊',
        },
        {
          id: 'activity',
          label: 'Recent activity',
          description: 'Payments, cash-outs, and more',
          prompt: `Show me the activity feed for project ${projectId} on chain ${chainId}`,
          icon: '📜',
        },
        {
          id: 'holders',
          label: 'Token holders',
          description: 'Who owns project tokens',
          prompt: `Show me the token holders for project ${projectId} on chain ${chainId}`,
          icon: '👥',
        },
        {
          id: 'rules',
          label: 'Ruleset schedule',
          description: 'Current and upcoming rules',
          prompt: `Show me the ruleset schedule for project ${projectId} on chain ${chainId}`,
          icon: '📅',
        },
        {
          id: 'nfts',
          label: 'NFT tiers',
          description: 'View available NFTs',
          prompt: `Show me the NFTs for project ${projectId} on chain ${chainId}`,
          icon: '🖼️',
        },
      ],
    },
    {
      id: 'contribute',
      title: 'Contribute',
      description: 'Support this project',
      interactions: [
        {
          id: 'pay',
          label: 'Pay this project',
          description: 'Send ETH and receive tokens',
          prompt: `I want to pay project ${projectId} on chain ${chainId}`,
          icon: '💸',
          requiresWallet: true,
        },
        {
          id: 'note',
          label: 'Leave a note',
          description: 'Send a message with your payment',
          prompt: `I want to leave a note for project ${projectId} on chain ${chainId}`,
          icon: '✉️',
          requiresWallet: true,
        },
        {
          id: 'cashout',
          label: 'Cash out tokens',
          description: 'Redeem tokens for ETH',
          prompt: `I want to cash out my tokens from project ${projectId} on chain ${chainId}`,
          icon: '🏧',
          requiresWallet: true,
        },
      ],
    },
    {
      id: 'manage',
      title: 'Manage',
      description: 'Owner actions',
      interactions: [
        {
          id: 'payouts',
          label: 'Send payouts',
          description: 'Distribute funds to splits',
          prompt: `Help me send payouts from project ${projectId} on chain ${chainId}`,
          icon: '📤',
          requiresWallet: true,
          requiresOwner: true,
        },
        {
          id: 'reserved',
          label: 'Distribute reserved tokens',
          description: 'Send tokens to reserved recipients',
          prompt: `Help me send reserved tokens for project ${projectId} on chain ${chainId}`,
          icon: '🎁',
          requiresWallet: true,
          requiresOwner: true,
        },
        {
          id: 'queue',
          label: 'Queue new ruleset',
          description: 'Update project configuration',
          prompt: `Help me queue a new ruleset for project ${projectId} on chain ${chainId}`,
          icon: '⚙️',
          requiresWallet: true,
          requiresOwner: true,
        },
        {
          id: 'erc20',
          label: 'Deploy ERC-20 token',
          description: 'Make tokens tradeable',
          prompt: `Help me deploy an ERC-20 token for project ${projectId} on chain ${chainId}`,
          icon: '🪙',
          requiresWallet: true,
          requiresOwner: true,
        },
        {
          id: 'surplus',
          label: 'Use surplus allowance',
          description: 'Access excess treasury funds',
          prompt: `Help me use the surplus allowance for project ${projectId} on chain ${chainId}`,
          icon: '💰',
          requiresWallet: true,
          requiresOwner: true,
        },
      ],
    },
    {
      id: 'build',
      title: 'Build',
      description: 'Extend and integrate',
      interactions: [
        {
          id: 'landing',
          label: 'Generate landing page',
          description: 'Create a standalone project page',
          prompt: `Generate a landing page for project ${projectId} on chain ${chainId}`,
          icon: '🎨',
        },
        {
          id: 'price',
          label: 'View price chart',
          description: 'Token price over time',
          prompt: `Show me the price chart for project ${projectId} on chain ${chainId}`,
          icon: '📈',
        },
      ],
    },
  ]
}

export default function InteractionsSheet({
  context,
  projectId,
  chainId,
}: InteractionsSheetProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const categories = context === 'project' && projectId && chainId
    ? getProjectInteractions(projectId, chainId)
    : APP_INTERACTIONS

  const handleClick = (interaction: Interaction) => {
    window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: interaction.prompt } }))
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${
        isDark ? 'border-white/10' : 'border-gray-100'
      }`}>
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {context === 'project' ? 'Project Actions' : 'What can I help you with?'}
        </span>
        <span className={`ml-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Click to get started
        </span>
      </div>

      {/* Categories */}
      <div className="p-4 space-y-6">
        {categories.map((category) => (
          <div key={category.id}>
            {/* Category header */}
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {category.title}
              </h3>
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {category.description}
              </span>
            </div>

            {/* Interaction grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {category.interactions.map((interaction) => (
                <button
                  key={interaction.id}
                  onClick={() => handleClick(interaction)}
                  className={`flex items-start gap-3 p-3 rounded-lg text-left transition-all ${
                    isDark
                      ? 'bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10'
                      : 'bg-gray-50 hover:bg-gray-100 border border-gray-100 hover:border-gray-200'
                  }`}
                >
                  {/* Icon */}
                  <span className="text-xl flex-shrink-0">{interaction.icon}</span>

                  {/* Text */}
                  <div className="min-w-0 flex-1">
                    <div className={`font-medium text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {interaction.label}
                    </div>
                    <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {interaction.description}
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    {interaction.requiresWallet && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'
                      }`}>
                        wallet
                      </span>
                    )}
                    {interaction.requiresOwner && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'
                      }`}>
                        owner
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className={`px-4 py-2 text-xs border-t ${
        isDark ? 'bg-white/5 border-white/5 text-gray-500' : 'bg-gray-50 border-gray-100 text-gray-400'
      }`}>
        Just ask if you need help with something else
      </div>
    </div>
  )
}
