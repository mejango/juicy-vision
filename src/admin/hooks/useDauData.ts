import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export interface DauDataPoint {
  date: string
  dau: number
}

async function fetchDauData(token: string): Promise<DauDataPoint[]> {
  const response = await fetch(`${API_BASE_URL}/admin/analytics/dau`, {
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

export function useDauData() {
  const token = useAuthStore((state) => state.token)

  return useQuery({
    queryKey: ['admin', 'dau'],
    queryFn: () => fetchDauData(token!),
    enabled: !!token,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
