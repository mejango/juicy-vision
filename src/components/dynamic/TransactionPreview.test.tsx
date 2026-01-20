import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TransactionPreview from './TransactionPreview'
import { useThemeStore } from '../../stores'

describe('TransactionPreview', () => {
  const defaultProps = {
    action: 'pay',
    contract: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c',
    chainId: '1',
    parameters: JSON.stringify({ amount: '1000000000000000000' }),
    explanation: 'Pay 1 ETH to project #42',
  }

  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
  })

  describe('rendering', () => {
    it('renders the explanation text', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.getByText('Pay 1 ETH to project #42')).toBeInTheDocument()
    })

    it('renders the Summary header', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.getByText('Summary')).toBeInTheDocument()
    })

    it('renders the action icon', () => {
      render(<TransactionPreview {...defaultProps} />)
      // Pay action should show 💰
      expect(screen.getByText('💰')).toBeInTheDocument()
    })

    it('renders chain name badge', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.getByText('Ethereum')).toBeInTheDocument()
    })

    it('renders project ID when provided', () => {
      render(<TransactionPreview {...defaultProps} projectId="42" />)
      expect(screen.getByText('#42')).toBeInTheDocument()
    })
  })

  describe('chain support', () => {
    it('displays Ethereum for chain ID 1', () => {
      render(<TransactionPreview {...defaultProps} chainId="1" />)
      expect(screen.getByText('Ethereum')).toBeInTheDocument()
    })

    it('displays Optimism for chain ID 10', () => {
      render(<TransactionPreview {...defaultProps} chainId="10" />)
      expect(screen.getByText('Optimism')).toBeInTheDocument()
    })

    it('displays Base for chain ID 8453', () => {
      render(<TransactionPreview {...defaultProps} chainId="8453" />)
      expect(screen.getByText('Base')).toBeInTheDocument()
    })

    it('displays Arbitrum for chain ID 42161', () => {
      render(<TransactionPreview {...defaultProps} chainId="42161" />)
      expect(screen.getByText('Arbitrum')).toBeInTheDocument()
    })

    it('displays generic chain name for unknown chain ID', () => {
      render(<TransactionPreview {...defaultProps} chainId="999" />)
      expect(screen.getByText('Chain 999')).toBeInTheDocument()
    })
  })

  describe('action icons', () => {
    const actionIconPairs = [
      { action: 'pay', icon: '💰' },
      { action: 'cashOut', icon: '🔄' },
      { action: 'sendPayouts', icon: '📤' },
      { action: 'useAllowance', icon: '💸' },
      { action: 'mintTokens', icon: '🪙' },
      { action: 'burnTokens', icon: '🔥' },
      { action: 'launchProject', icon: '🚀' },
      { action: 'queueRuleset', icon: '📋' },
      { action: 'deployERC20', icon: '🎟️' },
    ]

    actionIconPairs.forEach(({ action, icon }) => {
      it(`displays ${icon} for ${action} action`, () => {
        render(<TransactionPreview {...defaultProps} action={action} />)
        expect(screen.getByText(icon)).toBeInTheDocument()
      })
    })

    it('displays default icon for unknown action', () => {
      render(<TransactionPreview {...defaultProps} action="unknownAction" />)
      expect(screen.getByText('📝')).toBeInTheDocument()
    })
  })

  describe('expandable details', () => {
    it('shows technical details by default (expanded)', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.getByText('Contract')).toBeInTheDocument()
      expect(screen.getByText('Action')).toBeInTheDocument()
    })

    it('toggles details visibility when clicking toggle button', () => {
      render(<TransactionPreview {...defaultProps} />)

      // Should initially show details
      expect(screen.getByText('Contract')).toBeInTheDocument()

      // Click to hide
      fireEvent.click(screen.getByText('Hide technical details'))

      // Details should be hidden
      expect(screen.queryByText('Contract')).not.toBeInTheDocument()

      // Click to show again
      fireEvent.click(screen.getByText('Show technical details'))

      // Details should be visible again
      expect(screen.getByText('Contract')).toBeInTheDocument()
    })
  })

  describe('parameter formatting', () => {
    it('parses and displays JSON parameters', () => {
      const params = JSON.stringify({ recipient: '0x1234' })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      // The key should be displayed as "Recipient" (formatted)
      expect(screen.getByText('Recipient')).toBeInTheDocument()
    })

    it('handles invalid JSON gracefully', () => {
      render(<TransactionPreview {...defaultProps} parameters="not-valid-json" />)
      // Should show raw value when JSON parsing fails
      expect(screen.getByText('Raw')).toBeInTheDocument()
      expect(screen.getByText('not-valid-json')).toBeInTheDocument()
    })

    it('displays contract address', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.getByText(defaultProps.contract)).toBeInTheDocument()
    })

    it('displays action name', () => {
      render(<TransactionPreview {...defaultProps} />)
      expect(screen.getByText('pay')).toBeInTheDocument()
    })
  })

  describe('address label mapping', () => {
    it('shows JBMultiTerminal5_1 label for known address', () => {
      const params = JSON.stringify({
        terminal: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c'
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      // Should contain the label
      const text = screen.getByText(/JBMultiTerminal5_1/i)
      expect(text).toBeInTheDocument()
    })

    it('shows JBController5_1 label for known address', () => {
      const params = JSON.stringify({
        controller: '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1'
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/JBController5_1/i)).toBeInTheDocument()
    })

    it('shows NATIVE_TOKEN label for ETH address', () => {
      const params = JSON.stringify({
        token: '0x000000000000000000000000000000000000EEEe'
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/NATIVE_TOKEN/i)).toBeInTheDocument()
    })

    it('shows USDC label for chain-specific USDC address', () => {
      const params = JSON.stringify({
        token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' // Ethereum USDC
      })
      render(<TransactionPreview {...defaultProps} parameters={params} chainId="1" />)
      expect(screen.getByText(/USDC/i)).toBeInTheDocument()
    })
  })

  describe('value formatting', () => {
    it('formats wei values to ETH with both formats shown', () => {
      const params = JSON.stringify({
        amount: '1000000000000000000' // 1 ETH in wei (18 digits)
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/1\.0000 ETH/)).toBeInTheDocument()
    })

    it('formats duration in seconds to human readable', () => {
      const params = JSON.stringify({
        duration: 604800 // 7 days
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/7d 0h/)).toBeInTheDocument()
    })

    it('formats duration 0 as ongoing', () => {
      const params = JSON.stringify({
        duration: 0
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/0 \(ongoing\)/)).toBeInTheDocument()
    })

    it('formats reservedPercent to percentage', () => {
      const params = JSON.stringify({
        reservedPercent: 5000 // 50%
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/50%/)).toBeInTheDocument()
    })

    it('formats cashOutTaxRate 0 as full refunds', () => {
      const params = JSON.stringify({
        cashOutTaxRate: 0
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/0% \(full refunds\)/)).toBeInTheDocument()
    })

    it('formats cashOutTaxRate 10000 as disabled', () => {
      const params = JSON.stringify({
        cashOutTaxRate: 10000
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/100% \(disabled\)/)).toBeInTheDocument()
    })

    it('formats baseCurrency 1 as ETH', () => {
      const params = JSON.stringify({
        baseCurrency: 1
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/1 \(ETH\)/)).toBeInTheDocument()
    })

    it('formats baseCurrency 2 as USD', () => {
      const params = JSON.stringify({
        baseCurrency: 2
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/2 \(USD\)/)).toBeInTheDocument()
    })

    it('formats boolean pausePay correctly', () => {
      const params = JSON.stringify({
        pausePay: true
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText('Yes')).toBeInTheDocument()
    })

    it('formats weight with 18 decimals to human readable', () => {
      const params = JSON.stringify({
        weight: '1000000000000000000000000000' // Very large number with 18 decimals
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      // Should show tokens/USD format
      expect(screen.getByText(/tokens\/USD/)).toBeInTheDocument()
    })

    it('formats weightCutPercent correctly', () => {
      const params = JSON.stringify({
        weightCutPercent: 50000000 // 5.0% (50000000 / 10000000 = 5.0)
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/5\.0%\/cycle/)).toBeInTheDocument()
    })

    it('formats weightCutPercent 0 as no cut', () => {
      const params = JSON.stringify({
        weightCutPercent: 0
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/0% \(no cut\)/)).toBeInTheDocument()
    })
  })

  describe('nested object handling', () => {
    it('renders nested objects with expand/collapse', () => {
      const params = JSON.stringify({
        ruleset: {
          duration: 86400,
          weight: 1000000000000000000n.toString()
        }
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText('Ruleset')).toBeInTheDocument()
    })

    it('renders arrays with item count', () => {
      const params = JSON.stringify({
        terminals: [
          '0x52869db3d61dde1e391967f2ce5039ad0ecd371c',
          '0x2db6d704058e552defe415753465df8df0361846'
        ]
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/2 items/)).toBeInTheDocument()
    })

    it('shows empty for empty arrays', () => {
      const params = JSON.stringify({
        hooks: []
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText('empty')).toBeInTheDocument()
    })
  })

  describe('theme support', () => {
    it('applies dark theme styles', () => {
      useThemeStore.setState({ theme: 'dark' })
      render(<TransactionPreview {...defaultProps} />)

      const container = screen.getByText('Summary').closest('div[class*="bg-"]')
      // The parent container should have dark styles
      expect(container?.className).toContain('border-white/10')
    })

    it('applies light theme styles', () => {
      useThemeStore.setState({ theme: 'light' })
      render(<TransactionPreview {...defaultProps} />)

      const container = screen.getByText('Summary').closest('div[class*="bg-"]')
      expect(container?.className).toContain('border-gray-200')
    })
  })

  describe('clipboard functionality', () => {
    beforeEach(() => {
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    })

    it('copies address value when clicked', async () => {
      const params = JSON.stringify({
        recipient: '0x1234567890abcdef1234567890abcdef12345678'
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)

      const valueElement = screen.getByText(/0x1234567890abcdef/)
      fireEvent.click(valueElement)

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        '0x1234567890abcdef1234567890abcdef12345678'
      )
    })
  })

  describe('IPFS URI handling', () => {
    it('displays full IPFS URI', () => {
      const params = JSON.stringify({
        projectUri: 'ipfs://QmXyz123abc456def789'
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText('ipfs://QmXyz123abc456def789')).toBeInTheDocument()
    })
  })

  describe('parameter name formatting', () => {
    it('converts camelCase to readable format', () => {
      const params = JSON.stringify({
        minReturnedTokens: 0
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText('Min Returned Tokens')).toBeInTheDocument()
    })
  })

  describe('currency formatting', () => {
    it('formats known currency code 61166 as ETH', () => {
      const params = JSON.stringify({
        currency: 61166
      })
      render(<TransactionPreview {...defaultProps} parameters={params} />)
      expect(screen.getByText(/61,166 \(ETH\)/)).toBeInTheDocument()
    })
  })

  describe('chain-specific tokens', () => {
    it('shows USDC for Optimism USDC address on Optimism', () => {
      const params = JSON.stringify({
        token: '0x0b2c639c533813f4aa9d7837caf62653d097ff85'
      })
      render(<TransactionPreview {...defaultProps} parameters={params} chainId="10" />)
      expect(screen.getByText(/USDC/i)).toBeInTheDocument()
    })

    it('shows USDC for Base USDC address on Base', () => {
      const params = JSON.stringify({
        token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
      })
      render(<TransactionPreview {...defaultProps} parameters={params} chainId="8453" />)
      expect(screen.getByText(/USDC/i)).toBeInTheDocument()
    })

    it('shows USDC for Arbitrum USDC address on Arbitrum', () => {
      const params = JSON.stringify({
        token: '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
      })
      render(<TransactionPreview {...defaultProps} parameters={params} chainId="42161" />)
      expect(screen.getByText(/USDC/i)).toBeInTheDocument()
    })
  })
})
