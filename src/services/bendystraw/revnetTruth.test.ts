import { describe, expect, it } from 'vitest'
import { REV_OWNER } from '../../constants'
import { isRevnetProject } from './client'

describe('Revnet classification', () => {
  it('ignores a stale positive indexer flag when the live owner is not REVOwner', () => {
    expect(isRevnetProject({
      isRevnet: true,
      owner: '0x9999999999999999999999999999999999999999',
    })).toBe(false)
  })

  it('uses live REVOwner ownership even when the indexer flag is stale', () => {
    expect(isRevnetProject({ isRevnet: false, owner: REV_OWNER })).toBe(true)
  })
})
