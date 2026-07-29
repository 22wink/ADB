import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import RefreshIcon from "@mui/icons-material/Refresh";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import ViewComfyIcon from "@mui/icons-material/ViewComfy";
import ViewListIcon from "@mui/icons-material/ViewList";
import TableRowsIcon from "@mui/icons-material/TableRows";
import { api, type RemoteEntry } from "./api";

type ViewMode = "large" | "medium" | "list" | "details";
type SortKey = "name" | "size" | "type" | "mtime";
type TypeFilter = "all" | "folder" | "file" | "image" | "video" | "audio" | "doc";

const SHORTCUTS = [
  { label: "内部存储", path: "/sdcard" },
  { label: "Download", path: "/sdcard/Download" },
  { label: "DCIM", path: "/sdcard/DCIM" },
  { label: "Pictures", path: "/sdcard/Pictures" },
  { label: "Movies", path: "/sdcard/Movies" },
  { label: "Music", path: "/sdcard/Music" },
  { label: "Documents", path: "/sdcard/Documents" },
  { label: "tmp", path: "/data/local/tmp" },
] as const;

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "folder", label: "文件夹" },
  { id: "file", label: "文件" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
  { id: "doc", label: "文档" },
];

type Props = {
  serial: string;
  busy: boolean;
  run: (action: () => Promise<unknown>, okMsg: string) => Promise<void>;
};

function parentPath(p: string): string | null {
  if (p === "/sdcard" || p === "/storage" || p === "/data/local/tmp") return null;
  const i = p.lastIndexOf("/");
  if (i <= 0) return null;
  const parent = p.slice(0, i);
  if (parent === "/data/local" || parent === "/data" || parent === "/mnt") {
    return null;
  }
  return parent || null;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0) return "";
  return name.slice(i + 1).toLowerCase();
}

function kindOf(ent: RemoteEntry): TypeFilter {
  if (ent.isDir) return "folder";
  const e = extOf(ent.name);
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "svg"].includes(e)) {
    return "image";
  }
  if (["mp4", "mkv", "avi", "mov", "webm", "3gp"].includes(e)) return "video";
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg"].includes(e)) return "audio";
  if (
    ["pdf", "txt", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "md"].includes(
      e,
    )
  ) {
    return "doc";
  }
  return "file";
}

