// Battery gauge: MUI's determinate CircularProgress over a full "track" ring.

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";

export function Gauge({ percent, label, small = false }: { percent: number; label: string; small?: boolean }) {
  const pct = Math.max(0, Math.min(100, percent));
  const level = pct <= 20 ? "low" : pct <= 50 ? "mid" : "high";
  const size = small ? { xs: 112, sm: 140 } : { xs: 150, sm: 200 };
  const ring = { position: "absolute", inset: 0, width: "100% !important", height: "100% !important" } as const;
  return (
    <Box role="img" aria-label={`${label} ${Math.round(pct)} percent`}
      sx={{ position: "relative", flex: "none", width: size, height: size }}>
      <CircularProgress variant="determinate" value={100} thickness={small ? 4 : 3.5}
        sx={{ ...ring, color: "track" }} />
      <CircularProgress variant="determinate" value={pct} thickness={small ? 4 : 3.5}
        sx={{ ...ring, color: `level.${level}`, "& circle": { strokeLinecap: "round" } }} />
      <Box sx={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", textAlign: "center" }}>
        <Typography component="span" sx={{
          fontSize: small ? { xs: 26, sm: 32 } : { xs: 36, sm: 48 },
          fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums",
        }}>
          {Math.round(pct)}
          <Typography component="small" sx={{ fontSize: "0.45em", fontWeight: 600, color: "text.secondary", ml: 0.25 }}>%</Typography>
        </Typography>
        <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 2 }}>{label}</Typography>
      </Box>
    </Box>
  );
}
