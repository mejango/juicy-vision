type MediaKind = 'image' | 'video' | 'audio' | 'link'

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', json: 'application/json',
}

/**
 * Resolve an uploaded file's MIME type. `File.type` is empty on some browsers/OSes for ordinary
 * audio/video files; fall back to the filename extension so a raw IPFS CID (which carries no
 * filename) still renders with the right player in the storefront.
 */
export function mediaTypeForFile(file: { type?: string; name?: string } | null | undefined): string {
  const explicit = String(file?.type || '').trim().toLowerCase().split(';')[0]
  if (explicit && explicit !== 'application/octet-stream' && explicit !== 'binary/octet-stream') return explicit
  const name = String(file?.name || '').toLowerCase()
  const match = /\.([a-z0-9]+)$/.exec(name)
  return match ? (MEDIA_TYPE_BY_EXTENSION[match[1]] || '') : ''
}

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
