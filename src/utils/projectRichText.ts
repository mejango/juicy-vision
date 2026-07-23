import DOMPurify from 'dompurify'

const PROJECT_RICH_TEXT_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'strong',
  'u',
  'ul',
] as const

const PROJECT_RICH_TEXT_ATTRIBUTES = ['href', 'title'] as const
const MAX_CONTENT_LENGTH = 50_000
const BARE_HTTP_URL = /https?:\/\/[^\s<>"')]+/g
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function isSafeLink(href: string): boolean {
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(href).protocol)
  } catch {
    return false
  }
}

function unwrap(element: Element): void {
  element.replaceWith(...element.childNodes)
}

function linkifyBareUrls(root: DocumentFragment): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.parentElement?.closest('a, code, pre') && BARE_HTTP_URL.test(node.data)) {
      nodes.push(node)
    }
    BARE_HTTP_URL.lastIndex = 0
  }

  for (const node of nodes) {
    const replacement = document.createDocumentFragment()
    let lastIndex = 0
    for (const match of node.data.matchAll(BARE_HTTP_URL)) {
      const index = match.index ?? 0
      replacement.append(node.data.slice(lastIndex, index))
      const anchor = document.createElement('a')
      anchor.href = match[0]
      anchor.textContent = match[0]
      replacement.append(anchor)
      lastIndex = index + match[0].length
    }
    replacement.append(node.data.slice(lastIndex))
    node.replaceWith(replacement)
  }
}

/**
 * Sanitize untrusted project-supplied HTML and apply link policy.
 *
 * The policy is shared by the V6 webclients: semantic formatting only, no
 * embedded content or active attributes, and only absolute HTTP(S)/mailto
 * links. Unsafe anchors are unwrapped so their labels remain readable.
 */
export function sanitizeProjectRichText(html: string): string {
  if (typeof window === 'undefined') return ''

  const fragment = DOMPurify.sanitize(html.slice(0, MAX_CONTENT_LENGTH), {
    ALLOWED_TAGS: [...PROJECT_RICH_TEXT_TAGS],
    ALLOWED_ATTR: [...PROJECT_RICH_TEXT_ATTRIBUTES],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/iu,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: [
      'audio',
      'button',
      'embed',
      'form',
      'iframe',
      'img',
      'input',
      'math',
      'object',
      'script',
      'style',
      'svg',
      'template',
      'video',
    ],
    RETURN_DOM_FRAGMENT: true,
    SANITIZE_DOM: true,
    SANITIZE_NAMED_PROPS: true,
  })

  linkifyBareUrls(fragment)
  for (const anchor of fragment.querySelectorAll('a')) {
    const href = anchor.getAttribute('href')?.trim()
    if (!href || !isSafeLink(href)) {
      unwrap(anchor)
      continue
    }

    anchor.setAttribute('href', href)
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  }

  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}
