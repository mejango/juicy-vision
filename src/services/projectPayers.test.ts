import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchProjectPayers, PROJECT_PAYERS_QUERY } from './projectPayers'
import { safeRequest } from './bendystraw/client'

vi.mock('./bendystraw/client', () => ({
  getNetworkOption: (chainId: number) => ({ network: chainId === 1 ? 'mainnet' : 'testnet' }),
  safeRequest: vi.fn(),
}))

const mockedRequest = vi.mocked(safeRequest)

function payer(chainId: number, projectId: number, address: string, totalFacilitatedUsd: string) {
  return {
    chainId,
    projectId,
    version: 6,
    address,
    defaultAddToBalance: false,
    defaultBeneficiary: address,
    paymentsCount: 1,
    addToBalanceCount: 0,
    totalFacilitated: '1',
    totalFacilitatedUsd,
    lastUsedAt: 1,
    createdAt: 1,
  }
}

describe('fetchProjectPayers', () => {
  beforeEach(() => mockedRequest.mockReset())

  it('queries each deployment with its own project id and validates returned identity', async () => {
    mockedRequest.mockImplementation(async (_query, variables) => {
      const chainId = Number(variables?.chainId)
      const projectId = Number(variables?.projectId)
      return {
        projectPayers: {
          totalCount: 1,
          items: [payer(chainId, projectId, `0x${String(chainId).padStart(40, '0')}`, String(chainId))],
        },
      }
    })

    const rows = await fetchProjectPayers([
      { chainId: 1, projectId: 6 },
      { chainId: 8453, projectId: 17 },
    ])

    expect(mockedRequest).toHaveBeenCalledTimes(2)
    expect(mockedRequest.mock.calls.map((call) => call[1])).toEqual(expect.arrayContaining([
      expect.objectContaining({ chainId: 1, projectId: 6, version: 6 }),
      expect.objectContaining({ chainId: 8453, projectId: 17, version: 6 }),
    ]))
    expect(rows.map((row) => [row.chainId, row.projectId])).toEqual([
      [8453, 17],
      [1, 6],
    ])
  })

  it('rejects a row for a different deployment', async () => {
    mockedRequest.mockResolvedValue({
      projectPayers: {
        totalCount: 1,
        items: [payer(1, 999, '0x0000000000000000000000000000000000000001', '1')],
      },
    })

    await expect(fetchProjectPayers([{ chainId: 1, projectId: 6 }])).rejects.toThrow(
      'wrong deployment',
    )
  })

  it('uses an exact scalar chain filter in the registered query', () => {
    expect(PROJECT_PAYERS_QUERY).toContain('chainId: $chainId')
    expect(PROJECT_PAYERS_QUERY).not.toContain('chainId_in')
  })
})
