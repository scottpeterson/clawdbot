/**
 * VPS-aware Google Workspace OAuth flow for Gmail and Calendar.
 *
 * On local machines: Uses localhost callback server.
 * On VPS/SSH/headless: Shows URL and prompts user to paste the callback URL manually.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import type { GoogleWorkspaceCredentials } from "./types.js";

// OAuth credentials from environment variables
// Users must create their own Google Cloud OAuth app and set these
const REDIRECT_PORT = 51122;

function getGoogleCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth credentials not configured.\n\n" +
        "To use Gmail/Calendar integration:\n" +
        "1. Go to https://console.cloud.google.com/\n" +
        "2. Create a project and enable Gmail API + Calendar API\n" +
        "3. Create OAuth 2.0 credentials (Desktop app type)\n" +
        "4. Set environment variables:\n" +
        "   export GOOGLE_CLIENT_ID='your-client-id'\n" +
        "   export GOOGLE_CLIENT_SECRET='your-client-secret'\n",
    );
  }

  return { clientId, clientSecret };
}
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth-callback`;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Read-only scopes for Gmail and Calendar
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

/**
 * Detect if running in WSL (Windows Subsystem for Linux).
 */
function isWSL(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const release = readFileSync("/proc/version", "utf8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

/**
 * Detect if running in WSL2 specifically.
 */
function isWSL2(): boolean {
  if (!isWSL()) return false;
  try {
    const version = readFileSync("/proc/version", "utf8").toLowerCase();
    return version.includes("wsl2") || version.includes("microsoft-standard");
  } catch {
    return false;
  }
}

/**
 * Detect if running in a remote/headless environment where localhost callback won't work.
 */
export function isRemoteEnvironment(): boolean {
  if (
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY ||
    process.env.SSH_CONNECTION
  ) {
    return true;
  }
  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES) {
    return true;
  }
  if (
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY &&
    !isWSL()
  ) {
    return true;
  }
  return false;
}

/**
 * Whether to skip the local OAuth callback server.
 */
export function shouldUseManualOAuthFlow(): boolean {
  return isWSL2() || isRemoteEnvironment();
}

/**
 * Generate PKCE verifier and challenge.
 */
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * Build the Google OAuth authorization URL.
 */
function buildAuthUrl(challenge: string, state: string): string {
  const { clientId } = getGoogleCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Parse the OAuth callback URL or code input.
 */
function parseCallbackInput(
  input: string,
  expectedState: string,
): { code: string; state: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "No input provided" };
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? expectedState;

    if (!code) {
      return { error: "Missing 'code' parameter in URL" };
    }
    if (!state) {
      return { error: "Missing 'state' parameter. Paste the full URL." };
    }

    return { code, state };
  } catch {
    if (!expectedState) {
      return { error: "Paste the full redirect URL, not just the code." };
    }
    return { code: trimmed, state: expectedState };
  }
}

/**
 * Exchange authorization code for tokens.
 */
async function exchangeCodeForTokens(
  code: string,
  verifier: string,
): Promise<GoogleWorkspaceCredentials> {
  const { clientId, clientSecret } = getGoogleCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!data.refresh_token) {
    throw new Error(
      "No refresh token received. You may need to revoke access at https://myaccount.google.com/permissions and try again.",
    );
  }

  const email = await getUserEmail(data.access_token);
  const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

  return {
    refresh: data.refresh_token,
    access: data.access_token,
    expires: expiresAt,
    email,
  };
}

/**
 * Get user email from access token.
 */
async function getUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    if (response.ok) {
      const data = (await response.json()) as { email?: string };
      return data.email;
    }
  } catch {
    // Ignore errors, email is optional
  }
  return undefined;
}

/**
 * Refresh an expired access token.
 */
export async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ access: string; expires: number }> {
  const { clientId, clientSecret } = getGoogleCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

  return {
    access: data.access_token,
    expires: expiresAt,
  };
}

