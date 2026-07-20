import { describe, it, expect } from 'vitest'
import { collectErrorText, friendlyTransactionError } from './txErrors'

describe('friendlyTransactionError', () => {
  it('decodes the raw DeploymentFailed selector 0x30116425 into actionable guidance', () => {
    const error = new Error('execution reverted with reason: custom error 0x30116425')
    const message = friendlyTransactionError(error)
    expect(message).toContain('deployment failed')
    expect(message).toContain('[0x30116425]')
  })

  it('decodes JBPrices_PriceFeedNotFound nested under viem cause chains', () => {
    const error = {
      shortMessage: 'Execution reverted',
      cause: { data: '0x76d03816', message: 'reverted' },
    }
    const message = friendlyTransactionError(error)
    expect(message).toContain('no price feed')
    expect(message).toContain('[0x76d03816]')
  })

  it('decodes JB721TiersHookStore_PriceExceedsAmount by error name', () => {
    const error = { cause: { errorName: 'JB721TiersHookStore_PriceExceedsAmount' } }
    const message = friendlyTransactionError(error)
    expect(message).toContain('worth less than the selected shop items')
  })

  it('decodes JBMultiTerminal_UnderMin and AllowanceExpired selectors', () => {
    expect(friendlyTransactionError(new Error('0x6b2bb382'))).toContain('below the minimum')
    expect(friendlyTransactionError(new Error('0xd81b2f2e'))).toContain('authorization expired')
  })

  it('decodes JBTerminalStore_InadequateTerminalStoreBalance', () => {
    const message = friendlyTransactionError({ details: 'custom error 0x9fa59b9a:' })
    expect(message).toContain('terminal balance no longer covers')
  })

  it('returns null for unknown errors so raw messages pass through', () => {
    expect(friendlyTransactionError(new Error('something else went wrong'))).toBeNull()
    expect(friendlyTransactionError(null)).toBeNull()
    expect(friendlyTransactionError(undefined)).toBeNull()
  })

  it('retains the matched technical token for diagnostics', () => {
    const message = friendlyTransactionError({ message: 'DeploymentFailed()' })
    expect(message).toMatch(/\[deploymentfailed\]$/)
  })
})

describe('collectErrorText', () => {
  it('walks nested cause/data/error chains and stops on cycles', () => {
    const inner: Record<string, unknown> = { message: 'inner revert', data: '0x9fa59b9a' }
    inner.cause = inner
    const texts = collectErrorText({ shortMessage: 'outer', cause: inner })
    expect(texts).toContain('outer')
    expect(texts).toContain('inner revert')
    expect(texts).toContain('0x9fa59b9a')
  })
})
