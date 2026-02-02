/**
 * WebSocket Service for Real-Time Multi-Person Chat
 *
 * Handles:
 * - Real-time message delivery
 * - Presence tracking (who's online)
 * - Typing indicators
 * - Connection management per chat room
 */

import type { Context } from 'hono';
import { logDebugEvent } from '../routes/debug.ts';

// ============================================================================
// Types
// ============================================================================

export interface WsClient {
  socket: WebSocket;
  address: string; // Wallet address
  userId?: string; // Optional user ID (for managed wallets)
  chatId: string;
  connectedAt: Date;
}

export interface WsMessage {
  type:
    | 'message' // New chat message
    | 'typing' // Typing indicator
    | 'presence' // Online/offline
    | 'member_joined' // New member
    | 'member_left' // Member left
    | 'member_update' // Member profile update (emoji, etc.)
    | 'key_rotation' // Group key rotated
    | 'ai_response' // AI streaming response
    | 'chat_update' // Chat metadata update (title, etc.)
    | 'component_interaction' // Real-time component collaboration
    | 'error'; // Error message
  chatId: string;
  data: unknown;
  sender?: string; // Sender address
  timestamp: number;
}

export interface ComponentInteractionData {
  messageId: string; // Message containing the component
  groupId: string; // Option group ID
  action: 'select' | 'typing' | 'hover' | 'hover_end' | 'cursor';
  value?: string; // Selected option value or partial typed text
  x?: number; // Cursor x position (0-1 normalized)
  y?: number; // Cursor y position (0-1 normalized)
}

export interface PresenceUpdate {
  address: string;
  status: 'online' | 'offline' | 'away';
  lastSeen?: number;
}

// ============================================================================
// Connection Registry
// ============================================================================

// Map of chatId -> Set of connected clients
const chatConnections = new Map<string, Set<WsClient>>();

// Map of address -> Set of all their connections (for presence)
const addressConnections = new Map<string, Set<WsClient>>();

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Register a new WebSocket connection
 */
export function registerConnection(client: WsClient): void {
  // Add to chat room
  if (!chatConnections.has(client.chatId)) {
    chatConnections.set(client.chatId, new Set());
  }
  chatConnections.get(client.chatId)!.add(client);

  // Add to address registry
  if (!addressConnections.has(client.address)) {
    addressConnections.set(client.address, new Set());
  }
  addressConnections.get(client.address)!.add(client);

  // Notify others in chat
  broadcastToChat(client.chatId, {
    type: 'presence',
    chatId: client.chatId,
    data: {
      address: client.address,
      status: 'online',
    } as PresenceUpdate,
    timestamp: Date.now(),
  }, client.address); // Exclude sender

  console.log(`[WS] Client ${client.address} joined chat ${client.chatId}`);

  // Debug event
  logDebugEvent('ws_connect', 'websocket', {
    address: client.address,
    chatId: client.chatId,
    userId: client.userId,
  });
}

/**
 * Remove a WebSocket connection
 */
export function removeConnection(client: WsClient): void {
  // Remove from chat room
  const chatClients = chatConnections.get(client.chatId);
  if (chatClients) {
    chatClients.delete(client);
    if (chatClients.size === 0) {
      chatConnections.delete(client.chatId);
    }
  }

  // Remove from address registry
  const addressClients = addressConnections.get(client.address);
  if (addressClients) {
    addressClients.delete(client);
    if (addressClients.size === 0) {
      addressConnections.delete(client.address);

      // User is fully offline - notify chat
      broadcastToChat(client.chatId, {
        type: 'presence',
        chatId: client.chatId,
        data: {
          address: client.address,
          status: 'offline',
          lastSeen: Date.now(),
        } as PresenceUpdate,
        timestamp: Date.now(),
      });
    }
  }

  console.log(`[WS] Client ${client.address} left chat ${client.chatId}`);

  // Debug event
  logDebugEvent('ws_disconnect', 'websocket', {
    address: client.address,
    chatId: client.chatId,
  });
}

/**
 * Get all connections for a chat
 */
export function getChatConnections(chatId: string): WsClient[] {
  return Array.from(chatConnections.get(chatId) ?? []);
}

