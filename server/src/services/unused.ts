import type { Core } from "@strapi/strapi";
import type { UnusedMediaConfig } from "../config";

const PLUGIN_UID = "plugin::unused-media";
const MS_PER_DAY = 86_400_000;
const SOFT_REF_ROW_LIMIT = 1000;

const TEXT_TYPES = new Set(["string", "text", "richtext", "blocks", "json"]);

const skipUid = (uid: string) =>
  uid.startsWith("admin::") ||
  uid.startsWith("strapi::") ||
  uid.startsWith("plugin::upload") ||
  uid.startsWith("plugin::unused-media");

export type CreatorScope =
  | { type: "none" }
  | { type: "creator"; userId: number }
  | { type: "roles"; roleIds: number[] };

export interface SoftRef {
  uid: string;
  field: string;
  id: number;
}

interface IgnoreMaps {
  files: Map<number, number>;
  folders: Map<number, { entryId: number; name: string }>;
}

interface FileRow {
  id: number;
  name: string;
  hash?: string;
  mime: string;
  size: number;
  folder?: { id: number; name: string } | null;
}

const tagIgnored = (file: FileRow, maps: IgnoreMaps) => {
  if (maps.files.has(file.id)) {
    return { ...file, ignored: true, ignoreVia: "file", ignoreEntryId: maps.files.get(file.id) };
  }
  if (file.folder && maps.folders.has(file.folder.id)) {
    const entry = maps.folders.get(file.folder.id)!;
    return {
      ...file,
      ignored: true,
      ignoreVia: "folder",
      ignoreEntryId: entry.entryId,
      ignoredFolderName: entry.name,
    };
  }
  return { ...file, ignored: false };
};

