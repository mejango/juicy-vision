import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { inferMediaKind } from '../../utils/ipfsMedia'
import { IpfsImage, IpfsMedia } from './IpfsMedia'

const CID = 'bafybeif5xakuko65fh226ynfihtdqlt2vtuga5vjxi6kh5vtxx34lcvcp4'

describe('IPFS media', () => {
  it('retries images through the configured gateways', () => {
    render(<IpfsImage uri={`ipfs://${CID}/cover.png`} alt="Cover" />)
    const image = screen.getByAltText('Cover')
    expect(image).toHaveAttribute('src', `https://gateway.pinata.cloud/ipfs/${CID}/cover.png`)

    fireEvent.error(image)
    expect(image).toHaveAttribute('src', `https://${CID}.eth.sucks/cover.png`)
  })

  it('retries video and audio sources and honors the stored media type', () => {
    const { rerender } = render(
      <IpfsMedia uri={`ipfs://${CID}/item`} mediaType="video/mp4" title="Video item" />,
    )
    const video = screen.getByTitle('Video item')
    expect(video.tagName).toBe('VIDEO')
    fireEvent.error(video)
    expect(video).toHaveAttribute('src', `https://${CID}.eth.sucks/item`)

    rerender(<IpfsMedia uri={`ipfs://${CID}/item`} mediaType="audio/mpeg" title="Audio item" />)
    expect(screen.getByTitle('Audio item').tagName).toBe('AUDIO')
  })

  it('does not embed unknown animation formats', () => {
    render(<IpfsMedia uri={`ipfs://${CID}/scene.glb`} mediaType="model/gltf-binary" title="Model" />)
    expect(screen.getByRole('link', { name: 'Open animation' })).toHaveAttribute(
      'href',
      `https://gateway.pinata.cloud/ipfs/${CID}/scene.glb`,
    )
    expect(inferMediaKind(undefined, 'https://example.com/track.ogg')).toBe('audio')
  })
})
