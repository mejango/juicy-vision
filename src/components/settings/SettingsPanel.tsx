import { useState } from 'react'
import { Button, Input, Modal } from '../ui'
import { useSettingsStore, useThemeStore } from '../../stores'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const {
    claudeApiKey,
    paraApiKey,
    pinataJwt,
    bendystrawEndpoint,
    relayrEndpoint,
    setClaudeApiKey,
    setParaApiKey,
    setPinataJwt,
    setBendystrawEndpoint,
    setRelayrEndpoint,
    clearSettings,
  } = useSettingsStore()

  const [localClaudeKey, setLocalClaudeKey] = useState(claudeApiKey)
  const [localParaKey, setLocalParaKey] = useState(paraApiKey)
  const [localPinataJwt, setLocalPinataJwt] = useState(pinataJwt)
  const [localBendystraw, setLocalBendystraw] = useState(bendystrawEndpoint)
  const [localRelayr, setLocalRelayr] = useState(relayrEndpoint)
  const [showKeys, setShowKeys] = useState(false)
  const { theme } = useThemeStore()

  const handleSave = () => {
    setClaudeApiKey(localClaudeKey)
    setParaApiKey(localParaKey)
    setPinataJwt(localPinataJwt)
    setBendystrawEndpoint(localBendystraw)
    setRelayrEndpoint(localRelayr)
    onClose()
  }

  const handleClear = () => {
    if (confirm('Clear all settings? This cannot be undone.')) {
      clearSettings()
      setLocalClaudeKey('')
      setLocalParaKey('')
      setLocalPinataJwt('')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="md">
      <div className="space-y-4">
        {/* Claude API Key */}
        <div>
          <Input
            label="Claude API Key"
            type={showKeys ? 'text' : 'password'}
            value={localClaudeKey}
            onChange={(e) => setLocalClaudeKey(e.target.value)}
            placeholder="sk-ant-..."
            rightElement={
              <button
                type="button"
                onClick={() => setShowKeys(!showKeys)}
                className="text-gray-400 hover:text-white"
              >
                {showKeys ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            }
          />
          <p className="mt-1 text-xs text-gray-500">
            Get your API key from{' '}
            <a
              href="https://console.anthropic.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-juice-cyan hover:underline"
            >
              console.anthropic.com
            </a>
          </p>
        </div>

        {/* Para API Key */}
        <div>
          <Input
            label="Para API Key (optional)"
            type={showKeys ? 'text' : 'password'}
            value={localParaKey}
            onChange={(e) => setLocalParaKey(e.target.value)}
            placeholder="para_..."
          />
          <p className="mt-1 text-xs text-gray-500">
            For passkey wallet support
          </p>
        </div>

        {/* Pinata JWT */}
        <div>
          <Input
            label="Pinata JWT (optional)"
            type={showKeys ? 'text' : 'password'}
            value={localPinataJwt}
            onChange={(e) => setLocalPinataJwt(e.target.value)}
            placeholder="eyJhbGciOiJS..."
          />
          <p className="mt-1 text-xs text-gray-500">
            For pinning project metadata to IPFS.{' '}
            <a
              href="https://app.pinata.cloud/developers/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-juice-cyan hover:underline"
            >
              Get a JWT from Pinata
            </a>
          </p>
        </div>

        {/* Divider */}
        <div className={`border-t pt-4 ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
          <h3 className={`text-sm font-medium mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Advanced</h3>
        </div>

        {/* Bendystraw Endpoint */}
        <Input
          label="Bendystraw GraphQL Endpoint"
          value={localBendystraw}
          onChange={(e) => setLocalBendystraw(e.target.value)}
          placeholder="https://api.bendystraw.xyz/graphql"
        />

        {/* Relayr Endpoint */}
        <Input
          label="Relayr API Endpoint"
          value={localRelayr}
          onChange={(e) => setLocalRelayr(e.target.value)}
          placeholder="https://api.relayr.ba5ed.com"
        />

        {/* Actions */}
        <div className={`flex gap-3 pt-4 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
          <Button onClick={handleClear} variant="ghost" className="text-red-400">
            Clear All
          </Button>
          <div className="flex-1" />
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button onClick={handleSave} variant="outline">
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
