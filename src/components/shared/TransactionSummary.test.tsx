import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TransactionSummary from './TransactionSummary'
import type {
  PayDetails,
  CashOutDetails,
  SendPayoutsDetails,
  SendReservedTokensDetails,
  UseAllowanceDetails,
  QueueRulesetDetails,
  LaunchProjectDetails,
  DeployRevnetDetails,
  DeployERC20Details,
} from './TransactionSummary'

describe('TransactionSummary', () => {
  describe('PaySummary', () => {
    const payDetails: PayDetails = {
      projectId: '123',
      projectName: 'Test Project',
      amount: '1000000000000000000',
      amountFormatted: '1 ETH',
      estimatedTokens: '1,000,000',
      fee: '25000000000000000',
      feeFormatted: '0.025 ETH',
      memo: 'Test payment',
      currency: 'ETH',
    }

    it('renders payment summary with all details', () => {
      render(<TransactionSummary type="pay" details={payDetails} isDark={false} />)

      expect(screen.getByText(/You are paying/)).toBeInTheDocument()
      expect(screen.getByText('1 ETH')).toBeInTheDocument()
      expect(screen.getByText('Test Project')).toBeInTheDocument()
    })

    it('displays estimated tokens', () => {
      render(<TransactionSummary type="pay" details={payDetails} isDark={false} />)
      expect(screen.getByText(/1,000,000/)).toBeInTheDocument()
      expect(screen.getByText(/tokens/)).toBeInTheDocument()
    })

    it('displays fee information', () => {
      render(<TransactionSummary type="pay" details={payDetails} isDark={false} />)
      expect(screen.getByText(/2.5% fee/)).toBeInTheDocument()
      expect(screen.getByText(/0.025 ETH/)).toBeInTheDocument()
    })

    it('displays memo when provided', () => {
      render(<TransactionSummary type="pay" details={payDetails} isDark={false} />)
      expect(screen.getByText(/Memo:/)).toBeInTheDocument()
      expect(screen.getByText(/"Test payment"/)).toBeInTheDocument()
    })

    it('falls back to project ID when name not provided', () => {
      const detailsNoName = { ...payDetails, projectName: undefined }
      render(<TransactionSummary type="pay" details={detailsNoName} isDark={false} />)
      expect(screen.getByText('Project #123')).toBeInTheDocument()
    })

    it('does not show optional fields when not provided', () => {
      const minimalDetails: PayDetails = {
        projectId: '123',
        amount: '1000000000000000000',
        amountFormatted: '1 ETH',
      }
      render(<TransactionSummary type="pay" details={minimalDetails} isDark={false} />)
      expect(screen.queryByText(/Memo:/)).not.toBeInTheDocument()
      expect(screen.queryByText(/fee/)).not.toBeInTheDocument()
    })
  })

  describe('CashOutSummary', () => {
    const cashOutDetails: CashOutDetails = {
      projectId: '123',
      projectName: 'Test Project',
      tokens: '1000000000000000000000',
      tokensFormatted: '1,000 TEST',
      estimatedReturn: '800000000000000000',
      estimatedReturnFormatted: '0.8 ETH',
      taxRate: 20,
      currency: 'ETH',
    }

    it('renders cash out summary', () => {
      render(<TransactionSummary type="cashOut" details={cashOutDetails} isDark={false} />)

      expect(screen.getByText(/You are cashing out/)).toBeInTheDocument()
      expect(screen.getByText('1,000 TEST')).toBeInTheDocument()
    })

    it('displays tax rate', () => {
      render(<TransactionSummary type="cashOut" details={cashOutDetails} isDark={false} />)
      expect(screen.getByText(/20% cash out tax/)).toBeInTheDocument()
    })

    it('displays estimated return', () => {
      render(<TransactionSummary type="cashOut" details={cashOutDetails} isDark={false} />)
      expect(screen.getByText('0.8 ETH')).toBeInTheDocument()
    })

    it('shows permanent burn warning', () => {
      render(<TransactionSummary type="cashOut" details={cashOutDetails} isDark={false} />)
      expect(screen.getByText(/permanently burned/)).toBeInTheDocument()
    })
  })

  describe('SendPayoutsSummary', () => {
    const sendPayoutsDetails: SendPayoutsDetails = {
      projectId: '123',
      projectName: 'Test Project',
      amount: '10000000000000000000',
      amountFormatted: '10 ETH',
      fee: '250000000000000000',
      feeFormatted: '0.25 ETH',
      recipients: [
        { name: 'Alice', address: '0x1111111111111111111111111111111111111111', percent: 50, amount: '4.875 ETH' },
        { address: '0x2222222222222222222222222222222222222222', percent: 30, amount: '2.925 ETH' },
        { name: 'Charlie', address: '0x3333333333333333333333333333333333333333', percent: 20 },
      ],
      currency: 'ETH',
    }

    it('renders send payouts summary', () => {
      render(<TransactionSummary type="sendPayouts" details={sendPayoutsDetails} isDark={false} />)

      expect(screen.getByText(/Sending payouts from/)).toBeInTheDocument()
      expect(screen.getByText('Test Project')).toBeInTheDocument()
    })

    it('displays total amount', () => {
      render(<TransactionSummary type="sendPayouts" details={sendPayoutsDetails} isDark={false} />)
      expect(screen.getByText('10 ETH')).toBeInTheDocument()
    })

    it('displays protocol fee', () => {
      render(<TransactionSummary type="sendPayouts" details={sendPayoutsDetails} isDark={false} />)
      expect(screen.getByText(/Protocol fee:/)).toBeInTheDocument()
      expect(screen.getByText(/0.25 ETH/)).toBeInTheDocument()
    })

    it('displays recipients with names', () => {
      render(<TransactionSummary type="sendPayouts" details={sendPayoutsDetails} isDark={false} />)
      expect(screen.getByText(/Alice receives 50%/)).toBeInTheDocument()
    })

    it('truncates addresses for recipients without names', () => {
      render(<TransactionSummary type="sendPayouts" details={sendPayoutsDetails} isDark={false} />)
      expect(screen.getByText(/0x2222...2222 receives 30%/)).toBeInTheDocument()
    })

    it('shows amounts for recipients when provided', () => {
      render(<TransactionSummary type="sendPayouts" details={sendPayoutsDetails} isDark={false} />)
      expect(screen.getByText(/4.875 ETH/)).toBeInTheDocument()
    })

    it('shows +N more for recipients beyond 3', () => {
      const manyRecipients = {
        ...sendPayoutsDetails,
        recipients: [
          { address: '0x1111111111111111111111111111111111111111', percent: 25 },
          { address: '0x2222222222222222222222222222222222222222', percent: 25 },
          { address: '0x3333333333333333333333333333333333333333', percent: 25 },
          { address: '0x4444444444444444444444444444444444444444', percent: 15 },
          { address: '0x5555555555555555555555555555555555555555', percent: 10 },
        ],
      }
      render(<TransactionSummary type="sendPayouts" details={manyRecipients} isDark={false} />)
      expect(screen.getByText(/\+ 2 more recipients/)).toBeInTheDocument()
    })
  })

  describe('SendReservedTokensSummary', () => {
    const sendReservedTokensDetails: SendReservedTokensDetails = {
      projectId: '123',
      projectName: 'Test Project',
      pendingTokens: '1000000000000000000000',
      pendingTokensFormatted: '1,000',
      reservedRate: 10,
      recipients: [
        { name: 'Alice', address: '0x1111111111111111111111111111111111111111', percent: 50, tokens: '500' },
        { address: '0x2222222222222222222222222222222222222222', percent: 30, tokens: '300' },
        { name: 'Treasury', address: '0x0000000000000000000000000000000000000000', percent: 20, isProject: true, projectId: 456 },
      ],
    }

    it('renders send reserved tokens summary', () => {
      render(<TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={false} />)

      expect(screen.getByText(/Distributing/)).toBeInTheDocument()
      expect(screen.getByText('1,000')).toBeInTheDocument()
      expect(screen.getByText(/reserved tokens from/)).toBeInTheDocument()
    })

    it('displays project name', () => {
      render(<TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={false} />)
      expect(screen.getByText('Test Project')).toBeInTheDocument()
    })

    it('displays reserved rate', () => {
      render(<TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={false} />)
      expect(screen.getByText(/Reserved rate: 10%/)).toBeInTheDocument()
    })

    it('displays recipients with names', () => {
      render(<TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={false} />)
      expect(screen.getByText(/Alice receives 50%/)).toBeInTheDocument()
    })

    it('truncates addresses for recipients without names', () => {
      render(<TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={false} />)
      expect(screen.getByText(/0x2222...2222 receives 30%/)).toBeInTheDocument()
    })

    it('shows tokens for recipients when provided', () => {
      render(<TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={false} />)
      expect(screen.getByText(/~500/)).toBeInTheDocument()
    })

    it('shows project ID for project recipients', () => {
      render(<TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={false} />)
      expect(screen.getByText('Project #456')).toBeInTheDocument()
    })

    it('shows +N more for recipients beyond 3', () => {
      const manyRecipients = {
        ...sendReservedTokensDetails,
        recipients: [
          { address: '0x1111111111111111111111111111111111111111', percent: 20 },
          { address: '0x2222222222222222222222222222222222222222', percent: 20 },
          { address: '0x3333333333333333333333333333333333333333', percent: 20 },
          { address: '0x4444444444444444444444444444444444444444', percent: 20 },
          { address: '0x5555555555555555555555555555555555555555', percent: 20 },
        ],
      }
      render(<TransactionSummary type="sendReservedTokens" details={manyRecipients} isDark={false} />)
      expect(screen.getByText(/\+ 2 more recipients/)).toBeInTheDocument()
    })

    it('shows minting info', () => {
      render(<TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={false} />)
      expect(screen.getByText(/Tokens will be minted and sent to configured splits/)).toBeInTheDocument()
    })

    it('falls back to project ID when name not provided', () => {
      const noNameDetails = {
        ...sendReservedTokensDetails,
        projectName: undefined,
      }
      render(<TransactionSummary type="sendReservedTokens" details={noNameDetails} isDark={false} />)
      expect(screen.getByText('Project #123')).toBeInTheDocument()
    })

    it('applies dark theme styles', () => {
      const { container } = render(
        <TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={true} />
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-amber-500/5')
    })

    it('applies light theme styles', () => {
      const { container } = render(
        <TransactionSummary type="sendReservedTokens" details={sendReservedTokensDetails} isDark={false} />
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-amber-50/50')
    })
  })

  describe('UseAllowanceSummary', () => {
    const useAllowanceDetails: UseAllowanceDetails = {
      projectId: '123',
      projectName: 'Test Project',
      amount: '5000000000000000000',
      amountFormatted: '5 ETH',
      fee: '125000000000000000',
      feeFormatted: '0.125 ETH',
      netAmount: '4875000000000000000',
      netAmountFormatted: '4.875 ETH',
      destination: '0x1234567890123456789012345678901234567890',
      currency: 'ETH',
    }

    it('renders use allowance summary', () => {
      render(<TransactionSummary type="useAllowance" details={useAllowanceDetails} isDark={false} />)

      expect(screen.getByText(/Withdrawing/)).toBeInTheDocument()
      expect(screen.getByText('5 ETH')).toBeInTheDocument()
      expect(screen.getByText(/surplus allowance/)).toBeInTheDocument()
    })

    it('displays protocol fee', () => {
      render(<TransactionSummary type="useAllowance" details={useAllowanceDetails} isDark={false} />)
      expect(screen.getByText(/Protocol fee:/)).toBeInTheDocument()
    })

    it('displays net amount received', () => {
      render(<TransactionSummary type="useAllowance" details={useAllowanceDetails} isDark={false} />)
      expect(screen.getByText(/You receive:/)).toBeInTheDocument()
      expect(screen.getByText('4.875 ETH')).toBeInTheDocument()
    })

    it('displays truncated destination address', () => {
      render(<TransactionSummary type="useAllowance" details={useAllowanceDetails} isDark={false} />)
      expect(screen.getByText(/Destination:/)).toBeInTheDocument()
      expect(screen.getByText(/0x1234...7890/)).toBeInTheDocument()
    })
  })

  describe('QueueRulesetSummary', () => {
    const queueRulesetDetails: QueueRulesetDetails = {
      projectId: '123',
      projectName: 'Test Project',
      effectiveDate: 'Jan 15, 2025',
      changes: [
        { field: 'Token issuance', from: '1M tokens/ETH', to: '500K tokens/ETH' },
        { field: 'Reserved rate', from: '10%', to: '20%' },
        { field: 'Cash out tax', to: '15%' },
      ],
    }

    it('renders queue ruleset summary', () => {
      render(<TransactionSummary type="queueRuleset" details={queueRulesetDetails} isDark={false} />)

      expect(screen.getByText(/Queueing new ruleset for/)).toBeInTheDocument()
      expect(screen.getByText('Test Project')).toBeInTheDocument()
    })

    it('displays effective date', () => {
      render(<TransactionSummary type="queueRuleset" details={queueRulesetDetails} isDark={false} />)
      expect(screen.getByText(/Takes effect:/)).toBeInTheDocument()
      expect(screen.getByText(/Jan 15, 2025/)).toBeInTheDocument()
    })

    it('displays changes with from and to values', () => {
      render(<TransactionSummary type="queueRuleset" details={queueRulesetDetails} isDark={false} />)
      expect(screen.getByText(/Token issuance:/)).toBeInTheDocument()
      expect(screen.getByText('1M tokens/ETH')).toBeInTheDocument()
      expect(screen.getByText('500K tokens/ETH')).toBeInTheDocument()
    })

    it('displays changes with only to value', () => {
      render(<TransactionSummary type="queueRuleset" details={queueRulesetDetails} isDark={false} />)
      expect(screen.getByText(/Cash out tax:/)).toBeInTheDocument()
      expect(screen.getByText('15%')).toBeInTheDocument()
    })
  })

  describe('LaunchProjectSummary', () => {
    const launchProjectDetails: LaunchProjectDetails = {
      projectName: 'New Project',
      owner: '0x1234567890123456789012345678901234567890',
      chainIds: [1, 10, 8453],
      initialIssuance: '1,000,000',
      reservedRate: 10,
    }

    it('renders launch project summary', () => {
      render(<TransactionSummary type="launchProject" details={launchProjectDetails} isDark={false} />)

      expect(screen.getByText(/Creating new Juicebox project/)).toBeInTheDocument()
      expect(screen.getByText('New Project')).toBeInTheDocument()
    })

    it('displays chain names from chain IDs', () => {
      render(<TransactionSummary type="launchProject" details={launchProjectDetails} isDark={false} />)
      expect(screen.getByText('Ethereum, Optimism, Base')).toBeInTheDocument()
    })

    it('uses provided chain names when available', () => {
      const detailsWithNames = {
        ...launchProjectDetails,
        chainNames: ['ETH Mainnet', 'OP', 'Base'],
      }
      render(<TransactionSummary type="launchProject" details={detailsWithNames} isDark={false} />)
      expect(screen.getByText('ETH Mainnet, OP, Base')).toBeInTheDocument()
    })

    it('displays truncated owner address', () => {
      render(<TransactionSummary type="launchProject" details={launchProjectDetails} isDark={false} />)
      expect(screen.getByText(/Owner:/)).toBeInTheDocument()
      expect(screen.getByText(/0x1234...7890/)).toBeInTheDocument()
    })

    it('displays initial issuance when provided', () => {
      render(<TransactionSummary type="launchProject" details={launchProjectDetails} isDark={false} />)
      expect(screen.getByText(/Initial issuance:/)).toBeInTheDocument()
      expect(screen.getByText(/1,000,000 tokens\/ETH/)).toBeInTheDocument()
    })

    it('displays reserved rate when provided', () => {
      render(<TransactionSummary type="launchProject" details={launchProjectDetails} isDark={false} />)
      expect(screen.getByText(/Reserved rate:/)).toBeInTheDocument()
      expect(screen.getByText(/10%/)).toBeInTheDocument()
    })

    it('handles unknown chain IDs', () => {
      const detailsUnknownChain = {
        ...launchProjectDetails,
        chainIds: [1, 99999],
      }
      render(<TransactionSummary type="launchProject" details={detailsUnknownChain} isDark={false} />)
      expect(screen.getByText('Ethereum, Chain 99999')).toBeInTheDocument()
    })
  })

  describe('DeployRevnetSummary', () => {
    const deployRevnetDetails: DeployRevnetDetails = {
      name: 'Test Revnet',
      tokenSymbol: 'TREV',
      chainIds: [1, 10, 8453, 42161],
      stages: [
        { splitPercent: 20, decayPercent: 5, decayFrequency: '7 days' },
        { splitPercent: 10, decayPercent: 3, decayFrequency: '14 days' },
      ],
      autoDeploySuckers: true,
    }

    it('renders deploy revnet summary', () => {
      render(<TransactionSummary type="deployRevnet" details={deployRevnetDetails} isDark={false} />)

      expect(screen.getByText(/Deploying revnet:/)).toBeInTheDocument()
      expect(screen.getByText('Test Revnet')).toBeInTheDocument()
    })

    it('displays token symbol', () => {
      render(<TransactionSummary type="deployRevnet" details={deployRevnetDetails} isDark={false} />)
      expect(screen.getByText(/\$TREV/)).toBeInTheDocument()
    })

    it('displays chain names', () => {
      render(<TransactionSummary type="deployRevnet" details={deployRevnetDetails} isDark={false} />)
      expect(screen.getByText('Ethereum, Optimism, Base, Arbitrum')).toBeInTheDocument()
    })

    it('displays stage count', () => {
      render(<TransactionSummary type="deployRevnet" details={deployRevnetDetails} isDark={false} />)
      expect(screen.getByText(/2 stages configured/)).toBeInTheDocument()
    })

    it('displays stage details', () => {
      render(<TransactionSummary type="deployRevnet" details={deployRevnetDetails} isDark={false} />)
      expect(screen.getByText(/Stage 1:/)).toBeInTheDocument()
      expect(screen.getByText(/20% operator split/)).toBeInTheDocument()
      expect(screen.getByText(/5% decay\/7 days/)).toBeInTheDocument()
    })

    it('displays sucker deployment notice for multi-chain', () => {
      render(<TransactionSummary type="deployRevnet" details={deployRevnetDetails} isDark={false} />)
      expect(screen.getByText(/Cross-chain bridging will be enabled via suckers/)).toBeInTheDocument()
    })

    it('does not show sucker notice for single chain', () => {
      const singleChainDetails = {
        ...deployRevnetDetails,
        chainIds: [1],
      }
      render(<TransactionSummary type="deployRevnet" details={singleChainDetails} isDark={false} />)
      expect(screen.queryByText(/Cross-chain bridging/)).not.toBeInTheDocument()
    })

    it('does not show sucker notice when autoDeploySuckers is false', () => {
      const noSuckersDetails = {
        ...deployRevnetDetails,
        autoDeploySuckers: false,
      }
      render(<TransactionSummary type="deployRevnet" details={noSuckersDetails} isDark={false} />)
      expect(screen.queryByText(/Cross-chain bridging/)).not.toBeInTheDocument()
    })

    it('handles single stage with correct grammar', () => {
      const singleStageDetails = {
        ...deployRevnetDetails,
        stages: [{ splitPercent: 20, decayPercent: 5, decayFrequency: '7 days' }],
      }
      render(<TransactionSummary type="deployRevnet" details={singleStageDetails} isDark={false} />)
      expect(screen.getByText(/1 stage configured/)).toBeInTheDocument()
    })
  })

  describe('DeployERC20Summary', () => {
    const deployERC20Details: DeployERC20Details = {
      projectId: '123',
      projectName: 'Test Project',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      chainIds: [1, 10, 8453],
    }

    it('renders deploy ERC20 summary', () => {
      render(<TransactionSummary type="deployERC20" details={deployERC20Details} isDark={false} />)

      expect(screen.getByText(/Deploying ERC-20 token:/)).toBeInTheDocument()
      expect(screen.getByText('Test Token')).toBeInTheDocument()
      expect(screen.getByText(/\$TEST/)).toBeInTheDocument()
    })

    it('displays project association', () => {
      render(<TransactionSummary type="deployERC20" details={deployERC20Details} isDark={false} />)
      expect(screen.getByText(/For/)).toBeInTheDocument()
      expect(screen.getByText('Test Project')).toBeInTheDocument()
    })

    it('displays multi-chain deployment info', () => {
      render(<TransactionSummary type="deployERC20" details={deployERC20Details} isDark={false} />)
      expect(screen.getByText(/Deploying on:/)).toBeInTheDocument()
      expect(screen.getByText('Ethereum, Optimism, Base')).toBeInTheDocument()
    })

    it('shows CREATE2 notice for multi-chain', () => {
      render(<TransactionSummary type="deployERC20" details={deployERC20Details} isDark={false} />)
      expect(screen.getByText(/Same token address on all chains via CREATE2/)).toBeInTheDocument()
    })

    it('shows Network instead of Deploying on for single chain', () => {
      const singleChainDetails = {
        ...deployERC20Details,
        chainIds: [1],
      }
      render(<TransactionSummary type="deployERC20" details={singleChainDetails} isDark={false} />)
      expect(screen.getByText(/Network:/)).toBeInTheDocument()
      expect(screen.queryByText(/CREATE2/)).not.toBeInTheDocument()
    })

    it('shows token holder info', () => {
      render(<TransactionSummary type="deployERC20" details={deployERC20Details} isDark={false} />)
      expect(screen.getByText(/Token holders can claim and transfer freely/)).toBeInTheDocument()
    })

    it('falls back to project ID when name not provided', () => {
      const noNameDetails = {
        ...deployERC20Details,
        projectName: undefined,
      }
      render(<TransactionSummary type="deployERC20" details={noNameDetails} isDark={false} />)
      expect(screen.getByText('Project #123')).toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', () => {
      const payDetails: PayDetails = {
        projectId: '123',
        amount: '1000000000000000000',
        amountFormatted: '1 ETH',
      }
      const { container } = render(
        <TransactionSummary type="pay" details={payDetails} isDark={true} />
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-juice-orange/5')
    })

    it('applies light theme styles', () => {
      const payDetails: PayDetails = {
        projectId: '123',
        amount: '1000000000000000000',
        amountFormatted: '1 ETH',
      }
      const { container } = render(
        <TransactionSummary type="pay" details={payDetails} isDark={false} />
      )
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('bg-orange-50/50')
    })
  })

  describe('null handling', () => {
    it('returns null for unknown transaction type', () => {
      // @ts-expect-error - Testing unknown type
      const { container } = render(<TransactionSummary type="unknown" details={{}} isDark={false} />)
      expect(container.firstChild).toBeNull()
    })
  })
})
