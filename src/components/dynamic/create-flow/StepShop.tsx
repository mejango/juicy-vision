/**
 * Create-flow Step 4: Shop — a 1:1 port of the website's renderNfts
 * (website/src/create-flow.js: renderNfts / itemCard / itemSummary / itemEditor /
 * itemMediaPicker / itemSplitRow / collectionExtrasSection). Copy comes verbatim
 * from the source flow. One deliberate deviation: no Pinata JWT field in Store
 * config — juicy-vision pins via its configured backend key.
 */

import { useCallback, useState } from 'react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { pinFile } from '../../../utils/ipfs'
import { itemDraft, surplusTokenLabel, type CreateFlowState, type ItemState } from './state'
import {
  AddLink, Collapse, CurrencySelect, EnsAddressInput, FieldBlock, Hint, IdleToggle, ImagePicker,
  InfoNote, NumberInput, Select, StepHead, TextArea, TextInput, ToggleRow, WarnNote,
  labelClass, useIsDark,
} from './controls'

const ITEM_MAX_MEDIA_MB = 25
const ITEM_MAX_MEDIA_BYTES = ITEM_MAX_MEDIA_MB * 1024 * 1024
const ITEM_MEDIA_ACCEPT = 'image/*,video/*,audio/*,.pdf,.txt'

interface StepProps {
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
}

// ---------------------------------------------------------------------------
// Store currency helpers — mirrors of the website's storeCur / storeUnit /
// lockedCurrencySym chain (customAccounting / customAcctSym / usdcAccounting).
// ---------------------------------------------------------------------------

function customAccounting(state: CreateFlowState): boolean {
  return state.accepts[0] === 'custom'
}

function customAcctSym(state: CreateFlowState): string | null {
  return customAccounting(state) ? (state.customToken.symbol || 'TOKEN') : null
}

function usdcAccounting(state: CreateFlowState): boolean {
  return !customAccounting(state) && state.accepts.includes('usdc')
}

function lockedCurrencySym(state: CreateFlowState): string | null {
  return customAcctSym(state) || (usdcAccounting(state) ? 'USD' : null)
}

function storeCur(state: CreateFlowState): number {
  return state.storePricingCurrency || 1
}

function storeUnit(state: CreateFlowState): string {
  return customAccounting(state) ? (customAcctSym(state) as string) : (storeCur(state) === 2 ? 'USD' : 'ETH')
}

function anyTokenCashOut(state: CreateFlowState): boolean {
  return state.stages.some((s) => s.cashOutEnabled)
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

function itemFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (Math.round(bytes / 1024 / 1024 * 10) / 10) + ' MB'
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
  return bytes + ' B'
}

function itemSummary(state: CreateFlowState, nft: ItemState): string {
  const unit = storeUnit(state)
  const parts: string[] = []
  parts.push((nft.price ? nft.price : '0') + ' ' + unit)
  parts.push(nft.limited ? ((nft.supply || '0') + ' for sale') : 'unlimited')
  if (Number(nft.category) > 0) {
    const c = state.storeCategories.find((x) => x.id === Number(nft.category))
    parts.push('category ' + (c ? c.name : ('#' + nft.category)))
  }
  if (nft.splitOn) parts.push('split sales')
  if (nft.discountOn && Number(nft.discountPct) > 0) parts.push(round2(Number(nft.discountPct)) + '% off')
  if (nft.reserveOn) parts.push('reserved')
  return parts.join(' | ')
}

// Collection name/symbol default to the project name set in Details (empty if none); the project owner
// can change them onchain later. Once the user edits a field, their value sticks.
function collectionNameOf(state: CreateFlowState): string {
  if (state.collection.nameTouched) return state.collection.name
  return state.details.name || ''
}

function collectionSymbolOf(state: CreateFlowState): string {
  if (state.collection.symbolTouched) return state.collection.symbol
  // Default the NFT collection symbol to the project's token symbol (the Details ticker), not its name.
  return state.details.ticker || ''
}

// ---------------------------------------------------------------------------
// Step component
// ---------------------------------------------------------------------------

