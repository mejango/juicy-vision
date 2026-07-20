/**
 * .jb round-trip completeness guard (website eff02f6's test, adapted).
 * Builds a maximal draft touching every subsystem and asserts export→import
 * is lossless for all non-transient keys — a future field added to
 * CreateFlowState but missed by mergeDraft's whitelist fails HERE instead of
 * silently dropping user work.
 */

import { describe, expect, it } from 'vitest'
import { ALL_CHAIN_IDS } from '../../../constants'
import {
  createStage, initState, itemDraft, parseCreateDraftJson, sanitizeState, shopMediaUploadIssue,
  type CreateFlowState, type RecipientRow,
} from './state'

const A1 = '0x1111111111111111111111111111111111111111'
const A2 = '0x2222222222222222222222222222222222222222'

function recipient(over: Partial<RecipientRow> = {}): RecipientRow {
  return { type: 'wallet', address: A1, projectId: 0, percent: 12.5, amountEth: '1.5', ...over }
}

/** A draft exercising every subsystem, incl. all five per-chain override kinds. */
function maximalState(): CreateFlowState {
  const s = initState()
  s.step = 3
  s.projectType = 'custom'
  s.details = {
    ...s.details,
    name: 'Maximal', ticker: 'MAX', tagline: 'tag', description: 'desc',
    logoUri: 'ipfs://logo', website: 'https://max.example', twitter: '@max',
    discord: 'https://discord.gg/max', telegram: 'https://t.me/max',
    instagram: 'https://instagram.com/max', whatsapp: 'https://wa.me/1',
    tags: ['AI', 'Art'], coverImageUri: 'ipfs://cover', payDisclosure: 'notice',
    owner: A1, linksOpen: true, tagsOpen: true, customOpen: true,
  }
  s.revOperator = A2
  s.revBaseCurrency = 2
  s.accepts = ['eth', 'usdc']
  s.customToken = { address: A2, name: 'Tok', symbol: 'TOK', decimals: 8, status: 'ok', error: '' }
  s.swapRouter = false
  s.approvalAddress = A1
  const stage = createStage()
  stage.durationSeconds = 604800
  stage.scheduleOn = true
  stage.schedule = '1789000000'
  stage.weight = '5000'
  stage.reservedRecipients = [recipient({ percent: 10 }), recipient({ type: 'project', projectId: 3, address: A2 })]
  stage.payoutMode = 'limited'
  stage.payoutRecipients = [recipient()]
  stage.payoutByKind = {
    eth: { mode: 'limited', recipients: [recipient()] },
    usdc: { mode: 'unlimited', recipients: [recipient({ percent: 40 })] },
  }
  stage.surplusAllowanceOn = true
  stage.surplusAllowanceAmount = '2'
  stage.deadline = '3days'
  stage.holdFees = true
  stage.allowSetTerminals = true
  stage.autoIssuances = [{ count: '100', address: A1 }]
  s.stages = [stage, createStage()]
  s.afterMode = 'cycle'
  s.shopEnabled = true
  const item = itemDraft()
  item.name = 'Thing'
  item.description = 'd'
  item.imageUri = 'ipfs://img'
  item.mediaType = 'image/png'
  item.price = '0.5'
  item.limited = true
  item.supply = '10'
  item.splitOn = true
  item.splitRecipients = [{ pct: 10, recip: A1, benef: A2 }]
  item.discountOn = true
  item.discountPct = '25'
  item.category = 1
  item.reserveOn = true
  item.reserveFrequency = '5'
  item.reserveBeneficiary = A1
  item.votingOn = true
  item.votingUnits = '7'
  s.nfts = [item]
  s.storeCategories = [{ id: 1, name: 'Cat' }]
  s.collection = { ...s.collection, name: 'Coll', symbol: 'CLL', nameTouched: true, symbolTouched: true, preventOverspending: true, useForRedemptions: true }
  s.storePricingCurrency = 2
  s.suckerType = 'ccip'
  // Build-native chain ids so import's canon↔testnet remap is a no-op.
  s.chainIds = [ALL_CHAIN_IDS[0], ALL_CHAIN_IDS[1]]
  // All five per-chain override kinds, canonical keys, on a build-native chain.
  s.perChain = {
    [ALL_CHAIN_IDS[1]]: {
      addr: {
        owner: A2,
        'r:0:0': A2,
        'p:0:0': A2,
        'ppid:0:0': '7',
        'pamt:0:0': '2.5',
        'pkamt:eth:0': '3',
        'isup:0': '4',
        'rb:0': A2,
        approval: A2,
      },
    },
  }
  s.tos = true
  return s
}

describe('.jb round-trip completeness', () => {
  it('re-imports every non-transient field losslessly', () => {
    const exported = sanitizeState(maximalState())
    const imported = parseCreateDraftJson(JSON.stringify(exported))
    const reExported = sanitizeState(imported)
    // Key-by-key comparison for actionable failures.
    for (const key of Object.keys(exported) as (keyof CreateFlowState)[]) {
      expect(reExported[key], `field '${key}' must survive the .jb round-trip`).toEqual(exported[key])
    }
    // And nothing new appeared either.
    expect(Object.keys(reExported).sort()).toEqual(Object.keys(exported).sort())
  })

  it('bounds imported payoutByKind and coerces bad modes', () => {
    const exported = sanitizeState(maximalState())
    ;(exported.stages[0].payoutByKind as Record<string, unknown>).evil = { mode: 'steal', recipients: 'nope' }
    const imported = parseCreateDraftJson(JSON.stringify(exported))
    expect(imported.stages[0].payoutByKind.evil).toEqual({ mode: 'none', recipients: [] })
  })

  it('blocks deploy while a shop item media upload is pending or failed', () => {
    const withNfts = (nft: Partial<ReturnType<typeof itemDraft>>): CreateFlowState => {
      const s = initState(); s.shopEnabled = true; s.nfts = [{ ...itemDraft(), ...nft }]; return s
    }
    expect(shopMediaUploadIssue(withNfts({ _mediaUploading: true }))).toMatch(/still uploading/i)
    expect(shopMediaUploadIssue(withNfts({ _mediaError: 'network failed' }))).toMatch(/upload failed/i)
    // A resolved video attachment (animation_url media) is fine.
    expect(shopMediaUploadIssue(withNfts({ imageUri: 'ipfs://vid', mediaType: 'video/mp4' }))).toBeNull()
    // Transient flags on a disabled shop never block launch.
    const off = withNfts({ _mediaError: 'stale' }); off.shopEnabled = false
    expect(shopMediaUploadIssue(off)).toBeNull()
  })

  it('drops the transient media flags from exported .jb drafts', () => {
    const s = initState(); s.shopEnabled = true; s.nfts = [{ ...itemDraft(), _mediaUploading: true, _mediaError: 'x' }]
    const exported = sanitizeState(s)
    expect(exported.nfts[0]).not.toHaveProperty('_mediaUploading')
    expect(exported.nfts[0]).not.toHaveProperty('_mediaError')
  })
})
