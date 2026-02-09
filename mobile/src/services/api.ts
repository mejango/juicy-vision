/**
 * API Service
 *
 * Handles all backend API communication.
 */

const API_BASE = 'https://api.juicyvision.app'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface PaymentSession {
  id: string
  deviceId: string
  amountUsd: number
  token: string | null
  tokenSymbol: string
  status: 'pending' | 'paying' | 'completed' | 'failed' | 'expired' | 'cancelled'
  merchantId: string
  merchantName: string
  projectId: number
  chainId: number
  expiresAt: string
  createdAt: string
}

export interface JuiceBalance {
  balance: number
  lifetimePurchased: number
  lifetimeSpent: number
}

class ApiService {
  private token: string | null = null

  setToken(token: string | null) {
    this.token = token
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    })

    const data: ApiResponse<T> = await res.json()

    if (!data.success) {
      throw new Error(data.error || 'Request failed')
    }

    return data.data as T
  }

  // Payment Sessions
  async getSession(sessionId: string): Promise<PaymentSession> {
    const data = await this.request<{ session: PaymentSession }>(
      `/terminal/session/${sessionId}`
    )
    return data.session
  }

  async getSessionStatus(sessionId: string): Promise<{ status: string; txHash?: string }> {
    return this.request(`/terminal/session/${sessionId}/status`)
  }

  async payWithJuice(sessionId: string): Promise<PaymentSession> {
    const data = await this.request<{ session: PaymentSession }>(
      `/terminal/session/${sessionId}/pay/juice`,
      { method: 'POST', body: JSON.stringify({}) }
    )
    return data.session
  }

  // Juice Balance
  async getJuiceBalance(): Promise<JuiceBalance> {
    return this.request('/juice/balance')
  }

  // Auth
  async requestCode(email: string): Promise<void> {
    await this.request('/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  }

  async verifyCode(email: string, code: string): Promise<{ token: string; user: any }> {
    return this.request('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    })
  }

  // Stripe
  async getStripeConfig(): Promise<{ publishableKey: string }> {
    return this.request('/juice/stripe-config')
  }

  async createJuicePurchase(amount: number): Promise<{ clientSecret: string }> {
    return this.request('/juice/purchase', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    })
  }
}

export const api = new ApiService()
