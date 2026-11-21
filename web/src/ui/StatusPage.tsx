// Status (home) page: battery gauges, power in/out and output switches. Lays
// fields out by their role and controls by the model's settings, so it works
// for any device model.

import BatteryIcon from "@mui/icons-material/BatteryAlert";
import ScheduleIcon from "@mui/icons-material/Schedule";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import type { SettingSpec, TelemetryField } from "../ble";
import { formatHours, rawValue } from "./format";
import { Gauge } from "./Gauge";
import { OutputSwitch } from "./OutputSwitch";
import { useAppState, useStore } from "./store";

const num = (f?: TelemetryField) => (f && typeof f.value === "number" ? f.value : undefined);
const sum = (fs: TelemetryField[]) => fs.reduce((n, f) => n + (num(f) ?? 0), 0);
const watts = (n: number) => `${Math.round(n)} W`;

/** An output port's switch: the model's setting and the port's state from telemetry. */
interface PortSwitch { spec: SettingSpec; state: number | undefined; disabled: boolean }

export function StatusPage() {
  const store = useStore();
  const { connection, session, telemetry } = useAppState();
  const battery = telemetry?.fields.find((f) => f.role === "battery");
  if (!connection.connected || !telemetry || !battery) return <Waiting />;

  const fields = telemetry.fields;
  const inputs = fields.filter((f) => f.role === "input");
  const outputs = fields.filter((f) => f.role === "output");
  const totalIn = num(fields.find((f) => f.role === "input_total")) ?? sum(inputs);
  const totalOut = num(fields.find((f) => f.role === "output_total")) ?? sum(outputs);
  const packs = [battery, ...fields.filter((f) => f.role === "expansion_battery")];
  // Each pack's temperature: the main unit's, then expansion packs' in order.
  const temps = [fields.find((f) => f.role === "temperature"), ...fields.filter((f) => f.role === "expansion_temperature")];
  const tempText = (f?: TelemetryField) => (f ? `${f.value}${f.unit ?? ""}` : undefined);
  // Output ports the model can switch, keyed by the port's power field.
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const switches = new Map(store.client.settingSpecs.filter((s) => s.output).map((spec): [string, PortSwitch] => [
    spec.output!.powerKey,
    { spec, state: rawValue(byKey.get(spec.fields[0]!.stateKey ?? "")), disabled: session?.state !== "authorized" },
  ]));
  const net = totalIn - totalOut;
  const state = totalIn > totalOut && totalIn > 0 ? "charging" : totalOut > totalIn ? "discharging" : "idle";
  const allFull = packs.every((f) => (num(f) ?? 0) >= 100);
  const stateText = state === "charging" ? (allFull ? "Full, on input power" : "Charging")
    : state === "discharging" ? "Discharging" : "Idle";
  const stateColor = state === "charging" ? "flow.in" : state === "discharging" ? "flow.out" : "text.secondary";
  // The station's estimate follows net power: time to empty while draining,
  // time to full while charging. Nothing to count down when idle or full.
  const hours = num(fields.find((f) => f.role === "time_remaining"));
  const remaining = hours === undefined || hours <= 0 ? null
    : state === "discharging" ? `≈ ${formatHours(hours)} until empty`
    : state === "charging" && !allFull ? `≈ ${formatHours(hours)} until full`
    : null;

  return (
    <Stack spacing={2}>
      <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", alignItems: "baseline", columnGap: 1.5 }}>
        <Typography variant="h6" component="h1" sx={{ fontWeight: 650 }}>
          {connection.device?.name ?? session?.model.name ?? "Power station"}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {[session?.model.name, `updated ${telemetry.at.toLocaleTimeString()}`]
            .filter(Boolean).join(" · ")}
        </Typography>
      </Stack>

      <Card variant="outlined" sx={{ borderRadius: 4 }}>
        <CardContent sx={{
          display: "flex", alignItems: "center", gap: { xs: 2.5, sm: 4.5 }, p: { xs: 3, sm: 3.5 },
          flexDirection: { xs: "column", md: "row" }, textAlign: { xs: "center", md: "left" },
        }}>
          <Stack direction="row" spacing={{ xs: 1.75, sm: 3 }} sx={{ alignItems: "center" }}>
            {packs.map((f, i) => (
              <Gauge key={f.key} percent={num(f) ?? 0} small={i > 0} temperature={tempText(temps[i])}
                label={packs.length === 1 ? "battery" : f.role === "battery" ? "main" : "expansion"} />
            ))}
          </Stack>
          <Stack spacing={1.75}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: stateColor, justifyContent: { xs: "center", md: "flex-start" } }}>
              <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: "currentColor" }} />
              <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{stateText}</Typography>
            </Stack>
            {remaining && (
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", color: "text.secondary", mt: -0.75,
                justifyContent: { xs: "center", md: "flex-start" } }}>
                <ScheduleIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{remaining}</Typography>
              </Stack>
            )}
            <Box>
              <Typography sx={{ fontSize: 34, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {net > 0 ? "+" : net < 0 ? "−" : ""}{watts(Math.abs(net))}
              </Typography>
              <Typography variant="overline" color="text.secondary">net power</Typography>
            </Box>
            <Stack direction="row" spacing={2.5} sx={{ color: "text.secondary", justifyContent: { xs: "center", md: "flex-start" } }}>
              <Total label="In" value={totalIn} color="flow.in" />
              <Total label="Out" value={totalOut} color="flow.out" />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, alignItems: "start" }}>
        <FlowCard title="Input" total={totalIn} ports={inputs} color="flow.in" />
        <FlowCard title="Output" total={totalOut} ports={outputs} color="flow.out" switches={switches} />
      </Box>
    </Stack>
  );
}

