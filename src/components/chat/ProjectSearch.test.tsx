import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSearch from './ProjectSearch'

const ADDRESS = '0x1111111111111111111111111111111111111111'
const RESOLVED = '0x2222222222222222222222222222222222222222'

const { navigateMock, fetchProjects, resolveEnsToAddress } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  fetchProjects: vi.fn(),
  resolveEnsToAddress: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback || _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('../../stores', () => ({
  useThemeStore: () => ({ theme: 'dark' }),
}))

// Pin the slug map so tests don't depend on the environment's network mode.
vi.mock('../../constants', () => ({
  CHAINS: {
    1: { slug: 'eth' },
    10: { slug: 'op' },
    8453: { slug: 'base' },
  },
  MAINNET_CHAINS: {
    1: { slug: 'eth' },
    10: { slug: 'op' },
    8453: { slug: 'base' },
  },
  TESTNET_CHAINS: {},
}))

vi.mock('../../services/bendystraw', () => ({
  fetchProjects: (options: unknown) => fetchProjects(options),
}))

vi.mock('../../utils/ens', () => ({
  resolveEnsToAddress: (name: string) => resolveEnsToAddress(name),
  truncateAddress: (address: string) =>
    address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '',
}))

function typeQuery(value: string) {
  const input = screen.getByRole('combobox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
  return input
}

describe('ProjectSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchProjects.mockResolvedValue([
      { projectId: 3, chainId: 1, version: 6, name: 'Juicebox', volume: '0' },
      { projectId: 3, chainId: 10, version: 6, name: 'Juicebox', volume: '0' },
      { projectId: 53, chainId: 8453, version: 6, name: 'Revnet', volume: '0' },
      { projectId: 9, chainId: 1, version: 5, name: 'Juicy legacy', volume: '0' },
    ])
    resolveEnsToAddress.mockResolvedValue(null)
  })

  it('shows matching V6 project results for plain text and navigates to the project page', async () => {
    render(<ProjectSearch />)
    typeQuery('juice')

    await waitFor(() => expect(screen.getByText('Juicebox')).toBeTruthy())
    // V5 rows are excluded, non-matching names are filtered out
    expect(screen.queryByText('Juicy legacy')).toBeNull()
    expect(screen.queryByText('Revnet')).toBeNull()
    expect(screen.queryByText('View account')).toBeNull()
    // Chains are grouped into one row
    expect(screen.getByText('#3 | 2 chains')).toBeTruthy()

    fireEvent.click(screen.getByText('Juicebox'))
    expect(navigateMock).toHaveBeenCalledWith('/eth:3')
  })

  it('shows an account row first for a valid 0x address and Enter prefers it', async () => {
    render(<ProjectSearch />)
    const input = typeQuery(ADDRESS)

    await waitFor(() => expect(screen.getByText('View account')).toBeTruthy())
    expect(screen.getByText('0x1111...1111')).toBeTruthy()
    const options = screen.getAllByRole('option')
    expect(options[0].textContent).toContain('View account')
    // Addresses are not sent through ENS resolution
    expect(resolveEnsToAddress).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigateMock).toHaveBeenCalledWith(`/account/${ADDRESS}`)
  })

  it('debounce-resolves ENS names and navigates with the name so the route forward-resolves', async () => {
    resolveEnsToAddress.mockResolvedValue(RESOLVED)
    render(<ProjectSearch />)
    typeQuery('jango.eth')

    await waitFor(() => expect(screen.getByText('jango.eth')).toBeTruthy())
    expect(resolveEnsToAddress).toHaveBeenCalledWith('jango.eth')
    expect(screen.getByText('0x2222...2222')).toBeTruthy()

    fireEvent.click(screen.getByText('jango.eth'))
    expect(navigateMock).toHaveBeenCalledWith('/account/jango.eth')
  })

  it('shows no account row when ENS resolution fails', async () => {
    resolveEnsToAddress.mockResolvedValue(null)
    render(<ProjectSearch />)
    typeQuery('nobody.eth')

    await waitFor(() => expect(resolveEnsToAddress).toHaveBeenCalledWith('nobody.eth'))
    await waitFor(() => expect(screen.getByText('No matches')).toBeTruthy())
    expect(screen.queryByText('View account')).toBeNull()
  })

  it('supports keyboard navigation across results', async () => {
    render(<ProjectSearch />)
    const input = typeQuery('e')

    await waitFor(() => expect(screen.getByText('Revnet')).toBeTruthy())
    expect(screen.getByText('Juicebox')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigateMock).toHaveBeenCalledWith('/base:53')
  })
})
