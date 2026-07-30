import { describe, expect, it } from 'vitest'
import { deterministicShuffle } from './deterministicShuffle'

describe('deterministicShuffle', () => {
  const values = ['one', 'two', 'three', 'four', 'five', 'six']

  it('produces a stable order without mutating its input', () => {
    const original = [...values]

    expect(deterministicShuffle(values)).toEqual([
      'three',
      'two',
      'six',
      'one',
      'four',
      'five',
    ])
    expect(deterministicShuffle(values)).toEqual(deterministicShuffle(values))
    expect(values).toEqual(original)
  })

  it('retains every value exactly once and permits an alternate seed', () => {
    const shuffled = deterministicShuffle(values, 1)

    expect(shuffled).not.toEqual(deterministicShuffle(values))
    expect([...shuffled].sort()).toEqual([...values].sort())
  })
})
