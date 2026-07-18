import { describe, expect, it } from 'vitest'
import { mediaTypeForFile } from './ipfsMedia'

describe('mediaTypeForFile', () => {
  it('keeps an explicit File.type', () => {
    expect(mediaTypeForFile({ name: 'x.png', type: 'image/png' })).toBe('image/png')
  })

  it('infers the MIME from the extension when File.type is empty', () => {
    expect(mediaTypeForFile({ name: 'theme.MP3', type: '' })).toBe('audio/mpeg')
    expect(mediaTypeForFile({ name: 'trailer.webm', type: '' })).toBe('video/webm')
  })

  it('ignores the octet-stream placeholders browsers emit for unknown files', () => {
    expect(mediaTypeForFile({ name: 'field-recording.flac', type: 'application/octet-stream' })).toBe('audio/flac')
    expect(mediaTypeForFile({ name: 'clip.mov', type: 'binary/octet-stream' })).toBe('video/quicktime')
  })

  it('strips a codec/charset suffix from the declared type', () => {
    expect(mediaTypeForFile({ name: 'cover.png', type: 'image/custom; charset=binary' })).toBe('image/custom')
  })

  it('returns empty when neither the type nor the extension is recognized', () => {
    expect(mediaTypeForFile({ name: 'mystery', type: '' })).toBe('')
    expect(mediaTypeForFile({ name: 'file.xyz', type: 'application/octet-stream' })).toBe('')
    expect(mediaTypeForFile(null)).toBe('')
  })
})
