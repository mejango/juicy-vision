import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatUnits } from 'viem'
import { useThemeStore } from '../../stores'
import {
  PAYMENT_REVIEW_EVENT,
  type PaymentReviewRequest,
} from '../../utils/paymentReview'
import TechnicalDetails from '../shared/TechnicalDetails'

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export default function PaymentReviewModal() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [request, setRequest] = useState<PaymentReviewRequest | null>(null)
  const activeRequest = useRef<PaymentReviewRequest | null>(null)

  useEffect(() => {
    const handleReview = (event: Event) => {
      const next = (event as CustomEvent<PaymentReviewRequest>).detail
      if (activeRequest.current) {
        next.respond(false)
        return
      }
      activeRequest.current = next
      setRequest(next)
    }
    window.addEventListener(PAYMENT_REVIEW_EVENT, handleReview)
    return () => {
      window.removeEventListener(PAYMENT_REVIEW_EVENT, handleReview)
      activeRequest.current?.respond(false)
      activeRequest.current = null
    }
  }, [])

  const respond = (approved: boolean) => {
    const current = activeRequest.current
    activeRequest.current = null
    setRequest(null)
    current?.respond(approved)
  }

  if (!request) return null
  const review = request.review
  const addsToBalance = review.action === 'addToBalance'
  const expectedTokens = formatUnits(BigInt(review.expectedProjectTokens), 18)
  const minimumTokens = formatUnits(BigInt(review.minimumProjectTokens), 18)

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="payment-review-title">
      <button
        type="button"
        aria-label="Cancel payment review"
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => respond(false)}
      />
      <div className={`relative flex max-h-[90vh] w-full max-w-lg flex-col border ${
        isDark ? 'border-white/15 bg-juice-dark text-white' : 'border-gray-200 bg-white text-gray-900'
      }`}>
        <div className={`border-b px-5 py-4 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h2 id="payment-review-title" className="text-base font-semibold">
            {addsToBalance ? 'Review balance contribution' : 'Review payment'}
          </h2>
          <p className={`mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Project #{review.projectId} · {review.chainName}
          </p>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <div className={`border p-3 ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Amount</span>
              <span className="font-mono font-semibold">{review.amount} {review.tokenSymbol}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
              <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Route</span>
              <span>{review.route}{review.outcomeRoute ? ` · ${review.outcomeRoute}` : ''}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
              <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Account</span>
              <span className="font-mono">{shortAddress(review.account)}</span>
            </div>
            {!addsToBalance && (
              <>
                <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                  <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Beneficiary</span>
                  <span className="font-mono">{shortAddress(review.beneficiary)}</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                  <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Quoted project tokens</span>
                  <span className="font-mono">{expectedTokens}</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                  <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Minimum received</span>
                  <span className="font-mono">{minimumTokens}</span>
                </div>
              </>
            )}
            {addsToBalance && (
              <p className={`mt-3 text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                Adds funds to the project treasury without issuing project tokens.
              </p>
            )}
          </div>

          {review.nfts.length > 0 && (
            <div className={`border p-3 ${isDark ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-cyan-200 bg-cyan-50'}`}>
              <div className={`mb-2 text-xs font-medium ${isDark ? 'text-cyan-300' : 'text-cyan-800'}`}>NFTs</div>
              {review.nfts.map(nft => (
                <div key={nft.tierId} className="flex justify-between gap-3 text-sm">
                  <span>{nft.name}</span>
                  <span className="font-mono">×{nft.quantity}</span>
                </div>
              ))}
            </div>
          )}

          {review.approval && (
            <div className={`border p-3 ${isDark ? 'border-amber-500/30 bg-amber-500/5' : 'border-amber-200 bg-amber-50'}`}>
              <div className={`text-xs font-medium ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>Token approval required</div>
              <div className="mt-2 text-xs font-mono break-all">approve({review.approval.spender}, {review.approval.amount})</div>
              <div className={`mt-1 text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                Exact amount only · token {shortAddress(review.approval.token)}
              </div>
            </div>
          )}

          <TechnicalDetails
            contract={review.route === 'routed payment' ? 'JB_ROUTER_TERMINAL' : 'JB_MULTI_TERMINAL'}
            contractAddress={review.terminal}
            functionName={addsToBalance ? 'addToBalanceOf' : 'pay'}
            chainId={review.chainId}
            chainName={review.chainName}
            projectId={review.projectId}
            parameters={{
              token: review.tokenAddress,
              amount: review.amountRaw,
              ...(addsToBalance
                ? { shouldReturnHeldFees: false }
                : {
                    beneficiary: review.beneficiary,
                    minReturnedTokens: review.minimumProjectTokens,
                  }),
              memo: review.memo,
              metadata: review.metadata,
              value: review.valueRaw,
              calldata: review.callData,
              approvalCalldata: review.approval?.callData || 'none',
              rulesetId: review.rulesetId,
            }}
            isDark={isDark}
            defaultExpanded
          />
        </div>

        <div className={`flex gap-3 border-t px-5 py-4 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <button
            type="button"
            onClick={() => respond(false)}
            className={`flex-1 border-2 py-3 font-medium ${
              isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => respond(true)}
            className="flex-1 bg-green-500 py-3 font-bold text-black hover:bg-green-500/90"
          >
            Continue to wallet
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
