import {
  chatRepository,
  toSession,
  toMessage,
  ChatSession,
  ChatMessage,
} from './chat.repository';
import { aiService, BookingDraft } from '../ai/ai.service';
import { appointmentService } from '../appointments/appointment.service';
import { ApiError } from '@/server/lib/errors';
import { logger } from '@/server/lib/logger';

export interface SendMessageResult {
  session: ChatSession;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  draft: BookingDraft;
  missing: string[];
  readyToBook: boolean;
  aiAvailable: boolean;
  /** Which LLM provider served this turn (or was attempted). */
  aiProvider: string;
  aiModel: string;
  /** Machine-readable reason the LLM path failed, when it did. */
  aiErrorReason?: string;
}

export const chatService = {
  /** Creates a new session or resumes the caller's current active one. */
  async startOrResume(businessId: string, userId: string): Promise<ChatSession> {
    const existing = await chatRepository.findActiveSession(businessId, userId);
    if (existing) return toSession(existing);

    const created = await chatRepository.createSession(businessId, userId);
    return toSession(created);
  },

  async getSession(
    businessId: string,
    userId: string,
    sessionId: string,
  ): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
    const session = await chatRepository.findSessionById(businessId, userId, sessionId);
    if (!session) throw ApiError.notFound('Chat session not found');

    const messages = await chatRepository.listMessages(sessionId);
    return { session: toSession(session), messages: messages.map(toMessage) };
  },

  /**
   * One full chat turn:
   *   persist user msg -> AI extraction -> merge draft -> persist assistant msg.
   *
   * Note the ordering guarantee: the user's message is stored before the AI call,
   * so a provider outage never loses the user's input.
   */
  async sendMessage(params: {
    businessId: string;
    userId: string;
    sessionId: string;
    content: string;
  }): Promise<SendMessageResult> {
    const session = await chatRepository.findSessionById(
      params.businessId,
      params.userId,
      params.sessionId,
    );
    if (!session) throw ApiError.notFound('Chat session not found');

    const userMessage = await chatRepository.addMessage(params.sessionId, 'user', params.content);

    const history = await chatRepository.listMessages(params.sessionId);
    const historyForAi = history
      .slice(0, -1)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const outcome = await aiService.runTurn({
      sessionId: params.sessionId,
      userId: params.userId,
      draft: (session.draft ?? {}) as Partial<BookingDraft>,
      history: historyForAi,
      userMessage: params.content,
    });

    const assistantMessage = await chatRepository.addMessage(
      params.sessionId,
      'assistant',
      outcome.reply,
    );

    await chatRepository.updateDraft(
      params.sessionId,
      outcome.draft as unknown as Record<string, unknown>,
      outcome.draft.title ?? undefined,
    );

    const updated = await chatRepository.findSessionById(
      params.businessId,
      params.userId,
      params.sessionId,
    );

    return {
      session: toSession(updated ?? session),
      userMessage: toMessage(userMessage),
      assistantMessage: toMessage(assistantMessage),
      draft: outcome.draft,
      missing: outcome.missing,
      readyToBook: outcome.readyToBook,
      aiAvailable: outcome.aiAvailable,
      aiProvider: outcome.provider,
      aiModel: outcome.model,
      aiErrorReason: outcome.aiErrorReason,
    };
  },

  /**
   * Confirms the session's current draft as a real appointment.
   *
   * This is the AI/business-logic boundary in action: the LLM produced a draft,
   * but the appointment is created through the SAME validated service path as a
   * human-submitted form — same zod rules, same overlap guard, same persistence.
   */
  async confirmDraft(params: {
    businessId: string;
    userId: string;
    sessionId: string;
  }): Promise<{ appointmentId: string; session: ChatSession }> {
    const session = await chatRepository.findSessionById(
      params.businessId,
      params.userId,
      params.sessionId,
    );
    if (!session) throw ApiError.notFound('Chat session not found');

    const draft = (session.draft ?? {}) as Partial<BookingDraft>;
    if (!draft.title || !draft.date || !draft.time) {
      throw ApiError.validation('Booking draft is incomplete', {
        missing: [
          !draft.title ? 'title' : null,
          !draft.date ? 'date' : null,
          !draft.time ? 'time' : null,
        ].filter(Boolean) as string[],
      });
    }

    const window = aiService.draftToWindow(draft as BookingDraft);
    if (!window) throw ApiError.validation('Could not resolve a valid time window from the draft');

    const appointment = await appointmentService.create({
      businessId: params.businessId,
      userId: params.userId,
      title: draft.title,
      notes: draft.notes ?? null,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      source: 'chat',
    });

    await chatRepository.addMessage(
      params.sessionId,
      'assistant',
      `Booked: ${appointment.title} on ${new Date(appointment.startsAt).toUTCString()}.`,
    );
    await chatRepository.setSessionStatus(params.sessionId, 'booked');

    const updated = await chatRepository.findSessionById(
      params.businessId,
      params.userId,
      params.sessionId,
    );

    logger.info('chat_booking_confirmed', {
      sessionId: params.sessionId,
      appointmentId: appointment.id,
    });

    return { appointmentId: appointment.id, session: toSession(updated ?? session) };
  },
};
