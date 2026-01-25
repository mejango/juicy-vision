import { useState, useCallback } from 'react'
import { useThemeStore } from '../../stores'
import { useComponentCollaboration } from '../../hooks/useComponentCollaboration'

interface Option {
  value: string
  label: string
  sublabel?: string
  selected?: boolean // Pre-select this option (useful for multiSelect defaults)
}

interface OptionGroup {
  id: string
  label: string
  options?: Option[]
  type?: 'radio' | 'toggle' | 'chips' | 'text' | 'textarea'
  multiSelect?: boolean // Allow multiple selections for chips
  placeholder?: string // Placeholder for text/textarea inputs
  optional?: boolean // Mark field as optional (shows "(optional)" label)
  expectedOptionCount?: number // Show ghost cards for remaining options during streaming
}

interface OptionsPickerProps {
  groups: OptionGroup[]
  submitLabel?: string
  allSelectedLabel?: string // Label to use when all options in multiSelect groups are selected
  onSubmit?: (selections: Record<string, string>) => void
  // Streaming mode: show shimmer placeholders for remaining expected groups
  expectedGroupCount?: number
  isStreaming?: boolean
  // Real-time collaboration props
  chatId?: string
  messageId?: string
  // Creative mode: show "generate more ideas" button for brainstorming
  creative?: boolean
  // User's response to this picker (if already submitted) - used to restore state after page refresh
  userResponse?: string
}

// Values that indicate "other" / custom input
const OTHER_VALUES = ['other', 'something-else', 'something_else', 'something else', 'custom', 'else', 'exploring']

// Conversational confirmation words
const DONE_WORDS = ['Great', 'Super', 'Got it', 'Ok', 'Nice']

// Normalize value for comparison (lowercase, trim, collapse spaces)
const normalizeValue = (value: string) => value.toLowerCase().trim().replace(/[\s_-]+/g, ' ')

