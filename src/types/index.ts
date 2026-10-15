export interface PublicUser {
  id: string;
  businessId: string;
  email: string;
  fullName: string;
  role: string;
  createdAt: string;
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';
export type AppointmentSource = 'form' | 'chat';

export interface Appointment {
  id: string;
  businessId: string;
  userId: string;
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  createdAt: string;
  updatedAt: string;
}

export interface BookingDraft {
  title: string | null;
  date: string | null;
  time: string | null;
  durationMinutes: number | null;
  notes: string | null;
}

export interface ChatSession {
  id: string;
  title: string;
  status: 'active' | 'booked' | 'abandoned';
  draft: Partial<BookingDraft>;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}
