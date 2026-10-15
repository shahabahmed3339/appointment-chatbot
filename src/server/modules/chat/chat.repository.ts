import { query } from '@/server/db/pool';

export interface ChatSessionRow {
  id: string;
  business_id: string;
  user_id: string;
  title: string;
  status: 'active' | 'booked' | 'abandoned';
  draft: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date;
}

export interface ChatSession {
  id: string;
  title: string;
  status: string;
  draft: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export function toSession(row: ChatSessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    draft: row.draft,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at.toISOString(),
  };
}

const SESSION_COLUMNS = 'id, business_id, user_id, title, status, draft, created_at, updated_at';
const MESSAGE_COLUMNS = 'id, session_id, role, content, created_at';

export const chatRepository = {
  async createSession(
    businessId: string,
    userId: string,
    title = 'New booking conversation',
  ): Promise<ChatSessionRow> {
    const rows = await query<ChatSessionRow>(
      `INSERT INTO chat_sessions (business_id, user_id, title)
       VALUES ($1, $2, $3)
       RETURNING ${SESSION_COLUMNS}`,
      [businessId, userId, title],
    );
    return rows[0];
  },

  /** Returns the user's most recent active session, or null. */
  async findActiveSession(businessId: string, userId: string): Promise<ChatSessionRow | null> {
    const rows = await query<ChatSessionRow>(
      `SELECT ${SESSION_COLUMNS}
         FROM chat_sessions
        WHERE business_id = $1 AND user_id = $2 AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1`,
      [businessId, userId],
    );
    return rows[0] ?? null;
  },

  async findSessionById(
    businessId: string,
    userId: string,
    sessionId: string,
  ): Promise<ChatSessionRow | null> {
    const rows = await query<ChatSessionRow>(
      `SELECT ${SESSION_COLUMNS}
         FROM chat_sessions
        WHERE id = $1 AND business_id = $2 AND user_id = $3`,
      [sessionId, businessId, userId],
    );
    return rows[0] ?? null;
  },

  async listMessages(sessionId: string, limit = 100): Promise<ChatMessageRow[]> {
    const rows = await query<ChatMessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
         FROM chat_messages
        WHERE session_id = $1
        ORDER BY created_at ASC
        LIMIT $2`,
      [sessionId, limit],
    );
    return rows;
  },

  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
  ): Promise<ChatMessageRow> {
    const rows = await query<ChatMessageRow>(
      `INSERT INTO chat_messages (session_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING ${MESSAGE_COLUMNS}`,
      [sessionId, role, content],
    );
    return rows[0];
  },

  /** Persists the rolling booking draft and bumps the session's updated_at. */
  async updateDraft(
    sessionId: string,
    draft: Record<string, unknown>,
    title?: string,
  ): Promise<void> {
    if (title) {
      await query(
        `UPDATE chat_sessions SET draft = $2::jsonb, title = $3 WHERE id = $1`,
        [sessionId, JSON.stringify(draft), title],
      );
      return;
    }
    await query(`UPDATE chat_sessions SET draft = $2::jsonb WHERE id = $1`, [
      sessionId,
      JSON.stringify(draft),
    ]);
  },

  async setSessionStatus(sessionId: string, status: 'active' | 'booked' | 'abandoned'): Promise<void> {
    await query(`UPDATE chat_sessions SET status = $2 WHERE id = $1`, [sessionId, status]);
  },

  async logAiInteraction(input: {
    sessionId: string | null;
    userId: string | null;
    provider: string;
    model: string;
    latencyMs: number;
    outcome: 'extracted' | 'clarify' | 'failed';
    requestPayload: unknown;
    responsePayload: unknown;
    errorMessage: string | null;
  }): Promise<void> {
    await query(
      `INSERT INTO ai_interaction_logs
         (session_id, user_id, provider, model, latency_ms, outcome, request_payload, response_payload, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
      [
        input.sessionId,
        input.userId,
        input.provider,
        input.model,
        input.latencyMs,
        input.outcome,
        JSON.stringify(input.requestPayload ?? {}),
        input.responsePayload ? JSON.stringify(input.responsePayload) : null,
        input.errorMessage,
      ],
    );
  },
};
