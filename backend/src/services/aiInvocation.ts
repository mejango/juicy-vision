/**
 * AI Invocation Service
 *
 * Full pipeline for invoking the AI in a chat: context building, prompt
 * enhancement, attachment pinning, streaming with tool execution, response
 * persistence, confidence/escalation handling, and post-response bookkeeping.
 *
 * Extracted from the POST /chat/:chatId/ai/invoke route handler; the route
 * keeps auth + validation and delegates the pipeline here.
 */

import { type ChatMessage, getChatById, getChatMessages } from './chat.ts';
import { parseConfidence } from './claude.ts';
import { createEscalation, updateMessageConfidence } from './escalation.ts';

export interface InvokeAiParams {
  chatId: string;
  /** Wallet address of the invoking member (used as the hidden-prompt sender). */
  walletAddress: string;
  /** Linked user ID, when the wallet session has one. */
  userId?: string;
  prompt: string;
  attachments?: Array<{
    type: 'image' | 'document';
    name: string;
    mimeType: string;
    data: string;
  }>;
  /** User-provided Claude API key (BYOK). */
  apiKey?: string;
  /** Persist the prompt to the DB as a hidden message for future AI context. */
  savePrompt?: boolean;
}

/**
 * Invoke the AI for a chat and stream the response to connected clients.
 * Returns the persisted assistant message.
 *
 * The caller is responsible for auth: chat existence, the chat's AI toggle,
 * and the member's invoke_ai permission.
 */
