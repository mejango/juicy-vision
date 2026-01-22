import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ComponentRegistry from './ComponentRegistry'
import { useThemeStore } from '../../stores'
import type { ParsedComponent } from '../../utils/messageParser'

// Mock all lazy-loaded components
vi.mock('./ConnectWalletButton', () => ({
  default: () => <div data-testid="connect-wallet">ConnectWalletButton</div>,
}))

vi.mock('./ProjectCard', () => ({
  default: ({ projectId, chainId }: { projectId: string; chainId?: string }) => (
    <div data-testid="project-card">ProjectCard: {projectId} on {chainId || '1'}</div>
  ),
}))

vi.mock('./NoteCard', () => ({
  default: ({ projectId, defaultNote }: { projectId: string; defaultNote?: string }) => (
    <div data-testid="note-card">NoteCard: {projectId} - {defaultNote}</div>
  ),
}))

vi.mock('./TransactionStatus', () => ({
  default: ({ txId }: { txId: string }) => (
    <div data-testid="transaction-status">TransactionStatus: {txId}</div>
  ),
}))

vi.mock('./TransactionPreview', () => ({
  default: ({ action, contract }: { action: string; contract: string }) => (
    <div data-testid="transaction-preview">TransactionPreview: {action} on {contract}</div>
  ),
}))

vi.mock('./CashOutForm', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="cash-out-form">CashOutForm: {projectId}</div>
  ),
}))

vi.mock('./SendPayoutsForm', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="send-payouts-form">SendPayoutsForm: {projectId}</div>
  ),
}))

vi.mock('./SendReservedTokensForm', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="send-reserved-tokens-form">SendReservedTokensForm: {projectId}</div>
  ),
}))

vi.mock('./UseSurplusAllowanceForm', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="use-surplus-allowance-form">UseSurplusAllowanceForm: {projectId}</div>
  ),
}))

vi.mock('./DeployERC20Form', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="deploy-erc20-form">DeployERC20Form: {projectId}</div>
  ),
}))

vi.mock('./QueueRulesetForm', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="queue-ruleset-form">QueueRulesetForm: {projectId}</div>
  ),
}))

vi.mock('./PriceChart', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="price-chart">PriceChart: {projectId}</div>
  ),
}))

vi.mock('./ActivityFeed', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="activity-feed">ActivityFeed: {projectId}</div>
  ),
}))

vi.mock('./RulesetSchedule', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="ruleset-schedule">RulesetSchedule: {projectId}</div>
  ),
}))

vi.mock('./OptionsPicker', () => ({
  default: ({ groups, submitLabel }: { groups: unknown[]; submitLabel?: string }) => (
    <div data-testid="options-picker">OptionsPicker: {groups.length} groups, {submitLabel || 'Continue'}</div>
  ),
}))

vi.mock('./ProjectChainPicker', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-chain-picker">ProjectChainPicker: {projectId}</div>
  ),
}))

vi.mock('./TopProjects', () => ({
  default: ({ limit }: { limit?: number }) => (
    <div data-testid="top-projects">TopProjects: limit={limit || 10}</div>
  ),
}))

vi.mock('./NFTGallery', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="nft-gallery">NFTGallery: {projectId}</div>
  ),
}))

vi.mock('./NFTCard', () => ({
  default: ({ projectId, tierId }: { projectId: string; tierId: string }) => (
    <div data-testid="nft-card">NFTCard: {projectId} tier {tierId}</div>
  ),
}))

vi.mock('./Storefront', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="storefront">Storefront: {projectId}</div>
  ),
}))

vi.mock('./LandingPagePreview', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="landing-page-preview">LandingPagePreview: {projectId}</div>
  ),
}))

vi.mock('./SuccessVisualization', () => ({
  default: ({ targetRaise }: { targetRaise?: string }) => (
    <div data-testid="success-visualization">SuccessVisualization: {targetRaise}</div>
  ),
}))

