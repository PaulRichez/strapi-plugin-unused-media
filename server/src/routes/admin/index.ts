const PLUGIN_ID = "unused-media";

/** RBAC-protected admin route: authenticated admin + the given plugin action. */
const guarded = (action: string) => [
  "admin::isAuthenticatedAdmin",
  {
    name: "admin::hasPermissions",
    config: { actions: [`plugin::${PLUGIN_ID}.${action}`] },
  },
];

export default () => ({
  type: "admin",
  routes: [
    {
      method: "GET",
      path: "/files",
      handler: "unused.findUnused",
      config: { policies: guarded("read") },
    },
    {
      method: "GET",
      path: "/stats",
      handler: "unused.getStats",
      config: { policies: guarded("read") },
    },
    {
      // POST (not DELETE): the admin fetch client cannot send a body with
      // DELETE, and bulk delete needs an `ids` array in the body.
      method: "POST",
      path: "/files/bulk-delete",
      handler: "unused.deleteMany",
      config: { policies: guarded("delete") },
    },
    {
      method: "GET",
      path: "/ignored",
      handler: "ignore.list",
      config: { policies: guarded("read") },
    },
    {
      method: "POST",
      path: "/ignored",
      handler: "ignore.add",
      config: { policies: guarded("ignore") },
    },
    {
      method: "DELETE",
      path: "/ignored/:id",
      handler: "ignore.remove",
      config: { policies: guarded("ignore") },
    },
  ],
});
