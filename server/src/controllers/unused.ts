import type { Core } from "@strapi/strapi";
import type { CreatorScope } from "../services/unused";

const FILE_UID = "plugin::upload.file";
const PLUGIN_ID = "unused-media";

const actionId = (action: string) => `plugin::${PLUGIN_ID}.${action}`;

const toBool = (v: unknown) => v === "true" || v === true;

/**
 * Derive the RBAC scope from the permission's bound condition. We detect the
 * condition *type* from the permission query (is-creator → `createdBy`,
 * has-same-role → `roles`) and take the value from the current admin user.
 *
 * Fails CLOSED: a non-empty condition we can't translate (e.g. a custom admin
 * condition) throws, so the caller denies access rather than leaking every
 * user's files.
 */
const detectScope = (ctx: any, pm: any): CreatorScope => {
  const query = pm.getQuery();
  if (!query || typeof query !== "object" || Object.keys(query).length === 0) {
    return { type: "none" };
  }

  const str = JSON.stringify(query);

  if (str.includes("roles")) {
    const roleIds = (ctx.state.user?.roles ?? [])
      .map((r: any) => r?.id)
      .filter((id: unknown): id is number => Number.isInteger(id));
    if (!roleIds.length) {
      throw new Error("Cannot resolve roles for the has-same-role condition.");
    }
    return { type: "roles", roleIds };
  }

  if (str.includes("createdBy")) {
    const userId = ctx.state.user?.id;
    if (!Number.isInteger(userId)) {
      throw new Error("Cannot resolve the current user for the is-creator condition.");
    }
    return { type: "creator", userId };
  }

  throw new Error("Unsupported permission condition; access denied.");
};

const unused = ({ strapi }: { strapi: Core.Strapi }) => {
  const permissionManager = (ctx: any, action: string) =>
    strapi.service("admin::permission").createPermissionsManager({
      ability: ctx.state.userAbility,
      action: actionId(action),
      model: FILE_UID,
    });

  const service = () => strapi.plugin(PLUGIN_ID).service("unused");

  /** Gate on the action, then resolve the (fail-closed) RBAC scope. */
  const authorize = (ctx: any, action: string): CreatorScope | null => {
    const pm = permissionManager(ctx, action);
    if (!pm.isAllowed) {
      ctx.forbidden();
      return null;
    }
    try {
      return detectScope(ctx, pm);
    } catch (err) {
      ctx.forbidden((err as Error).message);
      return null;
    }
  };

  return {
    async findUnused(ctx: any) {
      const scope = authorize(ctx, "read");
      if (!scope) return;
      ctx.body = await service().findUnused({
        scope,
        page: Math.max(1, Number(ctx.query.page) || 1),
        pageSize: Math.min(100, Math.max(1, Number(ctx.query.pageSize) || 20)),
        includeIgnored: toBool(ctx.query.includeIgnored),
        deep: toBool(ctx.query.deep),
      });
    },

    async getStats(ctx: any) {
      const scope = authorize(ctx, "read");
      if (!scope) return;
      ctx.body = await service().getStats({ scope });
    },

    async deleteMany(ctx: any) {
      const scope = authorize(ctx, "delete");
      if (!scope) return;

      const ids = ctx.request.body?.ids;
      if (!Array.isArray(ids) || ids.some((id: unknown) => !Number.isInteger(id))) {
        return ctx.badRequest("`ids` must be an array of integers.");
      }

      try {
        ctx.body = await service().deleteMany(ids, { scope });
      } catch (err) {
        return ctx.forbidden((err as Error).message);
      }
    },
  };
};

export default unused;
