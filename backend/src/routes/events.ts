import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { optionalAuth, requireAuth, requireAdmin } from '../middleware/auth.ts';
import {
  createChatSession,
  updateChatSessionOutcome,
  endChatSession,
  storeChatMessage,
  updateMessageFeedback,
  storeEvent,
  storeEvents,
  getPendingCorrections,
  reviewCorrection,
  exportTrainingData,
} from '../services/events.ts';
import type { PrivacyMode } from '../types/index.ts';

const eventsRouter = new Hono();

// ============================================================================
// Chat Sessions
// ============================================================================

const CreateSessionSchema = z.object({
  privacyMode: z.enum(['open_book', 'anonymous', 'private', 'ghost']),
  mode: z.enum(['self_custody', 'managed']),
  entryPoint: z.string().optional(),
});

eventsRouter.post(
  '/sessions',
  optionalAuth,
  zValidator('json', CreateSessionSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    const sessionId = await createChatSession(
      user?.id ?? null,
      body.privacyMode,
      body.mode,
      body.entryPoint
    );

    return c.json({ success: true, data: { sessionId } });
  }
);

const UpdateOutcomeSchema = z.object({
  completedPayment: z.boolean().optional(),
  foundProject: z.boolean().optional(),
  connectedWallet: z.boolean().optional(),
  errorEncountered: z.boolean().optional(),
  userAbandoned: z.boolean().optional(),
});

eventsRouter.patch(
  '/sessions/:sessionId/outcome',
  zValidator('json', UpdateOutcomeSchema),
  async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = c.req.valid('json');

    await updateChatSessionOutcome(sessionId, body);

    return c.json({ success: true });
  }
);

const EndSessionSchema = z.object({
  rating: z.number().min(1).max(5).optional(),
  feedback: z.string().optional(),
});

eventsRouter.post(
  '/sessions/:sessionId/end',
  zValidator('json', EndSessionSchema),
  async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = c.req.valid('json');

    await endChatSession(sessionId, body.rating, body.feedback);

    return c.json({ success: true });
  }
);

// ============================================================================
// Chat Messages
// ============================================================================

const StoreMessageSchema = z.object({
  sessionId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  toolCalls: z
    .array(
      z.object({
        tool: z.string(),
        input: z.record(z.unknown()),
        output: z.record(z.unknown()).optional(),
        success: z.boolean().optional(),
        latencyMs: z.number().optional(),
      })
    )
    .optional(),
});

eventsRouter.post(
  '/messages',
  zValidator('json', StoreMessageSchema),
  async (c) => {
    const body = c.req.valid('json');

    const messageId = await storeChatMessage(
      body.sessionId,
      body.role,
      body.content,
      body.toolCalls
    );

    return c.json({ success: true, data: { messageId } });
  }
);

const FeedbackSchema = z.object({
  helpful: z.boolean().optional(),
  reported: z.boolean().optional(),
  reportReason: z.string().optional(),
  userCorrection: z.string().optional(),
});

eventsRouter.patch(
  '/messages/:messageId/feedback',
  zValidator('json', FeedbackSchema),
  async (c) => {
    const messageId = c.req.param('messageId');
    const body = c.req.valid('json');

    await updateMessageFeedback(messageId, body);

    return c.json({ success: true });
  }
);

// ============================================================================
// Raw Events (Real-time streaming)
// ============================================================================

const SingleEventSchema = z.object({
  sessionId: z.string().uuid().nullable(),
  eventType: z.string(),
  eventData: z.record(z.unknown()),
  privacyMode: z.enum(['open_book', 'anonymous', 'private', 'ghost']),
});

const BatchEventsSchema = z.object({
  events: z.array(SingleEventSchema),
});

// Single event
eventsRouter.post(
  '/stream',
  optionalAuth,
  zValidator('json', SingleEventSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    await storeEvent(
      body.sessionId,
      user?.id ?? null,
      body.eventType,
      body.eventData,
      body.privacyMode
    );

    return c.json({ success: true });
  }
);

// Batch events (for efficiency)
eventsRouter.post(
  '/stream/batch',
  optionalAuth,
  zValidator('json', BatchEventsSchema),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    await storeEvents(
      body.events.map((e) => ({
        ...e,
        userId: user?.id ?? null,
      }))
    );

    return c.json({ success: true, data: { count: body.events.length } });
  }
);

// ============================================================================
// Admin: Corrections Queue
// ============================================================================

eventsRouter.get('/admin/corrections', requireAuth, requireAdmin, async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const corrections = await getPendingCorrections(limit, offset);

  return c.json({ success: true, data: corrections });
});

const ReviewCorrectionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNotes: z.string().optional(),
});

eventsRouter.post(
  '/admin/corrections/:id',
  requireAuth,
  requireAdmin,
  zValidator('json', ReviewCorrectionSchema),
  async (c) => {
    const correctionId = c.req.param('id');
    const body = c.req.valid('json');

    await reviewCorrection(correctionId, body.status, body.reviewNotes);

    return c.json({ success: true });
  }
);

// ============================================================================
// Admin: Training Data Export
// ============================================================================

eventsRouter.get('/admin/training-data', requireAuth, requireAdmin, async (c) => {
  const quality = c.req.query('quality') as 'good' | 'bad' | undefined;
  const limit = parseInt(c.req.query('limit') ?? '1000', 10);

  if (quality && quality !== 'good' && quality !== 'bad') {
    return c.json({ success: false, error: 'quality must be "good" or "bad"' }, 400);
  }

  const goodData = !quality || quality === 'good' ? await exportTrainingData('good', limit) : [];
  const badData = !quality || quality === 'bad' ? await exportTrainingData('bad', limit) : [];

  return c.json({
    success: true,
    data: {
      good: goodData,
      bad: badData,
    },
  });
});

export { eventsRouter };
