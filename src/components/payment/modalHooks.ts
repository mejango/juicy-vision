import { useState, useEffect, useMemo } from 'react'
import { createPublicClient, http, type Address, type Chain } from 'viem'
import { ALL_VIEM_CHAINS, RPC_ENDPOINTS } from '../../constants'
import { getProjectController } from '../../utils/paymentTerminal'
import { fetchProjectCreationFee } from '../../services/omnichainDeployer'

const CHAINS: Record<number, Chain> = ALL_VIEM_CHAINS

/** Fetches the project's controller from JBDirectory while the modal is open. */
export function useProjectController(
  isOpen: boolean,
  projectId: string,
  chainId: number,
  onError: (message: string) => void,
) {
  const [controllerAddress, setControllerAddress] = useState<Address | null>(null)
  const [controllerLoading, setControllerLoading] = useState(false)

  useEffect(() => {
    if (!isOpen || !projectId || !chainId) {
      setControllerAddress(null)
      return
    }

    const fetchController = async () => {
      setControllerLoading(true)
      try {
        const chain = CHAINS[chainId]
        if (!chain) {
          console.error('Unsupported chain for controller lookup:', chainId)
          return
        }

        const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        })

        const controller = await getProjectController(publicClient, BigInt(projectId))
        setControllerAddress(controller)
      } catch (err) {
        console.error('Failed to fetch project controller:', err)
        onError(err instanceof Error ? err.message : 'Failed to fetch project controller')
      } finally {
        setControllerLoading(false)
      }
    }

    fetchController()
  }, [isOpen, projectId, chainId, onError])

  return { controllerAddress, controllerLoading }
}

/** Calls the parent persistence callbacks when a single-tx modal's status settles. */
export function useStatusCallbacks(
  status: string,
  txHash: string | null,
  error: string | null,
  onConfirmed?: (txHash: string) => void,
  onError?: (error: string) => void,
) {
  useEffect(() => {
    if (status === 'confirmed' && txHash) {
      onConfirmed?.(txHash)
    } else if (status === 'failed' && error) {
      onError?.(error)
    }
  }, [status, txHash, error, onConfirmed, onError])
}

interface SlowChainBundleState {
  processingStartedAt?: number
  chainStates: Array<{ chainId: number; status: string }>
}

/** Flags chains still pending/submitted 90s after processing started while others confirmed. */
export function useSlowChains(isProcessing: boolean, bundleState: SlowChainBundleState) {
  const [tick, setTick] = useState(0)
  const SLOW_CHAIN_THRESHOLD_MS = 90_000

  useEffect(() => {
    if (!isProcessing) return
    const id = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [isProcessing])

  return useMemo(() => {
    void tick
    const startedAt = bundleState.processingStartedAt
    if (!startedAt || !isProcessing) {
      return { slowChainIds: [] as number[], hasSlowChains: false }
    }
    const elapsed = Date.now() - startedAt
    if (elapsed < SLOW_CHAIN_THRESHOLD_MS) {
      return { slowChainIds: [] as number[], hasSlowChains: false }
    }
    const hasConfirmed = bundleState.chainStates.some(cs => cs.status === 'confirmed')
    const stuck = bundleState.chainStates
      .filter(cs => cs.status === 'pending' || cs.status === 'submitted')
      .map(cs => cs.chainId)
    const hasSlow = hasConfirmed && stuck.length > 0
    return { slowChainIds: hasSlow ? stuck : [], hasSlowChains: hasSlow }
  }, [tick, bundleState.processingStartedAt, bundleState.chainStates, isProcessing])
}

/** Loads the per-chain protocol creation fees while the modal is open. */
export function useCreationFees(isOpen: boolean, chainIds: number[]) {
  const [creationFeesWei, setCreationFeesWei] = useState<Record<number, bigint>>({})
  const [creationFeesLoading, setCreationFeesLoading] = useState(false)
  const [creationFeeError, setCreationFeeError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || chainIds.length === 0) return
    let cancelled = false
    setCreationFeesLoading(true)
    setCreationFeeError(null)
    Promise.all(chainIds.map(async chainId => [chainId, await fetchProjectCreationFee(chainId)] as const))
      .then(entries => {
        if (!cancelled) setCreationFeesWei(Object.fromEntries(entries))
      })
      .catch(err => {
        if (!cancelled) {
          setCreationFeesWei({})
          setCreationFeeError(err instanceof Error ? err.message : 'Project creation fee unavailable')
        }
      })
      .finally(() => {
        if (!cancelled) setCreationFeesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, chainIds])

  const creationFeesReady = chainIds.every(chainId => creationFeesWei[chainId] !== undefined)
  const totalCreationFee = Object.values(creationFeesWei).reduce((total, fee) => total + fee, 0n)

  return {
    creationFeesWei,
    setCreationFeesWei,
    creationFeesLoading,
    creationFeeError,
    setCreationFeeError,
    creationFeesReady,
    totalCreationFee,
  }
}
