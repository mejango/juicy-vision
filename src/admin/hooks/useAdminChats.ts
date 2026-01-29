import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export interface AdminChat {
  id: string
  name: string | null
  founderAddress: string
  isPublic: boolean
  isPrivate: boolean
  createdAt: string
  updatedAt: string
  messageCount: number
  memberCount: number
}

export interface AdminChatsResponse {
  chats: AdminChat[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface ChatMember {
  address: string
  userId: string | null
  role: string
  displayName: string | null
  joinedAt: string
}

export interface ChatMessage {
  id: string
  senderAddress: string | null
  senderUserId: string | null
  role: string
  content: string
  aiModel: string | null
  createdAt: string
}

export interface AdminChatDetail {
  chat: {
    id: string
    name: string | null
    founderAddress: string
    isPublic: boolean
    isPrivate: boolean
    createdAt: string
    updatedAt: string
  }
  messages: ChatMessage[]
  members: ChatMember[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

async function fetchChats(token: string, page: number, limit: number): Promise<AdminChatsResponse> {
  const response = await fetch(`${API_BASE_URL}/admin/chats?page=${page}&limit=${limit}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch chats')
  }

  return data.data
}

async function fetchChatDetail(token: string, chatId: string, page: number, limit: number): Promise<AdminChatDetail> {
  const response = await fetch(`${API_BASE_URL}/admin/chats/${chatId}?page=${page}&limit=${limit}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Failed to fetch chat details')
  }

  return data.data
}

export function useAdminChats(page = 1, limit = 50) {
  const token = useAuthStore((state) => state.token)

  return useQuery({
    queryKey: ['admin', 'chats', page, limit],
    queryFn: () => fetchChats(token!, page, limit),
    enabled: !!token,
    staleTime: 1000 * 60, // 1 minute
  })
}

export function useAdminChatDetail(chatId: string | null, page = 1, limit = 100) {
  const token = useAuthStore((state) => state.token)

  return useQuery({
    queryKey: ['admin', 'chat', chatId, page, limit],
    queryFn: () => fetchChatDetail(token!, chatId!, page, limit),
    enabled: !!token && !!chatId,
    staleTime: 1000 * 30, // 30 seconds
  })
}
