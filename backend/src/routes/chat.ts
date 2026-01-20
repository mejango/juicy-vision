import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { requireAuth } from '../middleware/auth.ts';
import {
  sendMessage,
  streamMessage,
  getUserUsageStats,
  type ChatMessage,
  type ToolDefinition,
} from '../services/claude.ts';

const chatRouter = new Hono();

// ============================================================================
// Message Schema
// ============================================================================

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});

const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema),
  system: z.string().optional(),
  tools: z.array(ToolSchema).optional(),
  maxTokens: z.number().max(8192).optional(),
  temperature: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
});

// ============================================================================
// Endpoints
// ============================================================================

// POST /chat/message - Send a message (non-streaming)
chatRouter.post(
  '/message',
  requireAuth,
  zValidator('json', ChatRequestSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    // If streaming requested, redirect to stream endpoint
    if (body.stream) {
      return c.json(
        { success: false, error: 'Use /chat/stream for streaming responses' },
        400
      );
    }

    try {
      const response = await sendMessage(user.id, {
        messages: body.messages as ChatMessage[],
        system: body.system,
        tools: body.tools as ToolDefinition[] | undefined,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
      });

      return c.json({
        success: true,
        data: response,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chat request failed';
      const status = message.includes('Rate limit') ? 429 : 500;
      return c.json({ success: false, error: message }, status);
    }
  }
);

// POST /chat/stream - Send a message (streaming via SSE)
chatRouter.post(
  '/stream',
  requireAuth,
  zValidator('json', ChatRequestSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    return streamSSE(c, async (stream) => {
      try {
        const generator = streamMessage(user.id, {
          messages: body.messages as ChatMessage[],
          system: body.system,
          tools: body.tools as ToolDefinition[] | undefined,
          maxTokens: body.maxTokens,
          temperature: body.temperature,
        });

        for await (const event of generator) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
          });
        }

        await stream.writeSSE({
          event: 'done',
          data: '',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Stream error';
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: message }),
        });
      }
    });
  }
);

// GET /chat/usage - Get current usage stats
chatRouter.get('/usage', requireAuth, (c) => {
  const user = c.get('user');
  const stats = getUserUsageStats(user.id);

  return c.json({
    success: true,
    data: stats,
  });
});

// ============================================================================
// Feedback Endpoint (convenience wrapper for events API)
// ============================================================================

const FeedbackSchema = z.object({
  messageId: z.string().uuid(),
  helpful: z.boolean().optional(),
  reported: z.boolean().optional(),
  reportReason: z.string().optional(),
  userCorrection: z.string().optional(),
});

chatRouter.post(
  '/feedback',
  requireAuth,
  zValidator('json', FeedbackSchema),
  async (c) => {
    const body = c.req.valid('json');

    // Import dynamically to avoid circular deps
    const { updateMessageFeedback } = await import('../services/events.ts');

    await updateMessageFeedback(body.messageId, {
      helpful: body.helpful,
      reported: body.reported,
      reportReason: body.reportReason,
      userCorrection: body.userCorrection,
    });

    return c.json({ success: true });
  }
);

export { chatRouter };
