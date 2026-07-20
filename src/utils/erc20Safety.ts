import type { Hex } from 'viem'

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`

/** Keep on-chain token labels display-safe: printable ASCII only, capped length. */
export function sanitizeTokenLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const printable = [...value]
    .filter(char => {
      const code = char.codePointAt(0) ?? 0
      return code >= 0x20 && code <= 0x7e
    })
    .join('')
    .trim()
  if (printable.length === 0) return null
  return printable.slice(0, 16)
}

export function assertSafeErc20TokenMetadata(name: string, symbol: string): void {
  if (name !== name.trim() || name.length === 0 || new TextEncoder().encode(name).length > 64) {
    throw new Error('Token name must be 1-64 bytes with no surrounding whitespace')
  }
  if (symbol !== symbol.trim() || !/^[A-Za-z0-9]{2,10}$/.test(symbol)) {
    throw new Error('Token symbol must be 2-10 letters or numbers')
  }
}

export function requireNonzeroBytes32(value: string, field: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new Error(`${field} must be a non-zero bytes32 value`)
  }
  return value as Hex
}
