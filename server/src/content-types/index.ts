/**
 * Internal content-type backing the runtime ignore-list: files or folders an
 * admin has explicitly chosen to keep, so they stop showing up as "unused".
 *
 * Hidden from the Content Manager and the Content-Type Builder — it is managed
 * only through the plugin's own UI/endpoints.
 */
const ignoredEntry = {
  schema: {
    kind: "collectionType",
    collectionName: "unused_media_ignored_entries",
    info: {
      singularName: "ignored-entry",
      pluralName: "ignored-entries",
      displayName: "Ignored entry",
      description:
        "Media files or folders intentionally kept (excluded from the unused list).",
    },
    options: {
      draftAndPublish: false,
    },
    pluginOptions: {
      "content-manager": { visible: false },
      "content-type-builder": { visible: false },
    },
    attributes: {
      targetType: {
        type: "enumeration",
        enum: ["file", "folder"],
        required: true,
      },
      targetId: {
        type: "integer",
        required: true,
      },
      note: {
        type: "string",
      },
    },
  },
};

export default {
  "ignored-entry": ignoredEntry,
};