export async function invokeAiForChat(params: InvokeAiParams): Promise<ChatMessage> {
  const { chatId, walletAddress, userId, prompt, attachments, apiKey, savePrompt } = params;

  // Build optimized context with summaries, state, and token budgeting
  const { buildOptimizedContext, formatContextForClaude, logContextUsage } = await import(
    './contextManager.ts'
  );
  const { buildEnhancedPrompt } = await import('./aiProvider.ts');
  const { logIntentDetection, createMetricsEntryFromResult } = await import(
    './intentMetrics.ts'
  );

  const optimizedContext = await buildOptimizedContext(chatId, userId);
  const chatHistory = formatContextForClaude(optimizedContext);

  // Build enhanced system prompt with transaction state and user context
  // Phase 1: Enable sub-modules for token efficiency
  // Phase 2: Enable semantic detection when embeddings are available
  const { systemPrompt: enhancedSystem, intents, semanticResult } = await buildEnhancedPrompt({
    chatId,
    userId: userId,
    includeOmnichain: true,
    useSubModules: true, // Phase 1: Granular sub-module loading
    useSemanticDetection: false, // Phase 2: Enable when embeddings are seeded
  });

  // Log intent detection metrics for optimization
  let metricsId = '';
  if (semanticResult) {
    const metricsEntry = createMetricsEntryFromResult(semanticResult, chatId);
    metricsId = await logIntentDetection(metricsEntry);
  } else if (intents) {
    // Log keyword-only detection
    metricsId = await logIntentDetection({
      chatId,
      detectedIntents: [
        intents.needsDataQuery ? 'dataQuery' : '',
        intents.needsHookDeveloper ? 'hookDeveloper' : '',
        intents.needsTransaction ? 'transaction' : '',
      ].filter(Boolean),
      subModulesLoaded: intents.transactionSubModules || [],
      detectionMethod: 'keyword',
      detectionTimeMs: 0,
    });
  }

  // Build multimodal content blocks for the new prompt
  const contentBlocks: Array<
    { type: 'text'; text: string } | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    } | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
  > = [];

  // Pin image attachments to IPFS first so we can include URIs in the prompt
  // Failures are logged and skipped
  const ipfsUris: Record<string, string> = {};
  if (attachments && attachments.length > 0) {
    const { pinAttachments } = await import('./ipfs.ts');
    const images = attachments
      .filter((att) => att.type === 'image')
      .map((att) => ({
        ...att,
        name: att.name || `image.${att.mimeType.split('/')[1] || 'png'}`,
      }));
    for (const { att, cid } of await pinAttachments(images)) {
      if (cid === null) continue;
      // Extract field ID from attachment name (format: fieldId.ext)
      const fieldId = att.name?.split('.')[0] || 'image';
      ipfsUris[fieldId] = `ipfs://${cid}`;
      console.log(`[IPFS] Pinned attachment ${fieldId} to ${ipfsUris[fieldId]}`);
    }
  }

  // Build prompt text, including IPFS URIs for any pinned images
  let promptText = prompt || '';
  if (Object.keys(ipfsUris).length > 0) {
    const uriList = Object.entries(ipfsUris)
      .map(([fieldId, uri]) => `- ${fieldId}: ${uri}`)
      .join('\n');
    promptText +=
      `\n\n[Uploaded images pinned to IPFS - use these URIs in transaction parameters:\n${uriList}]`;
  }

  // Add text content if present
  if (promptText.length > 0) {
    contentBlocks.push({ type: 'text', text: promptText });
  }

  // Add attachments as content blocks (for Claude to see the image)
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      if (attachment.type === 'image') {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mimeType,
            data: attachment.data,
          },
        });
      } else if (attachment.type === 'document') {
        contentBlocks.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: attachment.mimeType,
            data: attachment.data,
          },
        });
      }
    }
  }

  // Add the new prompt to history (use string if no attachments, blocks otherwise)
  const hasAttachments = attachments && attachments.length > 0;
  if (hasAttachments) {
    chatHistory.push({ role: 'user', content: contentBlocks });
  } else {
    chatHistory.push({ role: 'user', content: prompt });
  }

  // Import services
  const { streamMessageWithTools } = await import('./aiProvider.ts');
  const { importMessage } = await import('./chat.ts');
  const { streamAiToken } = await import('./websocket.ts');

  // When savePrompt is true, persist the hidden prompt to the database so it's
  // available in future AI context. importMessage doesn't broadcast to the UI.
  // This is critical for system messages (e.g. per-chain projectIds after deployment)
  // that need to be in conversation history for subsequent operations like setUriOf.
  if (savePrompt) {
    await importMessage({
      chatId,
      senderAddress: walletAddress,
      role: 'user',
      content: prompt,
    });
  }

  // Generate a message ID upfront for streaming
  const messageId = crypto.randomUUID();
  const assistantAddress = '0x0000000000000000000000000000000000000000';

  // Extract user's API key if provided (BYOK)
  const userApiKey = apiKey;

  // Stream Claude response with automatic tool execution
  let fullContent = '';
  let streamingStarted = false;

  console.log(
    `[AI] ${chatId}: Starting AI stream with ${chatHistory.length} messages (userApiKey: ${
      userApiKey ? 'yes' : 'no'
    })`,
  );
  console.log(`[AI] ${chatId}: System prompt length: ${enhancedSystem.length} chars`);
  console.log(
    `[AI] ${chatId}: Last user message: "${
      (chatHistory[chatHistory.length - 1]?.content as string)?.substring(0, 100)
    }..."`,
  );
  try {
    for await (
      const event of streamMessageWithTools(chatId, {
        messages: chatHistory,
        system: enhancedSystem,
      }, userApiKey)
    ) {
      if (!streamingStarted) {
        console.log(
          `[AI] ${chatId}: First event received, type: ${event.type}, data preview: ${
            JSON.stringify(event.data)?.substring(0, 100)
          }`,
        );
      }
      streamingStarted = true;
      if (event.type === 'text') {
        const token = event.data as string;
        fullContent += token;

        // Broadcast each token to connected clients
        streamAiToken(chatId, messageId, token, false);
      } else if (event.type === 'thinking') {
        // Log tool usage for debugging (not shown to user)
        console.log(`[AI] ${chatId}: ${event.data}`);
      } else if (event.type === 'tool_result') {
        // Optionally show tool results (could be verbose, so we keep it subtle)
        const result = event.data as {
          id: string;
          name: string;
          result?: string;
          error?: string;
        };
        if (result.error) {
          const errorText = `\n\n> ⚠️ Tool error: ${result.error}\n\n`;
          fullContent += errorText;
          streamAiToken(chatId, messageId, errorText, false);
        }
      }
    }

    // If the AI produced no text (e.g., tool calls exhausted token budget, or empty
    // data from bendystraw for a freshly deployed project), surface a recovery message
    if (!fullContent.trim()) {
      console.warn(`[AI] ${chatId}: Stream completed with no text content`);
      fullContent = "Sorry, I wasn't able to process that. Could you try again?";
      streamAiToken(chatId, messageId, fullContent, false);
    }
  } catch (streamError) {
    // Parse error and provide user-friendly message
    const rawMsg = streamError instanceof Error ? streamError.message : 'Stream interrupted';
    console.error(`[AI] ${chatId}: Stream error - ${rawMsg}`);

    // Categorize the error for better UX
    // BYOK users get specific messages about their own API key
    const isUsingOwnKey = !!userApiKey;
    let userFriendlyMsg: string;

    if (rawMsg.includes('credit balance is too low') || rawMsg.includes('purchase credits')) {
      userFriendlyMsg = isUsingOwnKey
        ? "Your Anthropic API key has run out of credits. Please add credits at console.anthropic.com or remove your key to use Juicy's service."
        : "I'm temporarily unavailable due to a service limit. The team has been notified - please try again shortly!";
    } else if (rawMsg.includes('rate_limit') || rawMsg.includes('too many requests')) {
      userFriendlyMsg = isUsingOwnKey
        ? 'Your API key has hit a rate limit. Please wait a moment and try again.'
        : "I'm getting a lot of requests right now. Please wait a moment and try again.";
    } else if (rawMsg.includes('overloaded') || rawMsg.includes('capacity')) {
      userFriendlyMsg = 'The AI service is a bit overloaded. Please try again in a few seconds.';
    } else if (rawMsg.includes('invalid_api_key') || rawMsg.includes('authentication')) {
      userFriendlyMsg = isUsingOwnKey
        ? 'Your API key appears to be invalid. Please check your key in Settings.'
        : "There's a configuration issue. The team has been notified.";
    } else {
      userFriendlyMsg = 'Something went wrong. Please try again.';
    }

    if (streamingStarted) {
      fullContent += `\n\n*${userFriendlyMsg}*`;
      streamAiToken(chatId, messageId, `\n\n*${userFriendlyMsg}*`, false);
    }
  } finally {
    // Always signal streaming is done, even on error
    streamAiToken(chatId, messageId, '', true);
  }

  // Parse and strip confidence tag from AI response
  const { content: cleanedContent, confidence } = parseConfidence(fullContent);

  // Debug: Log if content significantly changed (potential truncation)
  if (fullContent.length > 0 && cleanedContent.length < fullContent.length * 0.9) {
    console.warn(
      `[AI] ${chatId}: Content significantly shortened after parseConfidence - original: ${fullContent.length} chars, cleaned: ${cleanedContent.length} chars`,
    );
    console.warn(`[AI] ${chatId}: First 100 chars before: ${fullContent.substring(0, 100)}`);
    console.warn(`[AI] ${chatId}: First 100 chars after: ${cleanedContent.substring(0, 100)}`);
  }

  // Store the complete AI response as a message (with confidence tag stripped),
  // reusing the streaming id so the client reconciles the streamed message with
  // the persisted one instead of showing two replies.
  const aiMessage = await importMessage({
    chatId,
    senderAddress: assistantAddress,
    role: 'assistant',
    content: cleanedContent,
    id: messageId,
  });

  // Store confidence metadata and create escalation if low confidence
  if (confidence) {
    updateMessageConfidence({
      messageId: aiMessage.id,
      confidenceLevel: confidence.level,
      confidenceReason: confidence.reason,
    }).catch((err) => {
      console.error('Failed to update message confidence:', err);
    });

    // Update intent metrics with AI confidence level
    if (metricsId) {
      const { updateIntentMetrics } = await import('./intentMetrics.ts');
      updateIntentMetrics(metricsId, {
        aiConfidenceLevel: confidence.level,
      }).catch((err) => {
        console.error('Failed to update intent metrics with confidence:', err);
      });
    }

    // Auto-escalate low confidence responses for admin review
    if (confidence.level === 'low') {
      createEscalation({
        chatId,
        messageId: aiMessage.id,
        userQuery: prompt,
        aiResponse: cleanedContent,
        confidenceLevel: confidence.level,
        confidenceReason: confidence.reason,
      }).catch((err) => {
        console.error('Failed to create escalation:', err);
      });
    }
  }

  // Update fullContent for downstream processing (state extraction, etc.)
  fullContent = cleanedContent;

  // Context management: Extract transaction state and trigger summarization (async, non-blocking)
  const { extractStateFromResponse } = await import('./transactionState.ts');
  const { checkAndTriggerSummarization, queueAttachmentSummary } = await import(
    './summarization.ts'
  );

  // Extract project design decisions from the response
  extractStateFromResponse(chatId, fullContent, aiMessage.id).catch((err) => {
    console.error('Failed to extract transaction state:', err);
  });

  // Check if we need to summarize older messages
  checkAndTriggerSummarization(chatId).catch((err) => {
    console.error('Failed to check/trigger summarization:', err);
  });

  // Log context usage for analytics
  logContextUsage(chatId, aiMessage.id, optimizedContext).catch((err) => {
    console.error('Failed to log context usage:', err);
  });

  // Queue attachment summaries for the user's message if any
  if (attachments && attachments.length > 0) {
    // We need the user message ID - get the latest user message
    const userMessages = await getChatMessages(chatId, 2);
    const userMessage = userMessages.find((m) => m.role === 'user');
    if (userMessage) {
      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        queueAttachmentSummary(userMessage.id, chatId, i, {
          type: att.type,
          mimeType: att.mimeType,
          data: att.data,
          filename: att.name,
        });
      }
    }
  }

  // Auto-generate title if the chat has a generic name
  const { isGenericName, generateChatTitle, setAutoGeneratedTitle } = await import(
    './chatCategorization.ts'
  );
  const currentChat = await getChatById(chatId);
  if (currentChat && isGenericName(currentChat.name) && !currentChat.autoGeneratedTitle) {
    // Get messages for title generation
    const messagesForTitle = await getChatMessages(chatId, 10);
    const titleMessages = messagesForTitle.map((m) => ({ role: m.role, content: m.content }));

    // Generate title asynchronously (don't block response)
    generateChatTitle(titleMessages).then(async (title) => {
      if (title) {
        await setAutoGeneratedTitle(chatId, title);
        // Broadcast the new title to connected clients
        const { broadcastChatUpdate } = await import('./websocket.ts');
        broadcastChatUpdate(chatId, { autoGeneratedTitle: title });
      }
    }).catch((err) => {
      console.error('Failed to generate chat title:', err);
    });
  }

  return aiMessage;
}
