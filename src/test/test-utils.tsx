import { ReactElement, ReactNode } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { CHAIN_LOGOS } from '../constants'

// Create a fresh query client for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })
}

interface WrapperProps {
  children: ReactNode
}

function AllProviders({ children }: WrapperProps) {
  const queryClient = createTestQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {children}
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllProviders, ...options })
}

// Re-export everything from testing-library
export * from '@testing-library/react'
export { customRender as render }

// Helper to reset Zustand stores between tests
export function resetZustandStores() {
  // Clear persisted state from localStorage
  localStorage.clear()
}

// Helper to wait for async state updates
export async function waitForStateUpdate() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

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
