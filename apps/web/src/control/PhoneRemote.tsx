import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import BackspaceOutlinedIcon from "@mui/icons-material/BackspaceOutlined";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import ScrcpyPlayer from "./ScrcpyPlayer";

export type RemoteKeyId =
  | "KEYCODE_HOME"
  | "KEYCODE_BACK"
  | "KEYCODE_APP_SWITCH"
  | "KEYCODE_POWER"
  | "KEYCODE_VOLUME_UP"
  | "KEYCODE_VOLUME_DOWN"
  | "KEYCODE_ENTER"
  | "KEYCODE_DEL";

const LIVE_KEY = "adb-studio-live-mirror";

type Props = {
  serial: string;
  disabled?: boolean;
  shotUrl?: string;
  onScreenshot: () => void;
  inputText: string;
  onInputTextChange: (v: string) => void;
  onKey: (id: RemoteKeyId, label: string) => void;
  onSendText: () => void;
  onLiveError?: (message: string) => void;
};

function SideBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip title={title} placement="left">
      <Box
        component="button"
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={title}
        sx={{
          all: "unset",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 36,
          borderRadius: "4px 0 0 4px",
          bgcolor: "#2a3544",
          color: "#c5d0dc",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.45 : 1,
          boxShadow: "inset -1px 0 0 rgba(255,255,255,0.06)",
          transition: "background .15s, transform .1s",
          "&:hover:not(:disabled)": { bgcolor: "#364556" },
          "&:active:not(:disabled)": { transform: "translateX(1px)" },
        }}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

const softKeySx = {
  flex: 1,
  minWidth: 0,
  py: 0.75,
  borderRadius: 1.5,
  bgcolor: "rgba(0,0,0,0.45)",
  color: "#e8eef3",
  border: "1px solid rgba(255,255,255,0.1)",
  fontSize: "0.75rem",
  "&:hover": { bgcolor: "rgba(13,122,111,0.55)" },
} as const;

