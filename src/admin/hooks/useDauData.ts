import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export interface DauDataPoint {
  date: string
  dau: number
}

async function fetchDauData(token: string, includeAnonymous: boolean): Promise<DauDataPoint[]> {
  const response = await fetch(`${API_BASE_URL}/admin/analytics/dau?includeAnonymous=${includeAnonymous}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch DAU data')
  }

  return data.data
}

export function useDauData(includeAnonymous = false) {
  const token = useAuthStore((state) => state.token)

  return useQuery({
    queryKey: ['admin', 'dau', includeAnonymous],
    queryFn: () => fetchDauData(token!, includeAnonymous),
    enabled: !!token,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

// Metrics types
export interface AdminMetrics {
  today: {
    messages: number
    aiResponses: number
    chatsCreated: number
    newUsers: number
  }
  week: {
    chatsCreated: number
    newUsers: number
    returningUsers: number
  }
  engagement: {
    avgMessagesPerChat: number
    activeChats24h: number
    passkeyConversionRate: number
  }
}

async function fetchMetrics(token: string): Promise<AdminMetrics> {
  const response = await fetch(`${API_BASE_URL}/admin/analytics/metrics`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch metrics')
  }

  return data.data
}

export function useAdminMetrics() {
  const token = useAuthStore((state) => state.token)

  return useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: () => fetchMetrics(token!),
    enabled: !!token,
    staleTime: 1000 * 60 * 2, // 2 minutes
  })
}
