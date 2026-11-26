import { createId } from "@groundwork/shared";
import { betterAuth } from "better-auth";
import { magicLink, organization } from "better-auth/plugins";
import { adminAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import type pg from "pg";

import {
  LOCAL_BETTER_AUTH_URL,
  readBetterAuthSecret,
  readBetterAuthUrl,
  readGoogleOAuth,
  readWebOrigin,
} from "../config.js";
import type { Mailer } from "./mail.js";

const LOCAL_ORIGINS = [
  LOCAL_BETTER_AUTH_URL,
  "http://localhost:5173",
  "http://127.0.0.1:3001",
  "http://localhost:3001",
];

/**
 * Better Auth's organization is a Groundwork workspace (ADR 0002, ADR 0007).
 * Column names are snake_case. Ids are UUIDv7 strings. The pool must be
 * groundwork_auth: its policies allow identity lookups, and groundwork_app's
 * do not.
 *
 * Session cookie cache stays off so disabling a member is visible on the next
 * request, inside the 60 second acceptance window.
 */
export function createAuth(pool: pg.Pool, mailer: Mailer) {
  const baseURL = readBetterAuthUrl();
  const webOrigin = readWebOrigin();
  const google = readGoogleOAuth();
  const trusted = new Set<string>([baseURL, webOrigin]);
  if (process.env.NODE_ENV !== "production") {
    for (const origin of LOCAL_ORIGINS) {
      trusted.add(origin);
    }
  }

  return betterAuth({
    baseURL,
    basePath: "/auth",
    secret: readBetterAuthSecret(),
    trustedOrigins: [...trusted],
    database: pool,
    advanced: {
      database: {
        generateId: () => createId(),
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: false,
    },
    socialProviders: google
      ? {
          google: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
          },
        }
      : undefined,
    user: {
      modelName: "app_user",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        phone: {
          type: "string",
          required: false,
          input: true,
        },
      },
    },
    session: {
      modelName: "session",
      cookieCache: {
        enabled: false,
      },
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
    },
    account: {
      modelName: "account",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "verification",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await mailer.send({
            to: email,
            subject: "Your Groundwork sign-in link",
            text: `Open this link to sign in to Groundwork:\n${url}\n`,
          });
        },
      }),
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        invitationExpiresIn: 60 * 60 * 24 * 7,
        disableOrganizationDeletion: true,
        requireEmailVerificationOnInvitation: false,
        roles: {
          owner: ownerAc,
          admin: adminAc,
          member: memberAc,
          estimator: memberAc,
          office: memberAc,
          foreman: memberAc,
          crew: memberAc,
        },
        sendInvitationEmail: async (data) => {
          const url = `${webOrigin}/invites/${data.id}`;
          await mailer.send({
            to: data.email,
            subject: `Invite to ${data.organization.name}`,
            text: `You are invited to ${data.organization.name}. Open this link to accept:\n${url}\nThe invite expires in 7 days.\n`,
          });
        },
        schema: {
          organization: {
            modelName: "workspace",
            fields: {
              createdAt: "created_at",
            },
          },
          member: {
            modelName: "member",
            fields: {
              organizationId: "workspace_id",
              userId: "user_id",
              createdAt: "created_at",
            },
          },
          invitation: {
            modelName: "invitation",
            fields: {
              organizationId: "workspace_id",
              expiresAt: "expires_at",
              createdAt: "created_at",
              inviterId: "inviter_id",
            },
          },
          session: {
            fields: {
              activeOrganizationId: "active_organization_id",
            },
          },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
