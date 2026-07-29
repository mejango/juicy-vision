import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'src/components/project/backoffice/SafeQueueCards.tsx'),
  'utf8',
)

describe('SafeQueueCards wallet boundary', () => {
  it('verifies and reviews the reconstructed Safe hash before requesting a signature', () => {
    const hashCheck = source.indexOf("serviceHash.toLowerCase() !== digest.toLowerCase()")
    const review = source.indexOf('await requireTransactionReview')
    const signature = source.indexOf('await wallet.signTypedData')

    expect(hashCheck).toBeGreaterThan(-1)
    expect(review).toBeGreaterThan(hashCheck)
    expect(signature).toBeGreaterThan(review)
  })

  it('executes through the guarded transaction boundary and avoids nested Safe proposals', () => {
    expect(source).toContain('const { run, isSafeMode } = useGuardedTx()')
    expect(source).toContain('disabled={busy !== null || !current || isSafeMode}')
    expect(source).toContain('await run({')
  })
})
