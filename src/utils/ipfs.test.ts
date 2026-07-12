import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeEncodedIPFSUriCandidates,
  encodeIpfsUri,
  fetchIpfsJson,
  ipfsGatewayUrls,
} from './ipfs'

const DIGEST = '0xbdb815453bdd29f5af61a541e6382e7aace86076a9ba3ca3f6b3bdf7c58aa27f'
const CID_V0 = 'Qmb7EZvTHUeVTDi6YmwDFQvKEfCR4UGciUka24coJcNJzS'
const DAG_PB_CID_V1 = 'bafybeif5xakuko65fh226ynfihtdqlt2vtuga5vjxi6kh5vtxx34lcvcp4'
const RAW_CID_V1 = 'bafkreif5xakuko65fh226ynfihtdqlt2vtuga5vjxi6kh5vtxx34lcvcp4'

afterEach(() => vi.unstubAllGlobals())

describe('721-compatible IPFS encoding', () => {
  it('encodes CIDv0 and DAG-PB CIDv1 to the same stored digest', () => {
    expect(encodeIpfsUri(`ipfs://${CID_V0}`)).toBe(DIGEST)
    expect(encodeIpfsUri(`ipfs://${DAG_PB_CID_V1}`)).toBe(DIGEST)
  })

  it('rejects raw CIDv1 metadata before it can be stored onchain', () => {
    expect(() => encodeIpfsUri(`ipfs://${RAW_CID_V1}`)).toThrow(/raw CIDv1 metadata/i)
  })

  it('reconstructs canonical DAG-PB and legacy raw candidates from one digest', () => {
    expect(decodeEncodedIPFSUriCandidates(DIGEST)).toEqual([
      `ipfs://${CID_V0}`,
      `ipfs://${RAW_CID_V1}`,
    ])
  })
})

describe('IPFS gateway failover', () => {
  it('provides path gateways and a CIDv1 subdomain fallback', () => {
    const urls = ipfsGatewayUrls(`ipfs://${DAG_PB_CID_V1}/metadata.json`)
    expect(urls[0]).toBe(`https://gateway.pinata.cloud/ipfs/${DAG_PB_CID_V1}/metadata.json`)
    expect(urls).toContain(`https://${DAG_PB_CID_V1}.eth.sucks/metadata.json`)
    expect(urls).toContain(`https://dweb.link/ipfs/${DAG_PB_CID_V1}/metadata.json`)
    expect(urls).toContain(`https://ipfs.io/ipfs/${DAG_PB_CID_V1}/metadata.json`)
  })

  it('tries another gateway when the first one fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Recovered' }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchIpfsJson<{ name: string }>(`ipfs://${DAG_PB_CID_V1}`))
      .resolves.toEqual({ name: 'Recovered' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
