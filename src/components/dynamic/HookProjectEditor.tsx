import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useThemeStore, useAuthStore } from '../../stores'

interface ProjectFile {
  path: string
  content: string
}

interface HookProjectEditorProps {
  projectId?: string
  hookType?: 'pay' | 'cash-out' | 'split'
  files?: ProjectFile[] | string
  readOnly?: boolean
  onSave?: (files: ProjectFile[]) => void
  onCompile?: () => void
  onTest?: () => void
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
    'true', 'false',
  ]

  const types = [
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
    'int', 'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
    'address', 'bool', 'string', 'bytes', 'bytes32', 'bytes4',
  ]

  let result = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Comments
  result = result.replace(
    /(\/\/.*$)/gm,
    `<span class="${isDark ? 'text-gray-500' : 'text-gray-400'}">$1</span>`
  )

  // Strings
  result = result.replace(
    /("(?:[^"\\]|\\.)*")/g,
    `<span class="${isDark ? 'text-emerald-400' : 'text-emerald-600'}">$1</span>`
  )

  // Numbers
  result = result.replace(
    /\b(0x[a-fA-F0-9]+|\d+)\b/g,
    `<span class="${isDark ? 'text-amber-400' : 'text-amber-600'}">$1</span>`
  )

  // Types
  types.forEach(type => {
    const regex = new RegExp(`\\b(${type})\\b`, 'g')
    result = result.replace(regex, `<span class="${isDark ? 'text-cyan-400' : 'text-cyan-600'}">$1</span>`)
  })

  // Keywords
  keywords.forEach(keyword => {
    const regex = new RegExp(`\\b(${keyword})\\b`, 'g')
    result = result.replace(regex, `<span class="${isDark ? 'text-purple-400' : 'text-purple-600'}">$1</span>`)
  })

  return result
}

