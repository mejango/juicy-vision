export interface ParsedComponent {
  type: string
  props: Record<string, string>
  raw: string
}

export interface ParsedContent {
  segments: Array<{ type: 'text'; content: string } | { type: 'component'; component: ParsedComponent }>
}

// Regex to match juice-component tags - uses non-greedy match to find closing />
// The 's' flag allows . to match newlines
const COMPONENT_REGEX = /<juice-component\s+([\s\S]+?)\s*\/>/g
// Match attributes - double quotes are straightforward
const ATTR_REGEX_DOUBLE = /(\w+)="([^"]+)"/g
// Single quotes need non-greedy match with lookahead for next attr or tag end
// This handles apostrophes inside values like "What's your..."
const ATTR_REGEX_SINGLE = /(\w+)='([\s\S]*?)'\s*(?=\w+=|\/?>|$)/g
// Detect partial component tag that's still being streamed
// Note: We can't use [^>]* because JSON attribute values may contain > characters
// Instead, we look for <juice-component that isn't followed by /> in the remaining string
function hasPartialComponentTag(content: string): { hasPartial: boolean; index: number } {
  // Find the last occurrence of <juice-component
  const lastTagStart = content.lastIndexOf('<juice-component')
  if (lastTagStart === -1) {
    return { hasPartial: false, index: -1 }
  }

  // Check if there's a closing /> after this tag start
  // We need to find /> that actually closes this tag, not one inside a quoted string
  const afterTag = content.slice(lastTagStart)

  // Simple check: if /> exists after <juice-component, tag is complete
  // This is a heuristic - technically /> could be in a string, but unlikely
  const closeIndex = afterTag.indexOf('/>')
  if (closeIndex === -1) {
    // No closing found - tag is partial
    return { hasPartial: true, index: lastTagStart }
  }

  return { hasPartial: false, index: -1 }
}

export function parseMessageContent(content: string): ParsedContent {
  const segments: ParsedContent['segments'] = []
  let lastIndex = 0

  // Check if there's a partial component tag at the end (still streaming)
  const partialCheck = hasPartialComponentTag(content)
  const contentToProcess = partialCheck.hasPartial
    ? content.slice(0, partialCheck.index)
    : content
  const hasPartialComponent = partialCheck.hasPartial

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
        raw: content.slice(partialCheck.index),
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
  // Replace components with descriptive placeholders for better exports
  return content.replace(COMPONENT_REGEX, (_match, attrsString) => {
    const props: Record<string, string> = {}

    // Match double-quoted attributes
    const doubleMatches = attrsString.matchAll(ATTR_REGEX_DOUBLE)
    for (const attrMatch of doubleMatches) {
      props[attrMatch[1]] = attrMatch[2]
    }
    // Match single-quoted attributes
    const singleMatches = attrsString.matchAll(ATTR_REGEX_SINGLE)
    for (const attrMatch of singleMatches) {
      props[attrMatch[1]] = attrMatch[2]
    }

    const componentType = props.type || 'unknown'

    // Generate descriptive placeholder based on component type
    switch (componentType) {
      case 'token-price-chart':
        return `[Chart: Token price over time]`
      case 'multi-chain-cash-out-chart':
        return `[Chart: Per-chain cash out values]`
      case 'project-card':
        return `[Project card with payment form]`
      case 'note-card':
        return `[Note card for leaving messages]`
      case 'project-chain-picker':
        return `[Project chain selection]`
      case 'options-picker':
        return `[Options picker]`
      case 'balance-chart':
        return `[Chart: Balance over time]`
      case 'holders-chart':
        return `[Chart: Token holder distribution]`
      case 'volume-chart':
        return `[Chart: Payment volume]`
      case 'activity-feed':
        return `[Activity feed]`
      case 'ruleset-schedule':
        return `[Ruleset schedule view]`
      case 'cash-out-form':
        return `[Cash out form]`
      case 'connect-account':
        return `[Connect wallet button]`
      case 'top-projects':
        return `[Top projects list]`
      case 'nft-gallery':
        return `[NFT gallery grid]`
      case 'nft-card':
        return `[NFT tier card]`
      case 'storefront':
        return `[NFT storefront marketplace]`
      case 'landing-page-preview':
        return `[Landing page preview]`
      case 'success-visualization':
        return `[Growth projection visualization]`
      default:
        return `[${componentType} component]`
    }
  }).trim()
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
