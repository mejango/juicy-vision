import { describe, expect, it } from 'vitest'
import { downsampleTimeSeries } from './downsample'

describe('downsampleTimeSeries', () => {
  it('retains endpoints and a material spike in timestamp order', () => {
    const rows = Array.from({ length: 100 }, (_, timestamp) => ({
      timestamp,
      value: timestamp === 50 ? 10_000 : timestamp,
    }))
    const sampled = downsampleTimeSeries(rows, 12, row => row.timestamp, row => row.value)
    expect(sampled).toHaveLength(12)
    expect(sampled[0]).toBe(rows[0])
    expect(sampled[sampled.length - 1]).toBe(rows[rows.length - 1])
    expect(sampled).toContain(rows[50])
    expect(sampled.map(row => row.timestamp)).toEqual(
      [...sampled].map(row => row.timestamp).sort((a, b) => a - b),
    )
  })
})
