/**
 * Gmail read-only tool for the agent.
 */

import { Type } from "@sinclair/typebox";

import type { ClawdbotConfig } from "../../config/config.js";
import { createGmailClient } from "../../google/gmail-client.js";
import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  resolveApiKeyForProfile,
} from "../auth-profiles.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const PROVIDER_NAME = "google-workspace";

const GoogleGmailToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("search"),
    query: Type.String({
      description:
        "Gmail search query (same as Gmail web UI). Examples: 'is:unread', 'from:boss@company.com', 'subject:important after:2024/01/01'",
    }),
    maxResults: Type.Optional(
      Type.Number({
        description: "Maximum number of messages to return (1-50, default: 10)",
      }),
    ),
    includeBody: Type.Optional(
      Type.Boolean({
        description:
          "Include full message body (default: false, only returns snippet)",
      }),
    ),
    account: Type.Optional(
      Type.String({
        description: "Email account to use (defaults to first configured)",
      }),
    ),
  }),
  Type.Object({
    action: Type.Literal("read"),
    messageId: Type.String({ description: "Gmail message ID to read" }),
    account: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("thread"),
    threadId: Type.String({ description: "Gmail thread ID to read" }),
    includeBody: Type.Optional(Type.Boolean()),
    account: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("labels"),
    account: Type.Optional(Type.String()),
  }),
]);

export type CreateGmailToolOptions = {
  config?: ClawdbotConfig;
  agentDir?: string;
};

export function createGoogleGmailTool(
  options?: CreateGmailToolOptions,
): AnyAgentTool | undefined {
  return {
    label: "Gmail",
    name: "gmail",
    description: `Read-only access to Gmail. Search emails, read specific messages, list labels.

Examples:
- Search unread: gmail { action: "search", query: "is:unread" }
- Search from person: gmail { action: "search", query: "from:boss@company.com" }
- Read specific message: gmail { action: "read", messageId: "18abc123" }
- List labels: gmail { action: "labels" }

Requires: clawdbot google login`,
    parameters: GoogleGmailToolSchema,
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

      const gmail = createGmailClient(accessToken);

      switch (action) {
        case "search": {
          const query = readStringParam(params, "query", { required: true });
          const maxResultsRaw =
            typeof params.maxResults === "number" ? params.maxResults : 10;
          const maxResults = Math.min(Math.max(maxResultsRaw, 1), 50);
          const includeBody = params.includeBody === true;

          const messages = await gmail.searchMessages(
            query,
            maxResults,
            includeBody,
          );
          return jsonResult({
            ok: true,
            action: "search",
            query,
            count: messages.length,
            messages,
          });
        }

        case "read": {
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          const message = await gmail.getMessage(messageId, "full");
          return jsonResult({
            ok: true,
            action: "read",
            message,
          });
        }

        case "thread": {
          const threadId = readStringParam(params, "threadId", {
            required: true,
          });
          const includeBody = params.includeBody === true;
          const messages = await gmail.getThread(threadId, includeBody);
          return jsonResult({
            ok: true,
            action: "thread",
            threadId,
            messageCount: messages.length,
            messages,
          });
        }

        case "labels": {
          const labels = await gmail.listLabels();
          return jsonResult({
            ok: true,
            action: "labels",
            count: labels.length,
            labels,
          });
        }

        default:
          throw new Error(`Unknown gmail action: ${action}`);
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
