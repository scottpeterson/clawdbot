/**
 * Gmail API client wrapper for read-only access.
 */

import { type gmail_v1, google } from "googleapis";

import type {
  GmailLabel,
  GmailMessageFull,
  GmailMessageSummary,
} from "./types.js";

export type GmailClient = ReturnType<typeof createGmailClient>;

/**
 * Create a Gmail API client with the given access token.
 */
export function createGmailClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  return {
    /**
     * Search messages using Gmail query syntax.
     * @see https://support.google.com/mail/answer/7190
     */
    async searchMessages(
      query: string,
      maxResults = 10,
      includeBody = false,
    ): Promise<GmailMessageSummary[] | GmailMessageFull[]> {
      const response = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults,
      });

      const messages = response.data.messages ?? [];
      if (messages.length === 0) return [];

      const results = await Promise.all(
        messages
          .filter((m) => m.id)
          .map((m) =>
            this.getMessage(m.id as string, includeBody ? "full" : "metadata"),
          ),
      );

      return results;
    },

    /**
     * Get a specific message by ID.
     */
    async getMessage(
      messageId: string,
      format: "full" | "metadata" | "minimal" = "full",
    ): Promise<GmailMessageFull> {
      const response = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format,
      });

      return parseGmailMessage(response.data, format === "full");
    },

    /**
     * List all labels in the mailbox.
     */
    async listLabels(): Promise<GmailLabel[]> {
      const response = await gmail.users.labels.list({ userId: "me" });
      const labels = response.data.labels ?? [];

      return labels
        .filter((label) => label.id && label.name)
        .map((label) => ({
          id: label.id as string,
          name: label.name as string,
          type: label.type === "system" ? "system" : "user",
          messagesTotal: label.messagesTotal ?? undefined,
          messagesUnread: label.messagesUnread ?? undefined,
        }));
    },

    /**
     * Get thread with all messages.
     */
    async getThread(
      threadId: string,
      includeBody = false,
    ): Promise<GmailMessageFull[]> {
      const response = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: includeBody ? "full" : "metadata",
      });

      const messages = response.data.messages ?? [];
      return messages.map((m) => parseGmailMessage(m, includeBody));
    },
  };
}

/**
 * Parse Gmail API message response into our types.
 */
function parseGmailMessage(
  message: gmail_v1.Schema$Message,
  includeBody: boolean,
): GmailMessageFull {
  const headers = message.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ??
    "";

  const from = getHeader("from");
  const to = parseAddressList(getHeader("to"));
  const cc = parseAddressList(getHeader("cc"));
  const subject = getHeader("subject");
  const date = getHeader("date");

  // Parse body
  let textBody: string | undefined;
  let htmlBody: string | undefined;

  if (includeBody && message.payload) {
    const { text, html } = extractBodyContent(message.payload);
    textBody = text;
    htmlBody = html;
  }

  // Check for attachments
  const attachments = extractAttachments(message.payload);

  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    date: parseEmailDate(date),
    snippet: message.snippet ?? "",
    labels: message.labelIds ?? [],
    hasAttachments: attachments.length > 0,
    body: {
      text: textBody,
      html: htmlBody,
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

/**
 * Parse email address list (e.g., "John <john@example.com>, Jane <jane@example.com>").
 */
function parseAddressList(value: string): string[] {
  if (!value.trim()) return [];
  // Split by comma, but be careful of commas inside quotes
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Convert email date string to ISO 8601.
 */
function parseEmailDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toISOString();
  } catch {
    return dateStr;
  }
}

/**
 * Extract body content from message payload.
 */
function extractBodyContent(payload: gmail_v1.Schema$MessagePart): {
  text?: string;
  html?: string;
} {
  let text: string | undefined;
  let html: string | undefined;

  function processPayload(part: gmail_v1.Schema$MessagePart) {
    const mimeType = part.mimeType ?? "";

    if (mimeType === "text/plain" && part.body?.data) {
      text = decodeBase64(part.body.data);
    } else if (mimeType === "text/html" && part.body?.data) {
      html = decodeBase64(part.body.data);
    }

    // Recurse into parts
    if (part.parts) {
      for (const subPart of part.parts) {
        processPayload(subPart);
      }
    }
  }

  processPayload(payload);

  return { text, html };
}

/**
 * Extract attachment metadata from message payload.
 */
function extractAttachments(
  payload?: gmail_v1.Schema$MessagePart,
): Array<{ filename: string; mimeType: string; size: number }> {
  const attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
  }> = [];

  function processPayload(part: gmail_v1.Schema$MessagePart) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
      });
    }

    if (part.parts) {
      for (const subPart of part.parts) {
        processPayload(subPart);
      }
    }
  }

  if (payload) {
    processPayload(payload);
  }

  return attachments;
}

/**
 * Decode base64url-encoded string.
 */
function decodeBase64(data: string): string {
  // Gmail uses URL-safe base64 encoding
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}
