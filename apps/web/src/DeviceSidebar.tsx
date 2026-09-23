import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  CircularProgress,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import {
  api,
  type Device,
  type LanHost,
  type SavedDevice,
} from "./api";

type Props = {
  serial: string;
  setSerial: (s: string) => void;
  devices: Device[];
  history: SavedDevice[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  run: (action: () => Promise<unknown>, okMsg: string) => Promise<void>;
  setHistory: (h: SavedDevice[]) => void;
};

function HistoryDeviceCard({
  device,
  busy,
  onRefresh,
  run,
  setHistory,
  setSerial,
  setWifiAddr,
}: {
  device: SavedDevice;
  busy: boolean;
  onRefresh: () => Promise<void>;
  run: (action: () => Promise<unknown>, okMsg: string) => Promise<void>;
  setHistory: (h: SavedDevice[]) => void;
  setSerial: (s: string) => void;
  setWifiAddr: (s: string) => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(device.note ?? "");

  useEffect(() => {
    setNoteDraft(device.note ?? "");
    setEditingNote(false);
  }, [device.id, device.note]);

  async function finishNoteEdit() {
    const next = noteDraft.trim();
    setEditingNote(false);
    if (next === (device.note ?? "").trim()) {
      setNoteDraft(device.note ?? "");
      return;
    }
    await run(async () => {
      const r = await api.updateHistory(device.id, { note: next });
      setHistory(r.history);
    }, "备注已保存");
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        borderColor: device.pinned ? "warning.main" : undefined,
        bgcolor: device.pinned ? "action.hover" : undefined,
      }}
    >
      <Stack direction="row" alignItems="flex-start" spacing={0.5}>
        <Box
          onClick={() => {
            if (device.address) setWifiAddr(device.address);
            setSerial(device.serial);
          }}
          sx={{ cursor: "pointer", flex: 1, minWidth: 0 }}
        >
          <Typography variant="body2" fontWeight={600} noWrap>
            {device.model || device.serial}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {device.serial}
            {device.address ? ` · ${device.address}` : ""}
            {` · ${device.transport === "wifi" ? "Wi‑Fi" : "USB"}`}
          </Typography>
        </Box>
        <Tooltip title={device.pinned ? "取消固定" : "固定"}>
          <IconButton
            size="small"
            color={device.pinned ? "warning" : "default"}
            disabled={busy}
            aria-label={device.pinned ? "取消固定" : "固定"}
            onClick={() =>
              run(async () => {
                const r = await api.updateHistory(device.id, {
                  pinned: !device.pinned,
                });
                setHistory(r.history);
              }, device.pinned ? "已取消固定" : "已固定")
            }
          >
            {device.pinned ? (
              <PushPinIcon fontSize="small" />
            ) : (
              <PushPinOutlinedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Stack>

      {editingNote ? (
        <TextField
          size="small"
          fullWidth
          autoFocus
          placeholder="输入备注…"
          value={noteDraft}
          disabled={busy}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => void finishNoteEdit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setNoteDraft(device.note ?? "");
              setEditingNote(false);
            }
          }}
          inputProps={{ maxLength: 200 }}
          sx={{ mt: 0.75, mb: 1 }}
        />
      ) : (
        <Typography
          variant="caption"
          color={device.note ? "text.secondary" : "text.disabled"}
          display="block"
          title="双击编辑备注"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (busy) return;
            setNoteDraft(device.note ?? "");
            setEditingNote(true);
          }}
          sx={{
            mt: 0.5,
            mb: 1,
            px: 0.25,
            py: 0.25,
            borderRadius: 0.5,
            cursor: "text",
            fontStyle: device.note ? "italic" : "normal",
            userSelect: "none",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          {device.note || "双击添加备注"}
        </Typography>
      )}

      <Stack direction="row" spacing={1}>
        {device.address ? (
          <Button
            variant="contained"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.connect(device.address!);
                await onRefresh();
                setSerial(device.address!);
              }, "已发起重连")
            }
          >
            重连
          </Button>
        ) : null}
        <Button
          color="error"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.forgetDevice(device.id);
              const r = await api.devices();
              setHistory(r.history);
            }, "已从历史移除")
          }
        >
          忘记
        </Button>
      </Stack>
    </Paper>
  );
}