/**
 * Get online members for a chat
 */
export function getOnlineMembers(chatId: string): string[] {
  const clients = chatConnections.get(chatId);
  if (!clients) return [];

  const addresses = new Set<string>();
  for (const client of clients) {
    addresses.add(client.address);
  }
  return Array.from(addresses);
}

/**
 * Check if an address is online in any chat
 */
export function isAddressOnline(address: string): boolean {
  return addressConnections.has(address) && addressConnections.get(address)!.size > 0;
}

// ============================================================================
// Message Broadcasting
// ============================================================================

/**
 * Broadcast a message to all clients in a chat
 * @param excludeAddress - Exclude all connections from this address
 * @param excludeSocket - Exclude only this specific socket (for same-user multi-window)
 */
export function broadcastToChat(
  chatId: string,
  message: WsMessage,
  excludeAddress?: string,
  excludeSocket?: WebSocket
): void {
  const clients = chatConnections.get(chatId);
  if (!clients) return;

  const payload = JSON.stringify(message);

  for (const client of clients) {
    // If excludeSocket is provided, only exclude that specific socket
    // Otherwise fall back to excluding by address
    if (excludeSocket && client.socket === excludeSocket) continue;
    if (!excludeSocket && excludeAddress && client.address === excludeAddress) continue;

    try {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(payload);
      }
    } catch (error) {
      console.error(`[WS] Failed to send to ${client.address}:`, error);
    }
  }
}

/**
 * Send a message to a specific address (all their connections)
 */
export function sendToAddress(address: string, message: WsMessage): void {
  const clients = addressConnections.get(address);
  if (!clients) return;

  const payload = JSON.stringify(message);

  for (const client of clients) {
    try {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(payload);
      }
    } catch (error) {
      console.error(`[WS] Failed to send to ${address}:`, error);
    }
  }
}

/**
 * Broadcast a new chat message
 */
export function broadcastChatMessage(
  chatId: string,
  messageId: string,
  content: string,
  senderAddress: string,
  isEncrypted: boolean,
  role: 'user' | 'assistant' | 'system' = 'user'
): void {
  broadcastToChat(chatId, {
    type: 'message',
    chatId,
    data: {
      id: messageId,
      chatId,
      senderAddress,
      role,
      content,
      isEncrypted,
      createdAt: new Date().toISOString(),
    },
    sender: senderAddress,
    timestamp: Date.now(),
  });

  // Debug event
  logDebugEvent('ws_message', 'websocket', {
    chatId,
    messageId,
    senderAddress,
    role,
    contentLength: content.length,
    isEncrypted,
  });
}

/**
 * Broadcast typing indicator
 */
export function broadcastTyping(
  chatId: string,
  address: string,
  isTyping: boolean
): void {
  broadcastToChat(
    chatId,
    {
      type: 'typing',
      chatId,
      data: { isTyping },
      sender: address,
      timestamp: Date.now(),
    },
    address // Exclude sender
  );
}

/**
 * Broadcast member joined
 */
export function broadcastMemberJoined(
  chatId: string,
  address: string,
  role: string
): void {
  broadcastToChat(chatId, {
    type: 'member_joined',
    chatId,
    data: { address, role },
    timestamp: Date.now(),
  });
}

/**
 * Broadcast member left
 */
export function broadcastMemberLeft(chatId: string, address: string): void {
  broadcastToChat(chatId, {
    type: 'member_left',
    chatId,
    data: { address },
    timestamp: Date.now(),
  });
}

/**
 * Broadcast key rotation notification
 */
export function broadcastKeyRotation(chatId: string, newVersion: number): void {
  broadcastToChat(chatId, {
    type: 'key_rotation',
    chatId,
    data: { version: newVersion },
    timestamp: Date.now(),
  });
}

/**
 * Stream AI response token by token
 */
export function streamAiToken(
  chatId: string,
  messageId: string,
  token: string,
  isDone: boolean
): void {
  broadcastToChat(chatId, {
    type: 'ai_response',
    chatId,
    data: {
      messageId,
      token,
      isDone,
    },
    sender: 'assistant',
    timestamp: Date.now(),
  });
}

/**
 * Broadcast chat metadata update (e.g., auto-generated title)
 */
