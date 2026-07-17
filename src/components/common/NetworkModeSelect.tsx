import { useThemeStore } from '../../stores'
import { IS_TESTNET, setNetworkMode } from '../../config/environment'

/**
 * Subtle inline Mainnets/Testnets selector. Switching persists 'jb-network'
 * and reloads so every module-init constant (chains, contracts, endpoints)
 * re-resolves for the chosen mode. `beforeSwitch` runs first (e.g. the create
 * flow remaps + saves its draft).
 */
export default function NetworkModeSelect({ beforeSwitch }: { beforeSwitch?: (mode: 'mainnet' | 'testnet') => void }) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  return (
    <select
      value={IS_TESTNET ? 'testnet' : 'mainnet'}
      onChange={(e) => {
        const mode = e.target.value as 'mainnet' | 'testnet'
        if ((mode === 'testnet') === IS_TESTNET) return
        beforeSwitch?.(mode)
        setNetworkMode(mode)
      }}
      className={`select-caret shrink-0 bg-transparent border-none pl-0 pr-4 text-[11px] font-semibold cursor-pointer ${
        isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'
      }`}
      title="Switch between mainnets and testnets"
    >
      <option value="mainnet">Mainnets</option>
      <option value="testnet">Testnets</option>
    </select>
  )
}