vi.mock('./charts', () => ({
  BalanceChart: ({ projectId }: { projectId: string }) => (
    <div data-testid="balance-chart">BalanceChart: {projectId}</div>
  ),
  HoldersChart: ({ projectId }: { projectId: string }) => (
    <div data-testid="holders-chart">HoldersChart: {projectId}</div>
  ),
  VolumeChart: ({ projectId }: { projectId: string }) => (
    <div data-testid="volume-chart">VolumeChart: {projectId}</div>
  ),
  TokenPriceChart: ({ projectId }: { projectId: string }) => (
    <div data-testid="token-price-chart">TokenPriceChart: {projectId}</div>
  ),
  PoolPriceChart: ({ poolAddress }: { poolAddress: string }) => (
    <div data-testid="pool-price-chart">PoolPriceChart: {poolAddress}</div>
  ),
  MultiChainCashOutChart: ({ projectId }: { projectId: string }) => (
    <div data-testid="multi-chain-cash-out-chart">MultiChainCashOutChart: {projectId}</div>
  ),
}))

vi.mock('./ComponentShimmer', () => ({
  default: () => <div data-testid="component-shimmer">Loading...</div>,
}))

vi.mock('./OptionsPickerShimmer', () => ({
  default: () => <div data-testid="options-picker-shimmer">Loading options...</div>,
}))

