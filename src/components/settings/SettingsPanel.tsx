import { useState } from 'react'
import { Button, Input, Modal } from '../ui'
import { useSettingsStore, useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const {
    claudeApiKey,
    paraApiKey,
    pinataJwt,
    ankrApiKey,
    theGraphApiKey,
    bendystrawEndpoint,
    relayrEndpoint,
    setClaudeApiKey,
    setParaApiKey,
    setPinataJwt,
    setAnkrApiKey,
    setTheGraphApiKey,
    setBendystrawEndpoint,
    setRelayrEndpoint,
    clearSettings,
  } = useSettingsStore()

  const [localClaudeKey, setLocalClaudeKey] = useState(claudeApiKey)
  const [localParaKey, setLocalParaKey] = useState(paraApiKey)
  const [localPinataJwt, setLocalPinataJwt] = useState(pinataJwt)
  const [localAnkrKey, setLocalAnkrKey] = useState(ankrApiKey)
  const [localTheGraphKey, setLocalTheGraphKey] = useState(theGraphApiKey)
  const [localBendystraw, setLocalBendystraw] = useState(bendystrawEndpoint)
  const [localRelayr, setLocalRelayr] = useState(relayrEndpoint)
  const [showKeys, setShowKeys] = useState(false)
  const { theme } = useThemeStore()
  const { mode, user, isAuthenticated, logout } = useAuthStore()
  const { address: managedAddress } = useManagedWallet()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const handleSave = () => {
    setClaudeApiKey(localClaudeKey)
    setParaApiKey(localParaKey)
    setPinataJwt(localPinataJwt)
    setAnkrApiKey(localAnkrKey)
    setTheGraphApiKey(localTheGraphKey)
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
      setLocalAnkrKey('')
      setLocalTheGraphKey('')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="md">
      <div className="space-y-4">
        {/* Managed Account Section */}
        {isManagedMode && user && (
          <>
            <div className={`p-4 border-2 ${theme === 'dark' ? 'border-juice-cyan/30 bg-juice-cyan/5' : 'border-cyan-200 bg-cyan-50'}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-sm font-semibold ${theme === 'dark' ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                  Managed Account
                </h3>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className={`text-xs ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
                    Active
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Email</span>
                  <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                    {user.email}
                  </p>
                </div>

                {managedAddress && (
                  <div>
                    <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Wallet Address</span>
                    <p className={`font-mono text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                      {managedAddress}
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  logout()
                  onClose()
                }}
                className={`mt-4 w-full py-2 text-sm font-medium border transition-colors ${
                  theme === 'dark'
                    ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
                    : 'border-red-200 text-red-600 hover:bg-red-50'
                }`}
              >
                Sign Out
              </button>
            </div>

            <div className={`border-t pt-4 ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
              <h3 className={`text-sm font-medium mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                API Keys
              </h3>
            </div>
          </>
        )}

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
            placeholder="eyJhbGciOiJIUzI1NiIs..."
          />
          <p className="mt-1 text-xs text-gray-500">
            For pinning project metadata to IPFS.{' '}
            <a
              href="https://app.pinata.cloud/developers/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-juice-cyan hover:underline"
            >
              Get JWT from Pinata
            </a>
          </p>
        </div>

        {/* Ankr API Key */}
        <div>
          <Input
            label="Ankr API Key (optional)"
            type={showKeys ? 'text' : 'password'}
            value={localAnkrKey}
            onChange={(e) => setLocalAnkrKey(e.target.value)}
            placeholder="abc123..."
          />
          <p className="mt-1 text-xs text-gray-500">
            For RPC requests.{' '}
            <a
              href="https://www.ankr.com/rpc/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-juice-cyan hover:underline"
            >
              Get API key from Ankr
            </a>
          </p>
        </div>

        {/* The Graph API Key */}
        <div>
          <Input
            label="The Graph API Key"
            type={showKeys ? 'text' : 'password'}
            value={localTheGraphKey}
            onChange={(e) => setLocalTheGraphKey(e.target.value)}
            placeholder="02c70b717f22ba9a341a29655139ebd9"
          />
          <p className="mt-1 text-xs text-gray-500">
            For Uniswap pool price history. Default key provided.{' '}
            <a
              href="https://thegraph.com/studio/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-juice-cyan hover:underline"
            >
              Get your own from The Graph
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
