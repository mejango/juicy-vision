/**
 * Terminal WebSocket Service
 *
 * Real-time payment session status updates for terminals and consumers.
 * Eliminates polling for faster UX.
 */

// ============================================================================
// Types
// ============================================================================

export interface TerminalWsClient {
  socket: WebSocket
  sessionId: string
  role: 'terminal' | 'consumer'
  connectedAt: Date
}

export interface TerminalWsMessage {
  type:
    | 'status_update' // Session status changed
    | 'session_claimed' // Consumer opened the session
    | 'payment_started' // Payment initiated
    | 'payment_completed' // Payment successful
    | 'payment_failed' // Payment failed
    | 'session_expired' // Session timed out
    | 'session_cancelled' // Session cancelled
    | 'error' // Error message
    | 'pong' // Ping response
  sessionId: string
  data: unknown
  timestamp: number
}

// ============================================================================
// Connection Registry
// ============================================================================

// Map of sessionId -> Set of connected clients
const sessionConnections = new Map<string, Set<TerminalWsClient>>()

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Register a new WebSocket connection for a session
 */
export function registerSessionConnection(client: TerminalWsClient): void {
  if (!sessionConnections.has(client.sessionId)) {
    sessionConnections.set(client.sessionId, new Set())
  }
  sessionConnections.get(client.sessionId)!.add(client)

  console.log(`[TerminalWS] ${client.role} connected to session ${client.sessionId}`)

  // If a consumer connects, notify the terminal
  if (client.role === 'consumer') {
    broadcastToSession(client.sessionId, {
      type: 'session_claimed',
      sessionId: client.sessionId,
      data: { claimedAt: Date.now() },
      timestamp: Date.now(),
    }, client.socket)
  }
}

/**
 * Remove a WebSocket connection
 */
export function removeSessionConnection(client: TerminalWsClient): void {
  const clients = sessionConnections.get(client.sessionId)
  if (clients) {
    clients.delete(client)
    if (clients.size === 0) {
      sessionConnections.delete(client.sessionId)
    }
  }

  console.log(`[TerminalWS] ${client.role} disconnected from session ${client.sessionId}`)
}

/**
 * Get all connections for a session
 */
export function getSessionConnections(sessionId: string): TerminalWsClient[] {
  return Array.from(sessionConnections.get(sessionId) ?? [])
}

// ============================================================================
// Message Broadcasting
// ============================================================================

/**
 * Broadcast a message to all clients watching a session
 */
export function broadcastToSession(
  sessionId: string,
  message: TerminalWsMessage,
  excludeSocket?: WebSocket
): void {
  const clients = sessionConnections.get(sessionId)
  if (!clients) return

  const payload = JSON.stringify(message)

  for (const client of clients) {
    if (excludeSocket && client.socket === excludeSocket) continue

    try {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(payload)
      }
    } catch (error) {
      console.error(`[TerminalWS] Failed to send to ${client.role}:`, error)
    }
  }
}

/**
 * Broadcast session status update
 */
export function broadcastSessionStatus(
  sessionId: string,
  status: string,
  extra?: {
    txHash?: string
    tokensIssued?: string
    error?: string
  }
): void {
  const typeMap: Record<string, TerminalWsMessage['type']> = {
    pending: 'status_update',
    paying: 'payment_started',
    completed: 'payment_completed',
    failed: 'payment_failed',
    expired: 'session_expired',
    cancelled: 'session_cancelled',
  }

  broadcastToSession(sessionId, {
    type: typeMap[status] || 'status_update',
    sessionId,
    data: { status, ...extra },
    timestamp: Date.now(),
  })
}

/**
 * Handle incoming WebSocket message
 */
export function handleTerminalWsMessage(
  client: TerminalWsClient,
  rawMessage: string
): void {
  try {
    const message = JSON.parse(rawMessage) as { type: string; data?: unknown }

    switch (message.type) {
      case 'ping':
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.send(
            JSON.stringify({
              type: 'pong',
              sessionId: client.sessionId,
              data: {},
              timestamp: Date.now(),
            })
          )
        }
        break

      default:
        // Ignore unknown messages
        break
    }
  } catch {
    // Ignore malformed messages
  }
}

/**
 * Send error to a specific client
 */
export function sendSessionError(client: TerminalWsClient, error: string): void {
  try {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(
        JSON.stringify({
          type: 'error',
          sessionId: client.sessionId,
          data: { message: error },
          timestamp: Date.now(),
        } as TerminalWsMessage)
      )
    }
  } catch {
    // Ignore send errors
  }
}

// ============================================================================
// Stats & Cleanup
// ============================================================================

export function getTerminalWsStats(): {
  activeSessions: number
  totalConnections: number
} {
  let totalConnections = 0
  for (const clients of sessionConnections.values()) {
    totalConnections += clients.size
  }

  return {
    activeSessions: sessionConnections.size,
    totalConnections,
  }
}

export function cleanupStaleSessionConnections(): number {
  let cleaned = 0

  for (const [sessionId, clients] of sessionConnections.entries()) {
    for (const client of clients) {
      if (
        client.socket.readyState === WebSocket.CLOSED ||
        client.socket.readyState === WebSocket.CLOSING
      ) {
        removeSessionConnection(client)
        cleaned++
      }
    }
  }

  return cleaned
}
