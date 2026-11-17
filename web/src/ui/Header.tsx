// Site header: brand, page nav, connection state and the only Connect/Disconnect.

import BoltIcon from "@mui/icons-material/Bolt";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { Pill, type Tone } from "./common";
import { ROUTE_HREF, type Route } from "./route";
import { useAppState, useStore } from "./store";

function useConnectionPill(): [string, Tone] {
  const { connection: c, session } = useAppState();
  const name = c.device?.name ?? "device";
  const s = session?.state;
  if (!c.device) return ["Not connected", "default"];
  if (!c.connected) return ["Disconnected", "default"];
  if (s === "authorized") return [`Connected · ${name}`, "success"];
  if (s === "awaiting-confirmation") return ["Approve on device", "warning"];
  if (s === "failed" || s === "unsupported") return [`Connected · ${name} (no SOLIX session)`, "error"];
  return ["Connecting…", "default"];
}

export function Header({ route }: { route: Route }) {
  const store = useStore();
  const { connection } = useAppState();
  const [label, tone] = useConnectionPill();
  const nav = (r: Route, text: string) => (
    <Button href={ROUTE_HREF[r]} color="inherit" size="small" aria-current={route === r ? "page" : undefined}
      sx={{ color: route === r ? "text.primary" : "text.secondary", bgcolor: route === r ? "action.selected" : undefined }}>
      {text}
    </Button>
  );
  return (
    <AppBar position="sticky" color="default" elevation={0}
      sx={{ bgcolor: "background.default", borderBottom: 1, borderColor: "divider" }}>
      <Toolbar variant="dense" sx={{ gap: 1.5, flexWrap: "wrap", py: 1 }}>
        <Box component="a" href={ROUTE_HREF.status}
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, color: "text.primary", textDecoration: "none" }}>
          <BoltIcon fontSize="small" color="primary" />
          <Typography sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>Power Station</Typography>
        </Box>
        <Box component="nav" sx={{ display: "flex", gap: 0.5 }}>
          {nav("status", "Status")}
          {nav("debug", "Debug")}
        </Box>
        <Box sx={{ flex: 1, flexBasis: { xs: "100%", sm: 0 }, height: { xs: 0, sm: "auto" } }} />
        <Pill label={label} tone={tone} />
        {connection.connected
          ? <Button variant="outlined" color="inherit" onClick={() => store.disconnect()}>Disconnect</Button>
          : <Button variant="contained" onClick={() => void store.connect()}>Connect</Button>}
      </Toolbar>
    </AppBar>
  );
}
