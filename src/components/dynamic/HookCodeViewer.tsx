import { useState, useMemo } from 'react'
import { useThemeStore } from '../../stores'

interface HookCodeViewerProps {
  filename?: string
  code: string
  explanation?: string
  language?: string
}

// Simple syntax highlighting for Solidity
function highlightSolidity(code: string, isDark: boolean): string {
  const keywords = [
    'pragma', 'import', 'contract', 'interface', 'library', 'abstract',
    'function', 'modifier', 'event', 'error', 'struct', 'enum', 'mapping',
    'public', 'private', 'internal', 'external', 'view', 'pure', 'payable',
    'virtual', 'override', 'returns', 'return', 'if', 'else', 'for', 'while',
    'require', 'revert', 'emit', 'new', 'delete', 'this', 'super',
    'memory', 'storage', 'calldata', 'immutable', 'constant',
    'true', 'false', 'wei', 'gwei', 'ether', 'seconds', 'minutes', 'hours', 'days',
  ]

  const types = [
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
    'int', 'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
    'address', 'bool', 'string', 'bytes', 'bytes32', 'bytes4',
  ]

  let result = code
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Comments
  result = result.replace(
    /(\/\/.*$)/gm,
    `<span class="${isDark ? 'text-gray-500' : 'text-gray-400'}">$1</span>`
  )
  result = result.replace(
    /(\/\*[\s\S]*?\*\/)/g,
    `<span class="${isDark ? 'text-gray-500' : 'text-gray-400'}">$1</span>`
  )

  // Strings
  result = result.replace(
    /("(?:[^"\\]|\\.)*")/g,
    `<span class="${isDark ? 'text-emerald-400' : 'text-emerald-600'}">$1</span>`
  )

  // Numbers (including hex)
  result = result.replace(
    /\b(0x[a-fA-F0-9]+|\d+)\b/g,
    `<span class="${isDark ? 'text-amber-400' : 'text-amber-600'}">$1</span>`
  )

  // Types
  types.forEach(type => {
    const regex = new RegExp(`\\b(${type})\\b`, 'g')
    result = result.replace(
      regex,
      `<span class="${isDark ? 'text-cyan-400' : 'text-cyan-600'}">$1</span>`
    )
  })

  // Keywords
  keywords.forEach(keyword => {
    const regex = new RegExp(`\\b(${keyword})\\b`, 'g')
    result = result.replace(
      regex,
      `<span class="${isDark ? 'text-purple-400' : 'text-purple-600'}">$1</span>`
    )
  })

  // Function names (after function keyword)
  result = result.replace(
    /\bfunction\b\s+(\w+)/g,
    `<span class="${isDark ? 'text-purple-400' : 'text-purple-600'}">function</span> <span class="${isDark ? 'text-yellow-400' : 'text-yellow-600'}">$1</span>`
  )

  // Contract/interface names
  result = result.replace(
    /\b(contract|interface|library|abstract\s+contract)\b\s+(\w+)/g,
    `<span class="${isDark ? 'text-purple-400' : 'text-purple-600'}">$1</span> <span class="${isDark ? 'text-blue-400' : 'text-blue-600'}">$2</span>`
  )

  return result
}

export default function HookCodeViewer({
  filename = 'Contract.sol',
  code,
  explanation,
  language = 'solidity',
}: HookCodeViewerProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [copied, setCopied] = useState(false)
  const [showExplanation, setShowExplanation] = useState(true)

  const highlightedCode = useMemo(() => {
    if (language === 'solidity') {
      return highlightSolidity(code, isDark)
    }
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }, [code, isDark, language])

  const lines = code.split('\n')
  const lineNumbers = lines.map((_, i) => i + 1)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="w-full">
      {/* Explanation panel */}
      {explanation && (
        <div className={`mb-2 ${isDark ? 'bg-blue-900/20 border-blue-500/30' : 'bg-blue-50 border-blue-200'} border p-3`}>
          <button
            onClick={() => setShowExplanation(!showExplanation)}
            className={`flex items-center gap-2 w-full text-left text-sm font-medium ${
              isDark ? 'text-blue-300' : 'text-blue-700'
            }`}
          >
            <svg
              className={`w-4 h-4 transition-transform ${showExplanation ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            AI Explanation
          </button>
          {showExplanation && (
            <p className={`mt-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {explanation}
            </p>
          )}
        </div>
      )}

      {/* Code viewer */}
      <div className={`border ${isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-gray-50'}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-3 py-2 border-b ${
          isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-100'
        }`}>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-juice-orange" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              {filename}
            </span>
          </div>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
              copied
                ? 'text-green-500'
                : isDark
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>

        {/* Code content */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className={`${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'}`}>
                  <td className={`select-none text-right pr-4 pl-3 py-0 text-xs font-mono ${
                    isDark ? 'text-gray-600' : 'text-gray-400'
                  }`} style={{ width: '3rem' }}>
                    {lineNumbers[i]}
                  </td>
                  <td className={`pr-4 py-0 text-sm font-mono whitespace-pre ${
                    isDark ? 'text-gray-200' : 'text-gray-800'
                  }`}>
                    <span dangerouslySetInnerHTML={{ __html: highlightSolidity(line, isDark) }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className={`px-3 py-1.5 border-t text-xs ${
          isDark ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'
        }`}>
          {lines.length} lines • {language}
        </div>
      </div>
    </div>
  )
}
