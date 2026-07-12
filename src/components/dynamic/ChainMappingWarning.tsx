export function ChainMappingWarning({ isDark }: { isDark: boolean }) {
  return (
    <div className={`border px-3 py-2 text-xs ${
      isDark
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-amber-300 bg-amber-50 text-amber-800'
    }`}>
      Cross-chain project mapping is unavailable. Only the current chain is shown.
    </div>
  )
}
