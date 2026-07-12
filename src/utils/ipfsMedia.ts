export type MediaKind = 'image' | 'video' | 'audio' | 'link'

/** Classify media from declared metadata first, then from a URI extension. */
export function inferMediaKind(
  mediaType: string | null | undefined,
  uri: string | null | undefined,
): MediaKind {
  const normalizedType = mediaType?.trim().toLowerCase() ?? ''
  if (normalizedType.startsWith('image/')) return 'image'
  if (normalizedType.startsWith('video/')) return 'video'
  if (normalizedType.startsWith('audio/')) return 'audio'

  const path = uri?.split(/[?#]/, 1)[0].toLowerCase() ?? ''
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path) || path.startsWith('data:image/')) return 'image'
  if (/\.(mp4|webm|ogv|mov|m4v)$/.test(path) || path.startsWith('data:video/')) return 'video'
  if (/\.(mp3|wav|ogg|oga|m4a|flac)$/.test(path) || path.startsWith('data:audio/')) return 'audio'
  return 'link'
}