export default function DeviceSidebar({
  serial,
  setSerial,
  devices,
  history,
  busy,
  onRefresh,
  run,
  setHistory,
}: Props) {
  const [wifiAddr, setWifiAddr] = useState("192.168.1.100:5555");
  const [pairAddr, setPairAddr] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [lanHosts, setLanHosts] = useState<LanHost[]>([]);
  const [subnets, setSubnets] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);

  const onlineIds = useMemo(
    () => new Set(devices.map((d) => d.serial)),
    [devices],
  );

  const historyOffline = useMemo(
    () =>
      history.filter((h) => !onlineIds.has(h.serial) && !onlineIds.has(h.id)),
    [history, onlineIds],
  );

  async function discover() {
    setScanning(true);
    try {
      const r = await api.lanDiscover();
      setLanHosts(r.hosts);
      setSubnets(r.subnets);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    api
      .lanSubnets()
      .then((r) => setSubnets(r.subnets))
      .catch(() => undefined);
  }, []);

  return (
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
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: 1.1, borderBottom: 1, borderColor: "divider" }}
      >
        <Typography variant="subtitle2">设备</Typography>
        <Button
          startIcon={<RefreshIcon />}
          disabled={busy}
          onClick={() => run(onRefresh, "已刷新")}
        >
          刷新
        </Button>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 2, py: 1.5 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 700, letterSpacing: "0.04em" }}
        >
          在线
        </Typography>
        {devices.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            暂无在线设备
          </Typography>
        ) : (
          <List dense disablePadding sx={{ mt: 0.5, mb: 1.5 }}>
            {devices.map((d) => (
              <ListItemButton
                key={d.serial}
                selected={d.serial === serial}
                onClick={() => setSerial(d.serial)}
                sx={{ borderRadius: 1.5, mb: 0.5, py: 1 }}
              >
                <ListItemText
                  primary={d.model || d.product || d.serial}
                  secondary={`${d.serial} · ${d.state}${d.serial.includes(":") ? " · Wi‑Fi" : " · USB"}`}
                  primaryTypographyProps={{
                    variant: "body2",
                    fontWeight: d.serial === serial ? 700 : 600,
                  }}
                  secondaryTypographyProps={{
                    variant: "caption",
                    sx: { fontFamily: "IBM Plex Mono, monospace" },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        )}

        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          历史记录
        </Typography>
        {historyOffline.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            连接过的设备会保存在这里
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mt: 0.5, mb: 1.5 }}>
            {historyOffline.map((h) => (
              <HistoryDeviceCard
                key={h.id}
                device={h}
                busy={busy}
                onRefresh={onRefresh}
                run={run}
                setHistory={setHistory}
                setSerial={setSerial}
                setWifiAddr={setWifiAddr}
              />
            ))}
          </Stack>
        )}

        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          局域网发现
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          扫描私网 5555 + ADB mDNS
          {subnets.length ? `（${subnets.join(", ")}）` : ""}
        </Typography>
        <Button
          variant="contained"
          fullWidth
          sx={{ mt: 1, mb: 1 }}
          disabled={busy || scanning}
          startIcon={scanning ? <CircularProgress size={14} color="inherit" /> : undefined}
          onClick={() =>
            run(async () => {
              await discover();
            }, "局域网扫描完成")
          }
        >
          {scanning ? "扫描中…" : "扫描局域网"}
        </Button>
        {lanHosts.length > 0 ? (
          <Stack spacing={1} sx={{ mb: 1.5 }}>
            {lanHosts.map((h) => (
              <Paper key={h.address} variant="outlined" sx={{ p: 1 }}>
                <Typography
                  variant="body2"
                  fontFamily="IBM Plex Mono, monospace"
                  fontSize="0.8rem"
                >
                  {h.address}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {h.source.join("+")}
                  {h.name ? ` · ${h.name}` : ""}
                </Typography>
                <Button
                  variant="contained"
                  sx={{ mt: 0.75 }}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      setWifiAddr(h.address);
                      await api.connect(h.address);
                      await onRefresh();
                      setSerial(h.address);
                    }, "已发起连接")
                  }
                >
                  连接
                </Button>
              </Paper>
            ))}
          </Stack>
        ) : null}

        <Divider sx={{ my: 1.5 }} />

        <TextField
          label="手动无线连接（host:port）"
          fullWidth
          value={wifiAddr}
          onChange={(e) => setWifiAddr(e.target.value)}
          placeholder="192.168.x.x:5555"
          sx={{ mb: 1 }}
        />
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.connect(wifiAddr);
                await onRefresh();
                setSerial(wifiAddr);
              }, "已发起连接")
            }
          >
            连接
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const target =
                  serial.includes(":") ? serial : wifiAddr;
                await api.disconnect(target);
                await onRefresh();
              }, "已断开")
            }
          >
            断开
          </Button>
        </Stack>

        <TextField
          label="配对地址（Android 11+）"
          fullWidth
          value={pairAddr}
          onChange={(e) => setPairAddr(e.target.value)}
          placeholder="配对 IP:端口"
          sx={{ mb: 1 }}
        />
        <TextField
          label="6 位配对码"
          fullWidth
          value={pairCode}
          onChange={(e) => setPairCode(e.target.value)}
          inputProps={{ maxLength: 6 }}
          sx={{ mb: 1 }}
        />
        <Button
          fullWidth
          disabled={busy || !pairAddr || pairCode.length !== 6}
          onClick={() =>
            run(async () => {
              await api.pair(pairAddr, pairCode);
            }, "配对完成，请再点连接")
          }
        >
          配对
        </Button>
      </Box>
    </Paper>
  );
}
