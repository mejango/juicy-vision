/**
 * Setup Screen
 *
 * Initial configuration for the terminal.
 * Enter API key, configure device name, etc.
 */

import { useState } from 'react'

interface Settings {
  apiKey: string | null
  apiUrl: string
  deviceName: string
}

interface SetupScreenProps {
  settings: Settings | null
  onSave: (settings: Partial<Settings>) => void
}

export default function SetupScreen({ settings, onSave }: SetupScreenProps) {
  const [apiKey, setApiKey] = useState(settings?.apiKey || '')
  const [apiUrl, setApiUrl] = useState(settings?.apiUrl || 'https://api.juicyvision.app')
  const [deviceName, setDeviceName] = useState(settings?.deviceName || 'PayTerm Device')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleSave = () => {
    if (!apiKey.trim()) {
      alert('Please enter an API key')
      return
    }
    onSave({ apiKey: apiKey.trim(), apiUrl, deviceName })
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">PayTerm</h1>
          <p className="text-gray-400 text-sm">Juicebox Payment Terminal</p>
        </div>

        {/* API Key Input */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Terminal API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="pt_..."
            className="w-full px-4 py-3 bg-white/5 border border-white/10 text-white placeholder-gray-500 text-lg focus:border-juice-cyan outline-none"
          />
          <p className="mt-2 text-xs text-gray-500">
            Get your API key from the merchant dashboard at juicyvision.app/merchant
          </p>
        </div>

        {/* Device Name */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Device Name</label>
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="e.g., Register 1"
            className="w-full px-4 py-3 bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:border-juice-cyan outline-none"
          />
        </div>

        {/* Advanced Settings */}
        <div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-gray-500 hover:text-gray-300"
          >
            {showAdvanced ? '- Hide' : '+ Show'} Advanced Settings
          </button>

          {showAdvanced && (
            <div className="mt-4">
              <label className="block text-sm text-gray-400 mb-2">API URL</label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 text-white font-mono text-sm focus:border-juice-cyan outline-none"
              />
            </div>
          )}
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          className="w-full py-4 bg-juice-cyan text-juice-dark font-semibold text-lg hover:bg-juice-cyan/90 transition-colors"
        >
          Connect Terminal
        </button>

        {/* Version */}
        <p className="text-center text-xs text-gray-600">
          PayTerm v1.0.0
        </p>
      </div>
    </div>
  )
}
