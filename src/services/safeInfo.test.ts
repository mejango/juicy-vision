import { describe, expect, it } from 'vitest'
import { formatSafePolicy } from './safeInfo'

describe('formatSafePolicy', () => {
  it('formats an M-of-N policy', () => {
    expect(formatSafePolicy(2, 3)).toBe('Requires 2 of 3 signatures')
    expect(formatSafePolicy(3, 5)).toBe('Requires 3 of 5 signatures')
  })

  it('singularizes a 1-of-1 policy', () => {
    expect(formatSafePolicy(1, 1)).toBe('Requires 1 of 1 signature')
  })

  it('keeps the plural for a 1-of-N policy', () => {
    expect(formatSafePolicy(1, 2)).toBe('Requires 1 of 2 signatures')
  })
})
