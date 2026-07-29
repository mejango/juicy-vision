import type { CSSProperties } from 'react'
import { CHAIN_LOGOS } from '../../constants'

interface ChainLogoProps {
  chainId: number
  /** Rendered width in px; height follows the mark's aspect ratio. */
  size?: number
  className?: string
  style?: CSSProperties
}

/**
 * The chain's brand mark, shown beside its name. Testnet names differ by one
 * word ("Base Sepolia" vs "Optimism Sepolia") and chain choice moves money, so
 * the mark is the fast disambiguator — it never replaces the visible name.
 *
 * That visible name is what assistive tech reads, so the mark itself is
 * decorative: naming it too would announce the chain twice.
 */
export default function ChainLogo({ chainId, size = 20, className, style }: ChainLogoProps) {
  const src = CHAIN_LOGOS[chainId]
  if (!src) return null

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: 'auto',
        minWidth: size,
        flexShrink: 0,
        ...style,
      }}
    />
  )
}