const unused = ({ strapi }: { strapi: Core.Strapi }) => {
  const getConfig = () => strapi.config.get(PLUGIN_UID) as UnusedMediaConfig;
  const knex = () => (strapi.db as any).connection;

  /**
   * Resolve the join-table / column names from `strapi.db.metadata` rather than
   * hardcoding Strapi internals (the morph table name is a truncated identifier
   * that could change). Falls back to the known 5.x literals if the metadata
   * shape isn't what we expect.
   */
  const resolveSchema = () => {
    const lit = {
      files: "files",
      createdByCol: "created_by_id",
      morphTable: "files_related_mph",
      morphFileCol: "file_id",
      folderTable: "files_folder_lnk",
      folderFileCol: "file_id",
      folderCol: "folder_id",
      rolesTable: "admin_users_roles_lnk",
      rolesUserCol: "user_id",
      rolesRoleCol: "role_id",
    };
    try {
      const md = (strapi.db as any).metadata;
      const file = md.get("plugin::upload.file");
      const user = md.get("admin::user");
      const rel = file?.attributes?.related?.joinTable;
      const fol = file?.attributes?.folder?.joinTable;
      const rol = user?.attributes?.roles?.joinTable;
      return {
        files: file?.tableName || lit.files,
        createdByCol: file?.attributes?.createdBy?.joinColumn?.name || lit.createdByCol,
        morphTable: rel?.name || lit.morphTable,
        morphFileCol: rel?.joinColumn?.name || lit.morphFileCol,
        folderTable: fol?.name || lit.folderTable,
        folderFileCol: fol?.joinColumn?.name || lit.folderFileCol,
        folderCol: fol?.inverseJoinColumn?.name || lit.folderCol,
        rolesTable: rol?.name || lit.rolesTable,
        rolesUserCol: rol?.joinColumn?.name || lit.rolesUserCol,
        rolesRoleCol: rol?.inverseJoinColumn?.name || lit.rolesRoleCol,
      };
    } catch {
      return lit;
    }
  };

  const applyScope = (q: any, scope: CreatorScope, S: ReturnType<typeof resolveSchema>) => {
    if (scope.type === "creator") {
      return q.where(`f.${S.createdByCol}`, scope.userId);
    }
    if (scope.type === "roles") {
      const sub = knex()(S.rolesTable)
        .distinct(S.rolesUserCol)
        .whereIn(S.rolesRoleCol, scope.roleIds.length ? scope.roleIds : [-1]);
      return q.whereIn(`f.${S.createdByCol}`, sub);
    }
    return q;
  };

  /**
   * Base query for orphan files (no morph row), with config exclusions, RBAC
   * scope and (optionally) the ignore-list applied entirely at the DB level.
   */
  const orphanQuery = (
    config: UnusedMediaConfig,
    maps: IgnoreMaps,
    scope: CreatorScope,
    includeIgnored: boolean,
    S: ReturnType<typeof resolveSchema>
  ) => {
    let q = knex()(`${S.files} as f`)
      .leftJoin(`${S.morphTable} as m`, `m.${S.morphFileCol}`, "f.id")
      .leftJoin(`${S.folderTable} as fl`, `fl.${S.folderFileCol}`, "f.id")
      .whereNull("m.id");

    q = applyScope(q, scope, S);

    if (config.minimumAgeInDays > 0) {
      // Pass a Date object (NOT an ISO string) so the driver formats it for the
      // dialect — comparing a string against the stored date is unreliable.
      const cutoff = new Date(Date.now() - config.minimumAgeInDays * MS_PER_DAY);
      q = q.where("f.created_at", "<", cutoff);
    }

    for (const pattern of config.excludedMimeTypes) {
      q = pattern.endsWith("*")
        ? q.whereNot("f.mime", "like", `${pattern.slice(0, -1)}%`)
        : q.whereNot("f.mime", pattern);
    }

    const excludedFolders = [...config.excludedFolderIds];
    if (!includeIgnored) excludedFolders.push(...maps.folders.keys());
    if (excludedFolders.length) {
      q = q.where((qb: any) =>
        qb.whereNull(`fl.${S.folderCol}`).orWhereNotIn(`fl.${S.folderCol}`, excludedFolders)
      );
    }
    if (!includeIgnored && maps.files.size) {
      q = q.whereNotIn("f.id", [...maps.files.keys()]);
    }

    return q;
  };

  const findSoftReferences = async (
    hashes: string[]
  ): Promise<Map<string, SoftRef[]>> => {
    const result = new Map<string, SoftRef[]>();
    if (hashes.length === 0) return result;

    const metadata = (strapi.db as any).metadata as Map<string, any>;
    for (const [uid, meta] of metadata) {
      if (skipUid(uid) || !meta?.tableName) continue;

      const textCols: Array<{ field: string; column: string }> = [];
      for (const [name, attr] of Object.entries<any>(meta.attributes ?? {})) {
        if (attr && TEXT_TYPES.has(attr.type) && attr.columnName) {
          textCols.push({ field: name, column: attr.columnName });
        }
      }
      if (textCols.length === 0) continue;

      let rows: any[];
      try {
        rows = await knex()(meta.tableName)
          .select("id", ...textCols.map((c) => c.column))
          .where((qb: any) => {
            for (const { column } of textCols) {
              for (const hash of hashes) {
                qb.orWhere(column, "like", `%${hash}%`);
              }
            }
          })
          .limit(SOFT_REF_ROW_LIMIT);
      } catch {
        continue;
      }

      for (const row of rows) {
        for (const { field, column } of textCols) {
          const value = row[column];
          if (value == null) continue;
          const text = typeof value === "string" ? value : JSON.stringify(value);
          for (const hash of hashes) {
            if (text.includes(hash)) {
              const refs = result.get(hash) ?? [];
              refs.push({ uid, field, id: row.id });
              result.set(hash, refs);
            }
          }
        }
      }
    }
    return result;
  };

  const annotateSoftRefs = async (results: any[]) => {
    const hashes = results
      .map((r) => r.hash)
      .filter((h): h is string => Boolean(h));
    const refs = await findSoftReferences(hashes);
    for (const r of results) {
      if (r.hash && refs.has(r.hash)) r.softReferences = refs.get(r.hash);
    }
  };

  const hydrate = async (pageIds: number[], maps: IgnoreMaps) => {
    if (!pageIds.length) return [];
    const files = await strapi
      .plugin("upload")
      .service("upload")
      .findMany({ filters: { id: { $in: pageIds } }, populate: { folder: true } });
    const byId = new Map<number, FileRow>(files.map((f: FileRow) => [f.id, f]));
    const results = pageIds
      .map((id) => byId.get(id))
      .filter((f): f is FileRow => Boolean(f))
      .map((file) => tagIgnored(file, maps));
    if (results.length < pageIds.length) {
      strapi.log.debug(
        `[unused-media] ${pageIds.length - results.length} candidate(s) vanished between scan and hydration.`
      );
    }
    return results;
  };

  return {
    async findUnused({
      scope = { type: "none" } as CreatorScope,
      page = 1,
      pageSize = 20,
      includeIgnored = false,
      deep = false,
    }) {
      const config = getConfig();
      const S = resolveSchema();
      const maps = await strapi.plugin("unused-media").service("ignore").maps();

      const totalRow = await orphanQuery(config, maps, scope, includeIgnored, S)
        .countDistinct("f.id as cnt")
        .first();
      const total = Number(totalRow?.cnt) || 0;

      const rows = await orphanQuery(config, maps, scope, includeIgnored, S)
        // include the order column in the projection (PostgreSQL requires it for
        // SELECT DISTINCT) + a stable tiebreaker for deterministic pages.
        .distinct("f.id", "f.created_at")
        .orderBy("f.created_at", "desc")
        .orderBy("f.id", "desc")
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const results = await hydrate(rows.map((r: any) => r.id), maps);
      if (deep) await annotateSoftRefs(results);

      return {
        results,
        pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
      };
    },

    async getStats({ scope = { type: "none" } as CreatorScope }) {
      const config = getConfig();
      const S = resolveSchema();
      const maps = await strapi.plugin("unused-media").service("ignore").maps();
      const k = knex();

      // Whole library (scope-applied).
      const totalRow = await applyScope(k(`${S.files} as f`), scope, S)
        .select(k.raw("COUNT(*) as cnt"), k.raw("COALESCE(SUM(size), 0) as sz"))
        .first();

      // One orphan scan (config exclusions, no ignore-list) → split actionable
      // vs ignored via conditional aggregation. 3 queries → 2.
      const ignoredFileIds = [...maps.files.keys()];
      const ignoredFolderIds = [...maps.folders.keys()];
      const conds: string[] = [];
      const binds: number[] = [];
      if (ignoredFileIds.length) {
        conds.push(`f.id NOT IN (${ignoredFileIds.map(() => "?").join(",")})`);
        binds.push(...ignoredFileIds);
      }
      if (ignoredFolderIds.length) {
        conds.push(
          `(fl.${S.folderCol} IS NULL OR fl.${S.folderCol} NOT IN (${ignoredFolderIds
            .map(() => "?")
            .join(",")}))`
        );
        binds.push(...ignoredFolderIds);
      }
      const actionable = conds.length ? conds.join(" AND ") : "1=1";

      const orphanRow = await orphanQuery(config, maps, scope, true, S)
        .select(
          k.raw("COUNT(DISTINCT f.id) as allcnt"),
          k.raw(`COUNT(DISTINCT CASE WHEN ${actionable} THEN f.id END) as usedcnt`, binds),
          k.raw(`COALESCE(SUM(CASE WHEN ${actionable} THEN f.size END), 0) as usedsz`, binds)
        )
        .first();

      const unusedCount = Number(orphanRow?.usedcnt) || 0;
      return {
        totalCount: Number(totalRow?.cnt) || 0,
        unusedCount,
        ignoredCount: (Number(orphanRow?.allcnt) || 0) - unusedCount,
        totalSizeKb: Number(totalRow?.sz) || 0,
        unusedSizeKb: Number(orphanRow?.usedsz) || 0,
      };
    },

    async deleteMany(ids: number[], { scope = { type: "none" } as CreatorScope }) {
      const config = getConfig();
      if (!config.allowDelete) {
        throw new Error(
          "Deletion is disabled by configuration (allowDelete: false)."
        );
      }

      const S = resolveSchema();
      const maps = await strapi.plugin("unused-media").service("ignore").maps();
      const deletable: Array<{ id: number; hash: string; name: string }> =
        await orphanQuery(config, maps, scope, false, S)
          .distinct("f.id", "f.hash", "f.name")
          .whereIn("f.id", ids);

      const hashes = deletable.map((r) => r.hash).filter(Boolean);
      const refs = await findSoftReferences(hashes);
      const referenced = deletable.filter((r) => r.hash && refs.has(r.hash));
      const referencedSet = new Set(referenced.map((r) => r.id));

      const uploadService = strapi.plugin("upload").service("upload");
      const targets = deletable.filter((r) => !referencedSet.has(r.id));
      const files = targets.length
        ? await uploadService.findMany({ filters: { id: { $in: targets.map((r) => r.id) } } })
        : [];
      const byId = new Map<number, any>(files.map((f: any) => [f.id, f]));

      const deleted: number[] = [];
      for (const { id } of targets) {
        const file = byId.get(id);
        if (file) {
          await uploadService.remove(file);
          deleted.push(id);
        }
      }

      const deletableIds = new Set(deletable.map((r) => r.id));
      return {
        deleted,
        skipped: ids.filter((id) => !deletableIds.has(id)),
        skippedReferenced: referenced.map((r) => ({
          id: r.id,
          name: r.name,
          references: refs.get(r.hash) ?? [],
        })),
      };
    },
  };
};

export default unused;