function Total({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
      <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color }} />
      <span>{label}</span>
      <Typography component="strong" sx={{ fontWeight: 700, color: "text.primary" }}>{watts(value)}</Typography>
    </Stack>
  );
}

function FlowCard({ title, total, ports, color, switches }: {
  title: string; total: number; ports: TelemetryField[]; color: string; switches?: Map<string, PortSwitch>;
}) {
  // Switchable ports first in a fixed order (so a row doesn't jump when you
  // turn it off), then the rest with active ones first; idle ones stay muted.
  const order = (f: TelemetryField) => (switches?.has(f.key) ? 1 : 0);
  const sorted = [...ports].sort((a, b) => order(b) - order(a) || (order(a) ? 0 : (num(b) ?? 0) - (num(a) ?? 0)));
  return (
    <Card variant="outlined" sx={{ borderRadius: 4 }}>
      <CardHeader title={title}
        action={<Typography sx={{ fontSize: 26, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{watts(total)}</Typography>}
        sx={{ pb: 0, "& .MuiCardHeader-action": { alignSelf: "center", m: 0 } }}
        slotProps={{ title: { sx: { fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", color: "text.secondary" } } }} />
      <CardContent>
        <Stack spacing={1.5}>
          {!sorted.length && <Typography color="text.secondary">No {title.toLowerCase()}s reported</Typography>}
          {sorted.map((f) => <PortRow key={f.key} port={f} total={total} color={color} control={switches?.get(f.key)} />)}
        </Stack>
      </CardContent>
    </Card>
  );
}

function PortRow({ port, total, color, control }: { port: TelemetryField; total: number; color: string; control?: PortSwitch }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const w = num(port) ?? 0;
  const active = w > 0;
  const off = control?.state === 0;
  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", minHeight: 28,
        color: active ? "text.primary" : "text.secondary", fontWeight: active ? 600 : 500 }}>
        <span>{port.label}</span>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>{off ? "Off" : watts(w)}</Box>
          {control && (
            <OutputSwitch spec={control.spec} label={port.label} state={control.state} watts={w}
              disabled={control.disabled} onMessage={setMessage} />
          )}
        </Stack>
      </Stack>
      <LinearProgress variant="determinate" value={total > 0 ? Math.min(100, (w / total) * 100) : 0}
        sx={{ mt: 0.75, height: 6, borderRadius: 3, bgcolor: "track", "& .MuiLinearProgress-bar": { bgcolor: color, borderRadius: 3 } }} />
      {message && (
        <Typography variant="caption" color={message.error ? "error" : "text.secondary"}>{message.text}</Typography>
      )}
    </Box>
  );
}

function Waiting() {
  const { connection: c, session } = useAppState();
  const s = session?.state;
  let text = "";
  if (c.device && !c.connected) text = "Disconnected. Click Connect at the top to resume.";
  else if (c.connected) {
    if (s === "awaiting-confirmation") text = "Approve this browser on the power station: short-press its power or IoT button.";
    else if (s === "authorized") text = session?.model.id === "solix-generic"
      ? "Connected, but this model's telemetry isn't decoded yet. See Debug for the raw data."
      : "Connected. Waiting for the first reading…";
    else if (s === "failed" || s === "unsupported") text = "This device didn't complete a SOLIX session. See Debug for details.";
    else text = "Connecting…";
  }
  return (
    <Stack spacing={1.75} sx={{ alignItems: "center", textAlign: "center", py: 9, px: 2 }}>
      <Box sx={{ width: 76, height: 76, borderRadius: 5.5, display: "grid", placeItems: "center", color: "primary.main",
        bgcolor: (t) => `color-mix(in srgb, ${t.palette.primary.main} 12%, transparent)` }}>
        <BatteryIcon sx={{ fontSize: 40 }} />
      </Box>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>Connect your power station</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 460 }}>
        Click <strong>Connect</strong> at the top to pair a SOLIX power station and see its battery and power flow
        live. Close the Anker app on your phone first: the station accepts one Bluetooth connection at a time.
      </Typography>
      {text && <Typography color="warning.main" sx={{ fontWeight: 500 }}>{text}</Typography>}
    </Stack>
  );
}