export default function HookProjectEditor({
  projectId,
  hookType = 'pay',
  files: initialFiles,
  readOnly = false,
  onSave,
  onCompile,
  onTest,
}: HookProjectEditorProps) {
  const { theme } = useThemeStore()
  const token = useAuthStore((s) => s.token)
  const isDark = theme === 'dark'

  // Parse files if string
  const parsedFiles = useMemo((): ProjectFile[] => {
    if (!initialFiles) return []
    if (typeof initialFiles === 'string') {
      try {
        return JSON.parse(initialFiles)
      } catch {
        return []
      }
    }
    return initialFiles
  }, [initialFiles])

  const [files, setFiles] = useState<ProjectFile[]>(parsedFiles)
  const [selectedFile, setSelectedFile] = useState<string>(parsedFiles[0]?.path || '')
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [showNewFileModal, setShowNewFileModal] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Update files when initialFiles change
  useEffect(() => {
    if (parsedFiles.length > 0) {
      setFiles(parsedFiles)
      if (!selectedFile || !parsedFiles.find(f => f.path === selectedFile)) {
        setSelectedFile(parsedFiles[0].path)
      }
    }
  }, [parsedFiles])

  const currentFile = files.find(f => f.path === selectedFile)

  const updateFileContent = useCallback((content: string) => {
    if (readOnly) return
    setFiles(prev =>
      prev.map(f => (f.path === selectedFile ? { ...f, content } : f))
    )
    setHasChanges(true)
  }, [selectedFile, readOnly])

  const addNewFile = useCallback(() => {
    if (!newFileName.trim()) return

    let path = newFileName.trim()
    if (!path.includes('/')) {
      path = `src/${path}`
    }
    if (!path.endsWith('.sol') && !path.endsWith('.t.sol')) {
      path = `${path}.sol`
    }

    const newFile: ProjectFile = {
      path,
      content: `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.28;\n\n`,
    }

    setFiles(prev => [...prev, newFile])
    setSelectedFile(path)
    setShowNewFileModal(false)
    setNewFileName('')
    setHasChanges(true)
  }, [newFileName])

  const deleteFile = useCallback((path: string) => {
    if (files.length <= 1) return
    setFiles(prev => prev.filter(f => f.path !== path))
    if (selectedFile === path) {
      const remaining = files.filter(f => f.path !== path)
      setSelectedFile(remaining[0]?.path || '')
    }
    setHasChanges(true)
  }, [files, selectedFile])

  const handleSave = async () => {
    if (!projectId || !token) return

    setSaving(true)
    try {
      const response = await fetch(`/hooks/projects/${projectId}/files`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ files }),
      })

      if (!response.ok) throw new Error('Failed to save files')

      setHasChanges(false)
      onSave?.(files)
    } catch (error) {
      console.error('Save failed:', error)
    } finally {
      setSaving(false)
    }
  }

  // Group files by directory
  const fileTree = useMemo(() => {
    const tree: Record<string, ProjectFile[]> = {}
    for (const file of files) {
      const dir = file.path.substring(0, file.path.lastIndexOf('/')) || '/'
      if (!tree[dir]) tree[dir] = []
      tree[dir].push(file)
    }
    return tree
  }, [files])

  const getFileIcon = (path: string) => {
    if (path.endsWith('.t.sol')) return '🧪'
    if (path.endsWith('.sol')) return '📄'
    if (path.endsWith('.toml')) return '⚙️'
    return '📝'
  }

  return (
    <div className={`w-full border ${isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'}`}>
      {/* Toolbar */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${
        isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-100'
      }`}>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            {hookType === 'pay' ? 'Pay Hook' : hookType === 'cash-out' ? 'Cash Out Hook' : 'Split Hook'}
          </span>
          {hasChanges && (
            <span className="text-xs text-yellow-500">• Unsaved changes</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!readOnly && projectId && (
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                saving || !hasChanges
                  ? 'bg-gray-500/30 text-gray-500 cursor-not-allowed'
                  : isDark
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}

          {onCompile && (
            <button
              onClick={onCompile}
              className={`px-3 py-1.5 text-xs font-medium ${
                isDark
                  ? 'bg-purple-600 hover:bg-purple-500 text-white'
                  : 'bg-purple-500 hover:bg-purple-600 text-white'
              }`}
            >
              Compile
            </button>
          )}

          {onTest && (
            <button
              onClick={onTest}
              className={`px-3 py-1.5 text-xs font-medium ${
                isDark
                  ? 'bg-green-600 hover:bg-green-500 text-white'
                  : 'bg-green-500 hover:bg-green-600 text-white'
              }`}
            >
              Test
            </button>
          )}
        </div>
      </div>

      <div className="flex" style={{ height: '400px' }}>
        {/* File tree */}
        <div className={`w-48 flex-shrink-0 border-r overflow-y-auto ${
          isDark ? 'border-gray-700 bg-gray-850' : 'border-gray-200 bg-gray-50'
        }`}>
          <div className="p-2">
            {/* Add file button */}
            {!readOnly && (
              <button
                onClick={() => setShowNewFileModal(true)}
                className={`w-full mb-2 px-2 py-1.5 text-xs flex items-center gap-1 ${
                  isDark
                    ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-black/5'
                }`}
              >
                <span>+</span>
                New File
              </button>
            )}

            {/* File list */}
            {Object.entries(fileTree).map(([dir, dirFiles]) => (
              <div key={dir} className="mb-2">
                <div className={`text-xs px-2 py-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {dir === '/' ? 'root' : dir}
                </div>
                {dirFiles.map(file => (
                  <div
                    key={file.path}
                    className={`flex items-center justify-between group px-2 py-1.5 cursor-pointer text-sm ${
                      selectedFile === file.path
                        ? isDark
                          ? 'bg-blue-900/30 text-blue-300'
                          : 'bg-blue-100 text-blue-700'
                        : isDark
                          ? 'text-gray-300 hover:bg-white/5'
                          : 'text-gray-600 hover:bg-black/5'
                    }`}
                    onClick={() => setSelectedFile(file.path)}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <span>{getFileIcon(file.path)}</span>
                      <span className="truncate">
                        {file.path.split('/').pop()}
                      </span>
                    </span>
                    {!readOnly && files.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteFile(file.path)
                        }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* File tab */}
          {currentFile && (
            <div className={`px-3 py-1.5 border-b text-xs ${
              isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'
            }`}>
              {currentFile.path}
            </div>
          )}

          {/* Editor */}
          {currentFile ? (
            <div className="flex-1 overflow-auto relative">
              <div className="absolute inset-0 flex">
                {/* Line numbers */}
                <div className={`flex-shrink-0 text-right pr-3 pl-3 py-2 font-mono text-xs select-none ${
                  isDark ? 'text-gray-600 bg-gray-900' : 'text-gray-400 bg-gray-50'
                }`}>
                  {currentFile.content.split('\n').map((_, i) => (
                    <div key={i} style={{ lineHeight: '1.5rem' }}>{i + 1}</div>
                  ))}
                </div>

                {/* Code input */}
                <div className="flex-1 relative">
                  {/* Highlighted layer */}
                  <pre
                    className={`absolute inset-0 py-2 pr-4 font-mono text-sm overflow-auto pointer-events-none ${
                      isDark ? 'text-gray-200' : 'text-gray-800'
                    }`}
                    style={{ lineHeight: '1.5rem' }}
                  >
                    <code dangerouslySetInnerHTML={{
                      __html: highlightSolidity(currentFile.content, isDark)
                    }} />
                  </pre>

                  {/* Textarea for editing */}
                  <textarea
                    ref={textareaRef}
                    value={currentFile.content}
                    onChange={(e) => updateFileContent(e.target.value)}
                    readOnly={readOnly}
                    spellCheck={false}
                    className={`absolute inset-0 py-2 pr-4 font-mono text-sm resize-none outline-none bg-transparent ${
                      readOnly ? 'cursor-default' : ''
                    }`}
                    style={{
                      lineHeight: '1.5rem',
                      color: 'transparent',
                      caretColor: isDark ? 'white' : 'black',
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className={`flex-1 flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              No file selected
            </div>
          )}
        </div>
      </div>

      {/* New file modal */}
      {showNewFileModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`p-4 max-w-sm w-full mx-4 ${
            isDark ? 'bg-gray-800' : 'bg-white'
          }`}>
            <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              New File
            </h3>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="src/MyContract.sol"
              className={`w-full px-3 py-2 text-sm outline-none border mb-3 ${
                isDark
                  ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500'
                  : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
              }`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') addNewFile()
                if (e.key === 'Escape') setShowNewFileModal(false)
              }}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNewFileModal(false)}
                className={`px-3 py-1.5 text-xs ${
                  isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={addNewFile}
                className={`px-3 py-1.5 text-xs font-medium ${
                  isDark
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
