import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SetUriForm from './SetUriForm'
import { chainMarksFor } from '../../test/test-utils'

const mocks = vi.hoisted(() => ({
  fetchProject: vi.fn(),
  fetchCurrentProjectMetadataForEdit: vi.fn(),
  resolveProjectChains: vi.fn(),
  pinMetadata: vi.fn(),
  pinFileToBackend: vi.fn(),
  modalProps: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1234567890123456789012345678901234567890',
    isConnected: true,
  }),
}))

vi.mock('../../hooks', () => ({
  useManagedWallet: () => ({ address: null, isManagedMode: false }),
}))

vi.mock('../../services/bendystraw', () => ({
  fetchProject: mocks.fetchProject,
  fetchCurrentProjectMetadataForEdit: mocks.fetchCurrentProjectMetadataForEdit,
}))

vi.mock('../../utils/projectChains', () => ({
  resolveProjectChains: mocks.resolveProjectChains,
}))

vi.mock('../../services/ipfsPinning', () => ({
  pinMetadata: mocks.pinMetadata,
  pinFileToBackend: mocks.pinFileToBackend,
}))

vi.mock('../payment', () => ({
  SetUriModal: (props: { isOpen: boolean; newUri: string }) => {
    mocks.modalProps(props)
    return props.isOpen ? <div data-testid="set-uri-modal">{props.newUri}</div> : null
  },
}))

const CURRENT_METADATA = {
  name: 'Old Name',
  description: 'A football league',
  payDisclosure: 'No refunds.',
  leagueID: 42,
  tags: ['football', 'league'],
  stats: { season: 3, nested: { deep: true } },
}

function primeHappyPath(metadata: Record<string, unknown> = CURRENT_METADATA) {
  mocks.fetchProject.mockResolvedValue({
    projectId: 5,
    chainId: 1,
    name: (metadata.name as string) || 'Project #5',
    metadataUri: 'ipfs://QmCurrent',
  })
  mocks.resolveProjectChains.mockResolvedValue({
    mappingAvailable: true,
    chains: [{ chainId: 1, projectId: 5 }],
  })
  mocks.fetchCurrentProjectMetadataForEdit.mockResolvedValue({
    uri: 'ipfs://QmCurrent',
    metadata,
  })
  mocks.pinMetadata.mockResolvedValue('ipfs://QmNewPinned')
}

async function renderForm() {
  render(<SetUriForm projectId="5" chainId="1" />)
  await waitFor(() => expect(screen.getByTestId('seturi-name')).toBeInTheDocument())
}

