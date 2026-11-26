import {
  CATALOG_VISIBILITY_SAMPLE,
  IllegalMemberTransitionError,
  InviteExpiredError,
  LastOwnerError,
  SYSTEM_ROLE_NAMES,
  applyCostVisibility,
  assertInviteCurrent,
  assertKeepsAnOwner,
  createId,
  hasPermission,
  inviteExpiresAt,
  isSystemRoleName,
  isUuidV7,
  transitionMember,
  unitsPreferenceSchema,
  type MemberStatus,
  type SystemRoleName,
} from "@groundwork/shared";
import type { FastifyBaseLogger, FastifyInstance, RawServerDefault } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Kysely, Selectable, Transaction } from "kysely";
import type { IncomingMessage, ServerResponse } from "node:http";
import type pg from "pg";
import { z } from "zod/v4";

import type { Auth } from "../auth/auth.js";
import { requireActiveMember, requireSession, type MemberRow } from "../auth/guard.js";
import type { Mailer } from "../auth/mail.js";
import { readWebOrigin } from "../config.js";
import type { Database } from "../db/types.js";
import { withDbContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";

type AppDb = Kysely<Database>;
type ApiApp = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;
type WorkspaceRow = Selectable<Database["workspace"]>;

export type GroundworkContext = {
  db: AppDb;
  authPool: pg.Pool;
  auth: Auth;
  mailer: Mailer;
};

const TIME_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postal_code: z.string().max(32).optional(),
  country: z.string().max(120).optional(),
});

const workspaceBody = {
  name: z.string().trim().min(1).max(200),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
  units_pref: unitsPreferenceSchema.optional(),
  logo: z.string().trim().max(2000).nullable().optional(),
  license_number: z.string().trim().max(80).nullable().optional(),
  address: addressSchema.nullable().optional(),
  features: z.record(z.string(), z.boolean()).optional(),
};

const workspaceResponse = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable(),
  timezone: z.string(),
  currency: z.string(),
  units_pref: z.string(),
  features: z.record(z.string(), z.unknown()),
  plan: z.string().nullable(),
  address: addressSchema.nullable(),
  license_number: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const memberResponse = z.object({
  id: z.string(),
  workspace_id: z.string(),
  user_id: z.string().nullable(),
  role_id: z.string(),
  role: z.string(),
  status: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
});

function notFound(detail: string): ProblemError {
  return new ProblemError({ status: 404, title: "Not Found", detail });
}

function forbidden(): ProblemError {
  return new ProblemError({
    status: 403,
    title: "Forbidden",
    detail: "You do not have permission to do that.",
  });
}

function guardMember<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (
      error instanceof IllegalMemberTransitionError ||
      error instanceof InviteExpiredError ||
      error instanceof LastOwnerError
    ) {
      throw new ProblemError({ status: 409, title: "Conflict", detail: error.message });
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && (current as { code?: unknown }).code === "23505") {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function slugBase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "workspace";
}

function parseWorkspaceId(value: string): string {
  if (!isUuidV7(value)) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "Workspace id must be a UUIDv7.",
    });
  }
  return value;
}

function timezoneOrDefault(value: string | undefined): string {
  const timezone = value ?? "America/New_York";
  if (!TIME_ZONES.has(timezone)) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "Timezone must be an IANA name.",
    });
  }
  return timezone;
}

