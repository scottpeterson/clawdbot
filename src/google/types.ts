/**
 * Shared types for Google Workspace integration (Gmail, Calendar).
 */

// -----------------------------------------------------------------------------
// OAuth Types
// -----------------------------------------------------------------------------

export type GoogleWorkspaceCredentials = {
  access: string;
  refresh: string;
  expires: number; // Unix timestamp (ms)
  email?: string;
};

// -----------------------------------------------------------------------------
// Gmail Types
// -----------------------------------------------------------------------------

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  date: string; // ISO 8601
  snippet: string; // ~100 char preview
  labels: string[];
  hasAttachments: boolean;
};

export type GmailMessageFull = GmailMessageSummary & {
  body: {
    text?: string; // Plain text body
    html?: string; // HTML body (if no text)
  };
  attachments?: Array<{
    filename: string;
    mimeType: string;
    size: number;
  }>;
};

export type GmailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
};

// -----------------------------------------------------------------------------
// Calendar Types
// -----------------------------------------------------------------------------

export type CalendarEventTime = {
  dateTime?: string; // ISO 8601 for timed events
  date?: string; // YYYY-MM-DD for all-day events
  timeZone?: string;
};

export type CalendarAttendee = {
  email: string;
  displayName?: string;
  responseStatus: "needsAction" | "declined" | "tentative" | "accepted";
  organizer?: boolean;
  self?: boolean;
};

export type CalendarEvent = {
  id: string;
  calendarId: string;
  summary: string; // Title
  description?: string;
  location?: string;
  start: CalendarEventTime;
  end: CalendarEventTime;
  status: "confirmed" | "tentative" | "cancelled";
  attendees?: CalendarAttendee[];
  organizer?: { email: string; displayName?: string };
  recurrence?: string[];
  recurringEventId?: string;
  htmlLink: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ uri: string; label?: string }>;
  };
  created?: string;
  updated?: string;
};

export type CalendarInfo = {
  id: string;
  summary: string; // Calendar name
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
};