export function broadcastChatUpdate(
  chatId: string,
  updates: { autoGeneratedTitle?: string; name?: string }
): void {
  broadcastToChat(chatId, {
    type: 'chat_update',
    chatId,
    data: updates,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast component interaction to chat members (excluding sender's specific socket)
 * Used for real-time collaboration on OptionsPicker and similar components
 *
 * Note: We exclude only the specific socket, not all connections from the sender.
 * This allows the same user with multiple windows to see their own updates in other tabs.
 */
export function broadcastComponentInteraction(
  chatId: string,
  senderAddress: string,
  data: ComponentInteractionData,
  senderSocket?: WebSocket
): void {
  broadcastToChat(
    chatId,
    {
      type: 'component_interaction',
      chatId,
      data,
      sender: senderAddress,
      timestamp: Date.now(),
    },
    undefined, // Don't exclude by address
    senderSocket // Exclude only the specific socket that sent the message
  );
}

/**
 * Broadcast member profile update (e.g., custom emoji) to all chats they're in
 */
export function broadcastMemberUpdate(
  address: string,
  updates: { customEmoji?: string | null; displayName?: string | null }
): void {
  // Get all connections for this user
  const connections = addressConnections.get(address);
  if (!connections) return;

  // Get unique chat IDs where this user has connections
  const chatIds = new Set<string>();
  for (const client of connections) {
    chatIds.add(client.chatId);
  }

  // Broadcast to each chat
  for (const chatId of chatIds) {
    broadcastToChat(chatId, {
      type: 'member_update',
      chatId,
      data: { address, ...updates },
      timestamp: Date.now(),
    });
  }
}

/**
 * Send error to a specific client
 */
export function sendError(client: WsClient, error: string): void {
  try {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(
        JSON.stringify({
          type: 'error',
          chatId: client.chatId,
          data: { message: error },
          timestamp: Date.now(),
        } as WsMessage)
      );
    }
  } catch (err) {
    console.error('[WS] Failed to send error:', err);
  }
}

// ============================================================================
// WebSocket Handler (for Hono)
// ============================================================================

/**
 * Handle incoming WebSocket message
 */
export function handleWsMessage(
  client: WsClient,
  rawMessage: string
): { type: string; data: unknown } | null {
  try {
    const message = JSON.parse(rawMessage) as {
      type: string;
      data?: unknown;
    };

    switch (message.type) {
      case 'typing':
        broadcastTyping(
          client.chatId,
          client.address,
          (message.data as { isTyping: boolean })?.isTyping ?? true
        );
        break;

      case 'component_interaction':
        // Broadcast component interaction to other chat members (ephemeral, no persistence)
        // Pass the client's socket so we exclude only this specific connection,
        // allowing the same user in multiple tabs to see real-time updates
        broadcastComponentInteraction(
          client.chatId,
          client.address,
          message.data as ComponentInteractionData,
          client.socket
        );
        break;

      case 'ping':
        // Respond with pong
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
        break;

      default:
        // Return the message for the caller to handle
        return message;
    }

    return null;
  } catch (error) {
    console.error('[WS] Failed to parse message:', error);
    sendError(client, 'Invalid message format');
    return null;
  }
}

// ============================================================================
// Stats & Monitoring
// ============================================================================

export function getStats(): {
  totalConnections: number;
  activeChats: number;
  uniqueAddresses: number;
} {
  let totalConnections = 0;
  for (const clients of chatConnections.values()) {
    totalConnections += clients.size;
  }

  return {
    totalConnections,
    activeChats: chatConnections.size,
    uniqueAddresses: addressConnections.size,
  };
}

// ============================================================================
// Cleanup (call periodically)
// ============================================================================

export function cleanupStaleConnections(): number {
  let cleaned = 0;
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5 minutes without ping

  for (const [chatId, clients] of chatConnections.entries()) {
    for (const client of clients) {
      // Check if socket is closed or stale
      if (
        client.socket.readyState === WebSocket.CLOSED ||
        client.socket.readyState === WebSocket.CLOSING
      ) {
        removeConnection(client);
        cleaned++;
      }
    }
  }

  return cleaned;
}
