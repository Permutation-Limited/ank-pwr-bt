import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useMemo } from "react";
import { DebugPage } from "./DebugPage";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { StatusPage } from "./StatusPage";
import { useRoute } from "./route";
import { type AppStore, StoreContext } from "./store";
import { createAppTheme } from "./theme";

export function App({ store }: { store: AppStore }) {
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = useMemo(() => createAppTheme(dark ? "dark" : "light"), [dark]);
  const route = useRoute();
  return (
    <StoreContext.Provider value={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
          <Header route={route} />
          <Box component="main" sx={route === "status"
            ? { width: "100%", maxWidth: 920, mx: "auto", px: { xs: 2, sm: 2.5 }, py: { xs: 2.5, sm: 3.5 } }
            : { px: { xs: 2, sm: 2.5 }, py: 2 }}>
            {route === "status" ? <StatusPage /> : <DebugPage />}
          </Box>
          <Footer />
        </Box>
      </ThemeProvider>
    </StoreContext.Provider>
  );
}
