import { describe, expect, it } from 'vitest'
import { gasWithHeadroom } from './transactionSafety'

describe('gasWithHeadroom', () => {
  it('sets an explicit 2x limit without rounding loss', () => {
    expect(gasWithHeadroom(1_119_186n)).toBe(2_238_372n)
  })
})
