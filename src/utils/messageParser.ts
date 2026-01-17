export interface ParsedComponent {
  type: string
  props: Record<string, string>
  raw: string
}

export interface ParsedContent {
  segments: Array<{ type: 'text'; content: string } | { type: 'component'; component: ParsedComponent }>
}

const COMPONENT_REGEX = /<juice-component\s+([^>]+)\s*\/>/g
const ATTR_REGEX = /(\w+)="([^"]+)"/g

export function parseMessageContent(content: string): ParsedContent {
  const segments: ParsedContent['segments'] = []
  let lastIndex = 0

  const matches = content.matchAll(COMPONENT_REGEX)

  for (const match of matches) {
    // Add text before this component
    if (match.index! > lastIndex) {
      const textContent = content.slice(lastIndex, match.index)
      if (textContent.trim()) {
        segments.push({ type: 'text', content: textContent })
      }
    }

    // Parse component attributes
    const attrsString = match[1]
    const props: Record<string, string> = {}

    const attrMatches = attrsString.matchAll(ATTR_REGEX)
    for (const attrMatch of attrMatches) {
      props[attrMatch[1]] = attrMatch[2]
    }

    const componentType = props.type || 'unknown'
    delete props.type

    segments.push({
      type: 'component',
      component: {
        type: componentType,
        props,
        raw: match[0],
      },
    })

    lastIndex = match.index! + match[0].length
  }

  // Add remaining text
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex)
    if (textContent.trim()) {
      segments.push({ type: 'text', content: textContent })
    }
  }

  // If no components found, return single text segment
  if (segments.length === 0) {
    segments.push({ type: 'text', content })
  }

  return { segments }
}

export function stripComponents(content: string): string {
  return content.replace(COMPONENT_REGEX, '').trim()
}

export function extractComponents(content: string): ParsedComponent[] {
  const components: ParsedComponent[] = []
  const matches = content.matchAll(COMPONENT_REGEX)

  for (const match of matches) {
    const attrsString = match[1]
    const props: Record<string, string> = {}

    const attrMatches = attrsString.matchAll(ATTR_REGEX)
    for (const attrMatch of attrMatches) {
      props[attrMatch[1]] = attrMatch[2]
    }

    const componentType = props.type || 'unknown'
    delete props.type

    components.push({
      type: componentType,
      props,
      raw: match[0],
    })
  }

  return components
}
