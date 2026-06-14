import type { Core } from "@strapi/strapi";

const PLUGIN_ID = "unused-media";

const ignore = ({ strapi }: { strapi: Core.Strapi }) => ({
  async list(ctx: any) {
    ctx.body = await strapi.plugin(PLUGIN_ID).service("ignore").list();
  },

  async add(ctx: any) {
    const { targetType, targetId, note } = ctx.request.body ?? {};
    if (
      (targetType !== "file" && targetType !== "folder") ||
      !Number.isInteger(targetId)
    ) {
      return ctx.badRequest(
        '`targetType` must be "file" or "folder" and `targetId` an integer.'
      );
    }
    const safeNote = typeof note === "string" ? note : undefined;
    ctx.body = await strapi
      .plugin(PLUGIN_ID)
      .service("ignore")
      .add({ targetType, targetId, note: safeNote });
  },

  async remove(ctx: any) {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) return ctx.badRequest("Invalid id.");
    ctx.body = await strapi.plugin(PLUGIN_ID).service("ignore").remove(id);
  },
});

export default ignore;