function iso(value: Date): string {
  return value.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asAddress(value: unknown): z.infer<typeof addressSchema> | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = addressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function permissionsOf(db: AppDb, roleId: string): Promise<string[]> {
  const role = await db
    .selectFrom("role")
    .select("permissions")
    .where("id", "=", roleId)
    .executeTakeFirst();
  return role?.permissions ?? [];
}

async function requirePermission(
  db: AppDb,
  member: MemberRow,
  permission: "workspace.manage" | "members.manage" | "catalog.manage",
): Promise<string[]> {
  const permissions = await permissionsOf(db, member.role_id);
  if (!hasPermission(permissions, permission)) {
    throw forbidden();
  }
  return permissions;
}

async function writeAudit(
  trx: Transaction<Database>,
  input: {
    workspaceId: string;
    actorId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    diff: Record<string, unknown>;
  },
): Promise<void> {
  await trx
    .insertInto("audit_log")
    .values({
      workspace_id: input.workspaceId,
      actor_member_id: input.actorId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      diff: input.diff,
    })
    .execute();
}

function presentWorkspace(row: WorkspaceRow): z.infer<typeof workspaceResponse> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    timezone: row.timezone,
    currency: row.currency.trim(),
    units_pref: row.units_pref,
    features: asRecord(row.features),
    plan: row.plan,
    address: asAddress(row.address),
    license_number: row.license_number,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function registerGroundworkRoutes(app: ApiApp, ctx: GroundworkContext): Promise<void> {
  const webOrigin = readWebOrigin();

  app.get(
    "/me",
    {
      schema: {
        response: {
          200: z.object({
            user: z.object({
              id: z.string(),
              email: z.string(),
              name: z.string(),
              phone: z.string().nullable(),
              email_verified: z.boolean(),
            }),
            active_workspace_id: z.string().nullable(),
            memberships: z.array(
              z.object({
                id: z.string(),
                workspace_id: z.string(),
                role_id: z.string(),
                role: z.string(),
                status: z.string(),
                permissions: z.array(z.string()),
                workspace: z.object({
                  id: z.string(),
                  name: z.string(),
                  slug: z.string(),
                }),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const session = await requireSession(ctx.auth, request.headers);
      const user = await withDbContext(ctx.db, { userId: session.id }, async (trx) => {
        return trx
          .selectFrom("app_user")
          .selectAll()
          .where("id", "=", session.id)
          .executeTakeFirst();
      });
      if (!user) {
        throw new ProblemError({
          status: 401,
          title: "Unauthorized",
          detail: "Sign in to continue.",
        });
      }
      const members = await withDbContext(ctx.db, { userId: session.id }, async (trx) => {
        return trx.selectFrom("member").selectAll().where("user_id", "=", session.id).execute();
      });
      const visible = members.filter((member) => member.status !== "revoked");
      const workspaces = await withDbContext(ctx.db, { userId: session.id }, async (trx) => {
        return trx.selectFrom("workspace").select(["id", "name", "slug"]).execute();
      });
      const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
      const memberships = [];
      for (const member of visible) {
        const workspace = workspaceById.get(member.workspace_id);
        if (!workspace) {
          continue;
        }
        memberships.push({
          id: member.id,
          workspace_id: member.workspace_id,
          role_id: member.role_id,
          role: member.role,
          status: member.status,
          permissions: await permissionsOf(ctx.db, member.role_id),
          workspace,
        });
      }
      const active = memberships.find(
        (member) => member.status === "active" && member.workspace_id === session.activeWorkspaceId,
      );
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          email_verified: user.email_verified,
        },
        active_workspace_id: active?.workspace_id ?? null,
        memberships,
      };
    },
  );

  app.get(
    "/roles",
    {
      schema: {
        response: {
          200: z.object({
            roles: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                permissions: z.array(z.string()),
                is_system: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      await requireSession(ctx.auth, request.headers);
      const roles = await ctx.db
        .selectFrom("role")
        .select(["id", "name", "permissions", "is_system"])
        .where("is_system", "=", true)
        .execute();
      const order = new Map(SYSTEM_ROLE_NAMES.map((name, index) => [name, index]));
      roles.sort(
        (a, b) =>
          (order.get(a.name as SystemRoleName) ?? 99) - (order.get(b.name as SystemRoleName) ?? 99),
      );
      return { roles };
    },
  );

  app.get(
    "/catalog-items",
    {
      schema: {
        tags: ["tenant-header"],
        description:
          "Requires the x-workspace-id header. Unit cost is omitted without catalog.manage.",
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                unit: z.string(),
                unit_price_cents: z.number().int(),
                unit_cost_cents: z.number().int().optional(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const session = await requireSession(ctx.auth, request.headers);
      const header = request.headers["x-workspace-id"];
      if (typeof header !== "string") {
        throw new ProblemError({
          status: 400,
          title: "Bad Request",
          detail: "x-workspace-id must be a UUIDv7.",
        });
      }
      const workspaceId = parseWorkspaceId(header);
      const member = await requireActiveMember(ctx, session.id, workspaceId);
      const permissions = await permissionsOf(ctx.db, member.role_id);
      return {
        items: [applyCostVisibility({ ...CATALOG_VISIBILITY_SAMPLE }, permissions)],
      };
    },
  );

  app.post(
    "/workspaces",
    {
      schema: {
        body: z.object({
          name: workspaceBody.name,
          timezone: workspaceBody.timezone,
          currency: workspaceBody.currency,
          units_pref: workspaceBody.units_pref,
        }),
        response: { 201: workspaceResponse },
      },
    },
    async (request, reply) => {
      const session = await requireSession(ctx.auth, request.headers);
      const name = request.body.name;
      const timezone = timezoneOrDefault(request.body.timezone);
      const currency = (request.body.currency ?? "USD").toUpperCase();
      const units = request.body.units_pref ?? "imperial";
      const base = slugBase(name);
      let created: WorkspaceRow | undefined;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const id = createId();
        // UUIDv7's first 8 hex digits are the timestamp and stay the same for
        // about a minute, so a colliding slug takes its random tail instead.
        const slug = attempt === 0 ? base : `${base}-${id.slice(-12)}`;
        try {
          created = await withDbContext(
            ctx.db,
            { workspaceId: id, userId: session.id },
            async (trx) => {
              const role = await trx
                .selectFrom("role")
                .selectAll()
                .where("name", "=", "owner")
                .where("is_system", "=", true)
                .executeTakeFirst();
              if (!role) {
                throw new Error("The owner system role is not seeded.");
              }
              await trx
                .insertInto("workspace")
                .values({
                  id,
                  name,
                  slug,
                  logo: null,
                  metadata: null,
                  timezone,
                  currency,
                  units_pref: units,
                  features: {},
                  plan: null,
                  address: null,
                  license_number: null,
                })
                .execute();
              const memberId = createId();
              await trx
                .insertInto("member")
                .values({
                  id: memberId,
                  workspace_id: id,
                  user_id: session.id,
                  role: "owner",
                  role_id: role.id,
                  status: "active",
                  invite_email: session.email,
                })
                .execute();
              await writeAudit(trx, {
                workspaceId: id,
                actorId: memberId,
                entityType: "workspace",
                entityId: id,
                action: "create",
                diff: { name, slug },
              });
              const row = await trx
                .selectFrom("workspace")
                .selectAll()
                .where("id", "=", id)
                .executeTakeFirst();
              if (!row) {
                throw new Error("The workspace insert did not return a row.");
              }
              return row;
            },
          );
          break;
        } catch (error) {
          if (isUniqueViolation(error) && attempt < 4) {
            continue;
          }
          throw error;
        }
      }
      if (!created) {
        throw new Error("Could not create a workspace.");
      }
      await ctx.authPool.query(
        "update session set active_organization_id = $1, updated_at = now() where id = $2",
        [created.id, session.sessionId],
      );
      return reply.status(201).send(presentWorkspace(created));
    },
  );

  app.post(
    "/workspaces/:id/activate",
    {
      schema: {
        tags: ["tenant-workspace"],
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ active_workspace_id: z.string() }) },
      },
    },
    async (request) => {
      const session = await requireSession(ctx.auth, request.headers);
      const workspaceId = parseWorkspaceId(request.params.id);
      await requireActiveMember(ctx, session.id, workspaceId);
      await ctx.authPool.query(
        "update session set active_organization_id = $1, updated_at = now() where id = $2",
        [workspaceId, session.sessionId],
      );
      return { active_workspace_id: workspaceId };
    },
  );

  app.get(
    "/workspaces/:id",
    {
      schema: {
        tags: ["tenant-workspace"],
        params: z.object({ id: z.string() }),
        response: { 200: workspaceResponse },
      },
    },
    async (request) => {
      const session = await requireSession(ctx.auth, request.headers);
      const workspaceId = parseWorkspaceId(request.params.id);
      await requireActiveMember(ctx, session.id, workspaceId);
      const row = await withDbContext(ctx.db, { workspaceId, userId: session.id }, async (trx) => {
        return trx
          .selectFrom("workspace")
          .selectAll()
          .where("id", "=", workspaceId)
          .executeTakeFirst();
      });
      if (!row) {
        throw notFound("That workspace was not found.");
      }
      return presentWorkspace(row);
    },
  );

  app.patch(
    "/workspaces/:id",
    {
      schema: {
        tags: ["tenant-workspace"],
        params: z.object({ id: z.string() }),
        body: z.object({
          name: workspaceBody.name.optional(),
          timezone: workspaceBody.timezone,
          currency: workspaceBody.currency,
          units_pref: workspaceBody.units_pref,
          logo: workspaceBody.logo,
          license_number: workspaceBody.license_number,
          address: workspaceBody.address,
          features: workspaceBody.features,
        }),
        response: { 200: workspaceResponse },
      },
    },
    async (request) => {
      const session = await requireSession(ctx.auth, request.headers);
      const workspaceId = parseWorkspaceId(request.params.id);
      const actor = await requireActiveMember(ctx, session.id, workspaceId);
      await requirePermission(ctx.db, actor, "workspace.manage");
      const patch = request.body;
      if (Object.values(patch).every((value) => value === undefined)) {
        throw new ProblemError({
          status: 400,
          title: "Bad Request",
          detail: "Provide a setting to change.",
        });
      }
      const row = await withDbContext(ctx.db, { workspaceId, userId: session.id }, async (trx) => {
        await trx
          .updateTable("workspace")
          .set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.timezone !== undefined
              ? { timezone: timezoneOrDefault(patch.timezone) }
              : {}),
            ...(patch.currency !== undefined ? { currency: patch.currency.toUpperCase() } : {}),
            ...(patch.units_pref !== undefined ? { units_pref: patch.units_pref } : {}),
            ...(patch.logo !== undefined ? { logo: patch.logo } : {}),
            ...(patch.license_number !== undefined ? { license_number: patch.license_number } : {}),
            ...(patch.address !== undefined ? { address: patch.address } : {}),
            ...(patch.features !== undefined ? { features: patch.features } : {}),
          })
          .where("id", "=", workspaceId)
          .execute();
        await writeAudit(trx, {
          workspaceId,
          actorId: actor.id,
          entityType: "workspace",
          entityId: workspaceId,
          action: "update",
          diff: patch,
        });
        const updated = await trx
          .selectFrom("workspace")
          .selectAll()
          .where("id", "=", workspaceId)
          .executeTakeFirst();
        if (!updated) {
          throw notFound("That workspace was not found.");
        }
        return updated;
      });
      return presentWorkspace(row);
    },
  );

  app.get(
    "/workspaces/:id/members",
    {
      schema: {
        tags: ["tenant-workspace"],
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ members: z.array(memberResponse) }) },
      },
    },
    async (request) => {
      const session = await requireSession(ctx.auth, request.headers);
      const workspaceId = parseWorkspaceId(request.params.id);
      await requireActiveMember(ctx, session.id, workspaceId);
      const members = await withDbContext(
        ctx.db,
        { workspaceId, userId: session.id },
        async (trx) => {
          return trx
            .selectFrom("member")
            .leftJoin("app_user", "app_user.id", "member.user_id")
            .select([
              "member.id as id",
              "member.workspace_id as workspace_id",
              "member.user_id as user_id",
              "member.role_id as role_id",
              "member.role as role",
              "member.status as status",
              "member.invite_email as invite_email",
              "app_user.email as user_email",
              "app_user.name as user_name",
            ])
            .where("member.workspace_id", "=", workspaceId)
            .where("member.status", "!=", "revoked")
            .orderBy("member.created_at", "asc")
            .execute();
        },
      );
      return {
        members: members.map((member) => ({
          id: member.id,
          workspace_id: member.workspace_id,
          user_id: member.user_id,
          role_id: member.role_id,
          role: member.role,
          status: member.status,
          email: member.user_email ?? member.invite_email,
          name: member.user_name,
        })),
      };
    },
  );

  app.post(
    "/workspaces/:id/invites",
    {
      schema: {
        tags: ["tenant-workspace"],
        params: z.object({ id: z.string() }),
        body: z.object({
          email: z.email().max(320),
          roleId: z.string(),
        }),
        response: {
          201: z.object({
            id: z.string(),
            email: z.string(),
            role_id: z.string(),
            role: z.string(),
            status: z.literal("invited"),
            expires_at: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const session = await requireSession(ctx.auth, request.headers);
      const workspaceId = parseWorkspaceId(request.params.id);
      const actor = await requireActiveMember(ctx, session.id, workspaceId);
      await requirePermission(ctx.db, actor, "members.manage");
      const email = request.body.email.trim().toLowerCase();
      const role = await ctx.db
        .selectFrom("role")
        .selectAll()
        .where("id", "=", request.body.roleId)
        .where("is_system", "=", true)
        .executeTakeFirst();
      if (!role || !isSystemRoleName(role.name)) {
        throw new ProblemError({
          status: 400,
          title: "Bad Request",
          detail: "Choose one of the system roles.",
        });
      }
      const existingUser = await ctx.authPool.query<{ id: string }>(
        "select id from app_user where email = $1",
        [email],
      );
      const userId = existingUser.rows[0]?.id ?? null;
      const workspace = await withDbContext(
        ctx.db,
        { workspaceId, userId: session.id },
        async (trx) => {
          return trx
            .selectFrom("workspace")
            .select(["name"])
            .where("id", "=", workspaceId)
            .executeTakeFirst();
        },
      );
      if (!workspace) {
        throw notFound("That workspace was not found.");
      }

      const pending = await withDbContext(
        ctx.db,
        { workspaceId, userId: session.id },
        async (trx) => {
          return trx
            .selectFrom("member")
            .selectAll()
            .where("workspace_id", "=", workspaceId)
            .where("invite_email", "=", email)
            .execute();
        },
      );
      const current = pending.find((member) => member.status !== "revoked");
      if (current?.status === "active") {
        throw new ProblemError({
          status: 409,
          title: "Conflict",
          detail: "That person is already a member of this workspace.",
        });
      }
      if (current?.status === "disabled") {
        throw new ProblemError({
          status: 409,
          title: "Conflict",
          detail: "That person is disabled. Enable them instead of sending a new invite.",
        });
      }

      const expires = inviteExpiresAt(new Date());
      let invitationId: string;
      if (current?.status === "invited") {
        invitationId = await withDbContext(
          ctx.db,
          { workspaceId, userId: session.id },
          async (trx) => {
            const invitation = await trx
              .selectFrom("invitation")
              .selectAll()
              .where("member_id", "=", current.id)
              .where("status", "=", "pending")
              .executeTakeFirst();
            if (!invitation) {
              throw new ProblemError({
                status: 409,
                title: "Conflict",
                detail: "That invite is already pending.",
              });
            }
            await trx
              .updateTable("invitation")
              .set({ expires_at: expires, role: role.name })
              .where("id", "=", invitation.id)
              .execute();
            await trx
              .updateTable("member")
              .set({ role: role.name, role_id: role.id, user_id: userId ?? current.user_id })
              .where("id", "=", current.id)
              .execute();
            return invitation.id;
          },
        );
      } else {
        invitationId = createId();
        const memberId = createId();
        await withDbContext(ctx.db, { workspaceId, userId: session.id }, async (trx) => {
          await trx
            .insertInto("member")
            .values({
              id: memberId,
              workspace_id: workspaceId,
              user_id: userId,
              role: role.name,
              role_id: role.id,
              status: "invited",
              invite_email: email,
            })
            .execute();
          await trx
            .insertInto("invitation")
            .values({
              id: invitationId,
              workspace_id: workspaceId,
              email,
              role: role.name,
              status: "pending",
              expires_at: expires,
              inviter_id: session.id,
              member_id: memberId,
            })
            .execute();
          await writeAudit(trx, {
            workspaceId,
            actorId: actor.id,
            entityType: "member",
            entityId: memberId,
            action: "invite",
            diff: { email, role: role.name },
          });
        });
      }

      const link = `${webOrigin}/invites/${invitationId}`;
      await ctx.mailer.send({
        to: email,
        subject: `Invite to ${workspace.name}`,
        text: `You are invited to ${workspace.name} as ${role.name}.\nOpen this link to accept:\n${link}\nThe invite expires in 7 days.\n`,
      });
      return reply.status(201).send({
        id: invitationId,
        email,
        role_id: role.id,
        role: role.name,
        status: "invited" as const,
        expires_at: expires.toISOString(),
      });
    },
  );

  app.post(
    "/invites/:token/accept",
    {
      schema: {
        params: z.object({ token: z.string() }),
        response: {
          200: z.object({
            member_id: z.string(),
            workspace_id: z.string(),
            status: z.literal("active"),
          }),
        },
      },
    },
    async (request) => {
      const session = await requireSession(ctx.auth, request.headers);
      if (!isUuidV7(request.params.token)) {
        throw notFound("That invite was not found.");
      }
      const invitation = await withDbContext(
        ctx.db,
        { inviteId: request.params.token },
        async (trx) => {
          return trx
            .selectFrom("invitation")
            .selectAll()
            .where("id", "=", request.params.token)
            .executeTakeFirst();
        },
      );
      if (!invitation || invitation.email.toLowerCase() !== session.email.toLowerCase()) {
        throw notFound("That invite was not found.");
      }
      if (invitation.status !== "pending" || !invitation.member_id) {
        throw new ProblemError({
          status: 409,
          title: "Conflict",
          detail: "That invite is no longer pending.",
        });
      }
      guardMember(() => assertInviteCurrent(invitation.expires_at, new Date()));
      const updated = await withDbContext(
        ctx.db,
        { workspaceId: invitation.workspace_id, userId: session.id },
        async (trx) => {
          const member = await trx
            .selectFrom("member")
            .selectAll()
            .where("id", "=", invitation.member_id)
            .executeTakeFirst();
          if (!member) {
            throw notFound("That invite was not found.");
          }
          const next = guardMember(() => transitionMember(member.status as MemberStatus, "active"));
          await trx
            .updateTable("member")
            .set({ status: next, user_id: session.id })
            .where("id", "=", member.id)
            .execute();
          await trx
            .updateTable("invitation")
            .set({ status: "accepted" })
            .where("id", "=", invitation.id)
            .execute();
          await writeAudit(trx, {
            workspaceId: invitation.workspace_id,
            actorId: member.id,
            entityType: "member",
            entityId: member.id,
            action: "accept",
            diff: { from: member.status, to: next },
          });
          return { member_id: member.id, workspace_id: member.workspace_id };
        },
      );
      await ctx.authPool.query(
        "update session set active_organization_id = $1, updated_at = now() where id = $2",
        [updated.workspace_id, session.sessionId],
      );
      return { ...updated, status: "active" as const };
    },
  );

  app.patch(
    "/members/:id",
    {
      schema: {
        tags: ["tenant-member"],
        params: z.object({ id: z.string() }),
        body: z.object({
          roleId: z.string().optional(),
          status: z.enum(["invited", "active", "disabled", "revoked"]).optional(),
        }),
        response: { 200: memberResponse },
      },
    },
    async (request) => {
      const session = await requireSession(ctx.auth, request.headers);
      if (!isUuidV7(request.params.id)) {
        throw notFound("That member was not found.");
      }
      if (request.body.roleId === undefined && request.body.status === undefined) {
        throw new ProblemError({
          status: 400,
          title: "Bad Request",
          detail: "Provide a role or a status.",
        });
      }
      const mine = await withDbContext(ctx.db, { userId: session.id }, async (trx) => {
        return trx
          .selectFrom("member")
          .selectAll()
          .where("user_id", "=", session.id)
          .where("status", "=", "active")
          .execute();
      });
      let found: { target: MemberRow; actor: MemberRow } | undefined;
      for (const actor of mine) {
        const target = await withDbContext(
          ctx.db,
          { workspaceId: actor.workspace_id, userId: session.id },
          async (trx) => {
            return trx
              .selectFrom("member")
              .selectAll()
              .where("id", "=", request.params.id)
              .executeTakeFirst();
          },
        );
        if (!target || target.status === "revoked") {
          continue;
        }
        await requirePermission(ctx.db, actor, "members.manage");
        found = { target, actor };
        break;
      }
      if (!found) {
        throw notFound("That member was not found.");
      }
      const { target, actor } = found;
      const nextRole = request.body.roleId
        ? await ctx.db
            .selectFrom("role")
            .selectAll()
            .where("id", "=", request.body.roleId)
            .where("is_system", "=", true)
            .executeTakeFirst()
        : undefined;
      if (request.body.roleId && (!nextRole || !isSystemRoleName(nextRole.name))) {
        throw new ProblemError({
          status: 400,
          title: "Bad Request",
          detail: "Choose one of the system roles.",
        });
      }
      const nextStatus = request.body.status
        ? guardMember(() =>
            transitionMember(target.status as MemberStatus, request.body.status as MemberStatus),
          )
        : (target.status as MemberStatus);
      const nextRoleName = nextRole?.name ?? target.role;
      const owners = await withDbContext(
        ctx.db,
        { workspaceId: target.workspace_id, userId: session.id },
        async (trx) => {
          return trx
            .selectFrom("member")
            .select("id")
            .where("workspace_id", "=", target.workspace_id)
            .where("role", "=", "owner")
            .where("status", "=", "active")
            .execute();
        },
      );
      guardMember(() =>
        assertKeepsAnOwner({
          activeOwnerCount: owners.length,
          wasActiveOwner: target.role === "owner" && target.status === "active",
          willBeActiveOwner: nextRoleName === "owner" && nextStatus === "active",
        }),
      );
      const saved = await withDbContext(
        ctx.db,
        { workspaceId: target.workspace_id, userId: session.id },
        async (trx) => {
          await trx
            .updateTable("member")
            .set({
              status: nextStatus,
              role: nextRoleName,
              role_id: nextRole?.id ?? target.role_id,
            })
            .where("id", "=", target.id)
            .execute();
          if (nextStatus === "revoked") {
            await trx
              .updateTable("invitation")
              .set({ status: "canceled" })
              .where("member_id", "=", target.id)
              .where("status", "=", "pending")
              .execute();
          }
          await writeAudit(trx, {
            workspaceId: target.workspace_id,
            actorId: actor.id,
            entityType: "member",
            entityId: target.id,
            action: "update",
            diff: { role: nextRoleName, status: nextStatus },
          });
          const row = await trx
            .selectFrom("member")
            .leftJoin("app_user", "app_user.id", "member.user_id")
            .select([
              "member.id as id",
              "member.workspace_id as workspace_id",
              "member.user_id as user_id",
              "member.role_id as role_id",
              "member.role as role",
              "member.status as status",
              "member.invite_email as invite_email",
              "app_user.email as user_email",
              "app_user.name as user_name",
            ])
            .where("member.id", "=", target.id)
            .executeTakeFirst();
          if (!row) {
            throw notFound("That member was not found.");
          }
          return row;
        },
      );
      if (nextStatus === "disabled" && target.user_id) {
        await ctx.authPool.query("delete from session where user_id = $1", [target.user_id]);
      }
      return {
        id: saved.id,
        workspace_id: saved.workspace_id,
        user_id: saved.user_id,
        role_id: saved.role_id,
        role: saved.role,
        status: saved.status,
        email: saved.user_email ?? saved.invite_email,
        name: saved.user_name,
      };
    },
  );
}
