'use client';

import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiClientError } from '@/lib/api';
import type { ChatMessage, BookingDraft } from '@/types';

/**
 * The conversational booking experience.
 *
 * State is intentionally simple and explicit: a messages array, the rolling
 * draft, and a small set of flags. A reducer or a state library would add
 * ceremony without removing real complexity at this size.
 */
export default function ChatPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<Partial<BookingDraft>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [readyToBook, setReadyToBook] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [aiErrorReason, setAiErrorReason] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Redirect unauthenticated visitors once the auth check settles.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/');
  }, [authLoading, user, router]);

  // Boot the session and load any existing history.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { session } = await api.chat.startSession();
        if (cancelled) return;
        setSessionId(session.id);
        setDraft(session.draft ?? {});
        setReadyToBook(!!session.draft);

        const { messages: history } = await api.chat.getSession(session.id);
        if (cancelled) return;
        if (history.length > 0) {
          setMessages(history);
        } else {
          setMessages([
            {
              id: 'greeting',
              sessionId: session.id,
              role: 'assistant',
              content:
                "Hi! I can book an appointment for you. Tell me what you need and when — for example, “a tax review next Tuesday at 2pm”.",
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      } catch (err) {
        if (!cancelled) {
          setBootError(
            err instanceof ApiClientError ? err.message : 'Could not start the chat session.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  /**
   * Near-real-time sync via polling.
   *
   * The brief asks for "real-time or near-real-time" chat. We poll the session
   * rather than hold a WebSocket open, for three concrete reasons:
   *   1. It survives serverless hosts (Vercel), which do not support long-lived
   *      socket servers in the same process — the single-port deploy story breaks.
   *   2. It keeps one code path for state (REST), so the client has a single
   *      source of truth instead of a socket stream plus a REST fallback.
   *   3. Losing the connection degrades to "slightly stale", not "broken".
   *
   * The interval is cleared while a send is in flight (the POST response already
   * carries the authoritative state) to avoid clobbering the optimistic update.
   */
  useEffect(() => {
    if (!sessionId || sending) return;

    const POLL_MS = 5000;
    let cancelled = false;

    const tick = async () => {
      // Don't poll a backgrounded tab — saves quota and avoids surprise writes.
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const { messages: latest, session } = await api.chat.getSession(sessionId);
        if (cancelled) return;
        // Only replace when the server actually has more turns than we show, so
        // we never drop an optimistic message mid-flight.
        setMessages((prev) => (latest.length > prev.length ? latest : prev));
        if (session.draft) setDraft(session.draft);
      } catch {
        // Transient poll failure is not worth surfacing — the next tick retries.
      }
    };

    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sessionId, sending]);

  async function send() {
    const content = input.trim();
    if (!content || !sessionId || sending) return;

    setInput('');
    setNotice(null);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      sessionId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);

    try {
      const res = await api.chat.sendMessage(sessionId, content);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        res.userMessage,
        res.assistantMessage,
      ]);
      setDraft(res.draft);
      setMissing(res.missing);
      setReadyToBook(res.readyToBook);
      setAiAvailable(res.aiAvailable);
      setAiErrorReason(res.aiErrorReason);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(content);
      setNotice(
        err instanceof ApiClientError
          ? err.message
          : 'Message could not be sent. Please try again.',
      );
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  async function confirmBooking() {
    if (!sessionId || confirming) return;
    setConfirming(true);
    setNotice(null);
    try {
      await api.chat.confirmDraft(sessionId);
      setNotice('Appointment booked. You can see it under Appointments.');
      setReadyToBook(false);
      const { messages: history, session } = await api.chat.getSession(sessionId);
      setMessages(history);
      setDraft(session.draft ?? {});
    } catch (err) {
      setNotice(
        err instanceof ApiClientError ? err.message : 'Could not confirm the booking.',
      );
    } finally {
      setConfirming(false);
    }
  }

  function resetConversation() {
    setSessionId(null);
    setMessages([]);
    setDraft({});
    setMissing([]);
    setReadyToBook(false);
    void (async () => {
      const { session } = await api.chat.startSession();
      setSessionId(session.id);
      setMessages([
        {
          id: 'greeting',
          sessionId: session.id,
          role: 'assistant',
          content: 'Starting fresh — what would you like to book?',
          createdAt: new Date().toISOString(),
        },
      ]);
    })();
  }

  if (authLoading || !user) {
    return (
      <main className="app-loading">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <span className="auth-logo">◗</span>
            <h1>Appointments</h1>
          </div>
          <nav className="app-nav">
            <Link href="/chat" className="nav-link nav-link-active">
              Assistant
            </Link>
            <Link href="/appointments" className="nav-link">
              Appointments
            </Link>
          </nav>
          <div className="app-user">
            <span className="muted">{user.fullName}</span>
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                window.localStorage.clear();
                router.replace('/');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="chat-layout">
        <section className="chat-panel" aria-label="Chat with the booking assistant">
          <div className="chat-scroll" ref={scrollRef}>
            {bootError ? (
              <div className="alert alert-error" role="alert">
                {bootError}
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={m.role === 'user' ? 'bubble bubble-user' : 'bubble bubble-assistant'}
                >
                  <div className="bubble-body">{m.content}</div>
                  <time className="bubble-time">
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              ))
            )}

            {sending && (
              <div className="bubble bubble-assistant" aria-live="polite">
                <div className="typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {notice && (
            <div className="alert alert-info" role="status">
              {notice}
            </div>
          )}

          {!aiAvailable && (
            <div className="alert alert-warn" role="status">
              {aiErrorReason === 'rate_limited'
                ? 'The AI provider is rate-limiting requests right now. Replies are simplified — wait a minute and send another message, or book with the form.'
                : aiErrorReason === 'unauthorized'
                  ? 'The AI provider rejected our API key. Replies are simplified — check the provider key in your environment, or book with the form.'
                  : aiErrorReason === 'not_configured'
                    ? 'No AI provider is configured. Replies are simplified — set an API key (see the README) to enable conversational booking, or book with the form.'
                    : 'The AI assistant is unavailable right now, so replies are simplified. You can still book using the form.'}
            </div>
          )}

          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Describe your appointment… (Enter to send, Shift+Enter for a new line)"
              rows={2}
              aria-label="Message"
              disabled={Boolean(bootError)}
            />
            <button
              className="btn-primary"
              onClick={() => void send()}
              disabled={sending || !input.trim() || Boolean(bootError)}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </section>

        <aside className="draft-panel" aria-label="Booking details">
          <h2>Booking details</h2>
          <p className="muted small">
            Filled in as you chat. Confirm once everything looks right.
          </p>

          <dl className="draft-list">
            <DraftRow label="What" value={draft.title} />
            <DraftRow label="Date" value={draft.date} />
            <DraftRow label="Time" value={draft.time} />
            <DraftRow
              label="Duration"
              value={draft.durationMinutes ? `${draft.durationMinutes} min` : null}
            />
            <DraftRow label="Notes" value={draft.notes} />
          </dl>

          {missing.length > 0 && (
            <div className="draft-missing">
              <span className="muted small">Still needed:</span>
              <div className="chip-row">
                {missing.map((m) => (
                  <span key={m} className="chip">
                    {m === 'title' ? 'what' : m}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            className="btn-primary draft-confirm"
            onClick={() => void confirmBooking()}
            disabled={!readyToBook || confirming}
          >
            {confirming ? 'Booking…' : 'Confirm booking'}
          </button>

          <button className="btn-secondary draft-reset" onClick={resetConversation}>
            Start over
          </button>

          <p className="draft-note muted small">
            Prefer a form? Create it manually on the Appointments page.
          </p>
        </aside>
      </div>
    </main>
  );
}

function DraftRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="draft-row">
      <dt>{label}</dt>
      <dd className={value ? '' : 'draft-empty'}>{value || '—'}</dd>
    </div>
  );
}
