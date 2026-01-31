import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export interface JuiceSpend {
  id: string
  userId: string
  userEmail: string | null
  projectId: number
  chainId: number
  beneficiaryAddress: string
  memo: string | null
  juiceAmount: number
  cryptoAmount: string | null
  ethUsdRate: number | null
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'refunded'
  txHash: string | null
  tokensReceived: string | null
  errorMessage: string | null
  retryCount: number
  lastRetryAt: string | null
  createdAt: string
  updatedAt: string
}

export interface JuiceSpendsResponse {
  spends: JuiceSpend[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface JuiceStats {
  pending: {
    count: number
    totalUsd: number
  }
  executing: {
    count: number
  }
  today: {
    completedCount: number
    completedUsd: number
  }
  week: {
    completedCount: number
    completedUsd: number
  }
  failed: {
    count: number
  }
}

export interface ProcessSpendResult {
  spendId: string
  status: 'completed' | 'failed'
  txHash?: string
  error?: string
}

async function fetchPendingSpends(
  token: string,
  page: number,
  limit: number,
  status?: string
): Promise<JuiceSpendsResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  })
  if (status) {
    params.set('status', status)
  }

  const response = await fetch(`${API_BASE_URL}/admin/juice/pending-spends?${params}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch pending spends')
  }

  return data.data
}

async function fetchJuiceStats(token: string): Promise<JuiceStats> {
  const response = await fetch(`${API_BASE_URL}/admin/juice/stats`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch juice stats')
  }

  return data.data
}

async function processSpend(token: string, spendId: string): Promise<ProcessSpendResult> {
  const response = await fetch(`${API_BASE_URL}/admin/juice/spends/${spendId}/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to process spend')
  }

  return data.data
}

export function useAdminJuiceSpends(page = 1, limit = 50, status?: string) {
  const token = useAuthStore((state) => state.token)

  return useQuery({
    queryKey: ['admin', 'juice', 'spends', page, limit, status],
    queryFn: () => fetchPendingSpends(token!, page, limit, status),
    enabled: !!token,
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Auto-refresh every minute
  })
}

export function useAdminJuiceStats() {
  const token = useAuthStore((state) => state.token)

  return useQuery({
    queryKey: ['admin', 'juice', 'stats'],
    queryFn: () => fetchJuiceStats(token!),
    enabled: !!token,
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Auto-refresh every minute
  })
}

export function useProcessSpend() {
  const token = useAuthStore((state) => state.token)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (spendId: string) => processSpend(token!, spendId),
    onSuccess: () => {
      // Invalidate all juice-related queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['admin', 'juice'] })
    },
  })
}
