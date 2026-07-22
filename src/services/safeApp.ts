/**
 * Minimal Safe{Wallet} Apps integration — NO new dependency (raw postMessage).
 *
 * When juicy.vision is opened as a Safe App (inside the app.safe.global iframe:
 * Apps → add custom app → this URL) it speaks the Safe Apps postMessage
 * protocol directly so a user can connect their Safe and PROPOSE transactions
 * (pay a project, run an owner action, …) to the Safe's queue for the owners to
 * sign & execute.
 *
 * Protocol mirrors @safe-global/safe-apps-sdk's PostMessageCommunicator:
 *   request  = { id, method, params, env: { sdkVersion } }  → window.parent.postMessage
 *   response = { id, success, data|error, version }         → window 'message' event
 * Reads proxy to the Safe interface's node via rpcCall; writes go through
 * sendTransactions (which returns a safeTxHash — NOT a mined tx hash).
 *
 * This is the vanilla-JS `website/src/safe-app.js` ported to TypeScript. It is a
 * money path: writes must PROPOSE, never send a bare tx.
 */

import { encodeFunctionData, erc20Abi } from 'viem'

const SDK_VERSION = '9.1.0'

export interface SafeInfo {
  safeAddress: `0x${string}`
  chainId: number
  owners?: `0x${string}`[]
  threshold?: number
}

export interface SafeTx {
  to: `0x${string}`
  value: string
  data: `0x${string}`
}

interface SafeProvider {
  isSafe: true
  safeAddress: `0x${string}`
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on: () => void
  removeListener: () => void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

const pending: Record<string, Pending> = {}
let idCounter = 0
let listening = false

// Cross-origin parent access throws — that itself means we're framed (a top
// window can always read window.parent).
export function inIframe(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.parent && window.parent !== window
  } catch {
    return true
  }
}

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('message', event => {
    const msg = (event as MessageEvent)?.data as
      | { id?: string; success?: boolean; error?: unknown; data?: unknown }
      | undefined
    if (!msg || !msg.id || !pending[msg.id]) return
    const p = pending[msg.id]
    delete pending[msg.id]
    if (msg.success === false || msg.error) {
      p.reject(new Error(typeof msg.error === 'string' ? msg.error : 'Safe request failed'))
    } else {
      p.resolve(msg.data)
    }
  })
}

function safeRpc<T = unknown>(method: string, params?: unknown): Promise<T> {
  ensureListener()
  if (!inIframe()) return Promise.reject(new Error('Not running inside Safe{Wallet}.'))
  const id = `jb-safe-${++idCounter}-${Date.now()}`
  const message = { id, method, params: params ?? {}, env: { sdkVersion: SDK_VERSION } }
  return new Promise<T>((resolve, reject) => {
    pending[id] = { resolve: resolve as (value: unknown) => void, reject }
    try {
      window.parent.postMessage(message, '*')
    } catch (e) {
      delete pending[id]
      reject(e)
    }
  })
}

/**
 * Detect whether we're inside a Safe App iframe. Resolves the Safe info, or
 * null (not framed, or the parent isn't a Safe within the timeout).
 */
export function detectSafeApp(timeoutMs = 500): Promise<SafeInfo | null> {
  if (!inIframe()) return Promise.resolve(null)
  return new Promise<SafeInfo | null>(resolve => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(null)
      }
    }, timeoutMs)
    safeRpc<SafeInfo>('getSafeInfo')
      .then(info => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(info && info.safeAddress ? info : null)
      })
      .catch(() => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(null)
        }
      })
  })
}

/**
 * Poll for the on-chain tx hash a proposed safeTxHash eventually produces (once
 * signed & executed). Optional UX nicety; returns the txHash or null.
 */
export function txHashForSafeTx(safeTxHash: string): Promise<`0x${string}` | null> {
  return safeRpc<{ txHash?: `0x${string}` }>('getTxBySafeTxHash', { safeTxHash })
    .then(r => r?.txHash ?? null)
    .catch(() => null)
}

export interface WaitForSafeExecutionOptions {
  pollingIntervalMs?: number
  signal?: AbortSignal
}

/**
 * Wait until Safe{Wallet} reports the actual on-chain execution hash.
 *
 * A safeTxHash is only a queue/proposal identifier and must never be passed to
 * `waitForTransactionReceipt` or treated as success. Keeping this wait
 * unbounded is intentional: a Safe can require several owners and may be
 * executed hours later. Callers persist `safe-proposed` first, so the app can
 * recover the proposal after a reload while the foreground flow remains on
 * its pending step.
 */
