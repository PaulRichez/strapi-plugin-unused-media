/**
 * Plugin configuration schema.
 *
 * Set these in the host app's `config/plugins.ts`:
 *
 *   'unused-media': {
 *     enabled: true,
 *     resolve: 'src/plugins/unused-media',
 *     config: {
 *       excludedMimeTypes: ['video/*'],
 *       minimumAgeInDays: 7,
 *       allowDelete: false,
 *     },
 *   },
 *
 * `config` here = developer-set policy. It is distinct from the runtime
 * ignore-list (per-file decisions made by admins in the UI), which lives in
 * the `ignored-entry` content-type.
 */

export interface UnusedMediaConfig {
  /**
   * Baseline Media Library folder ids whose files are never considered unused
   * (and never shown in the plugin). This dev-set list is merged with the
   * runtime exclusions managed from within the plugin UI — the effective set is
   * `config.excludedFolderIds` ∪ runtime-excluded folders.
   */
  excludedFolderIds: number[];
  /**
   * MIME types never considered unused. A trailing `*` acts as a wildcard,
   * e.g. `'video/*'` excludes every video file.
   */
  excludedMimeTypes: string[];
  /**
   * Only flag files uploaded more than this many days ago. `0` disables the
   * age filter. Guards against flagging a just-uploaded file that has not been
   * attached to any entry yet.
   */
  minimumAgeInDays: number;
  /**
   * Enables the delete endpoint. Set to `false` to make the plugin strictly
   * read-only (the UI delete action is disabled and the route rejects).
   */
  allowDelete: boolean;
}

const config: {
  default: UnusedMediaConfig;
  validator: (config: Partial<UnusedMediaConfig>) => void;
} = {
  default: {
    excludedFolderIds: [],
    excludedMimeTypes: [],
    minimumAgeInDays: 0,
    allowDelete: true,
  },

  validator(config) {
    if (
      config.excludedFolderIds !== undefined &&
      (!Array.isArray(config.excludedFolderIds) ||
        config.excludedFolderIds.some((id) => !Number.isInteger(id)))
    ) {
      throw new Error(
        '[unused-media] `excludedFolderIds` must be an array of integers.'
      );
    }

    if (
      config.excludedMimeTypes !== undefined &&
      (!Array.isArray(config.excludedMimeTypes) ||
        config.excludedMimeTypes.some((mime) => typeof mime !== 'string'))
    ) {
      throw new Error(
        '[unused-media] `excludedMimeTypes` must be an array of strings.'
      );
    }

    if (
      config.minimumAgeInDays !== undefined &&
      (typeof config.minimumAgeInDays !== 'number' ||
        config.minimumAgeInDays < 0)
    ) {
      throw new Error(
        '[unused-media] `minimumAgeInDays` must be a number >= 0.'
      );
    }

    if (
      config.allowDelete !== undefined &&
      typeof config.allowDelete !== 'boolean'
    ) {
      throw new Error('[unused-media] `allowDelete` must be a boolean.');
    }
  },
};

export default config;
