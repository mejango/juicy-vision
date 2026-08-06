import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearProjectNavigationHints,
  getProjectNavigationHint,
  getProjectNavigationHintForPath,
  rememberProjectNavigation,
} from './projectNavigationCache'

describe('projectNavigationCache', () => {
  beforeEach(clearProjectNavigationHints)

  it('finds a seeded project from the router pathname', () => {
    rememberProjectNavigation({
      chainId: 8453,
      projectId: 7,
      name: ' Marquee ',
      logoUri: ' ipfs://logo ',
      tagline: ' Ready now ',
    })

    expect(getProjectNavigationHintForPath('/base:7')).toEqual({
      chainId: 8453,
      projectId: 7,
      name: 'Marquee',
      logoUri: 'ipfs://logo',
      tagline: 'Ready now',
    })
  })

  it('does not cache invalid identity', () => {
    rememberProjectNavigation({ chainId: 8453, projectId: 7, name: ' ' })
    expect(getProjectNavigationHint(8453, 7)).toBeNull()
  })
})
