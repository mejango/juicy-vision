import { z } from 'zod';

// ============================================================================
// User & Auth Types
// ============================================================================

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  emailVerified: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),

  // Privacy settings
  privacyMode: z.enum(['open_book', 'anonymous', 'private', 'ghost']).default('open_book'),

  // Custodial wallet
  custodialAddressIndex: z.number().int().nonnegative().optional(),

  // Admin flag
  isAdmin: z.boolean().default(false),
});

export type User = z.infer<typeof UserSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  createdAt: z.date(),
  expiresAt: z.date(),
});

export type Session = z.infer<typeof SessionSchema>;

// ============================================================================
// Auth Request/Response Types
// ============================================================================

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const AuthResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    privacyMode: z.enum(['open_book', 'anonymous', 'private', 'ghost']),
  }),
  token: z.string(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ============================================================================
// Custodial Wallet Types
// ============================================================================

export const WalletBalanceSchema = z.object({
  chainId: z.number(),
  tokenAddress: z.string(), // 0x0 for native, contract address for ERC20
  tokenSymbol: z.string(),
  tokenDecimals: z.number(),
  balance: z.string(), // BigInt as string
  isProjectToken: z.boolean(),
  projectId: z.number().optional(),
});

export type WalletBalance = z.infer<typeof WalletBalanceSchema>;

export const TransferRequestSchema = z.object({
  chainId: z.number(),
  tokenAddress: z.string(),
  amount: z.string(), // BigInt as string
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type TransferRequest = z.infer<typeof TransferRequestSchema>;

export const PendingTransferSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  chainId: z.number(),
  tokenAddress: z.string(),
  tokenSymbol: z.string(),
  amount: z.string(),
  toAddress: z.string(),
  createdAt: z.date(),
  availableAt: z.date(), // 30 days from creation
  status: z.enum(['pending', 'ready', 'executed', 'cancelled']),
  txHash: z.string().optional(),
});

export type PendingTransfer = z.infer<typeof PendingTransferSchema>;

// ============================================================================
// Payment Types
// ============================================================================

export const StripeCheckoutRequestSchema = z.object({
  amountUsd: z.number().positive(),
  projectId: z.number().positive(),
  chainId: z.number(),
  memo: z.string().optional(),
});

export type StripeCheckoutRequest = z.infer<typeof StripeCheckoutRequestSchema>;

export const PaymentExecutionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  stripePaymentId: z.string(),
  amountUsd: z.number(),
  projectId: z.number(),
  chainId: z.number(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  txHash: z.string().optional(),
  tokensReceived: z.string().optional(), // BigInt as string
  createdAt: z.date(),
  completedAt: z.date().optional(),
});

export type PaymentExecution = z.infer<typeof PaymentExecutionSchema>;

// ============================================================================
// Chat & Events Types
// ============================================================================

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.date(),
  toolCalls: z.array(z.object({
    tool: z.string(),
    input: z.record(z.unknown()),
    output: z.record(z.unknown()).optional(),
    success: z.boolean().optional(),
    latencyMs: z.number().optional(),
  })).optional(),
  feedback: z.object({
    helpful: z.boolean().nullable(),
    reported: z.boolean(),
    reportReason: z.string().optional(),
    userCorrection: z.string().optional(),
  }).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(), // null for anonymous
  startedAt: z.date(),
  endedAt: z.date().optional(),
  privacyMode: z.enum(['open_book', 'anonymous', 'private', 'ghost']),
  walletConnected: z.boolean(),
  mode: z.enum(['self_custody', 'managed']),
  entryPoint: z.string().optional(),
  outcome: z.object({
    completedPayment: z.boolean(),
    foundProject: z.boolean(),
    connectedWallet: z.boolean(),
    errorEncountered: z.boolean(),
    userAbandoned: z.boolean(),
  }).optional(),
  sessionRating: z.number().min(1).max(5).optional(),
  sessionFeedback: z.string().optional(),
});

export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const EventSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  type: z.string(),
  data: z.record(z.unknown()),
  timestamp: z.date(),
});

export type Event = z.infer<typeof EventSchema>;

// ============================================================================
// User Correction Queue Types
// ============================================================================

export const CorrectionSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  sessionId: z.string().uuid(),
  originalContent: z.string(),
  userCorrection: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewedAt: z.date().optional(),
  reviewNotes: z.string().optional(),
  createdAt: z.date(),
});

export type Correction = z.infer<typeof CorrectionSchema>;

// ============================================================================
// Privacy Mode Definitions
// ============================================================================

export const PrivacyModes = {
  open_book: {
    name: 'Open Book',
    description: 'Conversations improve the app. Fully attributed.',
    storeChat: true,
    storeAnalytics: true,
    includeInTraining: true,
    stripIdentity: false,
  },
  anonymous: {
    name: 'Anonymous',
    description: 'Conversations improve the app. Identity stripped.',
    storeChat: true,
    storeAnalytics: true,
    includeInTraining: true,
    stripIdentity: true,
  },
  private: {
    name: 'Private',
    description: 'Conversations not stored. Basic usage analytics only.',
    storeChat: false,
    storeAnalytics: true,
    includeInTraining: false,
    stripIdentity: true,
  },
  ghost: {
    name: 'Ghost',
    description: 'Nothing collected. Requires self-custody mode.',
    storeChat: false,
    storeAnalytics: false,
    includeInTraining: false,
    stripIdentity: true,
  },
} as const;

export type PrivacyMode = keyof typeof PrivacyModes;

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// Environment Config
// ============================================================================

export interface EnvConfig {
  // Server
  port: number;
  env: 'development' | 'production';
  isTestnet: boolean; // True when using Sepolia testnets

  // Database
  databaseUrl: string;

  // Auth
  jwtSecret: string;
  sessionDurationMs: number;

  // Encryption (for E2E keypair storage)
  encryptionMasterKey: string;

  // Cron jobs
  cronSecret: string;

  // Stripe
  stripeSecretKey: string;
  stripePublishableKey: string;
  stripeWebhookSecret: string;

  // AI Provider
  aiProvider: 'anthropic' | 'moonshot';
  aiFreeMode: boolean; // Beta: AI is free when true

  // Anthropic
  anthropicApiKey: string;

  // Moonshot (Kimi)
  moonshotApiKey: string;
  moonshotModel: string;

  // Reserves wallet (for fiat-to-crypto)
  reservesPrivateKey: string; // Hot wallet for executing payments

  // External API keys (for proxy endpoints)
  bendystrawApiKey: string;   // Bendystraw GraphQL API
  theGraphApiKey: string;     // The Graph Uniswap subgraph
  ankrApiKey: string;         // Ankr RPC endpoints (optional)

  // IPFS (Pinata)
  ipfsApiUrl?: string;        // Pinata API URL
  ipfsApiKey?: string;        // Pinata API key
  ipfsApiSecret?: string;     // Pinata API secret

  // Forge (Hook Development)
  forgeDockerEnabled?: boolean;  // Enable Docker-based forge execution
  semgrepEnabled?: boolean;      // Enable Semgrep security analysis

  // Replicate (Image Generation)
  replicateApiToken?: string;    // Replicate API token for image generation
}
