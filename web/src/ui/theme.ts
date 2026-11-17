// MUI theme: the app's colour tokens as palette entries, light and dark.

import { createTheme, type Theme } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Palette {
    flow: { in: string; out: string };
    level: { high: string; mid: string; low: string };
    track: string;
    surface2: string;
  }
  interface PaletteOptions {
    flow?: { in: string; out: string };
    level?: { high: string; mid: string; low: string };
    track?: string;
    surface2?: string;
  }
}

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const tokens = {
  light: {
    bg: "#f4f5f7", paper: "#ffffff", surface2: "#f0f2f5", fg: "#15181d", muted: "#667085",
    border: "#dde1e7", track: "#e5e8ec", in: "#0ea371", out: "#f08c00",
    high: "#16a34a", mid: "#e09b0b", low: "#dc2626",
  },
  dark: {
    bg: "#0d0f13", paper: "#161a21", surface2: "#1c212a", fg: "#e8eaee", muted: "#8b93a1",
    border: "#262c36", track: "#252b35", in: "#2fd39a", out: "#ffaa33",
    high: "#34d36a", mid: "#f2b42a", low: "#f05252",
  },
};

export function createAppTheme(mode: "light" | "dark"): Theme {
  const t = tokens[mode];
  return createTheme({
    palette: {
      mode,
      primary: { main: "#0a7cff" },
      success: { main: "#12a150" },
      error: { main: "#d92d20" },
      warning: { main: mode === "dark" ? "#f2b42a" : "#b54708" },
      background: { default: t.bg, paper: t.paper },
      text: { primary: t.fg, secondary: t.muted },
      divider: t.border,
      flow: { in: t.in, out: t.out },
      level: { high: t.high, mid: t.mid, low: t.low },
      track: t.track,
      surface2: t.surface2,
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: 14,
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiChip: { styleOverrides: { root: { fontSize: 12 } } },
      MuiCssBaseline: {
        styleOverrides: { body: { fontSize: 14, lineHeight: 1.45 } },
      },
    },
  });
}
