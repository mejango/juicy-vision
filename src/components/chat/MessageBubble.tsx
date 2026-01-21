import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Message } from '../../stores'
import { useThemeStore } from '../../stores'
import { parseMessageContent } from '../../utils/messageParser'
import ComponentRegistry from '../dynamic/ComponentRegistry'
import ThinkingIndicator from './ThinkingIndicator'

interface MessageBubbleProps {
  message: Message
  isLastAssistant?: boolean
}

// Check if response appears to be cut off or incomplete
function looksIncomplete(content: string): boolean {
  if (!content || content.length < 30) return false

  const trimmed = content.trim()
  if (!trimmed) return false

  // Ends with incomplete code block
  const codeBlockCount = (trimmed.match(/```/g) || []).length
  if (codeBlockCount % 2 !== 0) return true

  // Ends mid-word or with hanging punctuation
  if (/[a-zA-Z]{2,}$/.test(trimmed) && !/[.!?:;)\]}"']$/.test(trimmed)) {
    // Ends with letters but no punctuation - likely cut off
    const lastLine = trimmed.split('\n').pop() || ''
    // Unless it's a heading, list item, or component
    if (!lastLine.startsWith('#') && !lastLine.startsWith('-') && !lastLine.startsWith('*') && !lastLine.includes('juice-component')) {
      return true
    }
  }

  // Ends with ellipsis that isn't intentional
  if (trimmed.endsWith('...') || trimmed.endsWith('…')) {
    return true
  }

  // Ends with colon suggesting more content should follow
  if (trimmed.endsWith(':')) {
    return true
  }

  // Check if response promises action but doesn't deliver
  // Only trigger if NO component exists in the entire response
  const hasComponent = trimmed.includes('juice-component')

  // If there's already a component, the response is likely complete
  if (hasComponent) {
    return false
  }

  // Check for conversational responses that should have follow-ups
  const lower = trimmed.toLowerCase()
  const lastSentence = lower.slice(-200)

  // Phrases that indicate the assistant should continue with more content
  const promisePhrases = [
    'let me understand',
    'let me show',
    'let me design',
    'let me suggest',
    'let me ask',
    'let me help',
    'let me explain',
    'let me break',
    'let me walk',
    'here\'s what',
    'here are the',
    'i\'ll need to',
    'first, i need',
    'to help you',
  ]

  for (const phrase of promisePhrases) {
    if (lastSentence.includes(phrase)) {
      return true
    }
  }

  // Short response without a question or action item is likely incomplete
  // (unless it's a simple acknowledgment)
  if (trimmed.length < 200 && !trimmed.includes('?') && !hasComponent) {
    // Check if it ends with a promise-like statement
    if (lastSentence.includes('approach') ||
        lastSentence.includes('understand') ||
        lastSentence.includes('help you') ||
        lastSentence.includes('work with')) {
      return true
    }
  }

  // Response ends with period but doesn't ask a question or provide options
  // and is relatively short - likely incomplete
  if (trimmed.endsWith('.') && trimmed.length < 300 && !trimmed.includes('?')) {
    // Check for "setup" sentences that imply more to come
    const endsWithSetup = /\b(approach|understand|process|look at|examine|review|consider|design|plan|strategy)\s*\.\s*$/i.test(trimmed)
    if (endsWithSetup) {
      return true
    }
  }

  return false
}

export default function MessageBubble({ message, isLastAssistant }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const parsed = parseMessageContent(message.content)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  // Continue button disabled - AI responses with components are complete
  // The looksIncomplete heuristic was too aggressive and caused sporadic button appearances
  const showContinue = false

  const handleContinue = () => {
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message: 'Please continue where you left off.' }
    }))
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {isUser ? (
        /* User message: text right-aligned with arrow in right margin */
        <div className={`max-w-[85%] md:max-w-[75%] text-right ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {/* Sender name for multi-chat - above the message row */}
          {message.senderName && (
            <p className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {message.senderName}
            </p>
          )}
          {/* Message content + lightning bolt row */}
          <div className="flex items-start gap-3">
            {/* Text content */}
            <div>
              {/* Display attachments */}
              {message.attachments && message.attachments.length > 0 && (
                <div className="flex gap-2 mb-2 justify-end flex-wrap">
                  {message.attachments.map(attachment => (
                    <img
                      key={attachment.id}
                      src={`data:${attachment.mimeType};base64,${attachment.data}`}
                      alt={attachment.name}
                      className="max-w-[200px] max-h-[200px] object-contain rounded border-2 border-juice-cyan cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => {
                        // Open image in new tab for full view (using DOM methods to avoid XSS)
                        const win = window.open()
                        if (win) {
                          const img = win.document.createElement('img')
                          img.src = `data:${attachment.mimeType};base64,${attachment.data}`
                          img.alt = attachment.name
                          img.style.maxWidth = '100%'
                          img.style.height = 'auto'
                          win.document.body.appendChild(img)
                        }
                      }}
                    />
                  ))}
                </div>
              )}
              {parsed.segments.map((segment, index) => {
                if (segment.type === 'text') {
                  return (
                    <p key={index} className="whitespace-pre-wrap">{segment.content}</p>
                  )
                } else {
                  return (
                    <div key={index} className="my-3">
                      <ComponentRegistry component={segment.component} />
                    </div>
                  )
                }
              })}
            </div>
            {/* Lightning bolt - aligned with message text top */}
            <div className="shrink-0 pt-0.5">
              <svg
                className="w-5 h-5 text-juice-orange"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
        </div>
      ) : (
        /* Assistant message */
        <div className={`w-full bg-transparent px-4 py-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {parsed.segments.map((segment, index) => {
            if (segment.type === 'text') {
              return (
                <div key={index} className="prose-juice">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '')
                        const inline = !match
                        return !inline && match ? (
                          <SyntaxHighlighter
                            style={oneDark}
                            language={match[1]}
                            PreTag="div"
                            customStyle={{
                              margin: 0,
                              borderRadius: 0,
                              fontSize: '0.875rem',
                            }}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        )
                      },
                    }}
                  >
                    {segment.content}
                  </ReactMarkdown>
                </div>
              )
            } else {
              return (
                <div key={index} className="my-3">
                  <ComponentRegistry component={segment.component} />
                </div>
              )
            }
          })}

          {/* Streaming indicator with juice-themed verbs */}
          {message.isStreaming && (
            <ThinkingIndicator />
          )}

          {/* Continue button for cut-off responses */}
          {showContinue && (
            <button
              onClick={handleContinue}
              className={`mt-4 px-4 py-2 text-sm transition-colors ${
                isDark
                  ? 'text-juice-orange/80 border border-juice-orange/30 hover:text-juice-orange hover:border-juice-orange/50 hover:bg-juice-orange/5'
                  : 'text-juice-orange border border-juice-orange/40 hover:border-juice-orange/60 hover:bg-juice-orange/5'
              }`}
            >
              Continue
            </button>
          )}
        </div>
      )}
    </div>
  )
}
