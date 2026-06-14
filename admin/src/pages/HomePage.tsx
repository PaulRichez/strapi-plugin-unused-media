import * as React from "react";
import { useIntl } from "react-intl";
import {
  Page,
  Layouts,
  Pagination,
  useFetchClient,
  useNotification,
  useQueryParams,
  useRBAC,
} from "@strapi/strapi/admin";
import {
  Box,
  Flex,
  Grid,
  Typography,
  Button,
  Checkbox,
  Switch,
  Loader,
  EmptyStateLayout,
  SingleSelect,
  SingleSelectOption,
  Card,
  CardHeader,
  CardCheckbox,
  CardAsset,
  CardBody,
  CardContent,
  CardTitle,
  CardSubtitle,
  CardBadge,
  CardAction,
  IconButton,
  SimpleMenu,
  MenuItem,
} from "@strapi/design-system";
import {
  ArrowClockwise,
  Trash,
  Eye,
  File,
  FilePdf,
  FileCsv,
  FileXls,
  FileZip,
  GridFour,
  List,
  EyeStriked,
  More,
  Folder,
  Lock,
  ListSearch,
} from "@strapi/icons";
import { styled } from "styled-components";

import { getTranslation } from "../utils/getTranslation";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = ["10", "20", "50", "100"];
const PREVIEW_HEIGHT = "16.4rem";

const PERM = {
  delete: [{ action: "plugin::unused-media.delete" }],
  ignore: [{ action: "plugin::unused-media.ignore" }],
};

/** Translate a plugin key with an inline default and optional values. */
const useTranslate = () => {
  const { formatMessage } = useIntl();
  return React.useCallback(
    (id: string, defaultMessage: string, values?: Record<string, unknown>) =>
      formatMessage({ id: getTranslation(id), defaultMessage }, values as never),
    [formatMessage]
  );
};

interface SoftRef {
  uid: string;
  field: string;
  id: number;
}

interface FileRow {
  id: number;
  name: string;
  ext?: string | null;
  mime: string;
  size: number; // KB
  hash?: string;
  width?: number | null;
  height?: number | null;
  url: string;
  folder?: { id: number; name: string } | null;
  formats?: { thumbnail?: { url: string } } | null;
  ignored?: boolean;
  ignoreVia?: "file" | "folder";
  ignoreEntryId?: number;
  ignoredFolderName?: string;
  softReferences?: SoftRef[];
}

interface Stats {
  totalCount: number;
  unusedCount: number;
  ignoredCount: number;
  totalSizeKb: number;
  unusedSizeKb: number;
}

type ViewMode = "grid" | "list";

