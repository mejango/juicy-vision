import { useState } from 'react'
import { useThemeStore } from '../../stores'

interface Option {
  value: string
  label: string
  sublabel?: string
  selected?: boolean // Pre-select this option (useful for multiSelect defaults)
}

interface OptionGroup {
  id: string
  label: string
  options: Option[]
  type?: 'radio' | 'toggle' | 'chips'
  multiSelect?: boolean // Allow multiple selections for chips
}

interface OptionsPickerProps {
  groups: OptionGroup[]
  submitLabel?: string
  allSelectedLabel?: string // Label to use when all options in multiSelect groups are selected
  onSubmit?: (selections: Record<string, string>) => void
}

// Values that indicate "other" / custom input
const OTHER_VALUES = ['other', 'something-else', 'something_else', 'something else', 'custom', 'else', 'exploring']

// Normalize value for comparison (lowercase, trim, collapse spaces)
const normalizeValue = (value: string) => value.toLowerCase().trim().replace(/[\s_-]+/g, ' ')

export default function OptionsPicker({ groups, submitLabel = 'Continue', allSelectedLabel, onSubmit }: OptionsPickerProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  // Initialize with pre-selected options or first option of each group
  const [selections, setSelections] = useState<Record<string, string | string[]>>(() => {
    const initial: Record<string, string | string[]> = {}
    groups.forEach(g => {
      if (g.multiSelect) {
        // For multiSelect, check for pre-selected options first
        const preSelected = g.options.filter(o => o.selected).map(o => o.value)
        if (preSelected.length > 0) {
          initial[g.id] = preSelected
        } else {
          // Fallback to first option
          initial[g.id] = g.options.length > 0 ? [g.options[0].value] : []
        }
      } else {
        // For single select, check for pre-selected option first
        const preSelected = g.options.find(o => o.selected)
        if (preSelected) {
          initial[g.id] = preSelected.value
        } else if (g.options.length > 0) {
          initial[g.id] = g.options[0].value
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
          // Deselect - but keep at least one selected
          if (current.length > 1) {
            return { ...prev, [groupId]: current.filter(v => v !== value) }
          }
          return prev // Don't allow deselecting the last one
        } else {
          // Select
          return { ...prev, [groupId]: [...current, value] }
        }
      })
    } else {
      setSelections(prev => ({ ...prev, [groupId]: value }))
    }
  }

  const isSelected = (groupId: string, value: string, isMulti?: boolean): boolean => {
    const sel = selections[groupId]
    if (isMulti) {
      return Array.isArray(sel) && sel.includes(value)
    }
    return sel === value
  }

  const handleSubmit = () => {
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
      if (Array.isArray(sel)) {
        const labels = sel.map(v => g.options.find(o => o.value === v)?.label || v)
        return `${g.label}: ${labels.join(', ')}`
      }
      const selected = g.options.find(o => o.value === sel)
      return `${g.label}: ${selected?.label || sel}`
    })
    const message = parts.join(', ')

    if (onSubmit) {
      onSubmit(selections as Record<string, string>)
    } else {
      window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message } }))
    }
  }

  return (
    <div className={`rounded-lg border overflow-hidden inline-block ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      <div className="p-3 space-y-3">
        {groups.map(group => (
          <div key={group.id} className="space-y-1.5">
            <div className={`text-xs font-medium uppercase tracking-wide ${
              isDark ? 'text-gray-400' : 'text-gray-500'
            }`}>
              {group.label}
            </div>

            {/* Chips layout - horizontal wrap */}
            {(group.type === 'chips' || !group.type) && (
              <div className="flex flex-wrap gap-1.5">
                {group.options.map(option => {
                  const selected = isSelected(group.id, option.value, group.multiSelect)
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleSelect(group.id, option.value, group.multiSelect)}
                      className={`px-2.5 py-1 text-sm rounded border transition-all ${
                        selected
                          ? isDark
                            ? 'bg-green-500/20 border-green-500 text-green-400'
                            : 'bg-green-50 border-green-500 text-green-700'
                          : isDark
                            ? 'bg-white/5 border-white/10 text-gray-300 hover:border-white/30'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      <span className="font-medium">{option.label}</span>
                      {option.sublabel && (
                        <span className={`ml-1.5 text-xs ${
                          selected
                            ? isDark ? 'text-green-400/70' : 'text-green-600'
                            : isDark ? 'text-gray-400' : 'text-gray-500'
                        }`}>
                          {option.sublabel}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Toggle layout - 2 options side by side */}
            {group.type === 'toggle' && group.options.length === 2 && (
              <div className={`inline-flex rounded border ${
                isDark ? 'border-white/10' : 'border-gray-200'
              }`}>
                {group.options.map((option, idx) => {
                  const isSelected = selections[group.id] === option.value
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleSelect(group.id, option.value)}
                      className={`px-3 py-1.5 text-sm font-medium transition-all ${
                        idx === 0 ? 'rounded-l' : 'rounded-r border-l'
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
            {group.type === 'radio' && (
              <div className="space-y-1">
                {group.options.map(option => {
                  const selected = isSelected(group.id, option.value, group.multiSelect)
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleSelect(group.id, option.value, group.multiSelect)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded border transition-all text-left ${
                        selected
                          ? isDark
                            ? 'bg-green-500/20 border-green-500'
                            : 'bg-green-50 border-green-500'
                          : isDark
                            ? 'bg-white/5 border-white/10 hover:border-white/30'
                            : 'bg-gray-50 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {/* Checkbox for multiSelect, radio for single select */}
                      {group.multiSelect ? (
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
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
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          selected
                            ? 'border-green-500'
                            : isDark ? 'border-gray-500' : 'border-gray-300'
                        }`}>
                          {selected && (
                            <div className="w-2 h-2 rounded-full bg-green-500" />
                          )}
                        </div>
                      )}
                      <span className={`shrink-0 ${selected
                        ? isDark ? 'text-green-400' : 'text-green-700'
                        : isDark ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        {option.label}
                      </span>
                      {option.sublabel && (
                        <span className={`ml-auto pl-4 text-xs whitespace-nowrap ${
                          isDark ? 'text-gray-400' : 'text-gray-500'
                        }`}>
                          {option.sublabel}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Submit row */}
      {(() => {
        // Check if all options are selected in multiSelect groups
        const allSelected = allSelectedLabel && groups.every(g => {
          if (!g.multiSelect) return true
          const sel = selections[g.id]
          return Array.isArray(sel) && sel.length === g.options.length
        })
        const buttonLabel = allSelected ? allSelectedLabel : submitLabel

        return (
          <div className={`px-3 py-2 border-t flex flex-col gap-2 ${
            isDark ? 'border-white/10' : 'border-gray-100'
          }`}>
            <div className={`text-xs leading-relaxed ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {groups.map(g => {
                const sel = selections[g.id]
                if (Array.isArray(sel)) {
                  return sel.map(v => g.options.find(o => o.value === v)?.label).filter(Boolean).join(', ')
                }
                return g.options.find(o => o.value === sel)?.label
              }).filter(Boolean).join(' · ')}
            </div>
            <button
              onClick={handleSubmit}
              className="self-end px-3 py-1 text-sm font-medium text-green-500 hover:text-green-400 border border-green-500/50 hover:border-green-400 rounded transition-colors animate-shimmer"
              style={{
                background: 'linear-gradient(110deg, transparent 25%, rgba(34, 197, 94, 0.1) 50%, transparent 75%)',
                backgroundSize: '200% 100%',
              }}
            >
              {buttonLabel}
            </button>
          </div>
        )
      })()}
    </div>
  )
}