export default function OptionsPicker({ groups, submitLabel = 'Continue', allSelectedLabel, onSubmit, expectedGroupCount, isStreaming, chatId, messageId, creative, userResponse }: OptionsPickerProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  // Track if the picker has been submitted (to show idle state)
  // Initialize as submitted if we have a userResponse (component was previously submitted)
  const [hasSubmitted, setHasSubmitted] = useState(!!userResponse)
  const [doneWord, setDoneWord] = useState(() => userResponse ? 'Done' : '')

  // Optional memo/note from user - restore from userResponse if present
  const [memo, setMemo] = useState(() => {
    if (userResponse && userResponse.includes('. Note: ')) {
      return userResponse.split('. Note: ')[1] || ''
    }
    return ''
  })

  // Real-time collaboration
  const collaborationEnabled = !!(chatId && messageId)
  const {
    remoteSelections,
    remoteTyping,
    remoteHovers,
    sendSelection,
    sendTyping,
    sendHover,
  } = useComponentCollaboration({
    chatId,
    messageId,
    enabled: collaborationEnabled,
  })

  // Parse userResponse to restore selections (format: "GroupLabel: Value, GroupLabel2: Value2. Note: memo")
  const parseUserResponse = (response: string): Record<string, string | string[]> => {
    const result: Record<string, string | string[]> = {}

    // Remove memo suffix if present
    const mainPart = response.split('. Note:')[0].trim()

    // Find positions of all group labels in the response
    const positions: { group: OptionGroup; start: number; labelEnd: number }[] = []

    for (const group of groups) {
      // Match group label at start or after ", "
      const escapedLabel = group.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`(^|, )${escapedLabel}:\\s*`, 'i')
      const match = mainPart.match(pattern)
      if (match && match.index !== undefined) {
        const prefixLen = match[1]?.length || 0
        const start = match.index + prefixLen
        positions.push({
          group,
          start,
          labelEnd: start + match[0].length - prefixLen
        })
      }
    }

    // Sort by position in string
    positions.sort((a, b) => a.start - b.start)

    // Extract values between each group label
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]
      const valueStart = pos.labelEnd
      const valueEnd = positions[i + 1]?.start ?? mainPart.length
      let valueStr = mainPart.slice(valueStart, valueEnd).trim()
      // Remove trailing comma if present (from joining multiple groups)
      valueStr = valueStr.replace(/,\s*$/, '')

      const options = pos.group.options || []

      if (pos.group.multiSelect) {
        // Split by comma and find matching option values
        const labels = valueStr.split(/,\s*/)
        const values = labels.map(label => {
          const opt = options.find(o => o.label.toLowerCase() === label.toLowerCase().trim())
          return opt?.value
        }).filter((v): v is string => !!v)
        result[pos.group.id] = values
      } else {
        // Find matching option value
        const opt = options.find(o => o.label.toLowerCase() === valueStr.toLowerCase())
        result[pos.group.id] = opt?.value || valueStr
      }
    }

    return result
  }

  // Initialize with pre-selected options or first option of each group
  const [selections, setSelections] = useState<Record<string, string | string[]>>(() => {
    // If we have a userResponse, parse it to restore previous selections
    if (userResponse) {
      const parsed = parseUserResponse(userResponse)
      // Merge with defaults for any groups not found in response
      const initial: Record<string, string | string[]> = {}
      groups.forEach(g => {
        if (parsed[g.id] !== undefined) {
          initial[g.id] = parsed[g.id]
        } else if (g.type === 'text' || g.type === 'textarea') {
          initial[g.id] = ''
        } else if (g.multiSelect) {
          initial[g.id] = []
        } else if ((g.options || []).length > 0) {
          initial[g.id] = g.options![0].value
        }
      })
      return initial
    }

    const initial: Record<string, string | string[]> = {}
    groups.forEach(g => {
      // Text inputs start empty
      if (g.type === 'text' || g.type === 'textarea') {
        initial[g.id] = ''
        return
      }
      const options = g.options || []
      if (g.multiSelect) {
        // For multiSelect, only use pre-selected options - no default selection
        const preSelected = options.filter(o => o.selected).map(o => o.value)
        initial[g.id] = preSelected
      } else {
        // For single select, check for pre-selected option first
        const preSelected = options.find(o => o.selected)
        if (preSelected) {
          initial[g.id] = preSelected.value
        } else if (options.length > 0) {
          initial[g.id] = options[0].value
        }
      }
    })
    return initial
  })

  const isOtherValue = (value: string) => {
    const normalized = normalizeValue(value)
    return OTHER_VALUES.some(v => normalizeValue(v) === normalized || normalized.includes(normalizeValue(v)))
  }

  const handleSelect = (groupId: string, value: string, isMulti?: boolean) => {
    if (isMulti) {
      setSelections(prev => {
        const current = prev[groupId] as string[] || []
        if (current.includes(value)) {
          // Deselect - allow deselecting all for multiSelect
          sendSelection(groupId, null) // Notify others of deselection
          return { ...prev, [groupId]: current.filter(v => v !== value) }
        } else {
          // Select
          sendSelection(groupId, value) // Notify others of selection
          return { ...prev, [groupId]: [...current, value] }
        }
      })
    } else {
      setSelections(prev => ({ ...prev, [groupId]: value }))
      sendSelection(groupId, value) // Notify others of selection
    }
  }

  // Handle memo field changes with collaboration typing indicator
  const handleMemoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setMemo(value)
    sendTyping(value)
  }, [sendTyping])

  // Handle hover events for collaboration
  const handleOptionHover = useCallback((groupId: string, isHovering: boolean) => {
    sendHover(groupId, isHovering)
  }, [sendHover])

  // Get remote selections for a specific option
  const getRemoteSelectionsForOption = useCallback((groupId: string, value: string) => {
    const groupSelections = remoteSelections.get(groupId) || []
    return groupSelections.filter(s => s.value === value)
  }, [remoteSelections])

  // Get remote hovers for a specific group
  const getRemoteHoversForGroup = useCallback((groupId: string) => {
    return remoteHovers.get(groupId) || []
  }, [remoteHovers])

  // Get remote typing for a specific group
  const getRemoteTypingForGroup = useCallback((groupId: string) => {
    return remoteTyping.get(groupId) || []
  }, [remoteTyping])

  const isSelected = (groupId: string, value: string, isMulti?: boolean): boolean => {
    const sel = selections[groupId]
    if (isMulti) {
      return Array.isArray(sel) && sel.includes(value)
    }
    return sel === value
  }

  const handleSubmit = () => {
    // Mark as submitted to show idle state on button
    setHasSubmitted(true)
    setDoneWord(DONE_WORDS[Math.floor(Math.random() * DONE_WORDS.length)])

    // Check if any "other" option is selected - if so, prefill prompt and focus
    for (const g of groups) {
      const sel = selections[g.id]
      if (typeof sel === 'string' && isOtherValue(sel)) {
        // Create a useful prompt prefix based on the group label
        const labelLower = g.label.toLowerCase()
        let prefix = ''
        if (labelLower.includes('type') || labelLower.includes('project') || labelLower.includes('building')) {
          prefix = "I'm building "
        } else if (labelLower.includes('structure') || labelLower.includes('model')) {
          prefix = "I want to "
        } else if (labelLower.includes('size') || labelLower.includes('team')) {
          prefix = "We have "
        } else if (labelLower.includes('goal') || labelLower.includes('funding')) {
          prefix = "I'm looking to raise "
        } else {
          prefix = `${g.label}: `
        }
        // Dispatch event to prefill prompt field
        window.dispatchEvent(new CustomEvent('juice:prefill-prompt', {
          detail: { text: prefix, focus: true }
        }))
        return
      }
    }

    // Build response message for normal selections
    const parts = groups.map(g => {
      const sel = selections[g.id]
      const options = g.options || []
      if (Array.isArray(sel)) {
        const labels = sel.map(v => options.find(o => o.value === v)?.label || v)
        return `${g.label}: ${labels.join(', ')}`
      }
      const selected = options.find(o => o.value === sel)
      return `${g.label}: ${selected?.label || sel}`
    })
    let message = parts.join(', ')

    // Append memo if provided
    if (memo.trim()) {
      message += `. Note: ${memo.trim()}`
    }

    if (onSubmit) {
      onSubmit(selections as Record<string, string>)
    } else {
      window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message } }))
    }
  }

  // Calculate remaining shimmer placeholders for streaming mode
  const remainingShimmers = expectedGroupCount && expectedGroupCount > groups.length
    ? expectedGroupCount - groups.length
    : 0

  return (
    <div className={`border overflow-hidden inline-block max-w-lg ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      <div className="p-4 space-y-4">
        {groups.map(group => (
          <div key={group.id} className="space-y-1.5">
            <div className={`text-xs font-medium uppercase tracking-wide ${
              isDark ? 'text-gray-400' : 'text-gray-500'
            }`}>
              {group.label}
              {group.optional && (
                <span className={`ml-1 font-normal normal-case ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  (optional)
                </span>
              )}
            </div>

            {/* Chips layout - horizontal wrap */}
            {(group.type === 'chips' || !group.type) && (() => {
              const options = group.options || []
              const ghostCount = group.expectedOptionCount && group.expectedOptionCount > options.length
                ? group.expectedOptionCount - options.length
                : 0

              return (
                <div className="flex flex-wrap gap-2">
                  {options.map((option, idx) => {
                    const selected = isSelected(group.id, option.value, group.multiSelect)
                    const remoteSelectionsForOption = getRemoteSelectionsForOption(group.id, option.value)
                    return (
                      <button
                        key={option.value}
                        onClick={() => handleSelect(group.id, option.value, group.multiSelect)}
                        onMouseEnter={() => handleOptionHover(group.id, true)}
                        onMouseLeave={() => handleOptionHover(group.id, false)}
                        className={`relative px-3 py-1.5 text-sm border text-left ${
                          selected
                            ? isDark
                              ? 'border-green-500 text-green-400'
                              : 'border-green-500 text-green-700'
                            : isDark
                              ? 'bg-white/5 border-white/10 text-gray-300 hover:border-white/30'
                              : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        <span className="font-medium">{option.label}</span>
                        {option.sublabel && (
                          <span className={`ml-3 text-xs ${
                            selected
                              ? isDark ? 'text-green-400/70' : 'text-green-600'
                              : isDark ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                            {option.sublabel}
                          </span>
                        )}
                        {/* Remote selection indicators */}
                        {remoteSelectionsForOption.length > 0 && (
                          <span className="absolute -top-1 -right-1 flex">
                            {remoteSelectionsForOption.slice(0, 3).map((rs, i) => (
                              <span
                                key={rs.address}
                                className="text-[10px] leading-none animate-fade-in"
                                style={{
                                  marginLeft: i > 0 ? '-2px' : 0,
                                  zIndex: 3 - i,
                                }}
                                title={`Selected by ${rs.address.slice(0, 6)}...`}
                              >
                                {rs.emoji}
                              </span>
                            ))}
                            {remoteSelectionsForOption.length > 3 && (
                              <span className="text-[8px] text-gray-400 ml-0.5">
                                +{remoteSelectionsForOption.length - 3}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {/* Ghost chips for remaining expected options */}
                  {ghostCount > 0 && Array.from({ length: ghostCount }).map((_, idx) => (
                    <div
                      key={`ghost-${idx}`}
                      className={`h-9 rounded animate-pulse ${
                        isDark ? 'bg-white/5 border border-white/10' : 'bg-gray-100 border border-gray-200'
                      }`}
                      style={{ width: `${70 + (idx * 20) % 40}px` }}
                    />
                  ))}
                </div>
              )
            })()}

            {/* Toggle layout - 2 options side by side */}
            {group.type === 'toggle' && (group.options || []).length === 2 && (
              <div className={`inline-flex border ${
                isDark ? 'border-white/10' : 'border-gray-200'
              }`}>
                {(group.options || []).map((option, idx) => {
                  const isSelected = selections[group.id] === option.value
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleSelect(group.id, option.value)}
                      className={`px-4 py-2 text-sm font-medium ${
                        idx === 1 ? 'border-l' : ''
                      } ${isDark ? 'border-white/10' : 'border-gray-200'} ${
                        isSelected
                          ? 'bg-green-500 text-white'
                          : isDark
                            ? 'bg-white/5 text-gray-400 hover:text-white'
                            : 'bg-gray-50 text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Radio layout - vertical stack (supports multiSelect) */}
            {group.type === 'radio' && (() => {
              const options = group.options || []
              const ghostCount = group.expectedOptionCount && group.expectedOptionCount > options.length
                ? group.expectedOptionCount - options.length
                : 0

              return (
                <div className="space-y-2">
                  {options.map((option, idx) => {
                    const selected = isSelected(group.id, option.value, group.multiSelect)
                    const remoteSelectionsForOption = getRemoteSelectionsForOption(group.id, option.value)
                    return (
                      <button
                        key={option.value}
                        onClick={() => handleSelect(group.id, option.value, group.multiSelect)}
                        onMouseEnter={() => handleOptionHover(group.id, true)}
                        onMouseLeave={() => handleOptionHover(group.id, false)}
                        className={`relative w-full flex items-start gap-3 px-3 py-2 text-sm border text-left ${
                          selected
                            ? isDark
                              ? 'border-green-500'
                              : 'border-green-500'
                            : isDark
                              ? 'bg-white/5 border-white/10 hover:border-white/30'
                              : 'bg-gray-50 border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        {/* Checkbox for multiSelect, radio for single select */}
                        {group.multiSelect ? (
                          <div className={`w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center shrink-0 ${
                            selected
                              ? 'border-green-500 bg-green-500'
                              : isDark ? 'border-gray-500' : 'border-gray-300'
                          }`}>
                            {selected && (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        ) : (
                          <div className={`w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selected
                              ? 'border-green-500'
                              : isDark ? 'border-gray-500' : 'border-gray-300'
                          }`}>
                            {selected && (
                              <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                            )}
                          </div>
                        )}
                        <div className="flex flex-col min-w-0 text-left flex-1">
                          <span className={`${selected
                            ? isDark ? 'text-green-400' : 'text-green-700'
                            : isDark ? 'text-gray-300' : 'text-gray-600'
                          }`}>
                            {option.label}
                          </span>
                          {option.sublabel && (
                            <span className={`mt-0.5 text-xs text-left ${
                              isDark ? 'text-gray-400' : 'text-gray-500'
                            }`}>
                              {option.sublabel}
                            </span>
                          )}
                        </div>
                        {/* Remote selection indicators */}
                        {remoteSelectionsForOption.length > 0 && (
                          <span className="flex items-center shrink-0">
                            {remoteSelectionsForOption.slice(0, 3).map((rs, i) => (
                              <span
                                key={rs.address}
                                className="text-xs leading-none animate-fade-in"
                                style={{
                                  marginLeft: i > 0 ? '-2px' : 0,
                                  zIndex: 3 - i,
                                }}
                                title={`Selected by ${rs.address.slice(0, 6)}...`}
                              >
                                {rs.emoji}
                              </span>
                            ))}
                            {remoteSelectionsForOption.length > 3 && (
                              <span className="text-[10px] text-gray-400 ml-0.5">
                                +{remoteSelectionsForOption.length - 3}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {/* Ghost cards for remaining expected options */}
                  {ghostCount > 0 && Array.from({ length: ghostCount }).map((_, idx) => (
                    <div
                      key={`ghost-${idx}`}
                      className={`w-full flex items-start gap-3 px-3 py-2 border animate-pulse ${
                        isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
                      }`}
                      style={{ animationDelay: `${(options.length + idx) * 50}ms` }}
                    >
                      <div className={`w-5 h-5 mt-0.5 rounded border-2 shrink-0 ${
                        group.multiSelect ? '' : 'rounded-full'
                      } ${isDark ? 'border-gray-600' : 'border-gray-300'}`} />
                      <div className="flex flex-col gap-1.5 flex-1">
                        <div
                          className={`h-4 rounded ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}
                          style={{ width: `${45 + (idx * 10) % 30}%` }}
                        />
                        <div
                          className={`h-3 rounded opacity-60 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}
                          style={{ width: `${55 + (idx * 15) % 25}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Text input */}
            {group.type === 'text' && (() => {
              const groupTyping = getRemoteTypingForGroup(group.id)
              return (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={(selections[group.id] as string) || ''}
                    onChange={(e) => {
                      const value = e.target.value
                      setSelections(prev => ({ ...prev, [group.id]: value }))
                      sendTyping(value, group.id)
                    }}
                    placeholder={group.placeholder}
                    className={`w-full px-3 py-2 text-sm border transition-colors outline-none ${
                      isDark
                        ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-green-500'
                        : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-green-500'
                    }`}
                  />
                  {/* Remote typing indicators */}
                  {groupTyping.length > 0 && (
                    <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {groupTyping.map((rt, i) => (
                        <span key={rt.address} className="animate-fade-in">
                          {i > 0 && ', '}
                          <span className="text-xs">{rt.emoji}</span>
                          <span className="italic"> {rt.text || 'typing...'}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Textarea input */}
            {group.type === 'textarea' && (() => {
              const groupTyping = getRemoteTypingForGroup(group.id)
              return (
                <div className="space-y-1">
                  <textarea
                    value={(selections[group.id] as string) || ''}
                    onChange={(e) => {
                      const value = e.target.value
                      setSelections(prev => ({ ...prev, [group.id]: value }))
                      sendTyping(value, group.id)
                    }}
                    placeholder={group.placeholder}
                    rows={3}
                    className={`w-full px-3 py-2 text-sm border transition-colors outline-none resize-none ${
                      isDark
                        ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-green-500'
                        : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-green-500'
                    }`}
                  />
                  {/* Remote typing indicators */}
                  {groupTyping.length > 0 && (
                    <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {groupTyping.map((rt, i) => (
                        <span key={rt.address} className="animate-fade-in">
                          {i > 0 && ', '}
                          <span className="text-xs">{rt.emoji}</span>
                          <span className="italic"> {rt.text || 'typing...'}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        ))}

        {/* Shimmer placeholders for remaining expected groups during streaming */}
        {remainingShimmers > 0 && Array.from({ length: remainingShimmers }).map((_, idx) => (
          <div key={`shimmer-${idx}`} className="space-y-1.5 animate-pulse">
            {/* Label shimmer */}
            <div className={`h-3 w-24 rounded ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            {/* Options shimmer - varies by index for visual variety */}
            {idx % 2 === 0 ? (
              // Chips-style shimmer
              <div className="flex flex-wrap gap-2">
                {[80, 100, 90, 70].slice(0, 3 + (idx % 2)).map((w, i) => (
                  <div
                    key={i}
                    className={`h-9 rounded ${isDark ? 'bg-white/5 border border-white/10' : 'bg-gray-100 border border-gray-200'}`}
                    style={{ width: w, animationDelay: `${(idx * 100) + (i * 50)}ms` }}
                  />
                ))}
              </div>
            ) : (
              // Radio-style shimmer
              <div className="space-y-2">
                {[{ tw: '55%', sw: '70%' }, { tw: '45%', sw: '60%' }].map((widths, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 px-3 py-2 border ${
                      isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
                    }`}
                    style={{ animationDelay: `${(idx * 100) + (i * 50)}ms` }}
                  >
                    <div className={`w-5 h-5 mt-0.5 rounded-full border-2 shrink-0 ${
                      isDark ? 'border-gray-600' : 'border-gray-300'
                    }`} />
                    <div className="flex flex-col gap-1.5 flex-1">
                      <div className={`h-4 rounded ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} style={{ width: widths.tw }} />
                      <div className={`h-3 rounded opacity-60 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} style={{ width: widths.sw }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Submit row - only show if there are options to submit and not streaming */}
      {(() => {
        // Check if we have any groups with actual options
        const hasAnyOptions = groups.some(g => {
          if (g.type === 'text' || g.type === 'textarea') return true // Text inputs always count
          return (g.options || []).length > 0
        })

        // Don't show submit button if no options available or still streaming
        if (!hasAnyOptions) return null

        // Show disabled state while streaming
        const stillStreaming = isStreaming || remainingShimmers > 0

        // Check if all options are selected in multiSelect groups
        const allSelected = allSelectedLabel && groups.every(g => {
          if (!g.multiSelect) return true
          const sel = selections[g.id]
          const options = g.options || []
          return Array.isArray(sel) && sel.length === options.length
        })
        const buttonLabel = allSelected ? allSelectedLabel : submitLabel

        return (
          <div className={`px-4 py-3 border-t flex flex-col gap-3 ${
            isDark ? 'border-white/10' : 'border-gray-100'
          }`}>
            <div className={`text-xs leading-relaxed ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {groups.map(g => {
                const sel = selections[g.id]
                const options = g.options || []
                if (Array.isArray(sel)) {
                  return sel.map(v => options.find(o => o.value === v)?.label).filter(Boolean).join(', ')
                }
                return options.find(o => o.value === sel)?.label
              }).filter(Boolean).join(' · ')}
            </div>
            {/* Optional memo input with collaboration typing indicator */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={memo}
                  onChange={handleMemoChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !hasSubmitted && !stillStreaming) {
                      handleSubmit()
                    }
                  }}
                  placeholder="Add something..."
                  disabled={hasSubmitted || stillStreaming}
                  className={`flex-1 px-0 py-1 text-xs bg-transparent border-0 transition-colors outline-none ${
                    isDark
                      ? 'text-gray-300 placeholder-gray-600'
                      : 'text-gray-600 placeholder-gray-400'
                  } ${hasSubmitted || stillStreaming ? 'opacity-50' : ''}`}
                />
                <button
                  onClick={handleSubmit}
                  disabled={hasSubmitted || stillStreaming}
                  className={`shrink-0 px-4 py-1.5 text-sm font-bold border-2 transition-colors ${
                    hasSubmitted
                      ? isDark
                        ? 'bg-transparent text-gray-500 border-gray-600 cursor-default'
                        : 'bg-transparent text-gray-400 border-gray-300 cursor-default'
                      : stillStreaming
                        ? isDark
                          ? 'bg-transparent text-gray-500 border-gray-600 cursor-wait'
                          : 'bg-transparent text-gray-400 border-gray-300 cursor-wait'
                        : 'bg-green-500 text-black border-green-500 hover:bg-green-600 hover:border-green-600'
                  }`}
                >
                  {hasSubmitted ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {doneWord}
                    </span>
                  ) : stillStreaming ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Loading...
                    </span>
                  ) : buttonLabel}
                </button>
              </div>
              {/* Remote typing indicators */}
              {(() => {
                const memoTyping = getRemoteTypingForGroup('_memo')
                return memoTyping.length > 0 && (
                  <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {memoTyping.map((rt, i) => (
                      <span key={rt.address} className="animate-fade-in">
                        {i > 0 && ', '}
                        <span className="text-xs">{rt.emoji}</span>
                        <span className="italic"> {rt.text || 'typing...'}</span>
                      </span>
                    ))}
                  </div>
                )
              })()}
            </div>
            {/* Generate more ideas button for creative brainstorming */}
            {creative && !hasSubmitted && !stillStreaming && (
              <button
                onClick={() => {
                  // Extract context from the group labels
                  const context = groups.map(g => g.label).join(', ')
                  window.dispatchEvent(new CustomEvent('juice:send-message', {
                    detail: {
                      message: `Generate more unconventional ideas for: ${context}. Think outside the box - invert the problem, combine unexpected concepts, explore contrarian approaches, or find inspiration from unrelated industries.`
                    }
                  }))
                }}
                className={`text-xs transition-colors ${
                  isDark
                    ? 'text-gray-500 hover:text-gray-300'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                + Generate more ideas
              </button>
            )}
          </div>
        )
      })()}
    </div>
  )
}