describe('ComponentRegistry', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    vi.clearAllMocks()
  })

  describe('connect-wallet component', () => {
    it('renders ConnectWalletButton for connect-wallet type', async () => {
      const component: ParsedComponent = {
        type: 'connect-wallet',
        props: {},
        raw: '<juice-component type="connect-wallet" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('connect-wallet')).toBeInTheDocument()
      })
    })

    it('renders ConnectWalletButton for connect-account type', async () => {
      const component: ParsedComponent = {
        type: 'connect-account',
        props: {},
        raw: '<juice-component type="connect-account" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('connect-wallet')).toBeInTheDocument()
      })
    })
  })

  describe('project-card component', () => {
    it('renders ProjectCard with projectId', async () => {
      const component: ParsedComponent = {
        type: 'project-card',
        props: { projectId: '1' },
        raw: '<juice-component type="project-card" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('project-card')).toBeInTheDocument()
        expect(screen.getByText(/ProjectCard: 1/)).toBeInTheDocument()
      })
    })

    it('passes chainId to ProjectCard', async () => {
      const component: ParsedComponent = {
        type: 'project-card',
        props: { projectId: '1', chainId: '10' },
        raw: '<juice-component type="project-card" projectId="1" chainId="10" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByText(/on 10/)).toBeInTheDocument()
      })
    })
  })

  describe('payment-form component (deprecated)', () => {
    it('renders ProjectCard for payment-form type', async () => {
      const component: ParsedComponent = {
        type: 'payment-form',
        props: { projectId: '1' },
        raw: '<juice-component type="payment-form" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('project-card')).toBeInTheDocument()
      })
    })
  })

  describe('note-card component', () => {
    it('renders NoteCard with props', async () => {
      const component: ParsedComponent = {
        type: 'note-card',
        props: { projectId: '1', defaultNote: 'Hello!' },
        raw: '<juice-component type="note-card" projectId="1" defaultNote="Hello!" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('note-card')).toBeInTheDocument()
        expect(screen.getByText(/Hello!/)).toBeInTheDocument()
      })
    })
  })

  describe('cash-out-form component', () => {
    it('renders CashOutForm with projectId', async () => {
      const component: ParsedComponent = {
        type: 'cash-out-form',
        props: { projectId: '1' },
        raw: '<juice-component type="cash-out-form" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('cash-out-form')).toBeInTheDocument()
      })
    })
  })

  describe('send-payouts-form component', () => {
    it('renders SendPayoutsForm with projectId', async () => {
      const component: ParsedComponent = {
        type: 'send-payouts-form',
        props: { projectId: '1' },
        raw: '<juice-component type="send-payouts-form" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('send-payouts-form')).toBeInTheDocument()
      })
    })
  })

  describe('transaction-status component', () => {
    it('renders TransactionStatus with txId', async () => {
      const component: ParsedComponent = {
        type: 'transaction-status',
        props: { txId: 'tx-123' },
        raw: '<juice-component type="transaction-status" txId="tx-123" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('transaction-status')).toBeInTheDocument()
        expect(screen.getByText(/tx-123/)).toBeInTheDocument()
      })
    })
  })

  describe('transaction-preview component', () => {
    it('renders TransactionPreview with props', async () => {
      const component: ParsedComponent = {
        type: 'transaction-preview',
        props: {
          action: 'pay',
          contract: 'JBController',
          chainId: '1',
          projectId: '1',
        },
        raw: '<juice-component type="transaction-preview" action="pay" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('transaction-preview')).toBeInTheDocument()
        expect(screen.getByText(/pay/)).toBeInTheDocument()
      })
    })
  })

  describe('chart components', () => {
    it('renders BalanceChart', async () => {
      const component: ParsedComponent = {
        type: 'balance-chart',
        props: { projectId: '1', chainId: '1' },
        raw: '<juice-component type="balance-chart" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('balance-chart')).toBeInTheDocument()
      })
    })

    it('renders HoldersChart', async () => {
      const component: ParsedComponent = {
        type: 'holders-chart',
        props: { projectId: '1', limit: '10' },
        raw: '<juice-component type="holders-chart" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('holders-chart')).toBeInTheDocument()
      })
    })

    it('renders VolumeChart', async () => {
      const component: ParsedComponent = {
        type: 'volume-chart',
        props: { projectId: '1', range: '30d' },
        raw: '<juice-component type="volume-chart" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('volume-chart')).toBeInTheDocument()
      })
    })

    it('renders TokenPriceChart', async () => {
      const component: ParsedComponent = {
        type: 'token-price-chart',
        props: { projectId: '1' },
        raw: '<juice-component type="token-price-chart" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('token-price-chart')).toBeInTheDocument()
      })
    })
  })

  describe('options-picker component', () => {
    it('renders OptionsPicker with valid groups JSON', async () => {
      const groups = [
        {
          id: 'type',
          label: 'Type',
          options: [{ value: 'a', label: 'A' }],
        },
      ]
      const component: ParsedComponent = {
        type: 'options-picker',
        props: { groups: JSON.stringify(groups) },
        raw: '<juice-component type="options-picker" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('options-picker')).toBeInTheDocument()
        expect(screen.getByText(/1 groups/)).toBeInTheDocument()
      })
    })

    it('shows message for invalid JSON (results in empty groups)', async () => {
      const component: ParsedComponent = {
        type: 'options-picker',
        props: { groups: 'invalid json {' },
        raw: '<juice-component type="options-picker" />',
      }

      render(<ComponentRegistry component={component} />)

      // Invalid JSON parsing results in empty array, which triggers "not available" message
      await waitFor(() => {
        expect(screen.getByText(/Options not available/)).toBeInTheDocument()
      })
    })

    it('shows message when no groups provided', async () => {
      const component: ParsedComponent = {
        type: 'options-picker',
        props: {},
        raw: '<juice-component type="options-picker" />',
      }

      render(<ComponentRegistry component={component} />)

      expect(screen.getByText(/Options not available/)).toBeInTheDocument()
    })

    it('shows message when groups array is empty', async () => {
      const component: ParsedComponent = {
        type: 'options-picker',
        props: { groups: '[]' },
        raw: '<juice-component type="options-picker" />',
      }

      render(<ComponentRegistry component={component} />)

      expect(screen.getByText(/Options not available/)).toBeInTheDocument()
    })

    it('passes submitLabel to OptionsPicker', async () => {
      const groups = [{ id: 'type', label: 'Type', options: [{ value: 'a', label: 'A' }] }]
      const component: ParsedComponent = {
        type: 'options-picker',
        props: { groups: JSON.stringify(groups), submitLabel: 'Next' },
        raw: '<juice-component type="options-picker" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByText(/Next/)).toBeInTheDocument()
      })
    })
  })

  describe('_loading component', () => {
    it('renders OptionsPickerShimmer for loading state', () => {
      const component: ParsedComponent = {
        type: '_loading',
        props: {},
        raw: '<juice-component',
      }

      render(<ComponentRegistry component={component} />)

      expect(screen.getByTestId('options-picker-shimmer')).toBeInTheDocument()
    })
  })

  describe('activity-feed component', () => {
    it('renders ActivityFeed with props', async () => {
      const component: ParsedComponent = {
        type: 'activity-feed',
        props: { projectId: '1', limit: '20' },
        raw: '<juice-component type="activity-feed" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('activity-feed')).toBeInTheDocument()
      })
    })
  })

  describe('top-projects component', () => {
    it('renders TopProjects with limit', async () => {
      const component: ParsedComponent = {
        type: 'top-projects',
        props: { limit: '5', orderBy: 'volume' },
        raw: '<juice-component type="top-projects" limit="5" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('top-projects')).toBeInTheDocument()
        expect(screen.getByText(/limit=5/)).toBeInTheDocument()
      })
    })
  })

  describe('nft-gallery component', () => {
    it('renders NFTGallery with projectId', async () => {
      const component: ParsedComponent = {
        type: 'nft-gallery',
        props: { projectId: '1' },
        raw: '<juice-component type="nft-gallery" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('nft-gallery')).toBeInTheDocument()
      })
    })
  })

  describe('nft-card component', () => {
    it('renders NFTCard with props', async () => {
      const component: ParsedComponent = {
        type: 'nft-card',
        props: { projectId: '1', tierId: '1' },
        raw: '<juice-component type="nft-card" projectId="1" tierId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('nft-card')).toBeInTheDocument()
        expect(screen.getByText(/tier 1/)).toBeInTheDocument()
      })
    })
  })

  describe('storefront component', () => {
    it('renders Storefront with projectId', async () => {
      const component: ParsedComponent = {
        type: 'storefront',
        props: { projectId: '1' },
        raw: '<juice-component type="storefront" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('storefront')).toBeInTheDocument()
      })
    })
  })

  describe('landing-page-preview component', () => {
    it('renders LandingPagePreview with projectId', async () => {
      const component: ParsedComponent = {
        type: 'landing-page-preview',
        props: { projectId: '1' },
        raw: '<juice-component type="landing-page-preview" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('landing-page-preview')).toBeInTheDocument()
      })
    })
  })

  describe('success-visualization component', () => {
    it('renders SuccessVisualization with props', async () => {
      const component: ParsedComponent = {
        type: 'success-visualization',
        props: { targetRaise: '100000' },
        raw: '<juice-component type="success-visualization" targetRaise="100000" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('success-visualization')).toBeInTheDocument()
        expect(screen.getByText(/100000/)).toBeInTheDocument()
      })
    })
  })

  describe('unknown component type', () => {
    it('shows unknown component message', () => {
      const component: ParsedComponent = {
        type: 'unknown-type',
        props: {},
        raw: '<juice-component type="unknown-type" />',
      }

      render(<ComponentRegistry component={component} />)

      expect(screen.getByText(/Unknown component: unknown-type/)).toBeInTheDocument()
    })
  })

  describe('form components', () => {
    it('renders SendReservedTokensForm', async () => {
      const component: ParsedComponent = {
        type: 'send-reserved-tokens-form',
        props: { projectId: '1' },
        raw: '<juice-component type="send-reserved-tokens-form" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('send-reserved-tokens-form')).toBeInTheDocument()
      })
    })

    it('renders UseSurplusAllowanceForm', async () => {
      const component: ParsedComponent = {
        type: 'use-surplus-allowance-form',
        props: { projectId: '1' },
        raw: '<juice-component type="use-surplus-allowance-form" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('use-surplus-allowance-form')).toBeInTheDocument()
      })
    })

    it('renders DeployERC20Form', async () => {
      const component: ParsedComponent = {
        type: 'deploy-erc20-form',
        props: { projectId: '1' },
        raw: '<juice-component type="deploy-erc20-form" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('deploy-erc20-form')).toBeInTheDocument()
      })
    })

    it('renders QueueRulesetForm', async () => {
      const component: ParsedComponent = {
        type: 'queue-ruleset-form',
        props: { projectId: '1' },
        raw: '<juice-component type="queue-ruleset-form" projectId="1" />',
      }

      render(<ComponentRegistry component={component} />)

      await waitFor(() => {
        expect(screen.getByTestId('queue-ruleset-form')).toBeInTheDocument()
      })
    })
  })
})
