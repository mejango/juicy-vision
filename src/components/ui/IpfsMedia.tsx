import { useEffect, useMemo, useState, type ImgHTMLAttributes, type ReactNode } from 'react'
import { ipfsGatewayUrls } from '../../utils/ipfs'
import { inferMediaKind } from '../../utils/ipfsMedia'

function gatewayCandidates(uri: string | null | undefined): string[] {
  const value = uri?.trim()
  if (!value) return []
  if (/^data:(image|audio|video)\//i.test(value) || /^blob:/i.test(value)) return [value]
  if (/^data:/i.test(value)) return []
  return ipfsGatewayUrls(value)
}

function useGatewayCandidate(uri: string | null | undefined, fallbackSrc?: string | null) {
  const candidates = useMemo(() => {
    const values = gatewayCandidates(uri)
    if (fallbackSrc?.trim()) values.push(fallbackSrc.trim())
    return [...new Set(values)]
  }, [fallbackSrc, uri])
  const [index, setIndex] = useState(0)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    setIndex(0)
    setUnavailable(false)
  }, [candidates])

  return {
    src: candidates[index] ?? null,
    tryNext: () => setIndex(current => Math.min(current + 1, candidates.length)),
    hasNext: index + 1 < candidates.length,
    unavailable,
    markUnavailable: () => setUnavailable(true),
  }
}

interface IpfsImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  uri: string | null | undefined
  fallbackSrc?: string | null
  fallback?: ReactNode
}

export function IpfsImage({ uri, fallbackSrc, fallback = null, onError, ...props }: IpfsImageProps) {
  const { src, tryNext, hasNext, unavailable, markUnavailable } = useGatewayCandidate(uri, fallbackSrc)
  if (!src || unavailable) return fallback

  return (
    <img
      {...props}
      src={src}
      onError={(event) => {
        if (hasNext) {
          tryNext()
          return
        }
        markUnavailable()
        onError?.(event)
      }}
    />
  )
}

interface IpfsMediaProps {
  uri: string | null | undefined
  mediaType?: string | null
  title: string
  className?: string
  poster?: string | null
  isDark?: boolean
}

export function IpfsMedia({
  uri,
  mediaType,
  title,
  className = '',
  poster,
  isDark = false,
}: IpfsMediaProps) {
  const { src, tryNext, hasNext, unavailable, markUnavailable } = useGatewayCandidate(uri)
  const kind = inferMediaKind(mediaType, uri)
  if (!src) return null

  if (unavailable) {
    return <span className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>Media unavailable</span>
  }

  const handleError = () => {
    if (hasNext) tryNext()
    else markUnavailable()
  }

  if (kind === 'image') {
    return <IpfsImage uri={uri} alt={title} className={className} />
  }
  if (kind === 'video') {
    return (
      <video
        src={src}
        title={title}
        className={className}
        controls
        playsInline
        preload="metadata"
        poster={poster ?? undefined}
        onError={handleError}
      />
    )
  }
  if (kind === 'audio') {
    return (
      <audio
        src={src}
        title={title}
        className={className}
        controls
        preload="metadata"
        onError={handleError}
      />
    )
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-sm underline underline-offset-2 ${isDark ? 'text-juice-cyan' : 'text-blue-700'} ${className}`}
    >
      Open animation
    </a>
  )
}
