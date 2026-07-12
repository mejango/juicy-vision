import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { FundAccessAmountInput } from '../../src/components/fundAccess/FundAccessAmountInput'
import { FundAccessSummary } from '../../src/components/fundAccess/FundAccessSummary'
import {
  MAX_UINT224,
  PRICE_FIDELITY,
  type FundAccessAmountSnapshot,
  type FundAccessContextSnapshot,
} from '../../src/services/fundAccess'

const available = 123_456_789_012_345_678_901_234_567_890_123_456n
const context: FundAccessContextSnapshot = {
  projectId: 1n,
  terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
  store: '0x7497ae014a60561925b51c0a3b4ade7460b9927c',
  prices: '0xad45e4627f068d1e6b21e5301870d807543a8401',
  rulesets: '0x26f2228a4e8b0079ed1c2a3d22f12ff7f83cdfba',
  fundAccessLimits: '0xc93360158f187fc8fc8f1062a1b31d06f185dbab',
  token: '0x000000000000000000000000000000000000eeee',
  tokenSymbol: 'ETH',
  decimals: 18,
  accountingCurrency: 61_166n,
  rulesetId: 281_474_976_710_655n,
  rulesetCycleNumber: 281_474_976_710_655n,
  balance: available,
  currentSurplus: available,
  payoutLimits: [],
  surplusAllowances: [],
}

const payout: FundAccessAmountSnapshot = {
  configured: MAX_UINT224 - 1n,
  used: 1n,
  remaining: MAX_UINT224 - 2n,
  currency: 4_294_967_295n,
  pricePerUnit: PRICE_FIDELITY,
  sourceInCurrency: available,
  available,
  unlimited: false,
}

const allowance: FundAccessAmountSnapshot = {
  ...payout,
  configured: MAX_UINT224,
  remaining: MAX_UINT224,
  unlimited: true,
}

function Harness() {
  const [payoutAmount, setPayoutAmount] = useState('')
  const [allowanceAmount, setAllowanceAmount] = useState('')
  return (
    <main className="mx-auto grid w-full min-w-0 max-w-md gap-4" data-testid="fund-access-mobile-harness">
      <section className="w-full min-w-0 overflow-hidden border border-white/10 p-2">
        <FundAccessSummary kind="payout" context={context} access={payout} isDark />
        <div className="mt-2">
          <FundAccessAmountInput
            kind="payout"
            context={context}
            access={payout}
            amount={payoutAmount}
            onAmountChange={setPayoutAmount}
            onSubmit={() => undefined}
            submitLabel="Review"
            isDark
          />
        </div>
      </section>
      <section className="w-full min-w-0 overflow-hidden border border-white/10 p-2">
        <FundAccessSummary kind="allowance" context={context} access={allowance} isDark />
        <div className="mt-2">
          <FundAccessAmountInput
            kind="allowance"
            context={context}
            access={allowance}
            amount={allowanceAmount}
            onAmountChange={setAllowanceAmount}
            onSubmit={() => undefined}
            submitLabel="Review"
            isDark
          />
        </div>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
