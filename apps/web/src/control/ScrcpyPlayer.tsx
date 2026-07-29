import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";

type HelloMsg = {
  type: "hello";
  mode: "h264" | "mock";
  mock?: boolean;
  width: number;
  height: number;
  deviceName?: string;
};

type Props = {
  serial: string;
  active: boolean;
  onError?: (message: string) => void;
  onStatus?: (status: "connecting" | "live" | "idle" | "error") => void;
};

function isKeyframeAnnexB(data: Uint8Array): boolean {
  let i = 0;
  while (i + 4 < data.length) {
    let sc = 0;
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) sc = 3;
    else if (
      data[i] === 0 &&
      data[i + 1] === 0 &&
      data[i + 2] === 0 &&
      data[i + 3] === 1
    )
      sc = 4;
    if (!sc) {
      i += 1;
      continue;
    }
    const nalType = data[i + sc]! & 0x1f;
    if (nalType === 5 || nalType === 7) return true;
    i += sc + 1;
  }
  return false;
}

function wsUrl(serial: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/scrcpy/ws?serial=${encodeURIComponent(serial)}`;
}

/** scrcpy H.264 / Mock 画面播放器（开关打开后才连接） */
export default function ScrcpyPlayer({
  serial,
  active,
  onError,
  onStatus,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hint, setHint] = useState("正在连接 scrcpy…");
  const tsRef = useRef(0);
  const onErrorRef = useRef(onError);
  const onStatusRef = useRef(onStatus);
  onErrorRef.current = onError;
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (!active || !serial) {
      setHint("");
      return;
    }

    let closed = false;
    let ws: WebSocket | null = null;
    let decoder: VideoDecoder | null = null;
    let mode: "h264" | "mock" = "h264";
    let raf = 0;

    onStatusRef.current?.("connecting");
    setHint("正在连接 scrcpy…");

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    const drawMock = (t: number) => {
      if (!canvas || !ctx) return;
      const w = canvas.width || 360;
      const h = canvas.height || 640;
      if (!canvas.width) {
        canvas.width = w;
        canvas.height = h;
      }
      const g = ctx.createLinearGradient(0, 0, w, h);
      const phase = (t / 1000) % 1;
      g.addColorStop(0, `hsl(${160 + phase * 40}, 35%, 18%)`);
      g.addColorStop(1, `hsl(${190 + phase * 30}, 40%, 12%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(215,226,236,0.85)";
      ctx.font = "600 14px IBM Plex Sans, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Mock 实时画面", w / 2, h / 2 - 8);
      ctx.font = "12px IBM Plex Sans, sans-serif";
      ctx.fillStyle = "rgba(215,226,236,0.45)";
      ctx.fillText(serial, w / 2, h / 2 + 14);
    };

    const ensureDecoder = () => {
      if (decoder || typeof VideoDecoder === "undefined") return decoder;
      decoder = new VideoDecoder({
        output: (frame) => {
          if (!canvas || !ctx || closed) {
            frame.close();
            return;
          }
          if (canvas.width !== frame.displayWidth) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
          }
          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          frame.close();
        },
        error: (e) => {
          onErrorRef.current?.(e.message || "视频解码失败");
          onStatusRef.current?.("error");
        },
      });
      decoder.configure({
        codec: "avc1.42E01E",
        optimizeForLatency: true,
      });
      return decoder;
    };

    ws = new WebSocket(wsUrl(serial));
    ws.binaryType = "arraybuffer";

    ws.onmessage = (ev) => {
      if (closed) return;
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data) as
            | HelloMsg
            | { type: "error"; message: string }
            | { type: "tick"; t: number; width: number; height: number };
          if (msg.type === "hello") {
            mode = msg.mode;
            if (canvas && msg.width > 0) {
              canvas.width = msg.width;
              canvas.height = msg.height;
            } else if (canvas && msg.mode === "mock") {
              canvas.width = 360;
              canvas.height = 640;
            }
            setHint("");
            onStatusRef.current?.("live");
            if (mode === "mock") {
              const loop = (ts: number) => {
                drawMock(ts);
                raf = requestAnimationFrame(loop);
              };
              raf = requestAnimationFrame(loop);
            }
            return;
          }
          if (msg.type === "error") {
            setHint(msg.message);
            onErrorRef.current?.(msg.message);
            onStatusRef.current?.("error");
            return;
          }
        } catch {
          /* ignore */
        }
        return;
      }

      const buf = new Uint8Array(ev.data as ArrayBuffer);
      if (buf.length < 2 || buf[0] !== 1) return;
      const payload = buf.subarray(1);
      const dec = ensureDecoder();
      if (!dec || dec.state === "closed") return;
      tsRef.current += 1;
      try {
        dec.decode(
          new EncodedVideoChunk({
            type: isKeyframeAnnexB(payload) ? "key" : "delta",
            timestamp: tsRef.current * 1000,
            data: payload,
          }),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        onErrorRef.current?.(message);
      }
    };

    ws.onerror = () => {
      setHint("WebSocket 连接失败");
      onStatusRef.current?.("error");
    };

    ws.onclose = () => {
      if (!closed) {
        setHint("投屏已断开");
        onStatusRef.current?.("idle");
      }
    };

    return () => {
      closed = true;
      cancelAnimationFrame(raf);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      try {
        decoder?.close();
      } catch {
        /* ignore */
      }
      // 不在 cleanup 里回调 idle，避免父组件重渲染时状态抖动导致整页闪烁
    };
  }, [active, serial]);

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100%", bgcolor: "#15202b" }}>
      <Box
        component="canvas"
        ref={canvasRef}
        width={360}
        height={640}
        sx={{
          width: "100%",
          height: "100%",
          display: "block",
          objectFit: "contain",
        }}
      />
      {hint ? (
        <Typography
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            px: 2,
            textAlign: "center",
            color: "rgba(215,226,236,0.55)",
            fontSize: "0.85rem",
            pointerEvents: "none",
          }}
        >
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}
