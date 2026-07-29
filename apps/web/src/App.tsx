import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppBar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Typography,
  Collapse,
  ButtonGroup,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PhoneAndroidIcon from "@mui/icons-material/PhoneAndroid";
import {
  api,
  type Device,
  type PackageInfo,
  type PackageScope,
  type SavedDevice,
} from "./api";
import { DETAIL_GROUPS, PRIMARY_PROPS } from "./deviceProps";
import FileManager from "./FileManager";
import DeviceSidebar from "./DeviceSidebar";
import PropTable from "./PropTable";
import ResizablePanel from "./ResizablePanel";
import PhoneRemote from "./control/PhoneRemote";
import NotificationCenter, {
  type Notice,
  type NoticeLevel,
} from "./NotificationCenter";

type TabId =
  | "overview"
  | "files"
  | "apps"
  | "install"
  | "screen"
  | "logcat";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "files", label: "文件" },
  { id: "apps", label: "应用" },
  { id: "install", label: "安装 APK" },
  { id: "screen", label: "屏幕" },
  { id: "logcat", label: "Logcat" },
];

type ConfirmState = {
  title: string;
  body: string;
  onOk: () => void;
} | null;

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [history, setHistory] = useState<SavedDevice[]>([]);
  const [serial, setSerial] = useState("");
  const [healthy, setHealthy] = useState(false);
  const [mockMode, setMockMode] = useState(false);
  const [version, setVersion] = useState("");
  const [tab, setTab] = useState<TabId>("overview");
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [toast, setToast] = useState<Notice | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [props, setProps] = useState<Record<string, string>>({});
  const [propsExpanded, setPropsExpanded] = useState(false);
  const [showAllRaw, setShowAllRaw] = useState(false);
  const [propFilter, setPropFilter] = useState("");
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [pkgFilter, setPkgFilter] = useState("");
  const [pkgScope, setPkgScope] = useState<PackageScope>("third");
  const [shotUrl, setShotUrl] = useState("");
  const [logText, setLogText] = useState("");
  const [inputText, setInputText] = useState("");
  const [apk, setApk] = useState<File | null>(null);
  const [installMode, setInstallMode] = useState<"normal" | "replace" | "clean">(
    "replace",
  );
  const [installPkg, setInstallPkg] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const selected = useMemo(
    () => devices.find((d) => d.serial === serial),
    [devices, serial],
  );

  const notify = useCallback((text: string, error = false) => {
    const level: NoticeLevel = error ? "error" : "success";
    const item: Notice = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      level,
      at: Date.now(),
      read: false,
    };
    setNotices((prev) => [item, ...prev].slice(0, 200));
    setToast(item);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const markAllRead = useCallback(() => {
    setNotices((prev) =>
      prev.some((n) => !n.read) ? prev.map((n) => ({ ...n, read: true })) : prev,
    );
  }, []);

  const clearNotices = useCallback(() => {
    setNotices([]);
    setToast(null);
  }, []);

  async function refreshDevices() {
    const [{ devices: list, history: hist }, health] = await Promise.all([
      api.devices(),
      api.health(),
    ]);
    setDevices(list);
    setHistory(hist ?? []);
    setHealthy(health.ok);
    setMockMode(Boolean(health.mock));
    setVersion(health.version.split("\n")[0] ?? "");
    // 用函数式更新，避免定时刷新闭包里的旧 serial 把选中项打回第一台
    setSerial((current) => {
      if (!current && list[0]) return list[0].serial;
      if (current && !list.some((d) => d.serial === current) && list[0]) {
        return list[0].serial;
      }
      return current;
    });
  }

  useEffect(() => {
    refreshDevices().catch((e: Error) => notify(e.message, true));
    const t = window.setInterval(() => {
      refreshDevices().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!serial || tab !== "overview") return;
    setPropsExpanded(false);
    setShowAllRaw(false);
    setPropFilter("");
    api
      .props(serial)
      .then((r) => setProps(r.props))
      .catch((e: Error) => notify(e.message, true));
  }, [serial, tab]);

  const knownKeys = useMemo(() => {
    const s = new Set<string>();
    for (const p of PRIMARY_PROPS) s.add(p.key);
    for (const g of DETAIL_GROUPS) for (const p of g.items) s.add(p.key);
    return s;
  }, []);

  const rawProps = useMemo(() => {
    const q = propFilter.trim().toLowerCase();
    return Object.entries(props)
      .filter(([k]) => !knownKeys.has(k))
      .filter(([k, v]) => {
        if (!q) return true;
        return k.toLowerCase().includes(q) || v.toLowerCase().includes(q);
      })
      .sort(([a], [b]) => a.localeCompare(b));
  }, [props, knownKeys, propFilter]);

  useEffect(() => {
    if (!serial || tab !== "apps") return;
    api
      .packages(serial, pkgScope)
      .then((r) => setPackages(r.packages))
      .catch((e: Error) => notify(e.message, true));
  }, [serial, tab, pkgScope]);

  async function run(
    action: () => Promise<unknown>,
    okMsg: string,
    opts?: { lockUi?: boolean; toastOk?: boolean },
  ) {
    const lockUi = opts?.lockUi !== false;
    const toastOk = opts?.toastOk !== false;
    if (lockUi) setBusy(true);
    try {
      await action();
      if (toastOk) notify(okMsg);
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作失败", true);
    } finally {
      if (lockUi) setBusy(false);
    }
  }

  const filteredPkgs = packages.filter((p) => {
    const q = pkgFilter.trim().toLowerCase();
    if (!q) return true;
    const hay = [
      p.packageName,
      p.label,
      p.versionName,
      p.versionCode,
      p.installer,
    ]
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });

  function installerLabel(installer?: string) {
    if (!installer) return "未知来源";
    if (installer.includes("vending")) return "Play 商店";
    if (installer.includes("packageinstaller")) return "本地安装器";
    if (installer === "com.android.shell" || installer === "adb") return "ADB";
    if (installer.includes("market") || installer.includes("store")) {
      return "应用商店";
    }
    return installer;
  }

  function shortPath(p?: string) {
    if (!p) return "";
    if (p.length <= 48) return p;
    return `…${p.slice(-46)}`;
  }

  function askConfirm(title: string, body: string, onOk: () => void) {
    setConfirm({ title, body, onOk });
  }

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        maxWidth: 1280,
        mx: "auto",
        width: "100%",
      }}
    >
      <AppBar position="static">
        <Toolbar variant="dense" sx={{ gap: 1.25, minHeight: 58, px: { xs: 1.5, md: 2 } }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mr: 0.5 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1.5,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                display: "grid",
                placeItems: "center",
              }}
            >
              <PhoneAndroidIcon sx={{ fontSize: 18 }} />
            </Box>
            <Typography variant="h6" component="div" sx={{ lineHeight: 1.1 }}>
              ADB{" "}
              <Box component="span" sx={{ color: "primary.main" }}>
                Studio
              </Box>
            </Typography>
          </Stack>
          <Chip
            size="small"
            label={healthy ? "已就绪" : "未连接"}
            color={healthy ? "success" : "warning"}
            variant="outlined"
          />
          {mockMode ? <Chip size="small" label="MOCK" color="warning" /> : null}
          {version ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: { xs: "none", lg: "block" },
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {version}
            </Typography>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button
            startIcon={<RefreshIcon />}
            disabled={busy}
            onClick={() => run(refreshDevices, "设备列表已刷新")}
          >
            刷新设备
          </Button>
          <NotificationCenter
            items={notices}
            toast={toast}
            onMarkAllRead={markAllRead}
            onClear={clearNotices}
            onDismissToast={() => setToast(null)}
          />
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "300px 1fr" },
          gridTemplateRows: { xs: "minmax(180px, 32%) 1fr", md: "1fr" },
          gap: 1.5,
          p: 1.5,
          overflow: "hidden",
        }}
      >
        <DeviceSidebar
          serial={serial}
          setSerial={setSerial}
          devices={devices}
          history={history}
          setHistory={setHistory}
          busy={busy}
          onRefresh={refreshDevices}
          run={run}
        />

        <Paper
          sx={{
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            bgcolor: "background.paper",
          }}
        >
          <Box
            sx={{
              px: 2,
              borderBottom: 1,
              borderColor: "divider",
              flexShrink: 0,
            }}
          >
            <Tabs
              value={tab}
              onChange={(_, v: TabId) => setTab(v)}
              variant="scrollable"
              scrollButtons={false}
              allowScrollButtonsMobile
              sx={{
                minHeight: 44,
                "& .MuiTabs-scroller": { overflow: "auto !important" },
                "& .MuiTabs-flexContainer": { gap: 0.5 },
                "& .MuiTab-root": {
                  minHeight: 44,
                  px: 1.25,
                  py: 1,
                  "&:first-of-type": { pl: 0 },
                },
                "& .MuiTabs-indicator": {
                  height: 2,
                  borderRadius: "2px 2px 0 0",
                },
              }}
            >
              {TABS.map((t) => (
                <Tab key={t.id} value={t.id} label={t.label} disableRipple />
              ))}
            </Tabs>
          </Box>

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: tab === "files" ? "hidden" : "auto",
              px: 2,
              pt: 1.75,
              pb: 2,
              display: tab === "files" ? "flex" : "block",
              flexDirection: "column",
            }}
          >
            {!selected ? (
              <Typography color="text.secondary">请先选择一台在线设备。</Typography>
            ) : null}

            {tab === "overview" && selected ? (
              <Box>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.75,
                    mb: 2,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 1.5,
                    alignItems: "center",
                    boxShadow: "none",
                    bgcolor: "rgba(13, 122, 111, 0.04)",
                    borderColor: "rgba(13, 122, 111, 0.18)",
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 160 }}>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {props["ro.product.model"] ||
                        selected.model ||
                        selected.serial}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: "IBM Plex Mono, monospace" }}
                    >
                      {selected.serial}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {props["ro.build.version.release"] ? (
                      <Chip
                        label={`Android ${props["ro.build.version.release"]}`}
                        color="primary"
                        variant="outlined"
                      />
                    ) : null}
                    {props["battery.level"] ? (
                      <Chip label={`电量 ${props["battery.level"]}`} variant="outlined" />
                    ) : null}
                    {props["wm.size"] ? (
                      <Chip label={props["wm.size"]} variant="outlined" />
                    ) : null}
                    <Chip
                      label={selected.serial.includes(":") ? "Wi‑Fi" : "USB"}
                      variant="outlined"
                    />
                  </Stack>
                </Paper>

                <Stack
                  direction="row"
                  spacing={1}
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ mb: 2 }}
                >
                  <Button
                    color="error"
                    variant="outlined"
                    disabled={busy}
                    onClick={() =>
                      askConfirm("确认重启设备？", "设备将立即重启。", () =>
                        run(() => api.reboot("system", serial), "已发送重启"),
                      )
                    }
                  >
                    重启
                  </Button>
                  <Button
                    color="error"
                    variant="outlined"
                    disabled={busy}
                    onClick={() =>
                      askConfirm(
                        "确认进入 Bootloader？",
                        "设备将重启到 Bootloader。",
                        () =>
                          run(
                            () => api.reboot("bootloader", serial),
                            "已进入 Bootloader",
                          ),
                      )
                    }
                  >
                    Bootloader
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await api.props(serial);
                        setProps(r.props);
                      }, "设备信息已刷新")
                    }
                  >
                    刷新信息
                  </Button>
                </Stack>

                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  基本信息
                </Typography>
                <PropTable items={PRIMARY_PROPS} props={props} />

                <Button sx={{ mt: 1.5 }} onClick={() => setPropsExpanded((v) => !v)}>
                  {propsExpanded ? "收起详细信息" : "展开更多设备信息"}
                </Button>

                <Collapse in={propsExpanded}>
                  <Box sx={{ mt: 1.5 }}>
                    {DETAIL_GROUPS.map((group) => (
                      <Box key={group.titleEn} sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                          {group.titleZh}
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                            sx={{ ml: 1 }}
                          >
                            {group.titleEn}
                          </Typography>
                        </Typography>
                        <PropTable items={group.items} props={props} />
                      </Box>
                    ))}

                    <Button onClick={() => setShowAllRaw((v) => !v)}>
                      {showAllRaw
                        ? "隐藏全部原始属性"
                        : `显示全部原始属性 (${rawProps.length})`}
                    </Button>

                    <Collapse in={showAllRaw}>
                      <TextField
                        fullWidth
                        label="筛选属性"
                        value={propFilter}
                        onChange={(e) => setPropFilter(e.target.value)}
                        placeholder="ro.build / battery / ..."
                        sx={{ my: 1.5 }}
                      />
                      {rawProps.length === 0 ? (
                        <Typography color="text.secondary" variant="body2">
                          无匹配属性。
                        </Typography>
                      ) : (
                        <PropTable
                          items={rawProps.map(([k]) => ({
                            key: k,
                            zh: k,
                            en: k,
                          }))}
                          props={Object.fromEntries(rawProps)}
                        />
                      )}
                    </Collapse>
                  </Box>
                </Collapse>
              </Box>
            ) : null}

            {tab === "files" && selected ? (
              <Box sx={{ flex: 1, minHeight: 0 }}>
                <FileManager serial={serial} busy={busy} run={run} />
              </Box>
            ) : null}

            {tab === "apps" && selected ? (
              <Box>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ mb: 1.5 }}
                >
                  <ButtonGroup size="small">
                    {(
                      [
                        ["third", "第三方"],
                        ["system", "系统"],
                        ["all", "全部"],
                      ] as const
                    ).map(([id, label]) => (
                      <Button
                        key={id}
                        variant={pkgScope === id ? "contained" : "outlined"}
                        disabled={busy}
                        onClick={() => setPkgScope(id)}
                      >
                        {label}
                      </Button>
                    ))}
                  </ButtonGroup>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await api.packages(serial, pkgScope);
                        setPackages(r.packages);
                      }, "应用列表已更新")
                    }
                  >
                    刷新
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                    {filteredPkgs.length} 个
                  </Typography>
                </Stack>
                <TextField
                  fullWidth
                  label="搜索"
                  placeholder="名称 / 包名 / 版本 / 安装来源"
                  value={pkgFilter}
                  onChange={(e) => setPkgFilter(e.target.value)}
                  sx={{ mb: 1.5 }}
                />
                {filteredPkgs.length === 0 ? (
                  <Typography color="text.secondary">没有匹配的应用。</Typography>
                ) : (
                  <Stack spacing={1}>
                    {filteredPkgs.map((pkg) => (
                      <Paper key={pkg.packageName} variant="outlined" sx={{ p: 1.5 }}>
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1}
                          justifyContent="space-between"
                        >
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                              <Typography fontWeight={700}>
                                {pkg.label || pkg.packageName.split(".").pop()}
                              </Typography>
                              {pkg.versionName ? (
                                <Typography variant="body2" color="text.secondary">
                                  v{pkg.versionName}
                                  {pkg.versionCode ? ` (${pkg.versionCode})` : ""}
                                </Typography>
                              ) : null}
                              <Chip
                                label={pkg.system ? "系统" : "用户"}
                                color={pkg.system ? "default" : "success"}
                                variant="outlined"
                              />
                              {pkg.enabled === false ? (
                                <Chip label="已禁用" color="error" variant="outlined" />
                              ) : null}
                            </Stack>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontFamily: "IBM Plex Mono, monospace", display: "block" }}
                            >
                              {pkg.packageName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block">
                              {[
                                installerLabel(pkg.installer),
                                pkg.targetSdk ? `targetSdk ${pkg.targetSdk}` : null,
                                pkg.minSdk ? `minSdk ${pkg.minSdk}` : null,
                                pkg.uid ? `uid ${pkg.uid}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Typography>
                            {(pkg.firstInstallTime || pkg.lastUpdateTime) && (
                              <Typography variant="caption" color="text.secondary" display="block">
                                {[
                                  pkg.firstInstallTime
                                    ? `安装 ${pkg.firstInstallTime}`
                                    : null,
                                  pkg.lastUpdateTime
                                    ? `更新 ${pkg.lastUpdateTime}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </Typography>
                            )}
                            {pkg.apkPath ? (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                title={pkg.apkPath}
                                sx={{ fontFamily: "IBM Plex Mono, monospace" }}
                              >
                                {shortPath(pkg.apkPath)}
                              </Typography>
                            ) : null}
                          </Box>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => api.launch(pkg.packageName, serial),
                                  "已尝试启动",
                                )
                              }
                            >
                              启动
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () => api.forceStop(pkg.packageName, serial),
                                  "已强制停止",
                                )
                              }
                            >
                              停止
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                askConfirm(
                                  "清除应用数据？",
                                  `将清除 ${pkg.packageName} 的数据。`,
                                  () =>
                                    run(
                                      () => api.clearData(pkg.packageName, serial),
                                      "已清除数据",
                                    ),
                                )
                              }
                            >
                              清数据
                            </Button>
                            <Button
                              color="error"
                              disabled={busy || pkg.system}
                              onClick={() =>
                                askConfirm(
                                  "确认卸载？",
                                  `将卸载 ${pkg.packageName}。`,
                                  () =>
                                    run(async () => {
                                      await api.uninstall(pkg.packageName, serial);
                                      const r = await api.packages(serial, pkgScope);
                                      setPackages(r.packages);
                                    }, "已卸载"),
                                )
                              }
                            >
                              卸载
                            </Button>
                          </Stack>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Box>
            ) : null}

            {tab === "install" && selected ? (
              <Stack spacing={2} maxWidth={520}>
                <Button variant="outlined" component="label">
                  {apk ? apk.name : "选择 APK 文件"}
                  <input
                    type="file"
                    hidden
                    accept=".apk,application/vnd.android.package-archive"
                    onChange={(e) => setApk(e.target.files?.[0] ?? null)}
                  />
                </Button>

                <FormControl>
                  <FormLabel>安装方式</FormLabel>
                  <RadioGroup
                    value={installMode}
                    onChange={(e) =>
                      setInstallMode(
                        e.target.value as "normal" | "replace" | "clean",
                      )
                    }
                  >
                    <FormControlLabel
                      value="normal"
                      control={<Radio />}
                      label="普通安装 — 首次安装；已存在同包名会失败"
                    />
                    <FormControlLabel
                      value="replace"
                      control={<Radio />}
                      label="覆盖安装 — adb install -r，保留应用数据"
                    />
                    <FormControlLabel
                      value="clean"
                      control={<Radio />}
                      label="清空数据安装 — 先卸载（清数据）再安装"
                    />
                  </RadioGroup>
                </FormControl>

                {installMode === "clean" ? (
                  <TextField
                    label="包名（可选，解析失败时必填）"
                    placeholder="com.example.app"
                    value={installPkg}
                    onChange={(e) => setInstallPkg(e.target.value)}
                    helperText="若 APK 无法自动解析包名，请手动填写后再安装"
                  />
                ) : null}

                <Button
                  variant="contained"
                  disabled={busy || !apk}
                  onClick={() => {
                    if (!apk) return;
                    const tip =
                      installMode === "clean"
                        ? "清空数据安装将卸载同包名应用并清除数据，确认继续？"
                        : installMode === "normal"
                          ? "将以普通模式安装，若已安装会失败。"
                          : "将覆盖安装并保留原应用数据。";
                    askConfirm("确认安装", tip, () =>
                      run(
                        () =>
                          api.install(
                            apk,
                            serial,
                            installMode,
                            installPkg || undefined,
                          ),
                        installMode === "clean"
                          ? "清空数据安装完成"
                          : installMode === "normal"
                            ? "普通安装完成"
                            : "覆盖安装完成",
                      ),
                    );
                  }}
                >
                  安装到设备
                </Button>
              </Stack>
            ) : null}

            {tab === "screen" && selected ? (
              <PhoneRemote
                serial={serial}
                disabled={busy}
                shotUrl={shotUrl}
                onScreenshot={() =>
                  run(async () => {
                    const r = await api.screenshot(serial);
                    setShotUrl(r.url + "?t=" + Date.now());
                  }, "截图完成")
                }
                inputText={inputText}
                onInputTextChange={setInputText}
                onKey={(id, label) =>
                  run(() => api.inputKey(id, serial), "已发送 " + label, {
                    lockUi: false,
                    toastOk: false,
                  })
                }
                onSendText={() =>
                  run(() => api.inputText(inputText, serial), "已发送文本", {
                    lockUi: false,
                  })
                }
                onLiveError={(message) => notify(message, true)}
              />
            ) : null}

            {tab === "logcat" && selected ? (
              <Box
                sx={{
                  height: "100%",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                  <Button
                    variant="contained"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const text = await api.logcat(serial, 300);
                        setLogText(text);
                      }, "已拉取日志")
                    }
                  >
                    拉取日志
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.clearLogcat(serial);
                        setLogText("");
                      }, "已清空设备 logcat")
                    }
                  >
                    清空设备日志
                  </Button>
                </Stack>
                <ResizablePanel
                  storageKey="adb-studio-logcat-size"
                  defaultSize={{ w: 800, h: 420 }}
                  minSize={{ w: 200, h: 160 }}
                  maxSize={{ w: 2000, h: 900 }}
                  heightOnly
                >
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 1.5,
                      minHeight: "100%",
                      fontFamily: "IBM Plex Mono, monospace",
                      fontSize: "0.78rem",
                      lineHeight: 1.45,
                      bgcolor: "#15202b",
                      color: "#d7e2ec",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {logText || "点击「拉取日志」查看最近输出。"}
                  </Box>
                </ResizablePanel>
              </Box>
            ) : null}
          </Box>
        </Paper>
      </Box>

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)}>
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ whiteSpace: "pre-wrap" }}>
            {confirm?.body}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>取消</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              const fn = confirm?.onOk;
              setConfirm(null);
              fn?.();
            }}
          >
            确认
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
