/**
 * Google Workspace integration (Gmail, Calendar) - read-only access.
 */

export { loginGoogleWorkspace, refreshGoogleToken } from "./auth.js";
export {
  type CalendarClient,
  createCalendarClient,
} from "./calendar-client.js";
export { createGmailClient, type GmailClient } from "./gmail-client.js";
export type {
  CalendarAttendee,
  CalendarEvent,
  CalendarEventTime,
  CalendarInfo,
  GmailLabel,
  GmailMessageFull,
  GmailMessageSummary,
  GoogleWorkspaceCredentials,
} from "./types.js";
