/**
 * CLI commands for Google Workspace integration (Gmail, Calendar).
 */

import type { Command } from "commander";

import {
  type AuthProfileCredential,
  ensureAuthProfileStore,
  listProfilesForProvider,
  saveAuthProfileStore,
  upsertAuthProfile,
} from "../agents/auth-profiles.js";
import { openUrl } from "../commands/onboard-helpers.js";
import { danger, info, success } from "../globals.js";
import { loginGoogleWorkspace } from "../google/auth.js";
import { defaultRuntime } from "../runtime.js";

const PROVIDER_NAME = "google-workspace";

export function registerGoogleCli(program: Command) {
  const google = program
    .command("google")
    .description("Google Workspace integration (Gmail, Calendar read-only)");

  google
    .command("login")
    .description("Authenticate with Google (Gmail + Calendar read-only access)")
    .option("--verbose", "Verbose logging", false)
    .option("--no-open", "Don't automatically open the browser")
    .action(async (opts) => {
      try {
        defaultRuntime.log(info("Starting Google Workspace OAuth flow..."));
        defaultRuntime.log(info("Scopes: gmail.readonly, calendar.readonly"));

        const creds = await loginGoogleWorkspace(
          async (url) => {
            defaultRuntime.log(info(`\nAuthorization URL:\n${url}\n`));
            if (opts.open !== false) {
              const opened = await openUrl(url);
              if (opened) {
                defaultRuntime.log(info("Opened browser for authorization..."));
              } else {
                defaultRuntime.log(
                  info("Could not open browser. Please open the URL manually."),
                );
              }
            }
          },
          (msg) => {
            if (opts.verbose) {
              defaultRuntime.log(info(msg));
            }
          },
        );

        if (!creds) {
          defaultRuntime.error(danger("OAuth flow was cancelled or failed."));
          defaultRuntime.exit(1);
          return;
        }

        const profileId = `${PROVIDER_NAME}:${creds.email ?? "default"}`;
        // Cast through unknown because google-workspace is not in pi-ai's OAuthProvider type
        const credential = {
          type: "oauth" as const,
          provider: PROVIDER_NAME,
          access: creds.access,
          refresh: creds.refresh,
          expires: creds.expires,
          email: creds.email,
        } as unknown as AuthProfileCredential;
        upsertAuthProfile({ profileId, credential });

        defaultRuntime.log(
          success(
            `\nGoogle Workspace connected as ${creds.email ?? "unknown"}`,
          ),
        );
        defaultRuntime.log(info(`Profile ID: ${profileId}`));
        defaultRuntime.log(
          info("\nThe agent can now use gmail and calendar tools."),
        );
      } catch (err) {
        defaultRuntime.error(danger(`Google login failed: ${String(err)}`));
        defaultRuntime.exit(1);
      }
    });

  google
    .command("logout")
    .description("Remove Google Workspace credentials")
    .option("--account <email>", "Specific account to remove (default: all)")
    .action(async (opts) => {
      try {
        const store = ensureAuthProfileStore();
        const profiles = listProfilesForProvider(store, PROVIDER_NAME);

        if (profiles.length === 0) {
          defaultRuntime.log(info("No Google Workspace accounts configured."));
          return;
        }

        const targetEmail = opts.account as string | undefined;
        let removed = 0;

        for (const profileId of profiles) {
          if (targetEmail) {
            const cred = store.profiles[profileId];
            if (cred?.type === "oauth" && cred.email !== targetEmail) {
              continue;
            }
          }
          delete store.profiles[profileId];
          removed++;
          defaultRuntime.log(success(`Removed: ${profileId}`));
        }

        if (removed > 0) {
          saveAuthProfileStore(store);
          defaultRuntime.log(
            success(`\nRemoved ${removed} Google Workspace account(s).`),
          );
        } else if (targetEmail) {
          defaultRuntime.log(info(`No account found matching: ${targetEmail}`));
        }
      } catch (err) {
        defaultRuntime.error(danger(`Google logout failed: ${String(err)}`));
        defaultRuntime.exit(1);
      }
    });

  google
    .command("status")
    .description("Show Google Workspace authentication status")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      try {
        const store = ensureAuthProfileStore();
        const profiles = listProfilesForProvider(store, PROVIDER_NAME);

        if (opts.json) {
          const accounts = profiles
            .map((id) => {
              const cred = store.profiles[id];
              if (cred?.type !== "oauth") return null;
              return {
                profileId: id,
                email: cred.email,
                expires: new Date(cred.expires).toISOString(),
                expired: Date.now() > cred.expires,
              };
            })
            .filter(Boolean);
          console.log(JSON.stringify({ accounts }, null, 2));
          return;
        }

        if (profiles.length === 0) {
          defaultRuntime.log(info("No Google Workspace accounts configured."));
          defaultRuntime.log(info("Run: clawdbot google login"));
          return;
        }

        defaultRuntime.log(info("Google Workspace accounts:\n"));
        for (const profileId of profiles) {
          const cred = store.profiles[profileId];
          if (cred?.type !== "oauth") continue;

          const expired = Date.now() > cred.expires;
          const expiresAt = new Date(cred.expires).toLocaleString();
          const status = expired ? danger("EXPIRED") : success("active");

          defaultRuntime.log(`  ${cred.email ?? "unknown"} [${status}]`);
          defaultRuntime.log(info(`    Profile: ${profileId}`));
          defaultRuntime.log(
            info(
              `    Expires: ${expiresAt}${expired ? " (needs refresh)" : ""}`,
            ),
          );
          defaultRuntime.log("");
        }
      } catch (err) {
        defaultRuntime.error(danger(`Status check failed: ${String(err)}`));
        defaultRuntime.exit(1);
      }
    });
}
