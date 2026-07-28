import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDocumentTitle } from './useDocumentTitle'

describe('useDocumentTitle', () => {
  it('sets a suffixed title and restores the default on unmount', () => {
    const { rerender, unmount } = renderHook(({ title }: { title: string | null }) => useDocumentTitle(title), {
      initialProps: { title: 'My Project' as string | null },
    })
    expect(document.title).toBe('My Project | Juicy Vision')

    rerender({ title: null })
    expect(document.title).toBe('Juicy Vision')

    rerender({ title: 'Renamed' })
    expect(document.title).toBe('Renamed | Juicy Vision')

    unmount()
    expect(document.title).toBe('Juicy Vision')
  })
})