export async function waitForSafeExecution(
  safeTxHash: string,
  options: WaitForSafeExecutionOptions = {},
): Promise<`0x${string}`> {
  const pollingIntervalMs = options.pollingIntervalMs ?? 4000
  for (;;) {
    if (options.signal?.aborted) throw new DOMException('Safe execution wait aborted', 'AbortError')
    const txHash = await txHashForSafeTx(safeTxHash)
    if (txHash) return txHash
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, pollingIntervalMs)
      options.signal?.addEventListener('abort', () => {
        window.clearTimeout(timer)
        reject(new DOMException('Safe execution wait aborted', 'AbortError'))
      }, { once: true })
    })
  }
}

/**
 * Propose a BATCH of transactions as a single Safe queue entry (executed
 * atomically once signed). Used to bundle an ERC-20 approval + the main call
 * into ONE proposal. Returns the safeTxHash.
 */
export function proposeSafeTransactions(txs: SafeTx[]): Promise<`0x${string}`> {
  return safeRpc<{ safeTxHash: `0x${string}` }>('sendTransactions', { txs }).then(r => r?.safeTxHash)
}

/** Encode an ERC-20 approval as a Safe batch tx (helper for the guarded runner). */
export function encodeApprovalTx(token: `0x${string}`, spender: `0x${string}`, amount: bigint): SafeTx {
  return {
    to: token,
    value: '0x0',
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
  }
}

/**
 * An EIP-1193-shaped provider backed by the Safe. Writes propose to the Safe
 * queue (returning the safeTxHash — NOT a mined tx hash, so callers must not
 * waitForTransactionReceipt); reads proxy to the Safe interface's node.
 */
export function makeSafeProvider(safeInfo: SafeInfo): SafeProvider {
  const chainIdHex = `0x${Number(safeInfo.chainId).toString(16)}`
  return {
    isSafe: true,
    safeAddress: safeInfo.safeAddress,
    request(args: { method: string; params?: unknown[] }): Promise<unknown> {
      const method = args?.method
      const params = args?.params ?? []
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return Promise.resolve([safeInfo.safeAddress])
        case 'eth_chainId':
          return Promise.resolve(chainIdHex)
        case 'net_version':
          return Promise.resolve(String(Number(safeInfo.chainId)))
        case 'wallet_requestPermissions':
          return Promise.resolve([{ parentCapability: 'eth_accounts' }])
        case 'wallet_revokePermissions':
          return Promise.resolve(null)
        case 'wallet_switchEthereumChain': {
          const want = (params[0] as { chainId?: string })?.chainId
          if (want && String(want).toLowerCase() === chainIdHex.toLowerCase()) return Promise.resolve(null)
          return Promise.reject({
            code: 4902,
            message: `This Safe is on chain ${Number(safeInfo.chainId)}. Switch the Safe's network inside Safe{Wallet}.`,
          })
        }
        case 'eth_sendTransaction': {
          const tx = (params[0] as { to?: `0x${string}`; value?: string | bigint; data?: `0x${string}` }) || {}
          let value: string
          try {
            value = tx.value == null ? '0' : typeof tx.value === 'string' ? tx.value : `0x${BigInt(tx.value).toString(16)}`
          } catch {
            value = '0'
          }
          return safeRpc<{ safeTxHash?: `0x${string}` }>('sendTransactions', {
            txs: [{ to: tx.to, value, data: tx.data || '0x' }],
          }).then(r => r?.safeTxHash)
        }
        case 'personal_sign':
          return safeRpc<{ signature?: string; safeTxHash?: string }>('signMessage', {
            message: params[0],
          }).then(r => r?.signature || r?.safeTxHash)
        case 'eth_signTypedData_v4': {
          let td: unknown = params[1]
          try {
            td = typeof td === 'string' ? JSON.parse(td) : td
          } catch {
            /* keep as-is */
          }
          return safeRpc<{ signature?: string; safeTxHash?: string }>('signTypedMessage', {
            typedData: td,
          }).then(r => r?.signature || r?.safeTxHash)
        }
        default:
          // Reads (eth_call, eth_getBalance, eth_estimateGas, …) — proxy to the
          // Safe interface's node so a viem wallet client can operate normally.
          return safeRpc('rpcCall', { call: method, params })
      }
    },
    on() {},
    removeListener() {},
  }
}

// ---------------------------------------------------------------------------
// Active-session singleton. The React hook (useSafeApp) detects on mount and
// records the result here so non-React consumers (the guarded-tx runner's
// shared UI, tests) can read the current Safe context without prop drilling.
// ---------------------------------------------------------------------------
let activeSafeInfo: SafeInfo | null = null

export function setActiveSafeInfo(info: SafeInfo | null): void {
  activeSafeInfo = info
}

export function getActiveSafeInfo(): SafeInfo | null {
  return activeSafeInfo
}

export function isSafeAppActive(): boolean {
  return activeSafeInfo != null
}
