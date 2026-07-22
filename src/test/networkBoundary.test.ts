import { describe, expect, it, vi } from 'vitest'

async function expectFailClosedNetwork(): Promise<void> {
  expect(vi.isMockFunction(fetch)).toBe(true)
  const response = await fetch('https://external.invalid/unit-test')
  expect(response.status).toBe(503)
  await expect(response.json()).resolves.toEqual({
    error: 'External fetch blocked in tests: https://external.invalid/unit-test',
  })
  expect(() => new XMLHttpRequest()).toThrow('Unexpected XMLHttpRequest connection')
  expect(() => new WebSocket('wss://external.invalid/socket')).toThrow('Unexpected WebSocket connection')
  expect(() => new EventSource('https://external.invalid/events')).toThrow('Unexpected EventSource connection')
}

describe.sequential('unit-test network boundary', () => {
  it('fails closed for every browser network transport by default', async () => {
    await expectFailClosedNetwork()
  })

  it('allows a suite to remove its explicit global stubs during cleanup', () => {
    vi.unstubAllGlobals()
  })

  it('reinstalls every fail-closed transport before the following test', async () => {
    await expectFailClosedNetwork()
  })
})
