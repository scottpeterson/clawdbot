/**
 * Google Calendar read-only tool for the agent.
 */

import { Type } from "@sinclair/typebox";

import type { ClawdbotConfig } from "../../config/config.js";
import { createCalendarClient } from "../../google/calendar-client.js";
import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  resolveApiKeyForProfile,
} from "../auth-profiles.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const PROVIDER_NAME = "google-workspace";

const GoogleCalendarToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("list"),
    calendarId: Type.Optional(
      Type.String({
        description: "Calendar ID (default: 'primary' for main calendar)",
      }),
    ),
    timeMin: Type.Optional(
      Type.String({
        description:
          "Start time in ISO 8601 format (default: now). Example: '2024-01-15T00:00:00Z'",
      }),
    ),
    timeMax: Type.Optional(
      Type.String({
        description:
          "End time in ISO 8601 format. Example: '2024-01-22T23:59:59Z'",
      }),
    ),
    maxResults: Type.Optional(
      Type.Number({
        description: "Maximum events to return (1-250, default: 10)",
      }),
    ),
    query: Type.Optional(
      Type.String({
        description: "Free text search query to filter events",
      }),
    ),
    account: Type.Optional(
      Type.String({
        description: "Email account to use (defaults to first configured)",
      }),
    ),
  }),
  Type.Object({
    action: Type.Literal("get"),
    eventId: Type.String({ description: "Calendar event ID" }),
    calendarId: Type.Optional(Type.String()),
    account: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("calendars"),
    account: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("freebusy"),
    calendarIds: Type.Array(Type.String(), {
      description: "Array of calendar IDs to check",
    }),
    timeMin: Type.String({
      description: "Start time in ISO 8601 format",
    }),
    timeMax: Type.String({
      description: "End time in ISO 8601 format",
    }),
    account: Type.Optional(Type.String()),
  }),
]);

export type CreateCalendarToolOptions = {
  config?: ClawdbotConfig;
  agentDir?: string;
};

export function createGoogleCalendarTool(
  options?: CreateCalendarToolOptions,
): AnyAgentTool | undefined {
  return {
    label: "Calendar",
    name: "calendar",
    description: `Read-only access to Google Calendar. List events, get event details, check availability.

Examples:
- List upcoming events: calendar { action: "list" }
- List events for next week: calendar { action: "list", timeMax: "2024-01-22T00:00:00Z" }
- Get specific event: calendar { action: "get", eventId: "abc123" }
- List all calendars: calendar { action: "calendars" }
- Check free/busy: calendar { action: "freebusy", calendarIds: ["primary"], timeMin: "...", timeMax: "..." }

Requires: clawdbot google login`,
    parameters: GoogleCalendarToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const account = readStringParam(params, "account");

      // Resolve access token from auth profiles
      const accessToken = await resolveGoogleAccessToken({
        account,
        agentDir: options?.agentDir,
        cfg: options?.config,
      });

      const calendar = createCalendarClient(accessToken);

      switch (action) {
        case "list": {
          const calendarId = readStringParam(params, "calendarId") ?? "primary";
          const timeMin = readStringParam(params, "timeMin");
          const timeMax = readStringParam(params, "timeMax");
          const query = readStringParam(params, "query");
          const maxResultsRaw =
            typeof params.maxResults === "number" ? params.maxResults : 10;
          const maxResults = Math.min(Math.max(maxResultsRaw, 1), 250);

          const events = await calendar.listEvents({
            calendarId,
            timeMin,
            timeMax,
            maxResults,
            query,
          });

          return jsonResult({
            ok: true,
            action: "list",
            calendarId,
            count: events.length,
            events,
          });
        }

        case "get": {
          const eventId = readStringParam(params, "eventId", {
            required: true,
          });
          const calendarId = readStringParam(params, "calendarId") ?? "primary";

          const event = await calendar.getEvent(eventId, calendarId);
          return jsonResult({
            ok: true,
            action: "get",
            event,
          });
        }

        case "calendars": {
          const calendars = await calendar.listCalendars();
          return jsonResult({
            ok: true,
            action: "calendars",
            count: calendars.length,
            calendars,
          });
        }

        case "freebusy": {
          const calendarIds = params.calendarIds as string[];
          if (
            !Array.isArray(calendarIds) ||
            calendarIds.length === 0 ||
            !calendarIds.every((id) => typeof id === "string")
          ) {
            throw new Error("calendarIds must be a non-empty array of strings");
          }
          const timeMin = readStringParam(params, "timeMin", {
            required: true,
          });
          const timeMax = readStringParam(params, "timeMax", {
            required: true,
          });

          const freeBusy = await calendar.getFreeBusy({
            calendarIds,
            timeMin,
            timeMax,
          });

          return jsonResult({
            ok: true,
            action: "freebusy",
            timeMin,
            timeMax,
            freeBusy,
          });
        }

        default:
          throw new Error(`Unknown calendar action: ${action}`);
      }
    },
  };
}

/**
 * Resolve Google Workspace access token from auth profiles.
 */
async function resolveGoogleAccessToken(params: {
  account?: string;
  agentDir?: string;
  cfg?: ClawdbotConfig;
}): Promise<string> {
  const store = ensureAuthProfileStore(params.agentDir);
  const profiles = listProfilesForProvider(store, PROVIDER_NAME);

  if (profiles.length === 0) {
    throw new Error(
      "No Google Workspace account configured. Run: clawdbot google login",
    );
  }

  // Find matching profile
  let profileId: string;
  const accountFilter = params.account;
  if (accountFilter) {
    const match = profiles.find((p) => p.includes(accountFilter));
    if (!match) {
      throw new Error(
        `Google account not found: ${params.account}. Available: ${profiles.join(", ")}`,
      );
    }
    profileId = match;
  } else {
    profileId = profiles[0];
  }

  const resolved = await resolveApiKeyForProfile({
    cfg: params.cfg,
    store,
    profileId,
    agentDir: params.agentDir,
  });

  if (!resolved) {
    throw new Error(
      `Failed to resolve Google credentials for ${profileId}. Try: clawdbot google login`,
    );
  }

  return resolved.apiKey;
}
