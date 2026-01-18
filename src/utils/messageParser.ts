export interface ParsedComponent {
  type: string
  props: Record<string, string>
  raw: string
}

export interface ParsedContent {
  segments: Array<{ type: 'text'; content: string } | { type: 'component'; component: ParsedComponent }>
}

const COMPONENT_REGEX = /<juice-component\s+([^>]+)\s*\/>/g
// Match both double-quoted and single-quoted attributes
const ATTR_REGEX_DOUBLE = /(\w+)="([^"]+)"/g
const ATTR_REGEX_SINGLE = /(\w+)='([^']+)'/g
// Detect partial component tag that's still being streamed
const PARTIAL_COMPONENT_REGEX = /<juice-component(?:\s+[^>]*)?$/

export function parseMessageContent(content: string): ParsedContent {
  const segments: ParsedContent['segments'] = []
  let lastIndex = 0

  // Check if there's a partial component tag at the end (still streaming)
  const partialMatch = content.match(PARTIAL_COMPONENT_REGEX)
  const contentToProcess = partialMatch
    ? content.slice(0, partialMatch.index)
    : content
  const hasPartialComponent = !!partialMatch

  const matches = contentToProcess.matchAll(COMPONENT_REGEX)

  for (const match of matches) {
    // Add text before this component
    if (match.index! > lastIndex) {
      const textContent = contentToProcess.slice(lastIndex, match.index)
      if (textContent.trim()) {
        segments.push({ type: 'text', content: textContent })
      }
    }

    // Parse component attributes (both single and double quoted)
    const attrsString = match[1]
    const props: Record<string, string> = {}

    // Match double-quoted attributes
    const doubleMatches = attrsString.matchAll(ATTR_REGEX_DOUBLE)
    for (const attrMatch of doubleMatches) {
      props[attrMatch[1]] = attrMatch[2]
    }
    // Match single-quoted attributes (used for JSON)
    const singleMatches = attrsString.matchAll(ATTR_REGEX_SINGLE)
    for (const attrMatch of singleMatches) {
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

  // Add remaining text (before partial component if any)
  if (lastIndex < contentToProcess.length) {
    const textContent = contentToProcess.slice(lastIndex)
    if (textContent.trim()) {
      segments.push({ type: 'text', content: textContent })
    }
  }

  // If there's a partial component being streamed, show loading placeholder
  if (hasPartialComponent) {
    segments.push({
      type: 'component',
      component: {
        type: '_loading',
        props: {},
        raw: partialMatch![0],
      },
    })
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

    // Match double-quoted attributes
    const doubleMatches = attrsString.matchAll(ATTR_REGEX_DOUBLE)
    for (const attrMatch of doubleMatches) {
      props[attrMatch[1]] = attrMatch[2]
    }
    // Match single-quoted attributes (used for JSON)
    const singleMatches = attrsString.matchAll(ATTR_REGEX_SINGLE)
    for (const attrMatch of singleMatches) {
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