/** Strapi stores file size in KB (float). Format with the right unit. */
const formatSize = (kb: number): string => {
  if (kb < 1) return `${Math.round(kb * 1024)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = kb;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
};

/**
 * Run `fn` on Enter/Space for keyboard-operable clickable elements — but only
 * when the surface itself is focused, so a keydown bubbling up from a nested
 * control (checkbox, menu, restore) lets that control handle its own keys.
 */
const onActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};

const isImage = (mime: string): boolean => mime.startsWith("image/");

const previewUrl = (file: FileRow): string =>
  file.formats?.thumbnail?.url ?? file.url;

/** Asset type category badge (kept untranslated — near-universal labels). */
const typeLabel = (mime: string): string => {
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  return "Doc";
};

const fileIconFor = (mime: string): typeof File => {
  if (mime === "application/pdf") return FilePdf;
  if (mime.includes("csv")) return FileCsv;
  if (mime.includes("sheet") || mime.includes("excel")) return FileXls;
  if (mime.includes("zip") || mime.includes("compressed")) return FileZip;
  return File;
};

const isReferenced = (file: FileRow): boolean =>
  (file.softReferences?.length ?? 0) > 0;

/** "chef.chef · bio +2" — where a soft-referenced file is used. */
const refLabel = (file: FileRow): string => {
  const r = file.softReferences?.[0];
  if (!r) return "";
  const where = `${r.uid.split("::").pop() ?? r.uid} · ${r.field}`;
  const extra = (file.softReferences?.length ?? 1) - 1;
  return extra > 0 ? `${where} +${extra}` : where;
};

const DocPreview = styled(Flex)`
  border-radius: ${({ theme }) => theme.borderRadius} ${({ theme }) =>
      theme.borderRadius} 0 0;
  background: linear-gradient(
    180deg,
    ${({ theme }) => theme.colors.neutral0} 0%,
    ${({ theme }) => theme.colors.neutral100} 121.48%
  );
`;

const CardCheckboxWrapper = styled.div`
  z-index: 1;
`;

const Extension = styled.span`
  text-transform: uppercase;
`;

const CardActionsContainer = styled(CardAction)`
  opacity: 0;
  z-index: 1;
  &:focus-within {
    opacity: 1;
  }
`;

const ClickableCard = styled(Card)`
  cursor: pointer;
  &:hover ${CardActionsContainer} {
    opacity: 1;
  }
`;

const RowPreview = ({ file }: { file?: FileRow | null }) => {
  const Icon = file ? fileIconFor(file.mime) : File;
  return (
    <Flex
      width="40px"
      height="40px"
      justifyContent="center"
      alignItems="center"
      background="neutral100"
      hasRadius
      shrink={0}
    >
      {file && isImage(file.mime) ? (
        <img
          src={previewUrl(file)}
          alt={file.name}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      ) : (
        <Icon fill="neutral500" width="1.2rem" height="1.2rem" />
      )}
    </Flex>
  );
};

const IgnoreMenu = ({
  file,
  onIgnore,
  onIgnoreFolder,
}: {
  file: FileRow;
  onIgnore: () => void;
  onIgnoreFolder: () => void;
}) => {
  const t = useTranslate();
  if (!file.folder) {
    return (
      <IconButton label={t("action.ignoreFile", "Ignore this file")} onClick={onIgnore}>
        <EyeStriked />
      </IconButton>
    );
  }
  return (
    <SimpleMenu label={<More />} endIcon={null} variant="ghost" size="S">
      <MenuItem onSelect={onIgnore} startIcon={<EyeStriked />}>
        {t("action.ignoreFile", "Ignore this file")}
      </MenuItem>
      <MenuItem onSelect={onIgnoreFolder} startIcon={<Folder />}>
        {t("action.ignoreFolder", "Ignore folder «{name}»", { name: file.folder.name })}
      </MenuItem>
    </SimpleMenu>
  );
};

const UnusedCard = ({
  file,
  selected,
  canIgnore,
  onToggle,
  onOpen,
  onIgnore,
  onIgnoreFolder,
  onRestore,
}: {
  file: FileRow;
  selected: boolean;
  canIgnore: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onIgnore: () => void;
  onIgnoreFolder: () => void;
  onRestore: () => void;
}) => {
  const t = useTranslate();
  const Icon = fileIconFor(file.mime);
  const referenced = isReferenced(file);
  const protectedItem = file.ignored || referenced;

  return (
    <ClickableCard
      role="button"
      height="100%"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onActivate(onOpen)}
      aria-label={t("action.open", "Open {name}", { name: file.name })}
      style={{ opacity: protectedItem ? 0.55 : 1 }}
    >
      <CardHeader>
        <CardCheckboxWrapper onClick={(e) => e.stopPropagation()}>
          {protectedItem ? (
            <Box padding={1} background="neutral150" hasRadius>
              <Lock fill="neutral500" />
            </Box>
          ) : (
            <CardCheckbox checked={selected} onCheckedChange={onToggle} />
          )}
        </CardCheckboxWrapper>
        {canIgnore && !referenced && (
          <CardActionsContainer
            position="end"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {file.ignored ? (
              <IconButton label={t("action.restore", "Restore (stop ignoring)")} onClick={onRestore}>
                <ArrowClockwise />
              </IconButton>
            ) : (
              <IgnoreMenu
                file={file}
                onIgnore={onIgnore}
                onIgnoreFolder={onIgnoreFolder}
              />
            )}
          </CardActionsContainer>
        )}
        {isImage(file.mime) ? (
          <CardAsset src={previewUrl(file)} size="M" alt={file.name} />
        ) : (
          <DocPreview
            width="100%"
            height={PREVIEW_HEIGHT}
            justifyContent="center"
            alignItems="center"
          >
            <Flex gap={2} direction="column" alignItems="center">
              <Icon fill="neutral500" width="1.5rem" height="1.5rem" />
              <Typography textColor="neutral500" variant="pi">
                {t("card.noPreview", "No preview available")}
              </Typography>
            </Flex>
          </DocPreview>
        )}
      </CardHeader>
      <CardBody>
        <CardContent>
          <Box paddingTop={1}>
            <Typography tag="h2">
              <CardTitle tag="span">{file.name}</CardTitle>
            </Typography>
          </Box>
          <CardSubtitle>
            <Extension>{(file.ext ?? "").replace(".", "")}</Extension>
            {file.width && file.height ? ` - ${file.width}✕${file.height}` : ""}
            {` - ${formatSize(file.size)}`}
          </CardSubtitle>
          {referenced && (
            <Box paddingTop={1}>
              <Typography variant="pi" textColor="warning600" ellipsis>
                {t("card.referencedIn", "Referenced in {where}", { where: refLabel(file) })}
              </Typography>
            </Box>
          )}
        </CardContent>
        <Flex paddingTop={1} grow={1} gap={1}>
          <CardBadge>{typeLabel(file.mime)}</CardBadge>
          {file.ignored && <CardBadge>{t("badge.ignored", "Ignored")}</CardBadge>}
          {referenced && <CardBadge>{t("badge.referenced", "Referenced")}</CardBadge>}
        </Flex>
      </CardBody>
    </ClickableCard>
  );
};

const HomePage = () => {
  const t = useTranslate();
  const { get, post, del } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [{ query }, setQuery] = useQueryParams<{
    page?: string;
    pageSize?: string;
    showIgnored?: string;
    deep?: string;
    view?: string;
  }>();
  const { allowedActions } = useRBAC(PERM);
  const canDelete = Boolean(
    (allowedActions as Record<string, boolean>).canDelete
  );
  const canIgnore = Boolean(
    (allowedActions as Record<string, boolean>).canIgnore
  );

  const page = Number(query.page) || 1;
  const pageSize = Number(query.pageSize) || DEFAULT_PAGE_SIZE;
  // UI state lives in the URL so back/forward and refresh keep it.
  const showIgnored = query.showIgnored === "true";
  const deepScan = query.deep === "true";
  const viewMode: ViewMode = query.view === "list" ? "list" : "grid";

  const [files, setFiles] = React.useState<FileRow[]>([]);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [total, setTotal] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = React.useState(true);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    setSelected(new Set()); // selection is page-scoped — reset on every (re)fetch
    try {
      const [filesRes, statsRes] = await Promise.all([
        get(`/unused-media/files`, {
          params: { page, pageSize, includeIgnored: showIgnored, deep: deepScan },
        }),
        get(`/unused-media/stats`),
      ]);
      setFiles(filesRes.data.results ?? []);
      setTotal(filesRes.data.pagination?.total ?? 0);
      setStats(statsRes.data);
    } catch {
      toggleNotification({ type: "danger", message: t("notif.loadFailed", "Failed to load.") });
    } finally {
      setIsLoading(false);
    }
  }, [get, page, pageSize, showIgnored, deepScan, t, toggleNotification]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Selectable = neither ignored nor referenced in content.
  const selectableFiles = files.filter((f) => !f.ignored && !isReferenced(f));
  const allSelected =
    selectableFiles.length > 0 &&
    selectableFiles.every((f) => selected.has(f.id));
  const toggleAll = () =>
    setSelected(() =>
      allSelected ? new Set() : new Set(selectableFiles.map((f) => f.id))
    );

  const open = (file: FileRow) => window.open(file.url, "_blank");

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const ids = [...selected];
      const { data } = await post(`/unused-media/files/bulk-delete`, { ids });
      const deleted = data.deleted?.length ?? 0;
      const skippedRef = data.skippedReferenced?.length ?? 0;
      toggleNotification({
        type: skippedRef > 0 ? "warning" : "success",
        message:
          skippedRef > 0
            ? t("notif.deletedSkipped", "{deleted} deleted · {skipped} skipped (referenced in content).", { deleted, skipped: skippedRef })
            : t("notif.deleted", "{count} file(s) deleted.", { count: deleted }),
      });
      setSelected(new Set());
      fetchData();
    } catch {
      toggleNotification({ type: "danger", message: t("notif.deleteFailed", "Deletion failed.") });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleIgnore = async (file: FileRow) => {
    try {
      await post(`/unused-media/ignored`, { targetType: "file", targetId: file.id });
      toggleNotification({ type: "success", message: t("notif.ignored", "“{name}” ignored.", { name: file.name }) });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
      fetchData();
    } catch {
      toggleNotification({ type: "danger", message: t("notif.ignoreFailed", "Could not ignore the file.") });
    }
  };

  const handleIgnoreFolder = async (folder: { id: number; name: string }) => {
    try {
      await post(`/unused-media/ignored`, { targetType: "folder", targetId: folder.id });
      toggleNotification({ type: "success", message: t("notif.folderIgnored", "Folder “{name}” ignored.", { name: folder.name }) });
      fetchData();
    } catch {
      toggleNotification({ type: "danger", message: t("notif.folderIgnoreFailed", "Could not ignore the folder.") });
    }
  };

  const handleRestore = async (file: FileRow) => {
    if (!file.ignoreEntryId) return;
    try {
      await del(`/unused-media/ignored/${file.ignoreEntryId}`);
      toggleNotification({
        type: "success",
        message:
          file.ignoreVia === "folder"
            ? t("notif.restoredFolder", "Folder “{name}” restored to the scan.", { name: file.ignoredFolderName || "?" })
            : t("notif.restoredFile", "“{name}” restored to the scan.", { name: file.name }),
      });
      fetchData();
    } catch {
      toggleNotification({ type: "danger", message: t("notif.restoreFailed", "Could not restore.") });
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const unusedPct =
    stats && stats.totalSizeKb > 0
      ? Math.round((stats.unusedSizeKb / stats.totalSizeKb) * 100)
      : 0;

  return (
    <Page.Main>
      <Layouts.Header
        title={t("plugin.name", "Unused Media")}
        subtitle={t("header.subtitle", "Media Library files not referenced by any content")}
        primaryAction={
          <Button
            variant="secondary"
            startIcon={<ArrowClockwise />}
            onClick={fetchData}
            loading={isLoading}
          >
            {t("action.rescan", "Rescan")}
          </Button>
        }
      />

      <Layouts.Content>
        {stats && (
          <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} marginBottom={4}>
            <Typography variant="delta" tag="h2">
              {t("gauge.total", "{size} total", { size: formatSize(stats.totalSizeKb) })}
            </Typography>
            <Box background="neutral150" hasRadius height="8px" marginTop={2} marginBottom={2}>
              <Box background="danger500" hasRadius height="8px" width={`${unusedPct}%`} />
            </Box>
            <Typography variant="pi" textColor="neutral600">
              {t("gauge.summary", "{size} unused · {count} file(s) ({pct}%)", {
                size: formatSize(stats.unusedSizeKb),
                count: stats.unusedCount,
                pct: unusedPct,
              })}
              {stats.ignoredCount > 0
                ? t("gauge.ignoredSuffix", " · {count} ignored", { count: stats.ignoredCount })
                : ""}
            </Typography>
          </Box>
        )}

        <Flex justifyContent="space-between" alignItems="center" paddingBottom={4}>
          <Flex gap={4} alignItems="center">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              disabled={selectableFiles.length === 0}
            >
              {t("toolbar.selectAll", "Select all")}
            </Checkbox>
            <Flex>
              <Box background={viewMode === "grid" ? "primary100" : undefined} hasRadius>
                <Button variant="ghost" onClick={() => setQuery({ view: "grid" })} aria-label={t("toolbar.gridView", "Grid view")}>
                  <GridFour />
                </Button>
              </Box>
              <Box background={viewMode === "list" ? "primary100" : undefined} hasRadius>
                <Button variant="ghost" onClick={() => setQuery({ view: "list" })} aria-label={t("toolbar.listView", "List view")}>
                  <List />
                </Button>
              </Box>
            </Flex>
            <Flex tag="label" gap={2} alignItems="center">
              <Switch
                checked={showIgnored}
                onCheckedChange={(checked: boolean) =>
                  setQuery({ showIgnored: String(checked), page: "1" })
                }
                aria-label={t("toolbar.showIgnored", "Show ignored")}
              />
              <Typography variant="pi" textColor="neutral600">
                {t("toolbar.showIgnored", "Show ignored")}
              </Typography>
            </Flex>
            <Button
              variant={deepScan ? "secondary" : "tertiary"}
              startIcon={<ListSearch />}
              onClick={() => setQuery({ deep: String(!deepScan), page: "1" })}
              loading={isLoading && deepScan}
            >
              {t("action.deepScan", "Deep scan")}
            </Button>
          </Flex>
          {canDelete && selected.size > 0 && (
            <Flex gap={2} alignItems="center">
              <Typography variant="pi" textColor="neutral600">
                {t("toolbar.selected", "{count} selected", { count: selected.size })}
              </Typography>
              <Button
                variant="danger-light"
                startIcon={<Trash />}
                onClick={handleDelete}
                loading={isDeleting}
              >
                {t("action.delete", "Delete")}
              </Button>
            </Flex>
          )}
        </Flex>

        {isLoading ? (
          <Flex justifyContent="center" padding={8}>
            <Loader>{t("state.loading", "Loading…")}</Loader>
          </Flex>
        ) : files.length === 0 ? (
          <EmptyStateLayout
            icon={<Eye width="6rem" height="6rem" />}
            content={
              !showIgnored && stats && stats.ignoredCount > 0
                ? t("empty.withIgnored", "No unused media. {count} ignored — toggle “Show ignored” to see them.", { count: stats.ignoredCount })
                : t("empty.clean", "No unused media — your library is clean.")
            }
          />
        ) : viewMode === "grid" ? (
          <Grid.Root gap={4}>
            {files.map((file) => (
              <Grid.Item key={file.id} col={3} m={4} s={6} xs={12} height="100%" direction="column" alignItems="stretch">
                <UnusedCard
                  file={file}
                  selected={selected.has(file.id)}
                  canIgnore={canIgnore}
                  onToggle={() => toggle(file.id)}
                  onOpen={() => open(file)}
                  onIgnore={() => handleIgnore(file)}
                  onIgnoreFolder={() => file.folder && handleIgnoreFolder(file.folder)}
                  onRestore={() => handleRestore(file)}
                />
              </Grid.Item>
            ))}
          </Grid.Root>
        ) : (
          <Flex direction="column" gap={2} alignItems="stretch">
            {files.map((file) => {
              const referenced = isReferenced(file);
              const protectedItem = file.ignored || referenced;
              return (
                <Flex
                  key={file.id}
                  role="button"
                  tabIndex={0}
                  aria-label={t("action.open", "Open {name}", { name: file.name })}
                  gap={4}
                  alignItems="center"
                  background="neutral0"
                  hasRadius
                  shadow="tableShadow"
                  borderColor="neutral150"
                  padding={3}
                  onClick={() => open(file)}
                  onKeyDown={onActivate(() => open(file))}
                  style={{ cursor: "pointer", opacity: protectedItem ? 0.55 : 1 }}
                >
                  <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    {protectedItem ? (
                      <Lock fill="neutral500" />
                    ) : (
                      <Checkbox
                        checked={selected.has(file.id)}
                        onCheckedChange={() => toggle(file.id)}
                        aria-label={t("toolbar.selectFile", "Select {name}", { name: file.name })}
                      />
                    )}
                  </Box>
                  <RowPreview file={file} />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Typography fontWeight="bold" ellipsis>
                      {file.name}
                    </Typography>
                    {referenced && (
                      <Typography variant="pi" textColor="warning600" ellipsis>
                        {t("card.referencedIn", "Referenced in {where}", { where: refLabel(file) })}
                      </Typography>
                    )}
                  </Box>
                  <CardBadge>{typeLabel(file.mime)}</CardBadge>
                  {file.ignored && <CardBadge>{t("badge.ignored", "Ignored")}</CardBadge>}
                  {referenced && <CardBadge>{t("badge.referenced", "Referenced")}</CardBadge>}
                  <Box minWidth="80px">
                    <Typography variant="pi" textColor="neutral600">
                      {formatSize(file.size)}
                    </Typography>
                  </Box>
                  {canIgnore && !referenced && (
                    <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      {file.ignored ? (
                        <IconButton label={t("action.restore", "Restore (stop ignoring)")} onClick={() => handleRestore(file)}>
                          <ArrowClockwise />
                        </IconButton>
                      ) : (
                        <IgnoreMenu
                          file={file}
                          onIgnore={() => handleIgnore(file)}
                          onIgnoreFolder={() => file.folder && handleIgnoreFolder(file.folder)}
                        />
                      )}
                    </Box>
                  )}
                </Flex>
              );
            })}
          </Flex>
        )}

        {files.length > 0 && (
          <Flex justifyContent="space-between" alignItems="center" paddingTop={4}>
            <Flex gap={2} alignItems="center">
              <SingleSelect
                size="S"
                aria-label={t("pagination.entriesPerPage", "Entries per page")}
                value={String(pageSize)}
                onChange={(value: string | number) =>
                  setQuery({ pageSize: String(value), page: "1" })
                }
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SingleSelectOption key={option} value={option}>
                    {option}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
              <Typography textColor="neutral600">
                {t("pagination.entriesPerPage", "Entries per page")}
              </Typography>
            </Flex>
            {pageCount > 1 && (
              <Pagination.Root pageCount={pageCount} total={total} defaultPageSize={pageSize}>
                <Pagination.Links />
              </Pagination.Root>
            )}
          </Flex>
        )}
      </Layouts.Content>
    </Page.Main>
  );
};

export { HomePage };
