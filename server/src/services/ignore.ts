import type { Core } from "@strapi/strapi";

const UID = "plugin::unused-media.ignored-entry";

export type IgnoreTargetType = "file" | "folder";

const ignore = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * All ignore-list entries (newest first), each enriched with its target's
   * details (the upload file or folder) so the UI can render a preview. A
   * `null` target means the file/folder was deleted elsewhere (stale entry,
   * still restorable).
   */
  async list() {
    const entries = await strapi.db
      .query(UID)
      .findMany({ orderBy: { createdAt: "DESC" } });
    const uploadService = strapi.plugin("upload").service("upload");

    return Promise.all(
      entries.map(async (entry: any) => {
        if (entry.targetType === "file") {
          const file = await uploadService
            .findOne(entry.targetId)
            .catch(() => null);
          return { ...entry, file };
        }
        const folder = await strapi.db
          .query("plugin::upload.folder")
          .findOne({ where: { id: entry.targetId } })
          .catch(() => null);
        return { ...entry, folder };
      })
    );
  },

  /**
   * Ignored targets as id → ignore-entry maps, for O(1) lookups while scanning.
   * Folder entries also carry the folder name (for the "ignored via folder X"
   * label). These maps let the scan both exclude and *tag* ignored media, and
   * expose the entry id so the UI can restore (un-ignore) a single item.
   */
  async maps(): Promise<{
    files: Map<number, number>;
    folders: Map<number, { entryId: number; name: string }>;
  }> {
    const entries = await strapi.db.query(UID).findMany();
    const files = new Map<number, number>();
    const folders = new Map<number, { entryId: number; name: string }>();

    for (const entry of entries) {
      if (entry.targetType === "folder") {
        folders.set(entry.targetId, { entryId: entry.id, name: "" });
      } else {
        files.set(entry.targetId, entry.id);
      }
    }

    if (folders.size > 0) {
      const rows = await strapi.db.query("plugin::upload.folder").findMany({
        where: { id: { $in: [...folders.keys()] } },
        select: ["id", "name"],
      });
      for (const row of rows) {
        const entry = folders.get(row.id);
        if (entry) entry.name = row.name;
      }
    }

    return { files, folders };
  },

  /** Add a file/folder to the ignore-list. Idempotent on (targetType, targetId). */
  async add({
    targetType,
    targetId,
    note,
  }: {
    targetType: IgnoreTargetType;
    targetId: number;
    note?: string;
  }) {
    const existing = await strapi.db
      .query(UID)
      .findOne({ where: { targetType, targetId } });
    if (existing) return existing;
    return strapi.db.query(UID).create({ data: { targetType, targetId, note } });
  },

  /** Remove an ignore-list entry by its own id. */
  async remove(id: number) {
    return strapi.db.query(UID).delete({ where: { id } });
  },
});

export default ignore;