export default function StepShop({ state, update }: StepProps) {
  return (
    <div>
      <StepHead desc="Sell items to customers and supporters." />

      {/* Store pricing currency — what every item's price is denominated in. */}
      <FieldBlock label="Store pricing currency">
        <CurrencySelect
          value={storeCur(state)}
          onChange={(v) => update((s) => { s.storePricingCurrency = v })}
          lockedSymbol={lockedCurrencySym(state)}
        />
      </FieldBlock>

      {/* Opt-in: the Shop is off by default. Ticking it on reveals the first item to fill out. */}
      <ToggleRow
        label="Launch with items in stock"
        on="Your project launches with items already for sale."
        off="You can add items to sell anytime after launch."
        checked={state.shopEnabled}
        onChange={(v) => update((s) => {
          s.shopEnabled = v
          if (v && !s.nfts.length) s.nfts.push(itemDraft())
        })}
      />

      {state.shopEnabled && (
        <div>
          {state.nfts.map((nft, idx) => (
            <ItemCard key={idx} state={state} nft={nft} idx={idx} update={update} />
          ))}
          <AddLink
            label="+ Add item"
            onClick={() => update((s) => {
              s.nfts.forEach((n) => { n.expanded = false })
              s.nfts.push(itemDraft())
            })}
          />
        </div>
      )}

      {/* Store Config (collection name/symbol, store-wide flags) is always available — the owner
          can configure the store even when launching with no items in stock. */}
      <div className="mt-4">
        <Collapse
          label="Store config"
          open={state.collection.extrasOpen}
          onToggle={() => update((s) => { s.collection.extrasOpen = !s.collection.extrasOpen })}
        >
          <StoreConfigSection state={state} update={update} />
        </Collapse>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One item as an expandable inline card — same head/caret/remove pattern as a
// ruleset card. Per-card transient state (media busy, add-category) lives here.
// ---------------------------------------------------------------------------

function ItemCard({ state, nft, idx, update }: {
  state: CreateFlowState
  nft: ItemState
  idx: number
  update: (fn: (s: CreateFlowState) => void) => void
}) {
  const isDark = useIsDark()
  return (
    <div className={`border mb-3 ${isDark ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-gray-50/50'}`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => update((s) => { const n = s.nfts[idx]; if (n) n.expanded = !n.expanded })}
      >
        <div className="flex-1 min-w-0">
          <div className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {nft.name || ('Item #' + (idx + 1))}
          </div>
          <div className={`text-xs mt-0.5 truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {itemSummary(state, nft)}
          </div>
        </div>
        <button
          type="button"
          className="text-xs text-gray-500 hover:text-red-400"
          onClick={(e) => {
            e.stopPropagation()
            update((s) => {
              s.nfts.splice(idx, 1)
              if (!s.nfts.length) s.shopEnabled = false
            })
          }}
        >
          ✕
        </button>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{nft.expanded ? '▾' : '▸'}</span>
      </div>
      {nft.expanded && <ItemEditor state={state} nft={nft} idx={idx} update={update} />}
    </div>
  )
}

// Inline editor for one item — same fields as the project-page store modal, rendered inline (no popover).
function ItemEditor({ state, nft, idx, update }: {
  state: CreateFlowState
  nft: ItemState
  idx: number
  update: (fn: (s: CreateFlowState) => void) => void
}) {
  const pinataJwt = useSettingsStore((s) => s.pinataJwt)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [catAdding, setCatAdding] = useState(false)
  const [catName, setCatName] = useState('')
  const [resolvedBenef, setResolvedBenef] = useState<string | null>(null)
  const onBenefResolved = useCallback((addr: string | null) => setResolvedBenef(addr), [])

  const upd = (fn: (n: ItemState) => void) => update((s) => { const n = s.nfts[idx]; if (n) fn(n) })

  const priceUnit = storeUnit(state)
  const hasPrice = parseFloat(nft.price) > 0

  // Pins the chosen file immediately (any type) and stores imageUri + mediaType.
  const onPickMedia = (f: File) => {
    if (!pinataJwt) {
      alert('IPFS pinning isn’t available right now — you can add item media later by editing the project.')
      return
    }
    if (f.size > ITEM_MAX_MEDIA_BYTES) {
      alert('That file is ' + itemFileSize(f.size) + ' — over the ' + ITEM_MAX_MEDIA_MB + ' MB max.')
      return
    }
    setMediaBusy(true)
    pinFile(f, pinataJwt, nft.name || f.name)
      .then((cid) => {
        upd((n) => { n.imageUri = `ipfs://${cid}`; n.mediaType = (f.type || '').toLowerCase() })
        setMediaBusy(false)
      })
      .catch((e: unknown) => {
        setMediaBusy(false)
        alert('Could not upload: ' + (e instanceof Error ? e.message : String(e)))
      })
  }

  const clearMedia = () => upd((n) => { n.imageUri = ''; n.mediaType = '' })
  const mediaIsImage = !nft.imageUri || (nft.mediaType || '').indexOf('image') === 0

  const minter = state.projectType === 'revnet' ? 'revnet operator' : 'project owner'
  const minterCap = minter.charAt(0).toUpperCase() + minter.slice(1)

  const benefWarn = Number(nft.reserveFrequency) > 0 && !resolvedBenef

  return (
    <div className="px-4 pb-4">
      <FieldBlock label="Name">
        <TextInput value={nft.name} placeholder="My juicy thing" onChange={(v) => upd((n) => { n.name = v })} />
      </FieldBlock>

      <FieldBlock label="Media">
        {mediaIsImage ? (
          <ImagePicker
            uri={nft.imageUri}
            busy={mediaBusy}
            accept={ITEM_MEDIA_ACCEPT}
            onPick={onPickMedia}
            onClear={nft.imageUri ? clearMedia : undefined}
          />
        ) : (
          <div className="flex items-center gap-3">
            <ImagePicker uri="" busy={mediaBusy} accept={ITEM_MEDIA_ACCEPT} onPick={onPickMedia} />
            <span className="text-xs text-gray-500">{(nft.mediaType || 'file') + ' | pinned'}</span>
            <button type="button" title="Remove" onClick={clearMedia} className="text-xs text-gray-500 hover:text-red-400">✕</button>
          </div>
        )}
        <Hint>Image, gif, video, audio, PDF, text… up to {ITEM_MAX_MEDIA_MB} MB.</Hint>
      </FieldBlock>

      <FieldBlock label="Description" optional>
        <TextArea value={nft.description} onChange={(v) => upd((n) => { n.description = v })} />
      </FieldBlock>

      <FieldBlock label={`Price (${priceUnit})`}>
        <TextInput value={nft.price} placeholder="0.0" onChange={(v) => upd((n) => { n.price = v.trim() })} />
      </FieldBlock>

      {/* Split sales + Initial discount only make sense once there's a price — always shown, idle when free. */}
      {!hasPrice ? (
        <>
          <IdleToggle label="Split sales" sub="Set a price above to split each sale." />
          <IdleToggle label="Initial discount" sub="Set a price above to start the item at a discount." />
        </>
      ) : (
        <>
          <ToggleRow
            label="Split sales"
            on="Send part of each sale to other addresses or projects; the rest goes to this project."
            off="The whole sale goes to this project."
            checked={nft.splitOn}
            onChange={(v) => upd((n) => {
              n.splitOn = v
              if (v && !n.splitRecipients.length) n.splitRecipients.push({ pct: '', recip: '', benef: '' })
            })}
          />
          {nft.splitOn && (
            <div className="pl-5 mb-3">
              {nft.splitRecipients.map((rec, i) => (
                <ItemSplitRow key={i} rec={rec} i={i} nftIdx={idx} update={update} />
              ))}
              <AddLink
                label="+ Add recipient"
                onClick={() => upd((n) => { n.splitRecipients.push({ pct: '', recip: '', benef: '' }) })}
              />
              {nft.flags.allowCredits && (
                <WarnNote>
                  Buying with shop credit bypasses this split — the split only divides new payment, and a credit purchase brings in little or none. To make every sale honor the split, turn off “Allow credit purchases” under Extra options.
                </WarnNote>
              )}
            </div>
          )}
          <ToggleRow
            label="Initial discount"
            on="The item starts at a percent off its price."
            off="The item sells at full price."
            checked={nft.discountOn}
            onChange={(v) => upd((n) => {
              n.discountOn = v
              if (!v) n.discountPct = ''
            })}
          />
          {nft.discountOn && (
            <div className="flex items-center gap-2 text-sm mb-3">
              <NumberInput
                value={nft.discountPct}
                min={0}
                max={100}
                step="any"
                placeholder="10"
                className="w-20"
                onChange={(v) => upd((n) => { n.discountPct = v.trim() })}
              />
              <span> % off the price</span>
            </div>
          )}
        </>
      )}

      <ToggleRow
        label="Unlimited inventory"
        on="Any number can be sold."
        off="Only a set quantity can be sold."
        checked={!nft.limited}
        onChange={(v) => upd((n) => { n.limited = !v })}
      />
      {nft.limited && (
        <FieldBlock label="Quantity">
          <TextInput value={nft.supply} placeholder="100" onChange={(v) => upd((n) => { n.supply = v.trim() })} />
        </FieldBlock>
      )}

      {/* Category */}
      <FieldBlock label="Category">
        <div className="text-xs mb-2 text-gray-500">Items being sold can be organized by category.</div>
        {catAdding ? (
          <div className="flex items-center gap-2">
            <TextInput value={catName} placeholder="category name" onChange={setCatName} />
            <AddLink
              label="Save"
              onClick={() => {
                const nm = catName.trim()
                if (!nm) return
                update((s) => {
                  const nextId = s.storeCategories.reduce((m, x) => (x.id > m ? x.id : m), 0) + 1
                  s.storeCategories.push({ id: nextId, name: nm })
                  const n = s.nfts[idx]
                  if (n) n.category = nextId
                })
                setCatAdding(false)
                setCatName('')
              }}
            />
          </div>
        ) : (
          <Select
            value={String(nft.category || 0)}
            options={[
              ['0', 'Default'],
              ...state.storeCategories.map((x): [string, string] => [String(x.id), `${x.name} (#${x.id})`]),
              ['__add__', '+ Add category…'],
            ]}
            onChange={(v) => {
              if (v === '__add__') setCatAdding(true)
              else upd((n) => { n.category = Number(v) || 0 })
            }}
          />
        )}
      </FieldBlock>

      {/* Extra options */}
      <Collapse
        label="Extra options"
        optional
        open={nft.advOpen}
        onToggle={() => upd((n) => { n.advOpen = !n.advOpen })}
      >
        <ToggleRow
          label="Reserve inventory"
          on="Set aside 1 of every N sold for a chosen address."
          off="No inventory is reserved."
          checked={nft.reserveOn}
          onChange={(v) => upd((n) => { n.reserveOn = v })}
        />
        {nft.reserveOn && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span>1 of </span>
              <NumberInput
                value={nft.reserveFrequency}
                min={1}
                step={1}
                placeholder="10"
                className="w-20"
                onChange={(v) => upd((n) => { n.reserveFrequency = v.trim() })}
              />
              <span> sold to </span>
              <EnsAddressInput
                value={nft.reserveBeneficiary}
                placeholder="0x… or name.eth"
                className="flex-1"
                onChange={(v) => upd((n) => { n.reserveBeneficiary = v.trim() })}
                onResolved={onBenefResolved}
              />
            </div>
            {/* Reserving requires a beneficiary, or the deploy reverts (JB721TiersHookStore_MissingReserveBeneficiary). */}
            {benefWarn && (
              <WarnNote>Add the address that receives the reserved set-aside, or this item will fail to deploy.</WarnNote>
            )}
          </>
        )}
        <ToggleRow
          label={`${minterCap} can mint for free`}
          on={`The ${minter} can mint this item from inventory without paying.`}
          off={`The ${minter} pays like everyone else.`}
          checked={nft.flags.allowOwnerMint}
          onChange={(v) => upd((n) => { n.flags.allowOwnerMint = v })}
        />
        <ToggleRow
          label="Transfers pausable per ruleset"
          on="This item’s transfers can be paused during a ruleset."
          off="This item’s transfers can’t be paused."
          checked={nft.flags.transfersPausable}
          onChange={(v) => upd((n) => { n.flags.transfersPausable = v })}
        />
        <ToggleRow
          label="Permanent"
          on="This item can never be removed from the store."
          off="This item can be removed later."
          checked={nft.flags.cantBeRemoved}
          onChange={(v) => upd((n) => { n.flags.cantBeRemoved = v })}
        />
        <ToggleRow
          label="Allow credit purchases"
          on="Payments that don’t buy an item become credit usable on items that allow it."
          off="Payments that don’t buy this item don’t earn credit toward it."
          checked={nft.flags.allowCredits}
          onChange={(v) => upd((n) => { n.flags.allowCredits = v })}
        />
        <ToggleRow
          label={`${minterCap} can edit discounts`}
          on={`The ${minter} can change this item’s discount later.`}
          off="This item’s discount is locked."
          checked={nft.flags.ownerCanEditDiscount}
          onChange={(v) => upd((n) => { n.flags.ownerCanEditDiscount = v })}
        />
        <ToggleRow
          label="Custom voting units"
          on="Give this item a specific governance weight."
          off="Governance weight follows the item price."
          checked={nft.votingOn}
          onChange={(v) => upd((n) => {
            n.votingOn = v
            if (!v) n.votingUnits = ''
          })}
        />
        {nft.votingOn && (
          <FieldBlock label="Voting units">
            <TextInput value={nft.votingUnits} placeholder="0" onChange={(v) => upd((n) => { n.votingUnits = v.trim() })} />
          </FieldBlock>
        )}
      </Collapse>
    </div>
  )
}

