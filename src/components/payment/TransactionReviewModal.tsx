import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeFunctionData, formatEther, toFunctionSelector, type AbiFunction } from 'viem'
import { ALL_VIEM_CHAINS } from '../../constants/chains'
import DialogShell from '../ui/DialogShell'
import { useThemeStore } from '../../stores'
import { getAddressLabel } from '../../utils/technicalDetails'
import {
  buildTransactionAuditPrompt,
  registerTransactionReviewHandler,
  transactionReviewJson,
  type TransactionReviewCall,
  type TransactionReviewEventDetail,
} from '../../utils/transactionReview'

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function functionOf(call: TransactionReviewCall): AbiFunction | null {
  if (!call.abi || !call.functionName) return null
  const selector = call.data.slice(0, 10)
  return (call.abi.find(item =>
    item.type === 'function' &&
    item.name === call.functionName &&
    toFunctionSelector(item) === selector
  ) as AbiFunction | undefined) ?? null
}

function argumentsOf(call: TransactionReviewCall): readonly unknown[] {
  if (call.args) return call.args
  if (!call.abi) return []
  try {
    return decodeFunctionData({ abi: call.abi, data: call.data }).args ?? []
  } catch {
    return []
  }
}

function PrettyCall({ call, index, total, isDark }: {
  call: TransactionReviewCall
  index: number
  total: number
  isDark: boolean
}) {
  const fn = functionOf(call)
  const args = argumentsOf(call)
  const chainName = ALL_VIEM_CHAINS[call.chainId as keyof typeof ALL_VIEM_CHAINS]?.name ?? `Chain ${call.chainId}`
  const contractName = call.contractName || getAddressLabel(call.to, String(call.chainId))
  return (
    <section className={`border p-4 ${isDark ? 'border-white/15 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
      <div className={`flex flex-wrap justify-between gap-2 text-[11px] uppercase ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        <span>{total > 1 ? `Call ${index + 1} of ${total}` : 'Exact call'}</span>
        <span>{chainName} · {call.chainId}</span>
      </div>
      {call.label && <h3 className="mt-3 text-sm font-semibold">{call.label}</h3>}
      <dl className="mt-3 space-y-3 text-xs">
        {call.from && <div><dt className={isDark ? 'text-gray-400' : 'text-gray-500'}>From</dt><dd className="mt-1 break-all font-mono">{call.from}</dd></div>}
        <div><dt className={isDark ? 'text-gray-400' : 'text-gray-500'}>Destination{contractName ? ` · ${contractName}` : ''}</dt><dd className="mt-1 break-all font-mono">{call.to}</dd></div>
        <div><dt className={isDark ? 'text-gray-400' : 'text-gray-500'}>Native value</dt><dd className="mt-1 font-mono">{formatEther(call.value ?? 0n)} native · {(call.value ?? 0n).toString()} wei</dd></div>
      </dl>
      {fn ? (
        <div className={`mt-4 border-t pt-3 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Contract function</p>
          <p className="mt-1 break-all font-mono text-sm font-semibold">{fn.name}({fn.inputs.map(input => input.type).join(', ')})</p>
          <div className="mt-3 space-y-2">
            {fn.inputs.map((input, argumentIndex) => (
              <div key={`${input.name}-${argumentIndex}`} className={`p-3 text-xs ${isDark ? 'bg-black/25' : 'bg-white'}`}>
                <p className="font-medium">{input.name || `argument ${argumentIndex + 1}`} <span className="font-normal opacity-60">{input.type}</span></p>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono">{stringify(args[argumentIndex])}</pre>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={`mt-4 border p-3 text-xs ${isDark ? 'border-amber-400/30 bg-amber-400/5 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          The ABI is not attached to this flow. Verify selector {call.data.slice(0, 10)} and the complete calldata in Raw.
        </div>
      )}
    </section>
  )
}

export default function TransactionReviewModal() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [active, setActive] = useState<TransactionReviewEventDetail | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const activeRef = useRef<TransactionReviewEventDetail | null>(null)
  const queue = useRef<TransactionReviewEventDetail[]>([])

  const enqueue = useCallback((review: TransactionReviewEventDetail['review']) => {
    return new Promise<boolean>(resolve => {
      const next: TransactionReviewEventDetail = { review, respond: resolve }
      if (activeRef.current) queue.current.push(next)
      else {
        activeRef.current = next
        setActive(next)
      }
    })
  }, [])

  useEffect(() => {
    const unregister = registerTransactionReviewHandler(enqueue)
    return () => {
      unregister()
      activeRef.current?.respond(false)
      queue.current.forEach(item => item.respond(false))
      queue.current = []
    }
  }, [enqueue])

  const finish = (approved: boolean) => {
    const current = activeRef.current
    if (!current) return
    const next = queue.current.shift() ?? null
    activeRef.current = next
    setActive(next)
    setAgreed(false)
    current.respond(approved)
  }

  if (!active) return null
  const review = active.review
  const authorization = review.kind === 'authorization'

  return (
    <DialogShell
      isOpen
      onClose={() => finish(false)}
      labelledBy="transaction-review-title"
      contentClassName={`relative flex max-h-[92vh] w-full max-w-3xl flex-col border ${isDark ? 'border-white/15 bg-juice-dark text-white' : 'border-gray-200 bg-white text-gray-900'}`}
    >
        <header className={`flex items-start justify-between border-b px-5 py-4 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div><p className="text-[11px] font-semibold uppercase text-juice-orange">Transaction safety check</p><h2 id="transaction-review-title" className="mt-1 text-base font-semibold">{review.title ?? (authorization ? 'Review authorization' : 'Review transaction')}</h2></div>
          <button type="button" className={`border px-3 py-1 text-xs ${isDark ? 'border-white/20' : 'border-gray-300'}`} onClick={() => finish(false)}>Close</button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <p className={`border p-3 text-xs leading-relaxed ${isDark ? 'border-juice-orange/40 bg-juice-orange/5 text-gray-200' : 'border-orange-200 bg-orange-50 text-orange-950'}`}>
            {review.description ?? (authorization
              ? 'This authorization commits to the exact typed data and resulting calls below. It does not itself prove those calls executed.'
              : 'These are the exact app-controlled fields that will be submitted. Wallet-selected nonce and network fees are not shown.')}
          </p>
          {review.calls.map((call, index) => <PrettyCall key={`${call.chainId}:${call.to}:${index}`} call={call} index={index} total={review.calls.length} isDark={isDark} />)}
          <details className={`border ${isDark ? 'border-white/15 bg-black/20' : 'border-gray-200 bg-gray-50'}`}>
            <summary className="cursor-pointer px-4 py-3 text-xs font-semibold">Raw transaction payload</summary>
            <pre className={`max-h-96 overflow-auto border-t p-4 text-[11px] leading-relaxed ${isDark ? 'border-white/10 bg-black/40 text-gray-200' : 'border-gray-200 bg-gray-950 text-gray-100'}`}>{transactionReviewJson(review)}</pre>
          </details>
          <button type="button" className={`border px-4 py-2 text-xs font-semibold ${isDark ? 'border-juice-cyan/50 text-juice-cyan' : 'border-teal-600 text-teal-700'}`} onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildTransactionAuditPrompt(review))
              setCopyState('copied')
            } catch {
              setCopyState('failed')
            }
            window.setTimeout(() => setCopyState('idle'), 2200)
          }}>{copyState === 'copied' ? 'Prompt copied — paste into your LLM' : copyState === 'failed' ? 'Could not copy prompt' : '[copy tx audit prompt]'}</button>
        </div>
        <footer className={`border-t p-5 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <label className={`flex items-start gap-3 border p-3 text-xs leading-relaxed ${isDark ? 'border-white/15 bg-white/5' : 'border-gray-200 bg-gray-50'}`}><input className="mt-0.5" type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span>I reviewed the chain, destination, native value, calldata{authorization ? ', and exact authorization' : ''}. I agree to this exact payload.</span></label>
          <div className="mt-4 flex gap-3"><button type="button" className={`flex-1 border-2 py-3 font-medium ${isDark ? 'border-white/20' : 'border-gray-200'}`} onClick={() => finish(false)}>Cancel</button><button type="button" disabled={!agreed} className="flex-1 bg-green-500 py-3 font-bold text-black disabled:cursor-not-allowed disabled:opacity-40" onClick={() => finish(true)}>{review.confirmLabel ?? (authorization ? 'Agree & authorize' : 'Agree & continue')}</button></div>
        </footer>
    </DialogShell>
  )
}
