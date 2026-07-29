import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Popover,
  Snackbar,
  Alert,
  Stack,
  Typography,
} from "@mui/material";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";

export type NoticeLevel = "info" | "success" | "error";

export type Notice = {
  id: string;
  text: string;
  level: NoticeLevel;
  at: number;
  read: boolean;
};

type Props = {
  items: Notice[];
  toast: Notice | null;
  onMarkAllRead: () => void;
  onClear: () => void;
  onDismissToast: () => void;
};

function formatTime(at: number) {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function NotificationCenter({
  items,
  toast,
  onMarkAllRead,
  onClear,
  onDismissToast,
}: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);
  const unread = items.reduce((n, x) => n + (x.read ? 0 : 1), 0);

  useEffect(() => {
    if (open) onMarkAllRead();
  }, [open, items, onMarkAllRead]);

  return (
    <>
      <IconButton
        color="inherit"
        aria-label="消息通知中心"
        onClick={(e) => setAnchor(e.currentTarget)}
        size="small"
      >
        <Badge badgeContent={unread} color="error" max={99}>
          <NotificationsNoneIcon />
        </Badge>
      </IconButton>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              width: 380,
              maxWidth: "calc(100vw - 24px)",
              maxHeight: "min(520px, calc(100dvh - 72px))",
              display: "flex",
              flexDirection: "column",
              mt: 1,
            },
          },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 1.5, py: 1 }}
        >
          <Typography variant="subtitle2" fontWeight={700}>
            消息中心
          </Typography>
          <Stack direction="row" spacing={0.5}>
            <IconButton size="small" title="全部已读" onClick={onMarkAllRead}>
              <DoneAllIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" title="清空" onClick={onClear}>
              <DeleteSweepIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>
        <Divider />
        <Box sx={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {items.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">
              暂无消息与操作日志
            </Typography>
          ) : (
            <List dense disablePadding>
              {items.map((n) => (
                <ListItem
                  key={n.id}
                  alignItems="flex-start"
                  sx={{
                    bgcolor: n.read ? "transparent" : "action.hover",
                    borderBottom: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" justifyContent="space-between" gap={1}>
                        <Typography
                          variant="caption"
                          color={
                            n.level === "error"
                              ? "error"
                              : n.level === "success"
                                ? "success.main"
                                : "text.secondary"
                          }
                          fontWeight={700}
                        >
                          {n.level === "error"
                            ? "错误"
                            : n.level === "success"
                              ? "成功"
                              : "消息"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatTime(n.at)}
                        </Typography>
                      </Stack>
                    }
                    secondary={
                      <Typography
                        variant="body2"
                        color="text.primary"
                        sx={{ mt: 0.5, wordBreak: "break-word" }}
                      >
                        {n.text}
                      </Typography>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>
        {items.length > 0 ? (
          <Box sx={{ p: 1, borderTop: "1px solid", borderColor: "divider" }}>
            <Button fullWidth size="small" onClick={onClear}>
              清空全部
            </Button>
          </Box>
        ) : null}
      </Popover>

      <Snackbar
        open={Boolean(toast) && !open}
        autoHideDuration={3200}
        onClose={(_, reason) => {
          if (reason === "clickaway") return;
          onDismissToast();
        }}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        sx={{ top: { xs: 56, sm: 64 } }}
      >
        {toast ? (
          <Alert
            severity={toast.level === "error" ? "error" : "success"}
            variant="filled"
            onClose={onDismissToast}
            sx={{ width: "100%", maxWidth: 360 }}
          >
            {toast.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
