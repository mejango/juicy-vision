import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ResolvedNFTTier } from '../../services/nft'
import TierDetailModal from './TierDetailModal'

const tier: ResolvedNFTTier = {
  tierId: 7,
  name: 'Studio session',
  description: 'A recorded live session.',
  imageUri: 'https://example.com/poster.png',
  animationUrl: 'https://example.com/session.mp4',
  mediaType: 'video/mp4',
  price: 10n ** 16n,
  currency: 1,
  pricingDecimals: 18,
  initialSupply: 10,
  remainingSupply: 4,
  reservedRate: 0,
  votingUnits: 0n,
  category: 2,
  allowOwnerMint: false,
  transfersPausable: false,
}

describe('TierDetailModal', () => {
  it('renders stored descriptions, animation URLs, and media types', () => {
    render(
      <TierDetailModal
        isOpen
        onClose={() => undefined}
        tier={tier}
        imageUrl="https://example.com/poster.png"
      />,
    )

    expect(screen.getByText('Studio session')).toBeInTheDocument()
    expect(screen.getByText('A recorded live session.')).toBeInTheDocument()
    expect(screen.getByTitle('Studio session media').tagName).toBe('VIDEO')

    fireEvent.click(screen.getByRole('button', { name: /technical details/i }))
    expect(screen.getByText('video/mp4')).toBeInTheDocument()
  })
})
