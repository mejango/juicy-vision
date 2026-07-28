import { beforeEach, describe, expect, it } from 'vitest'
import { useViewAsStore, VIEW_AS_WRITE_REFUSAL } from './viewAsStore'

const ADDRESS = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'

describe('viewAsStore', () => {
  beforeEach(() => {
    useViewAsStore.setState({ viewAs: null })
    localStorage.removeItem('juicy-view-as-v1')
  })

  it('starts with view-as mode off', () => {
    expect(useViewAsStore.getState().viewAs).toBeNull()
  })

  it('setViewAs activates the mode and can switch targets', () => {
    useViewAsStore.getState().setViewAs(ADDRESS)
    expect(useViewAsStore.getState().viewAs).toBe(ADDRESS)

    useViewAsStore.getState().setViewAs(OTHER)
    expect(useViewAsStore.getState().viewAs).toBe(OTHER)
  })

  it('clearViewAs deactivates the mode', () => {
    useViewAsStore.getState().setViewAs(ADDRESS)
    useViewAsStore.getState().clearViewAs()
    expect(useViewAsStore.getState().viewAs).toBeNull()
  })

  it('persists the viewed address under the juicy-view-as-v1 key', () => {
    useViewAsStore.getState().setViewAs(ADDRESS)
    const raw = localStorage.getItem('juicy-view-as-v1')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).state.viewAs).toBe(ADDRESS)

    useViewAsStore.getState().clearViewAs()
    expect(JSON.parse(localStorage.getItem('juicy-view-as-v1')!).state.viewAs).toBeNull()
  })

  it('exposes the write-refusal copy used by the review seams', () => {
    expect(VIEW_AS_WRITE_REFUSAL).toBe(
      "You're viewing the site as another account — exit View as to transact."
    )
  })
})
