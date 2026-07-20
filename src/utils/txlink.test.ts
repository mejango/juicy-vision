import { describe, expect, it } from 'vitest'
import { buildTxLinkEntries, buildTxLinkUrl, parseTxLinkUrl, type TxLinkEntry } from './txlink'

const TERMINAL = '0x130f5DD2Bd8805443cF41755253d778a75A67F53' as const
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const

describe('txlink', () => {
  it('copied link opened by another person reproduces the same transaction (round-trip)', () => {
    const entry: TxLinkEntry = {
      chainId: 1,
      to: TERMINAL,
      data: '0xabcd1234',
      value: 0n,
    }
    expect(parseTxLinkUrl(buildTxLinkUrl(entry))).toEqual(entry)
  })

  it('round-trips a nonzero native value and large calldata exactly', () => {
    const entry: TxLinkEntry = {
      chainId: 8453,
      to: TERMINAL,
      data: `0x1d1a696e${'ab'.repeat(2048)}`,
      value: 123456789012345678901234567890n,
    }
    expect(parseTxLinkUrl(buildTxLinkUrl(entry))).toEqual(entry)
  })

  it('encodes params exactly once (one decodeURIComponent yields valid JSON)', () => {
    const url = buildTxLinkUrl({ chainId: 10, to: TERMINAL, data: '0x00', value: 5n })
    const raw = url.split('params=')[1]
    const decoded = JSON.parse(decodeURIComponent(raw))
    expect(decoded).toEqual({ to: TERMINAL, data: '0x00', value: '0x5' })
  })

  it('omits from so txlink fills it from the opener wallet', () => {
    const url = buildTxLinkUrl({ chainId: 1, to: TERMINAL, data: '0xabcd', value: 0n })
    expect(url).not.toContain('from')
    expect(url).toContain('method=eth_sendTransaction')
    expect(url).toContain('chainId=1')
  })

  it('emits the approval entry first, then the main call', () => {
    const entries = buildTxLinkEntries({
      chainId: 1,
      to: TERMINAL,
      data: '0xabcd',
      value: '0',
      approval: { token: TOKEN, data: '0x5678' },
    })
    expect(entries).toEqual([
      { chainId: 1, to: TOKEN, data: '0x5678', value: 0n },
      { chainId: 1, to: TERMINAL, data: '0xabcd', value: 0n },
    ])
  })

  it('emits a single entry when no approval is needed', () => {
    const entries = buildTxLinkEntries({ chainId: 1, to: TERMINAL, data: '0xabcd', value: 42n })
    expect(entries).toEqual([{ chainId: 1, to: TERMINAL, data: '0xabcd', value: 42n }])
  })

  it('returns [] for missing or invalid fields instead of emitting a wrong link', () => {
    const valid = { chainId: 1, to: TERMINAL, data: '0xabcd', value: 0n } as const
    expect(buildTxLinkEntries({ ...valid, chainId: undefined })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, chainId: 0 })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, chainId: 1.5 })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, to: undefined })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, to: '0x123' })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, data: undefined })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, data: '0xabc' })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, data: 'abcd' })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, value: undefined })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, value: -1n })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, value: 'not-a-number' })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, approval: { token: '0xbad', data: '0x5678' } })).toEqual([])
    expect(buildTxLinkEntries({ ...valid, approval: { token: TOKEN, data: undefined } })).toEqual([])
  })

  it('rejects foreign or malformed URLs when parsing', () => {
    expect(parseTxLinkUrl('not a url')).toBeNull()
    expect(parseTxLinkUrl('https://evil.example/?method=eth_sendTransaction&chainId=1&params=%7B%7D')).toBeNull()
    expect(parseTxLinkUrl('https://txlink.stupidtech.net/?method=eth_sign&chainId=1&params=%7B%7D')).toBeNull()
    expect(parseTxLinkUrl('https://txlink.stupidtech.net/?method=eth_sendTransaction&chainId=1&params=%7Bnope')).toBeNull()
    expect(parseTxLinkUrl('https://txlink.stupidtech.net/?method=eth_sendTransaction&chainId=1')).toBeNull()
  })
})
