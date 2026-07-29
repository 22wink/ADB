import { createTheme } from "@mui/material/styles";

/** ADB Studio 青绿主题 */
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0d7a6f",
      dark: "#085c54",
      light: "#3a9e92",
      contrastText: "#ffffff",
    },
    secondary: { main: "#1a2332" },
    success: { main: "#157a3b" },
    warning: { main: "#b45309" },
    error: { main: "#b42318" },
    background: {
      default: "#e4ebf1",
      paper: "#ffffff",
    },
    text: {
      primary: "#1a2332",
      secondary: "#5a6a7d",
    },
    divider: "rgba(26, 35, 50, 0.1)",
  },
  typography: {
    fontFamily: '"IBM Plex Sans", "Segoe UI", sans-serif',
    h6: { fontWeight: 700, letterSpacing: "-0.03em" },
    subtitle2: { fontWeight: 700 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "html, body, #root": {
          height: "100dvh",
          overflow: "hidden",
        },
        body: {
          background:
            "radial-gradient(ellipse 70% 45% at 8% -8%, rgba(13,122,111,0.16), transparent 55%), radial-gradient(ellipse 50% 35% at 100% 0%, rgba(26,35,50,0.06), transparent 50%), linear-gradient(165deg, #d8e2ea 0%, #e8eef3 45%, #eef2f6 100%)",
          backgroundAttachment: "fixed",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(13, 122, 111, 0.35) transparent",
        },
        code: {
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        },
        "*::-webkit-scrollbar": { width: 8, height: 8 },
        "*::-webkit-scrollbar-track": { background: "transparent" },
        "*::-webkit-scrollbar-thumb": {
          backgroundColor: "rgba(13, 122, 111, 0.28)",
          borderRadius: 999,
          border: "2px solid transparent",
          backgroundClip: "padding-box",
        },
        "*::-webkit-scrollbar-thumb:hover": {
          backgroundColor: "rgba(13, 122, 111, 0.5)",
        },
        "*::-webkit-scrollbar-corner": { background: "transparent" },
        "*": {
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(13, 122, 111, 0.35) transparent",
        },
      },
    },
    MuiButton: {
      defaultProps: { size: "small", disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
    MuiTextField: {
      defaultProps: { size: "small", variant: "outlined" },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: "1px solid rgba(26, 35, 50, 0.1)",
          backgroundImage: "none",
          boxShadow: "0 8px 28px rgba(26, 35, 50, 0.06)",
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: "transparent" },
      styleOverrides: {
        root: {
          borderBottom: "1px solid rgba(26, 35, 50, 0.08)",
          backgroundColor: "rgba(255, 255, 255, 0.82)",
          backdropFilter: "blur(12px)",
          color: "#1a2332",
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 44,
          textTransform: "none",
          fontWeight: 600,
          color: "#5a6a7d",
          "&.Mui-selected": { color: "#0d7a6f" },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { backgroundColor: "#0d7a6f" },
      },
    },
    MuiChip: {
      defaultProps: { size: "small" },
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          "&.Mui-selected": {
            backgroundColor: "rgba(13, 122, 111, 0.12)",
            "&:hover": { backgroundColor: "rgba(13, 122, 111, 0.16)" },
          },
        },
      },
    },
  },
});