describe('SetUriForm metadata round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves unknown keys and nested objects on a name-only edit', async () => {
    primeHappyPath()
    await renderForm()

    const nameInput = screen.getByTestId('seturi-name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'New Name')

    await userEvent.click(screen.getByRole('button', { name: /update metadata/i }))

    await waitFor(() => expect(mocks.pinMetadata).toHaveBeenCalledTimes(1))
    const pinned = mocks.pinMetadata.mock.calls[0][0] as Record<string, unknown>
    expect(pinned.name).toBe('New Name')
    expect(pinned.description).toBe('A football league')
    expect(pinned.payDisclosure).toBe('No refunds.')
    expect(pinned.leagueID).toBe(42)
    expect(pinned.tags).toEqual(['football', 'league'])
    expect(pinned.stats).toEqual({ season: 3, nested: { deep: true } })

    // The pinned URI (not a hand-pasted one) reaches the review modal.
    await waitFor(() => expect(screen.getByTestId('set-uri-modal')).toHaveTextContent('ipfs://QmNewPinned'))
  })

  it('blocks saving when the current metadata cannot be fetched', async () => {
    mocks.fetchProject.mockResolvedValue({ projectId: 5, chainId: 1, name: 'P' })
    mocks.resolveProjectChains.mockResolvedValue({
      mappingAvailable: true,
      chains: [{ chainId: 1, projectId: 5 }],
    })
    mocks.fetchCurrentProjectMetadataForEdit.mockRejectedValue(new Error('gateway down'))

    render(<SetUriForm projectId="5" chainId="1" />)

    await waitFor(() =>
      expect(screen.getByText(/current project metadata could not be loaded/i)).toBeInTheDocument()
    )
    expect(screen.queryByTestId('seturi-name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /update metadata/i })).not.toBeInTheDocument()
    expect(mocks.pinMetadata).not.toHaveBeenCalled()
  })

  it('edits the payment notice and clears its key when emptied', async () => {
    primeHappyPath()
    await renderForm()

    const notice = screen.getByTestId('seturi-pay-disclosure')
    expect(notice).toHaveValue('No refunds.')
    await userEvent.clear(notice)

    await userEvent.click(screen.getByRole('button', { name: /update metadata/i }))

    await waitFor(() => expect(mocks.pinMetadata).toHaveBeenCalledTimes(1))
    const pinned = mocks.pinMetadata.mock.calls[0][0] as Record<string, unknown>
    expect('payDisclosure' in pinned).toBe(false)
    expect(pinned.leagueID).toBe(42)
  })

  it('prefills the Advanced JSON with the unmanaged keys, pretty-printed', async () => {
    primeHappyPath()
    await renderForm()

    const textarea = screen.getByTestId('seturi-custom-json') as HTMLTextAreaElement
    expect(JSON.parse(textarea.value)).toEqual({
      leagueID: 42,
      stats: { season: 3, nested: { deep: true } },
    })
    // Pretty-printed (multi-line), not a single-line dump.
    expect(textarea.value).toContain('\n')
  })

  it('applies Advanced JSON edits: update, add, and delete custom keys', async () => {
    primeHappyPath()
    await renderForm()

    const textarea = screen.getByTestId('seturi-custom-json')
    await userEvent.clear(textarea)
    // paste avoids userEvent.type treating { and [ as key descriptors
    await userEvent.click(textarea)
    await userEvent.paste('{"leagueID": 43, "newKey": "hello"}')

    await userEvent.click(screen.getByRole('button', { name: /update metadata/i }))

    await waitFor(() => expect(mocks.pinMetadata).toHaveBeenCalledTimes(1))
    const pinned = mocks.pinMetadata.mock.calls[0][0] as Record<string, unknown>
    expect(pinned.leagueID).toBe(43)
    expect(pinned.newKey).toBe('hello')
    expect('stats' in pinned).toBe(false)
    // Managed fields untouched.
    expect(pinned.name).toBe('Old Name')
    expect(pinned.tags).toEqual(['football', 'league'])
  })

  it('blocks saving on invalid Advanced JSON', async () => {
    primeHappyPath()
    await renderForm()

    const textarea = screen.getByTestId('seturi-custom-json')
    await userEvent.clear(textarea)
    await userEvent.click(textarea)
    await userEvent.paste('{not json')

    expect(screen.getByTestId('seturi-custom-json-error')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /update metadata/i })
    expect(submit).toBeDisabled()
    await userEvent.click(submit)
    expect(mocks.pinMetadata).not.toHaveBeenCalled()
  })

  it('resolves managed-key collisions in the form fields\' favor', async () => {
    primeHappyPath()
    await renderForm()

    const textarea = screen.getByTestId('seturi-custom-json')
    await userEvent.clear(textarea)
    await userEvent.click(textarea)
    await userEvent.paste('{"leagueID": 42, "name": "JSON Name", "tags": ["json-tag"]}')

    const nameInput = screen.getByTestId('seturi-name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Form Name')

    await userEvent.click(screen.getByRole('button', { name: /update metadata/i }))

    await waitFor(() => expect(mocks.pinMetadata).toHaveBeenCalledTimes(1))
    const pinned = mocks.pinMetadata.mock.calls[0][0] as Record<string, unknown>
    expect(pinned.name).toBe('Form Name')
    expect(pinned.tags).toEqual(['football', 'league'])
    expect(pinned.leagueID).toBe(42)
  })

  it('shows each chain’s logo beside its name in the chain selector', async () => {
    primeHappyPath()
    mocks.resolveProjectChains.mockResolvedValue({
      mappingAvailable: true,
      chains: [
        { chainId: 1, projectId: 5 },
        { chainId: 10, projectId: 9 },
      ],
    })
    await renderForm()

    expect(chainMarksFor(1)).not.toHaveLength(0)
    expect(chainMarksFor(10)).not.toHaveLength(0)
  })

  it('disables submission until something changes', async () => {
    primeHappyPath()
    await renderForm()

    const submit = screen.getByRole('button', { name: /update metadata/i })
    expect(submit).toBeDisabled()

    const nameInput = screen.getByTestId('seturi-name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Different')
    expect(submit).toBeEnabled()
  })
})