function formatSize(n?: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function typeLabel(ent: RemoteEntry): string {
  if (ent.isDir) return "文件夹";
  const e = extOf(ent.name);
  return e ? e.toUpperCase() + " 文件" : "文件";
}

function loadView(): ViewMode {
  const v = localStorage.getItem("adb-fs-view");
  if (v === "large" || v === "medium" || v === "list" || v === "details") return v;
  return "details";
}

export default function FileManager({ serial, busy, run }: Props) {
  const [cwd, setCwd] = useState("/sdcard");
  const [address, setAddress] = useState("/sdcard");
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newDir, setNewDir] = useState("");
  const [view, setView] = useState<ViewMode>(loadView);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  async function load(path = cwd) {
    setLoading(true);
    setError("");
    setSelected("");
    try {
      const r = await api.fsList(path, serial);
      setCwd(r.path);
      setAddress(r.path);
      setEntries(r.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "列出目录失败");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("/sdcard");
  }, [serial]);

  useEffect(() => {
    localStorage.setItem("adb-fs-view", view);
  }, [view]);

  const up = parentPath(cwd);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = entries.filter((ent) => {
      if (q && !ent.name.toLowerCase().includes(q)) return false;
      if (typeFilter === "all") return true;
      if (typeFilter === "file") return !ent.isDir;
      return kindOf(ent) === typeFilter;
    });

    list = [...list].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name, "zh");
      else if (sortKey === "size") cmp = (a.size ?? -1) - (b.size ?? -1);
      else if (sortKey === "type") {
        cmp = typeLabel(a).localeCompare(typeLabel(b), "zh");
      } else {
        cmp = (a.mtime ?? "").localeCompare(b.mtime ?? "");
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [entries, query, typeFilter, sortKey, sortAsc]);

  const selectedEntry = visible.find((e) => e.path === selected);

  function changeSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function openEntry(ent: RemoteEntry) {
    if (ent.isDir) load(ent.path);
    else setSelected(ent.path);
  }

  const sortMark = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "168px 1fr" },
        gap: 1.5,
        height: "100%",
        minHeight: 0,
      }}
    >
      <Paper
        variant="outlined"
        sx={{ p: 1, overflow: "auto", minHeight: 0, display: { xs: "none", md: "block" } }}
      >
        <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ px: 1 }}>
          快速访问
        </Typography>
        <List dense disablePadding>
          {SHORTCUTS.map((s) => (
            <ListItemButton
              key={s.path}
              selected={cwd === s.path || cwd.startsWith(s.path + "/")}
              disabled={busy || loading}
              onClick={() => load(s.path)}
              sx={{ borderRadius: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <FolderIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText primary={s.label} primaryTypographyProps={{ variant: "body2" }} />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      <Box
        sx={{
          display: "grid",
          gridTemplateRows: "auto auto auto 1fr auto",
          gap: 1,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <IconButton size="small" disabled={!up || busy || loading} onClick={() => up && load(up)}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" disabled={busy || loading} onClick={() => load(cwd)}>
            <RefreshIcon fontSize="small" />
          </IconButton>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={view}
            onChange={(_, v) => v && setView(v)}
          >
            <ToggleButton value="large" title="大图标">
              <ViewModuleIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="medium" title="中图标">
              <ViewComfyIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="list" title="列表">
              <ViewListIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="details" title="详细信息">
              <TableRowsIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel>类型</InputLabel>
            <Select
              label="类型"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            >
              {TYPE_FILTERS.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            placeholder="筛选名称…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
          />
        </Stack>

        <Stack
          component="form"
          direction="row"
          spacing={1}
          alignItems="center"
          onSubmit={(e) => {
            e.preventDefault();
            const next = address.trim() || "/sdcard";
            load(next.startsWith("/") ? next : "/" + next);
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            地址
          </Typography>
          <TextField
            size="small"
            fullWidth
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            inputProps={{ spellCheck: false }}
            sx={{
              "& input": { fontFamily: "IBM Plex Mono, monospace", fontSize: "0.84rem" },
            }}
          />
          <Button type="submit" disabled={busy || loading}>
            转到
          </Button>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            disabled={busy || loading}
            onClick={() => uploadRef.current?.click()}
          >
            上传
          </Button>
          <input
            ref={uploadRef}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              run(async () => {
                await api.fsUpload(file, cwd, serial);
                await load(cwd);
              }, "上传完成");
            }}
          />
          <TextField
            size="small"
            placeholder="新建文件夹名"
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            inputProps={{ maxLength: 120 }}
            sx={{ flex: 1, minWidth: 120 }}
          />
          <Button
            disabled={busy || loading || !newDir.trim()}
            onClick={() => {
              const name = newDir.trim();
              if (!name || name.includes("/") || name.includes("\\")) return;
              const remote = cwd.replace(/\/$/, "") + "/" + name;
              run(async () => {
                await api.fsMkdir(remote, serial);
                setNewDir("");
                await load(cwd);
              }, "文件夹已创建");
            }}
          >
            新建文件夹
          </Button>
          {selectedEntry && !selectedEntry.isDir ? (
            <Button
              href={api.fsDownloadUrl(selectedEntry.path, serial)}
              download={selectedEntry.name}
            >
              下载
            </Button>
          ) : null}
          {selectedEntry ? (
            <Button
              color="error"
              disabled={busy || loading}
              onClick={() => setConfirmDelete(true)}
            >
              删除
            </Button>
          ) : null}
        </Stack>

        <Paper
          variant="outlined"
          sx={{ overflow: "auto", minHeight: 0, p: view === "details" ? 0 : 1 }}
        >
          {loading ? (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 4 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : null}
          {error ? (
            <Typography color="error" variant="body2" sx={{ p: 2 }}>
              {error}
            </Typography>
          ) : null}
          {!loading && visible.length === 0 && !error ? (
            <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>
              没有匹配的项目
            </Typography>
          ) : null}

          {view === "details" && !loading ? (
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {(
                    [
                      ["name", "名称"],
                      ["mtime", "修改日期"],
                      ["type", "类型"],
                      ["size", "大小"],
                    ] as const
                  ).map(([key, label]) => (
                    <TableCell key={key}>
                      <Button size="small" onClick={() => changeSort(key)}>
                        {label}
                        {sortMark(key)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((ent) => (
                  <TableRow
                    key={ent.path}
                    hover
                    selected={selected === ent.path}
                    onClick={() => setSelected(ent.path)}
                    onDoubleClick={() => openEntry(ent)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        {ent.isDir ? (
                          <FolderIcon fontSize="small" color="primary" />
                        ) : (
                          <InsertDriveFileIcon fontSize="small" color="action" />
                        )}
                        {ent.name}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ fontFamily: "IBM Plex Mono, monospace", fontSize: "0.78rem" }}>
                      {ent.mtime || "—"}
                    </TableCell>
                    <TableCell>{typeLabel(ent)}</TableCell>
                    <TableCell sx={{ fontFamily: "IBM Plex Mono, monospace", fontSize: "0.78rem" }}>
                      {ent.isDir ? "" : formatSize(ent.size)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          {view !== "details" && !loading ? (
            <Box
              sx={{
                display: view === "list" ? "flex" : "grid",
                flexDirection: view === "list" ? "column" : undefined,
                gridTemplateColumns:
                  view === "large"
                    ? "repeat(auto-fill, minmax(110px, 1fr))"
                    : view === "medium"
                      ? "repeat(auto-fill, minmax(88px, 1fr))"
                      : undefined,
                gap: view === "list" ? 0.5 : 1,
              }}
            >
              {visible.map((ent) => (
                <Paper
                  key={ent.path}
                  variant="outlined"
                  onClick={() => setSelected(ent.path)}
                  onDoubleClick={() => openEntry(ent)}
                  sx={{
                    p: view === "list" ? 1 : 1.5,
                    cursor: "pointer",
                    textAlign: view === "list" ? "left" : "center",
                    display: view === "list" ? "flex" : "block",
                    alignItems: "center",
                    gap: 1,
                    bgcolor:
                      selected === ent.path ? "action.selected" : "background.paper",
                    borderColor:
                      selected === ent.path ? "primary.main" : "divider",
                  }}
                >
                  {ent.isDir ? (
                    <FolderIcon color="primary" sx={{ fontSize: view === "large" ? 40 : 28 }} />
                  ) : (
                    <InsertDriveFileIcon
                      color="action"
                      sx={{ fontSize: view === "large" ? 40 : 28 }}
                    />
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      mt: view === "list" ? 0 : 0.5,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: view === "list" ? "nowrap" : "normal",
                      wordBreak: "break-all",
                    }}
                  >
                    {ent.name}
                  </Typography>
                  {view === "list" ? (
                    <Typography variant="caption" color="text.secondary">
                      {ent.isDir ? "文件夹" : formatSize(ent.size)}
                    </Typography>
                  ) : null}
                </Paper>
              ))}
            </Box>
          ) : null}
        </Paper>

        <Stack direction="row" justifyContent="space-between" sx={{ px: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {visible.length} 个项目
            {query || typeFilter !== "all"
              ? `（已筛选，共 ${entries.length}）`
              : ""}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {selectedEntry ? selectedEntry.name : cwd}
          </Typography>
        </Stack>
      </Box>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {selectedEntry?.isDir
              ? `确认删除文件夹及其内容？\n${selectedEntry.path}`
              : `确认删除文件？\n${selectedEntry?.path ?? ""}`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (!selectedEntry) return;
              setConfirmDelete(false);
              run(async () => {
                await api.fsDelete(
                  selectedEntry.path,
                  selectedEntry.isDir,
                  serial,
                );
                await load(cwd);
              }, "已删除");
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
