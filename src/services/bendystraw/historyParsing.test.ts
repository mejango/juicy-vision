import { describe, expect, it } from 'vitest'
import { normalizeCashOutTaxSnapshot } from './client'

const GROUP = 'c5b6168ae62151cbc009c554a7a1fbe7'

describe('normalizeCashOutTaxSnapshot', () => {
  it('normalizes Bendystraw bigint time fields without changing the ruleset ID', () => {
    expect(normalizeCashOutTaxSnapshot({
      cashOutTax: 1000,
      start: '1782190518',
      duration: '7776000',
      rulesetId: '1781633652',
      suckerGroupId: GROUP,
    }, GROUP)).toEqual({
      cashOutTax: 1000,
      start: 1782190518,
      duration: 7776000,
      rulesetId: '1781633652',
      suckerGroupId: GROUP,
    })
  })

  it('rejects unsafe integers instead of rounding them', () => {
    expect(() => normalizeCashOutTaxSnapshot({
      cashOutTax: 1000,
      start: '9007199254740992',
      duration: '7776000',
      rulesetId: '1781633652',
      suckerGroupId: GROUP,
    }, GROUP)).toThrow('Cash-out tax history contains malformed data')
  })

  it('rejects a snapshot from a different sucker group', () => {
    expect(() => normalizeCashOutTaxSnapshot({
      cashOutTax: 1000,
      start: '1782190518',
      duration: '7776000',
      rulesetId: '1781633652',
      suckerGroupId: 'different',
    }, GROUP)).toThrow('Cash-out tax history contains malformed data')
  })
})