/**
 * Prompt user for input via readline.
 */
async function promptInput(message: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Start a local HTTP server to receive the OAuth callback.
 */
function startCallbackServer(
  expectedState: string,
): Promise<{ code: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== "/oauth-callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400);
        res.end(`OAuth error: ${error}`);
        reject(new Error(`OAuth error: ${error}`));
        server.close();
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end("Missing authorization code");
        reject(new Error("Missing authorization code"));
        server.close();
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400);
        res.end("State mismatch");
        reject(new Error("OAuth state mismatch"));
        server.close();
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html>
          <body style="font-family: system-ui; text-align: center; padding: 50px;">
            <h1>Success!</h1>
            <p>Google Workspace connected. You can close this window.</p>
          </body>
        </html>
      `);

      resolve({ code, close: () => server.close() });
    });

    server.on("error", (err) => {
      reject(err);
    });

    server.listen(REDIRECT_PORT);
  });
}

/**
 * VPS-aware Google Workspace OAuth login.
 */
export async function loginGoogleWorkspace(
  onUrl: (url: string) => void | Promise<void>,
  onProgress?: (message: string) => void,
): Promise<GoogleWorkspaceCredentials | null> {
  if (shouldUseManualOAuthFlow()) {
    return loginGoogleWorkspaceManual(onUrl, onProgress);
  }

  try {
    return await loginGoogleWorkspaceLocal(onUrl, onProgress);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes("EADDRINUSE") ||
        err.message.includes("port") ||
        err.message.includes("listen"))
    ) {
      onProgress?.("Local callback server failed. Switching to manual mode...");
      return loginGoogleWorkspaceManual(onUrl, onProgress);
    }
    throw err;
  }
}

/**
 * Local Google Workspace OAuth login with automatic callback server.
 */
async function loginGoogleWorkspaceLocal(
  onUrl: (url: string) => void | Promise<void>,
  onProgress?: (message: string) => void,
): Promise<GoogleWorkspaceCredentials> {
  const { verifier, challenge } = generatePKCE();
  const state = randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl(challenge, state);

  const serverPromise = startCallbackServer(state);

  await onUrl(authUrl);
  onProgress?.("Waiting for authorization in browser...");

  const { code, close } = await serverPromise;
  close();

  onProgress?.("Exchanging authorization code for tokens...");
  return exchangeCodeForTokens(code, verifier);
}

/**
 * Manual Google Workspace OAuth login for VPS/headless environments.
 */
async function loginGoogleWorkspaceManual(
  onUrl: (url: string) => void | Promise<void>,
  onProgress?: (message: string) => void,
): Promise<GoogleWorkspaceCredentials | null> {
  const { verifier, challenge } = generatePKCE();
  const state = randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl(challenge, state);

  await onUrl(authUrl);

  onProgress?.("Waiting for you to paste the callback URL...");

  console.log("\n");
  console.log("=".repeat(60));
  console.log("VPS/Remote Mode - Manual OAuth");
  console.log("=".repeat(60));
  console.log("\n1. Open the URL above in your LOCAL browser");
  console.log("2. Complete the Google sign-in");
  console.log(
    "3. Your browser will redirect to a localhost URL that won't load",
  );
  console.log("4. Copy the ENTIRE URL from your browser's address bar");
  console.log("5. Paste it below\n");
  console.log("The URL will look like:");
  console.log(
    `http://localhost:${REDIRECT_PORT}/oauth-callback?code=xxx&state=yyy\n`,
  );

  const callbackInput = await promptInput("Paste the redirect URL here: ");

  const parsed = parseCallbackInput(callbackInput, state);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }

  if (parsed.state !== state) {
    throw new Error("OAuth state mismatch - please try again");
  }

  onProgress?.("Exchanging authorization code for tokens...");

  return exchangeCodeForTokens(parsed.code, verifier);
}
