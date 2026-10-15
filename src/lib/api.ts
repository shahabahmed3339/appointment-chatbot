import type {
  PublicUser,
  Appointment,
  AppointmentStatus,
  ChatSession,
  ChatMessage,
  BookingDraft,
} from '@/types';

const TOKEN_KEY = 'ac_app_token';

export const tokenStore = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    window.localStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Thin typed fetch wrapper. Keeps auth-token handling and the API's error
 * envelope ({ error: { code, message } }) in exactly one place.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiClientError('NETWORK_ERROR', 'Could not reach the server. Check your connection.', 0);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body (e.g. a 500 HTML page) — handled below */
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError(
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed (${res.status})`,
      res.status,
      err?.details,
    );
  }

  return (payload as { data: T }).data;
}

export const api = {
  auth: {
    signup: (input: { email: string; password: string; fullName: string }) =>
      request<{ user: PublicUser; token: string }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    login: (input: { email: string; password: string }) =>
      request<{ user: PublicUser; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    me: () => request<{ user: PublicUser }>('/api/auth/me'),
  },

  appointments: {
    list: (status?: AppointmentStatus) =>
      request<{ appointments: Appointment[] }>(
        `/api/appointments${status ? `?status=${status}` : ''}`,
      ),
    /**
     * Takes the raw date/time the form collects and converts to an ISO window.
     * Interpreting the input as the browser's local time is the only sane default:
     * the API stores timestamptz, so the server never has to guess a timezone.
     */
    create: (input: {
      title: string;
      date: string;
      time: string;
      durationMinutes: number;
      notes?: string;
    }) => {
      const startsAt = new Date(`${input.date}T${input.time}`);
      if (Number.isNaN(startsAt.getTime())) {
        return Promise.reject(
          new ApiClientError('VALIDATION_ERROR', 'Please provide a valid date and time.', 422),
        );
      }
      const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
      return request<{ appointment: Appointment }>('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          title: input.title,
          notes: input.notes,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        }),
      });
    },
    update: (id: string, input: { status: AppointmentStatus }) =>
      request<{ appointment: Appointment }>(`/api/appointments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
  },

  chat: {
    startSession: () => request<{ session: ChatSession }>('/api/chat/sessions', { method: 'POST' }),
    getSession: (id: string) =>
      request<{ session: ChatSession; messages: ChatMessage[] }>(`/api/chat/sessions/${id}`),
    sendMessage: (id: string, content: string) =>
      request<{
        session: ChatSession;
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
        draft: BookingDraft;
        missing: string[];
        readyToBook: boolean;
        aiAvailable: boolean;
        aiProvider: string;
        aiModel: string;
        aiErrorReason?: string;
      }>(`/api/chat/sessions/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    confirmDraft: (id: string) =>
      request<{ appointmentId: string; session: ChatSession }>(
        `/api/chat/sessions/${id}/confirm`,
        { method: 'POST' },
      ),
  },
};
