/**
 * Google Calendar API client wrapper for read-only access.
 */

import { type calendar_v3, google } from "googleapis";

import type { CalendarAttendee, CalendarEvent, CalendarInfo } from "./types.js";

export type CalendarClient = ReturnType<typeof createCalendarClient>;

/**
 * Create a Google Calendar API client with the given access token.
 */
export function createCalendarClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: "v3", auth });

  return {
    /**
     * List events from a calendar.
     */
    async listEvents(
      options: {
        calendarId?: string;
        timeMin?: string;
        timeMax?: string;
        maxResults?: number;
        singleEvents?: boolean;
        orderBy?: "startTime" | "updated";
        query?: string;
      } = {},
    ): Promise<CalendarEvent[]> {
      const {
        calendarId = "primary",
        timeMin,
        timeMax,
        maxResults = 10,
        singleEvents = true,
        orderBy = "startTime",
        query,
      } = options;

      const response = await calendar.events.list({
        calendarId,
        timeMin: timeMin ?? new Date().toISOString(),
        timeMax,
        maxResults,
        singleEvents,
        orderBy,
        q: query,
      });

      const events = response.data.items ?? [];
      return events.map((e) => parseCalendarEvent(e, calendarId));
    },

    /**
     * Get a specific event by ID.
     */
    async getEvent(
      eventId: string,
      calendarId = "primary",
    ): Promise<CalendarEvent> {
      const response = await calendar.events.get({
        calendarId,
        eventId,
      });

      return parseCalendarEvent(response.data, calendarId);
    },

    /**
     * List all calendars the user has access to.
     */
    async listCalendars(): Promise<CalendarInfo[]> {
      const response = await calendar.calendarList.list();
      const calendars = response.data.items ?? [];

      return calendars
        .filter((cal) => cal.id)
        .map((cal) => ({
          id: cal.id as string,
          summary: cal.summary ?? "Untitled",
          description: cal.description ?? undefined,
          primary: cal.primary ?? false,
          backgroundColor: cal.backgroundColor ?? undefined,
          foregroundColor: cal.foregroundColor ?? undefined,
          accessRole:
            (cal.accessRole as CalendarInfo["accessRole"]) ?? "reader",
        }));
    },

    /**
     * Check free/busy times across multiple calendars.
     */
    async getFreeBusy(options: {
      calendarIds: string[];
      timeMin: string;
      timeMax: string;
    }): Promise<Record<string, Array<{ start: string; end: string }>>> {
      const { calendarIds, timeMin, timeMax } = options;

      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: calendarIds.map((id) => ({ id })),
        },
      });

      const result: Record<string, Array<{ start: string; end: string }>> = {};

      for (const [calId, data] of Object.entries(
        response.data.calendars ?? {},
      )) {
        result[calId] = (data.busy ?? []).map((b) => ({
          start: b.start ?? "",
          end: b.end ?? "",
        }));
      }

      return result;
    },
  };
}

/**
 * Parse Google Calendar API event response into our types.
 */
function parseCalendarEvent(
  event: calendar_v3.Schema$Event,
  calendarId: string,
): CalendarEvent {
  return {
    id: event.id ?? "",
    calendarId,
    summary: event.summary ?? "Untitled Event",
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: {
      dateTime: event.start?.dateTime ?? undefined,
      date: event.start?.date ?? undefined,
      timeZone: event.start?.timeZone ?? undefined,
    },
    end: {
      dateTime: event.end?.dateTime ?? undefined,
      date: event.end?.date ?? undefined,
      timeZone: event.end?.timeZone ?? undefined,
    },
    status: (event.status as CalendarEvent["status"]) ?? "confirmed",
    attendees: event.attendees
      ?.filter((a) => a.email)
      .map((a) => ({
        email: a.email as string,
        displayName: a.displayName ?? undefined,
        responseStatus:
          (a.responseStatus as CalendarAttendee["responseStatus"]) ??
          "needsAction",
        organizer: a.organizer ?? undefined,
        self: a.self ?? undefined,
      })),
    organizer: event.organizer?.email
      ? {
          email: event.organizer.email,
          displayName: event.organizer.displayName ?? undefined,
        }
      : undefined,
    recurrence: event.recurrence ?? undefined,
    recurringEventId: event.recurringEventId ?? undefined,
    htmlLink: event.htmlLink ?? "",
    hangoutLink: event.hangoutLink ?? undefined,
    conferenceData: event.conferenceData?.entryPoints
      ? {
          entryPoints: event.conferenceData.entryPoints.map((ep) => ({
            uri: ep.uri ?? "",
            label: ep.label ?? undefined,
          })),
        }
      : undefined,
    created: event.created ?? undefined,
    updated: event.updated ?? undefined,
  };
}
