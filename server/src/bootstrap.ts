import type { Core } from "@strapi/strapi";

const PLUGIN_ID = "unused-media";

/**
 * RBAC actions exposed by the plugin. Each becomes a permission
 * `plugin::unused-media.<uid>` assignable to roles in Settings → Roles, and
 * usable to gate the menu link and the admin routes.
 */
const RBAC_ACTIONS = [
  {
    section: "plugins",
    displayName: "Access unused media",
    uid: "read",
    pluginName: PLUGIN_ID,
  },
  {
    section: "plugins",
    displayName: "Delete unused media",
    uid: "delete",
    pluginName: PLUGIN_ID,
  },
  {
    section: "plugins",
    displayName: "Manage ignore-list",
    uid: "ignore",
    pluginName: PLUGIN_ID,
  },
];

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  await strapi.admin.services.permission.actionProvider.registerMany(
    RBAC_ACTIONS
  );
};

export default bootstrap;
