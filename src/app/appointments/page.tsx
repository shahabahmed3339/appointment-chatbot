'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiClientError } from '@/lib/api';
import type { Appointment, AppointmentStatus } from '@/types';

const STATUS_FILTERS: Array<'all' | AppointmentStatus> = [
  'all',
  'pending',
  'confirmed',
  'completed',
  'cancelled',
];

/**
 * Appointment list + a manual booking form.
 *
 * The form is the structured fallback path required by the brief: if the AI
 * cannot confidently extract details from chat, the user can still complete a
 * booking here. Both paths converge on the same API endpoint and service.
 */
export default function AppointmentsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [filter, setFilter] = useState<'all' | AppointmentStatus>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('60');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/');
  }, [authLoading, user, router]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const { appointments } = await api.appointments.list();
      setAppointments(appointments);
    } catch (err) {
      setLoadError(
        err instanceof ApiClientError ? err.message : 'Could not load your appointments.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setSaving(true);
    try {
      await api.appointments.create({
        title,
        date,
        time,
        durationMinutes: Number(duration),
        notes: notes || undefined,
      });
      setFormSuccess('Appointment created.');
      setTitle('');
      setDate('');
      setTime('');
      setNotes('');
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiClientError ? err.message : 'Could not create the appointment.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function onStatusChange(id: string, status: AppointmentStatus) {
    const previous = appointments;
    // Optimistic update — revert if the request fails.
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      await api.appointments.update(id, { status });
    } catch {
      setAppointments(previous);
      setLoadError('Could not update the appointment status.');
    }
  }

  if (authLoading || !user) {
    return (
      <main className="app-loading">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const visible =
    filter === 'all' ? appointments : appointments.filter((a) => a.status === filter);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <span className="auth-logo">◗</span>
            <h1>Appointments</h1>
          </div>
          <nav className="app-nav">
            <Link href="/chat" className="nav-link">
              Assistant
            </Link>
            <Link href="/appointments" className="nav-link nav-link-active">
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

      <div className="page-body">
        <div className="page-toolbar">
          <div className="filters" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                className={filter === s ? 'chip chip-active' : 'chip'}
                onClick={() => setFilter(s)}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New appointment'}
          </button>
        </div>

        {formSuccess && (
          <div className="alert alert-info" role="status">
            {formSuccess}
          </div>
        )}

        {showForm && (
          <form className="card booking-form" onSubmit={onCreate}>
            <h2>New appointment</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="title">What is it for?</label>
                <input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Tax review"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="date">Date</label>
                <input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="time">Time</label>
                <input
                  id="time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="duration">Duration (minutes)</label>
                <select id="duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
                  <option value="30">30</option>
                  <option value="45">45</option>
                  <option value="60">60</option>
                  <option value="90">90</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="notes">Notes (optional)</label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the provider should know"
              />
            </div>

            {formError && (
              <div className="alert alert-error" role="alert">
                {formError}
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create appointment'}
            </button>
          </form>
        )}

        {loadError && (
          <div className="alert alert-error" role="alert">
            {loadError}
          </div>
        )}

        {loading ? (
          <p className="muted">Loading appointments…</p>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <p className="muted">
              {appointments.length === 0
                ? 'No appointments yet. Book one with the assistant or the form above.'
                : 'Nothing matches this filter.'}
            </p>
          </div>
        ) : (
          <ul className="appt-list">
            {visible.map((a) => (
              <li key={a.id} className="card appt-row">
                <div className="appt-main">
                  <h3>{a.title}</h3>
                  <p className="muted small">
                    {formatRange(a.startsAt, a.endsAt)}
                    {a.notes ? ` · ${a.notes}` : ''}
                  </p>
                </div>
                <div className="appt-side">
                  <span className={`status status-${a.status}`}>{a.status}</span>
                  <select
                    className="btn-sm"
                    value={a.status}
                    onChange={(e) => void onStatusChange(a.id, e.target.value as AppointmentStatus)}
                    aria-label={`Change status for ${a.title}`}
                  >
                    <option value="pending">pending</option>
                    <option value="confirmed">confirmed</option>
                    <option value="completed">completed</option>
                    <option value="cancelled">cancelled</option>
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function formatRange(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const date = s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const time = `${s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${e.toLocaleTimeString(
    [],
    { hour: '2-digit', minute: '2-digit' },
  )}`;
  return `${date}, ${time}`;
}
