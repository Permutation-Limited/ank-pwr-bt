// Small shared building blocks on top of MUI components.

import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import { styled } from "@mui/material/styles";
import type { ReactNode } from "react";
import { MONO } from "./theme";

/** Outlined card with a small-caps title and optional header actions. */
export function Section({ title, action, children, wide = false }: {
  title: ReactNode; action?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  return (
    <Card variant="outlined" sx={{ minWidth: 0, gridColumn: wide ? "1 / -1" : undefined }}>
      <CardHeader
        title={title}
        action={action}
        sx={{ pb: 0, "& .MuiCardHeader-action": { alignSelf: "center", m: 0 } }}
        slotProps={{
          title: {
            sx: { fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", color: "text.secondary" },
          },
        }}
      />
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Responsive card grid. */
export const CardGrid = styled("div")({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
  gap: 16,
});

export const Mono = styled("span")({ fontFamily: MONO });

const Dl = styled("dl")(({ theme }) => ({
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
  gap: "4px 12px",
  margin: 0,
  "& dt": { color: theme.palette.text.secondary },
  "& dd": { margin: 0, fontFamily: MONO, wordBreak: "break-all" },
}));

/** Key/value list. */
export function KeyValue({ rows, empty = "—" }: { rows: [string, ReactNode][]; empty?: string }) {
  if (!rows.length) rows = [["—", empty]];
  return <Dl>{rows.map(([k, v], i) => [<dt key={`k${i}`}>{k}</dt>, <dd key={`v${i}`}>{v}</dd>])}</Dl>;
}

export type Tone = "default" | "success" | "error" | "warning";

export function Pill({ label, tone = "default" }: { label: ReactNode; tone?: Tone }) {
  return <Chip size="small" variant="outlined" color={tone} label={label} />;
}