/** 截图 + scrcpy 实时投屏（开关）+ 手机外形远程按键 */
export default function PhoneRemote({
  serial,
  disabled,
  shotUrl,
  onScreenshot,
  inputText,
  onInputTextChange,
  onKey,
  onSendText,
  onLiveError,
}: Props) {
  const [live, setLive] = useState(() => {
    try {
      return localStorage.getItem(LIVE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [liveStatus, setLiveStatus] = useState<
    "connecting" | "live" | "idle" | "error"
  >("idle");

  useEffect(() => {
    try {
      localStorage.setItem(LIVE_KEY, live ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [live]);

  useEffect(() => {
    if (!live) setLiveStatus("idle");
  }, [live]);

  const onStatus = useCallback(
    (s: "connecting" | "live" | "idle" | "error") => setLiveStatus(s),
    [],
  );

  const statusLabel =
    !live
      ? "已关闭"
      : liveStatus === "connecting"
        ? "连接中…"
        : liveStatus === "live"
          ? "直播中"
          : liveStatus === "error"
            ? "异常"
            : "待命";

  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={3}
      alignItems={{ xs: "center", md: "flex-start" }}
      sx={{ pb: 1 }}
    >
      <Stack alignItems="center" spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ alignSelf: { xs: "stretch", md: "center" }, width: "100%", maxWidth: 320 }}
        >
          <Button
            variant="contained"
            disabled={disabled || live}
            startIcon={<PhotoCameraIcon />}
            onClick={onScreenshot}
            sx={{ flex: 1 }}
          >
            立即截图
          </Button>
        </Stack>

        <FormControlLabel
          control={
            <Switch
              checked={live}
              disabled={disabled || !serial}
              onChange={(_, v) => setLive(v)}
              color="primary"
            />
          }
          label={
            <Typography variant="body2">
              实时投屏（scrcpy）· {statusLabel}
            </Typography>
          }
          sx={{ alignSelf: { xs: "flex-start", md: "center" }, ml: 0 }}
        />

        <Box sx={{ display: "flex", alignItems: "center", userSelect: "none" }}>
          <Stack spacing={1.25} sx={{ mr: "-2px", zIndex: 1, pt: 8 }}>
            <SideBtn
              title="音量+"
              disabled={disabled}
              onClick={() => onKey("KEYCODE_VOLUME_UP", "音量+")}
            >
              <AddIcon sx={{ fontSize: 14 }} />
            </SideBtn>
            <SideBtn
              title="音量-"
              disabled={disabled}
              onClick={() => onKey("KEYCODE_VOLUME_DOWN", "音量-")}
            >
              <RemoveIcon sx={{ fontSize: 14 }} />
            </SideBtn>
          </Stack>

          <Box
            sx={{
              width: 280,
              borderRadius: "36px",
              p: "10px",
              background:
                "linear-gradient(160deg, #2c3645 0%, #1a2332 45%, #121820 100%)",
              boxShadow:
                "0 18px 40px rgba(18, 24, 32, 0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
              position: "relative",
            }}
          >
            <Box
              sx={{
                position: "absolute",
                top: 18,
                left: "50%",
                transform: "translateX(-50%)",
                width: 88,
                height: 10,
                borderRadius: 999,
                bgcolor: "#0c1118",
                zIndex: 2,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
              }}
            />

            <Box
              sx={{
                borderRadius: "28px",
                overflow: "hidden",
                bgcolor: "#0e1620",
                height: 520,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  position: "relative",
                  bgcolor: "#15202b",
                }}
              >
                {live ? (
                  <ScrcpyPlayer
                    serial={serial}
                    active={live}
                    onError={onLiveError}
                    onStatus={onStatus}
                  />
                ) : shotUrl ? (
                  <Box
                    component="img"
                    src={shotUrl}
                    alt="设备截图"
                    draggable={false}
                    sx={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      display: "block",
                      pointerEvents: "none",
                      WebkitUserDrag: "none",
                    }}
                  />
                ) : (
                  <Stack
                    alignItems="center"
                    justifyContent="center"
                    sx={{ height: "100%", px: 3, textAlign: "center" }}
                  >
                    <Typography
                      sx={{ color: "rgba(215,226,236,0.45)", fontSize: "0.85rem" }}
                    >
                      截图或开启实时投屏
                    </Typography>
                  </Stack>
                )}

                {!live ? (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      position: "absolute",
                      left: 8,
                      right: 8,
                      bottom: 8,
                    }}
                  >
                    <Button
                      disabled={disabled}
                      onClick={() => onKey("KEYCODE_ENTER", "回车")}
                      startIcon={<KeyboardReturnIcon sx={{ fontSize: 16 }} />}
                      sx={softKeySx}
                    >
                      回车
                    </Button>
                    <Button
                      disabled={disabled}
                      onClick={() => onKey("KEYCODE_DEL", "删除")}
                      startIcon={<BackspaceOutlinedIcon sx={{ fontSize: 16 }} />}
                      sx={softKeySx}
                    >
                      删除
                    </Button>
                  </Stack>
                ) : null}
              </Box>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  alignItems: "center",
                  px: 1,
                  py: 1,
                  bgcolor: "rgba(0,0,0,0.55)",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  flexShrink: 0,
                }}
              >
                <Tooltip title="返回">
                  <span>
                    <IconButton
                      disabled={disabled}
                      onClick={() => onKey("KEYCODE_BACK", "返回")}
                      aria-label="返回"
                      sx={{ color: "#d7e2ec", mx: "auto", display: "flex" }}
                    >
                      <ArrowBackIosNewIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Home">
                  <span>
                    <IconButton
                      disabled={disabled}
                      onClick={() => onKey("KEYCODE_HOME", "Home")}
                      aria-label="Home"
                      sx={{ color: "#d7e2ec", mx: "auto", display: "flex" }}
                    >
                      <CircleOutlinedIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="多任务">
                  <span>
                    <IconButton
                      disabled={disabled}
                      onClick={() => onKey("KEYCODE_APP_SWITCH", "多任务")}
                      aria-label="多任务"
                      sx={{ color: "#d7e2ec", mx: "auto", display: "flex" }}
                    >
                      <CropSquareIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            </Box>
          </Box>

          <Box sx={{ ml: "-2px", zIndex: 1, pt: 10 }}>
            <Tooltip title="电源" placement="right">
              <Box
                component="button"
                type="button"
                disabled={disabled}
                onClick={() => onKey("KEYCODE_POWER", "电源")}
                aria-label="电源"
                sx={{
                  all: "unset",
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 56,
                  borderRadius: "0 4px 4px 0",
                  bgcolor: "#2a3544",
                  color: "#c5d0dc",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.45 : 1,
                  boxShadow: "inset 1px 0 0 rgba(255,255,255,0.06)",
                  transition: "background .15s, transform .1s",
                  "&:hover:not(:disabled)": { bgcolor: "#364556" },
                  "&:active:not(:disabled)": { transform: "translateX(-1px)" },
                }}
              >
                <PowerSettingsNewIcon sx={{ fontSize: 14 }} />
              </Box>
            </Tooltip>
          </Box>
        </Box>

        {live ? (
          <Stack direction="row" spacing={1} sx={{ width: "100%", maxWidth: 280 }}>
            <Button
              fullWidth
              disabled={disabled}
              onClick={() => onKey("KEYCODE_ENTER", "回车")}
              startIcon={<KeyboardReturnIcon />}
            >
              回车
            </Button>
            <Button
              fullWidth
              disabled={disabled}
              onClick={() => onKey("KEYCODE_DEL", "删除")}
              startIcon={<BackspaceOutlinedIcon />}
            >
              删除
            </Button>
          </Stack>
        ) : null}
      </Stack>

      <Box sx={{ width: "100%", maxWidth: 360, pt: { md: 5 } }}>
        <Typography color="text.secondary" variant="body2" sx={{ mb: 1.5 }}>
          默认关闭实时投屏。开启后经 scrcpy-server 推流（H.264 / WebCodecs）；关闭即断开并释放设备端进程。
        </Typography>
        <TextField
          fullWidth
          label="输入文本（最长 200 字）"
          value={inputText}
          onChange={(e) => onInputTextChange(e.target.value)}
          inputProps={{ maxLength: 200 }}
          sx={{ mb: 1.5 }}
        />
        <Button
          fullWidth
          variant="contained"
          disabled={disabled || !inputText.trim()}
          onClick={onSendText}
        >
          发送到设备
        </Button>
      </Box>
    </Stack>
  );
}
