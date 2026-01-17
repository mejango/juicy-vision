import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Message } from '../../stores/chatStore'
import { parseMessageContent } from '../../utils/messageParser'
import ComponentRegistry from '../dynamic/ComponentRegistry'

interface MessageBubbleProps {
  message: Message
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const parsed = parseMessageContent(message.content)

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`
          max-w-[85%] md:max-w-[75%] px-4 py-3
          ${isUser
            ? 'bg-juice-orange text-juice-dark'
            : 'bg-juice-dark-lighter text-white'
          }
        `}
      >
        {parsed.segments.map((segment, index) => {
          if (segment.type === 'text') {
            return (
              <div key={index} className={isUser ? '' : 'prose-juice'}>
                {isUser ? (
                  <p className="whitespace-pre-wrap">{segment.content}</p>
                ) : (
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
                )}
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

        {/* Streaming indicator */}
        {message.isStreaming && (
          <span className="inline-flex ml-1">
            <span className="w-2 h-2 bg-juice-orange animate-pulse" />
          </span>
        )}
      </div>
    </div>
  )
}
