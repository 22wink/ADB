import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Box } from "@mui/material";

type Size = { w: number; h: number };
type Axis = "e" | "s" | "se";

type Props = {
  storageKey: string;
  defaultSize: Size;
  minSize?: Partial<Size>;
  maxSize?: Partial<Size>;
  /** 仅调高度时固定宽度为 100% */
  heightOnly?: boolean;
  children: ReactNode;
};

function loadSize(key: string, fallback: Size): Size {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Size>;
    const w = Number(parsed.w);
    const h = Number(parsed.h);
    return {
      w: Number.isFinite(w) ? w : fallback.w,
      h: Number.isFinite(h) ? h : fallback.h,
    };
  } catch {
    return fallback;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** 可拖拽调整大小的面板，尺寸写入 localStorage */
export default function ResizablePanel({
  storageKey,
  defaultSize,
  minSize,
  maxSize,
  heightOnly = false,
  children,
}: Props) {
  const minW = minSize?.w ?? 200;
  const minH = minSize?.h ?? 120;
  const maxW = maxSize?.w ?? 1200;
  const maxH = maxSize?.h ?? 900;

  const [size, setSize] = useState<Size>(() =>
    loadSize(storageKey, defaultSize),
  );
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const drag = useRef<{
    axis: Axis;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(size));
  }, [storageKey, size]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      e.preventDefault();
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      const nextW =
        heightOnly || d.axis === "s"
          ? d.w
          : clamp(d.w + dx, minW, maxW);
      const nextH =
        d.axis === "e" ? d.h : clamp(d.h + dy, minH, maxH);
      setSize({ w: nextW, h: nextH });
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [heightOnly, minW, maxW, minH, maxH]);

  const startDrag = useCallback((axis: Axis, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = sizeRef.current;
    drag.current = {
      axis,
      x: e.clientX,
      y: e.clientY,
      w: cur.w,
      h: cur.h,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      axis === "e" ? "ew-resize" : axis === "s" ? "ns-resize" : "nwse-resize";
  }, []);

  const handleSx = {
    position: "absolute" as const,
    zIndex: 3,
    touchAction: "none",
    bgcolor: "transparent",
  };

  return (
    <Box
      sx={{
        position: "relative",
        width: heightOnly ? "100%" : size.w,
        height: size.h,
        maxWidth: "100%",
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "background.paper",
        flexShrink: 0,
        // 避免拖到图片时触发浏览器原生拖拽
        WebkitUserDrag: "none",
        userSelect: "none",
      }}
    >
      <Box
        sx={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          pointerEvents: "auto",
          "& img": {
            WebkitUserDrag: "none",
            userSelect: "none",
            pointerEvents: "none",
          },
        }}
      >
        {children}
      </Box>

      {heightOnly ? (
        <Box
          title="拖拽调整高度"
          onPointerDown={(e) => startDrag("s", e)}
          sx={{
            ...handleSx,
            left: 0,
            right: 0,
            bottom: 0,
            height: 12,
            cursor: "ns-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            "&::after": {
              content: '""',
              width: 40,
              height: 4,
              borderRadius: 2,
              bgcolor: "rgba(13, 122, 111, 0.45)",
            },
            "&:hover::after": { bgcolor: "primary.main" },
          }}
        />
      ) : (
        <>
          {/* 右边：调宽 */}
          <Box
            title="拖拽调整宽度"
            onPointerDown={(e) => startDrag("e", e)}
            sx={{
              ...handleSx,
              top: 0,
              right: 0,
              width: 10,
              bottom: 14,
              cursor: "ew-resize",
              "&:hover": { bgcolor: "rgba(13, 122, 111, 0.12)" },
            }}
          />
          {/* 底边：调高 */}
          <Box
            title="拖拽调整高度"
            onPointerDown={(e) => startDrag("s", e)}
            sx={{
              ...handleSx,
              left: 0,
              bottom: 0,
              height: 10,
              right: 14,
              cursor: "ns-resize",
              "&:hover": { bgcolor: "rgba(13, 122, 111, 0.12)" },
            }}
          />
          {/* 右下角：同时调宽高 */}
          <Box
            title="拖拽调整大小"
            onPointerDown={(e) => startDrag("se", e)}
            sx={{
              ...handleSx,
              right: 0,
              bottom: 0,
              width: 18,
              height: 18,
              cursor: "nwse-resize",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-end",
              "&::after": {
                content: '""',
                width: 12,
                height: 12,
                m: 0.5,
                borderRight: "2px solid rgba(13, 122, 111, 0.65)",
                borderBottom: "2px solid rgba(13, 122, 111, 0.65)",
                borderRadius: "0 0 2px 0",
              },
              "&:hover::after": { borderColor: "primary.main" },
            }}
          />
        </>
      )}
    </Box>
  );
}
