import { CHAIN_LOGOS } from '../constants'

// Re-export everything from testing-library
export * from '@testing-library/react'

// Chain marks are decorative — the chain name beside them is what assistive tech
// reads — so they carry no accessible name and can't be found by role. Tests look
// them up by brand asset instead (project logos are IPFS URLs, never /assets/img/logo).
export function chainMarks(scope: HTMLElement = document.body): HTMLImageElement[] {
  return Array.from(scope.querySelectorAll<HTMLImageElement>('img[src^="/assets/img/logo/"]'))
}

export function chainMarksFor(
  chainId: number,
  scope: HTMLElement = document.body,
): HTMLImageElement[] {
  const src = CHAIN_LOGOS[chainId]
  if (!src) return []
  return Array.from(scope.querySelectorAll<HTMLImageElement>(`img[src="${src}"]`))
}
