import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Message } from '../../stores/chatStore'
import { useThemeStore } from '../../stores'
import { parseMessageContent } from '../../utils/messageParser'
import ComponentRegistry from '../dynamic/ComponentRegistry'
import ThinkingIndicator from './ThinkingIndicator'

interface MessageBubbleProps {
  message: Message
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const parsed = parseMessageContent(message.content)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {isUser ? (
        /* User message: text right-aligned with arrow in right margin */
        <div className="flex items-start gap-3 max-w-[85%] md:max-w-[75%]">
          {/* Text content - right aligned */}
          <div className={`text-right ${isDark ? 'text-white' : 'text-gray-900'}`}>
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
                      // Open image in new tab for full view
                      const win = window.open()
                      if (win) {
                        win.document.write(`<img src="data:${attachment.mimeType};base64,${attachment.data}" alt="${attachment.name}" style="max-width: 100%; height: auto;" />`)
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
          {/* Lightning bolt in right margin */}
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
        </div>
      )}
    </div>
  )
}