// One "Send N% to X" row — with the beneficiary row shown when the recipient is a project ID.
function ItemSplitRow({ rec, i, nftIdx, update }: {
  rec: { pct: number | string; recip: string; benef: string }
  i: number
  nftIdx: number
  update: (fn: (s: CreateFlowState) => void) => void
}) {
  const upd = (fn: (r: { pct: number | string; recip: string; benef: string }) => void) =>
    update((s) => { const r = s.nfts[nftIdx]?.splitRecipients[i]; if (r) fn(r) })

  const recipVal = (rec.recip || '').trim()
  const isProjectId = /^[0-9]+$/.test(recipVal) && Number(recipVal) > 0

  return (
    <div className={i > 0 ? 'mt-3' : ''}>
      <div className="flex items-center gap-2 text-sm">
        <span>{i === 0 ? 'Send' : '… and'}</span>
        <NumberInput
          value={rec.pct || ''}
          min={0}
          step="any"
          placeholder="10"
          className="w-20"
          onChange={(v) => upd((r) => { r.pct = v.trim() })}
        />
        <span>%</span>
        <span>to</span>
        <EnsAddressInput
          value={rec.recip}
          placeholder="0x…, name.eth, or project ID"
          className="flex-1"
          onChange={(v) => upd((r) => { r.recip = v })}
        />
        <button
          type="button"
          title="Remove"
          className="text-xs text-gray-500 hover:text-red-400"
          onClick={() => update((s) => { s.nfts[nftIdx]?.splitRecipients.splice(i, 1) })}
        >
          ✕
        </button>
      </div>
      {isProjectId && (
        <div className="flex items-center gap-2 text-sm mt-2">
          <span>with beneficiary</span>
          <EnsAddressInput
            value={rec.benef}
            placeholder="0x… or name.eth"
            className="flex-1"
            onChange={(v) => upd((r) => { r.benef = v.trim() })}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Everything that applies to the whole collection (not a single item) —
// collection name/symbol and the top-level JB721TiersHookFlags.
// ---------------------------------------------------------------------------

function StoreConfigSection({ state, update }: StepProps) {
  const isDark = useIsDark()
  const c = state.collection

  return (
    <div>
      <div className="text-xs mb-3 text-gray-500">The project owner can set or change these anytime after launch.</div>

      <FieldBlock label="Collection name">
        <TextInput
          value={collectionNameOf(state)}
          placeholder={state.details.name || 'Collection name'}
          onChange={(v) => update((s) => { s.collection.name = v; s.collection.nameTouched = true })}
        />
      </FieldBlock>

      {/* a symbol is short — 1/4 width */}
      <FieldBlock label="Collection symbol">
        <TextInput
          value={collectionSymbolOf(state)}
          placeholder={state.details.ticker || 'Symbol'}
          className="w-1/4 min-w-[120px]"
          onChange={(v) => update((s) => { s.collection.symbol = v; s.collection.symbolTouched = true })}
        />
      </FieldBlock>

      <ToggleRow
        label="Require exact payment"
        on="Payers must pay an item’s exact price — anything extra is turned away."
        off="Payers can overpay; the extra is kept as spendable credit."
        checked={c.preventOverspending}
        onChange={(v) => update((s) => { s.collection.preventOverspending = v })}
      />
      <ToggleRow
        label="Lock reserved items after launch"
        on="New items added after launch can’t set aside reserved inventory."
        off="New items added after launch can set aside reserved inventory."
        checked={c.noNewTiersWithReserves}
        onChange={(v) => update((s) => { s.collection.noNewTiersWithReserves = v })}
      />
      <ToggleRow
        label="Lock voting items after launch"
        on="New items added after launch can’t carry custom voting power."
        off="New items added after launch can carry custom voting power."
        checked={c.noNewTiersWithVotes}
        onChange={(v) => update((s) => { s.collection.noNewTiersWithVotes = v })}
      />
      <ToggleRow
        label="Lock owner minting after launch"
        on="New items added after launch can’t let the owner mint for free."
        off="New items added after launch can let the owner mint for free."
        checked={c.noNewTiersWithOwnerMinting}
        onChange={(v) => update((s) => { s.collection.noNewTiersWithOwnerMinting = v })}
      />
      <ToggleRow
        label="Give split recipients project tokens"
        on="Sale-split recipients also receive project tokens for their share."
        off="Sale-split recipients receive funds only, no project tokens."
        checked={c.issueTokensForSplits}
        onChange={(v) => update((s) => { s.collection.issueTokensForSplits = v })}
      />

      {/* useDataHookForCashOut — item holders redeem items against project surplus. Revnets force this on at the
          deployer (so it's custom-only). Mutually exclusive with TOKEN cash out (set in rulesets): the 721 hook
          reverts on any token cash out, so if token cash outs are on we idle this instead of letting both be set. */}
      {state.projectType !== 'revnet' && (
        anyTokenCashOut(state) && !c.useForRedemptions ? (
          <IdleToggle
            label="Give items cash out access to surplus funds"
            sub="Token cash outs are enabled in your rulesets — tokens and items can’t both be cashed out. Turn off token cash outs to let items redeem."
          />
        ) : (
          <>
            <ToggleRow
              label="Give items cash out access to surplus funds"
              on={`Item holders can cash out their items for a share of the project’s surplus ${surplusTokenLabel(state)}.`}
              off="Items can’t be cashed out — they grant no claim on surplus."
              checked={c.useForRedemptions}
              onChange={(v) => update((s) => { s.collection.useForRedemptions = v })}
            />
            {c.useForRedemptions && <InfoNote>Items redeem at the cash out tax you set in your rulesets.</InfoNote>}
          </>
        )
      )}

      {/* Revnet operator 721 permissions — REVDeployer grants the operator all four by default; these let the
          user revoke individual ones at deploy time (encoded as the REVDeploy721TiersHookConfig preventOperator* flags). */}
      {state.projectType === 'revnet' && (
        <div className="mt-4">
          <div className={labelClass(isDark)}>Operator store permissions</div>
          <div className="text-xs mb-2 text-gray-500">What the revnet operator can do to the store after launch.</div>
          <ToggleRow
            label="Operator can add & remove items"
            on="The operator can adjust the store’s items."
            off="The operator can’t change the store’s items."
            checked={c.opCanAdjustTiers}
            onChange={(v) => update((s) => { s.collection.opCanAdjustTiers = v })}
          />
          <ToggleRow
            label="Operator can update item metadata"
            on="The operator can update the store’s metadata."
            off="The operator can’t update the store’s metadata."
            checked={c.opCanUpdateMetadata}
            onChange={(v) => update((s) => { s.collection.opCanUpdateMetadata = v })}
          />
          <ToggleRow
            label="Operator can mint items for free"
            on="The operator can mint shop items from inventory without paying."
            off="The operator pays like everyone else."
            checked={c.opCanMint}
            onChange={(v) => update((s) => { s.collection.opCanMint = v })}
          />
          <ToggleRow
            label="Operator can increase discounts"
            on="The operator can raise an item’s discount."
            off="The operator can’t raise item discounts."
            checked={c.opCanIncreaseDiscount}
            onChange={(v) => update((s) => { s.collection.opCanIncreaseDiscount = v })}
          />
        </div>
      )}
    </div>
  )
}
