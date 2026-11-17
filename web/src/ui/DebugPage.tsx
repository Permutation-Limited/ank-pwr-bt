// Diagnostics: connection options, SOLIX session and telemetry (decoded and
// raw), the Bluetooth environment, advertisements, the GATT tree and the log.

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import { styled } from "@mui/material/styles";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { type CharacteristicInfo, type ServiceInfo, type TelemetryField, errMsg, shortUuid } from "../ble";
import { CardGrid, KeyValue, Mono, Pill, Section, type Tone } from "./common";
import { describeValue, formatField, toHex } from "./format";
import { type ConnectOptions, type RawFrame, useAppState, useStore } from "./store";
import { MONO } from "./theme";

export function DebugPage() {
  return (
    <Stack spacing={2}>
      <Controls />
      <CardGrid>
        <SolixSection />
        <ApiSection />
        <DeviceSection />
        <AdvertisementSection />
        <GattSection />
        <LogSection />
      </CardGrid>
    </Stack>
  );
}

// ------------------------------------------------------------ controls

function Controls() {
  const store = useStore();
  const { environment: env, connection, options } = useAppState();
  const set = (patch: Partial<ConnectOptions>) => store.setOptions(patch);
  const [availability, tone]: [string, Tone] = !env ? ["checking…", "default"]
    : !env.present ? ["Web Bluetooth unavailable", "error"]
    : env.available ? ["Bluetooth available", "success"] : ["No Bluetooth adapter", "error"];
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <Pill label={availability} tone={tone} />
        <Button variant="outlined" color="inherit" size="small" disabled={!connection.connected} sx={{ whiteSpace: "nowrap" }}
          onClick={() => void store.exploreGatt()}>Read GATT tree</Button>
      </Stack>
      <Accordion variant="outlined" disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>Options</AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
            <FormControlLabel label="Show all nearby devices, not just Anker (acceptAllDevices)"
              control={<Checkbox checked={options.acceptAll} onChange={(e) => set({ acceptAll: e.target.checked })} />} />
            <TextField select size="small" label="Handshake variant" value={options.outer}
              onChange={(e) => set({ outer: e.target.value as ConnectOptions["outer"] })}>
              <MenuItem value="auto">Auto (advertisement hint, else model preference, else plain with encrypted fallback)</MenuItem>
              <MenuItem value="plain">Plain (clear handshake, AES-CBC session)</MenuItem>
              <MenuItem value="encrypted">Encrypted (AES-GCM handshake and session)</MenuItem>
            </TextField>
            <FormControlLabel label="Send the device model's start-up commands (e.g. telemetry subscribe) once authorized"
              control={<Checkbox checked={options.runModelCommands} onChange={(e) => set({ runModelCommands: e.target.checked })} />} />
            <FormControlLabel label="Read the full GATT tree after the handshake"
              control={<Checkbox checked={options.autoGatt} onChange={(e) => set({ autoGatt: e.target.checked })} />} />
            <TextField size="small" multiline minRows={2} label="Extra optional service UUIDs (one per line)"
              helperText="Web Bluetooth only exposes services listed here" value={options.extraServices}
              onChange={(e) => set({ extraServices: e.target.value })} slotProps={{ input: { sx: { fontFamily: MONO } } }} />
            <TextField size="small" label="Optional manufacturer IDs for advertisement data" placeholder="e.g. 0x004c"
              helperText="Comma-separated, decimal or 0x hex" value={options.manufacturerIds}
              onChange={(e) => set({ manufacturerIds: e.target.value })} slotProps={{ input: { sx: { fontFamily: MONO } } }} />
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}

// ------------------------------------------------------------ SOLIX session + telemetry

/** Ports are short ("AC") on the status page; in this flat list say which side. */
const fieldLabel = (f: TelemetryField) =>
  f.role === "input" ? `${f.label} in` : f.role === "output" ? `${f.label} out`
  : f.role === "time_remaining" ? `${f.label} (to empty or full)` : f.label;

function SolixSection() {
  const store = useStore();
  const { session, telemetry, raw } = useAppState();
  const s = session;
  const a = s?.announcement ?? {};
  const tone: Tone = s?.state === "authorized" ? "success" : s?.state === "failed" || s?.state === "unsupported" ? "error"
    : s?.state === "awaiting-confirmation" ? "warning" : "default";
  const commands = store.client.modelCommands;
  const rows: [string, string][] = s ? [
    ["model", s.model.name],
    ["handshake", s.outer ?? "—"],
    ["serial", a.serial ?? "—"],
    ["MAC", a.mac ?? "—"],
    ["chip / firmware", [a.chip, a.firmware].filter(Boolean).join(" / ") || "—"],
    ["MTU", a.mtu?.toString() ?? "—"],
    ["methods", a.encryptMethod != null
      ? `base 0x${(a.baseMethod ?? 0).toString(16)} · encrypt 0x${a.encryptMethod.toString(16)} · auth ${a.authMethod ?? "—"}` : "—"],
    ...(s.error ? [["error", s.error] as [string, string]] : []),
  ] : [];
  return (
    <Section wide title="SOLIX" action={
      <Stack direction="row" spacing={1}>
        <Pill label={(s?.state ?? "not started").replace(/-/g, " ")} tone={tone} />
        {commands.length > 0 && (
          <Button size="small" variant="outlined" color="inherit" disabled={s?.state !== "authorized"}
            onClick={() => void store.client.runModelCommands()}>
            {commands.map((c) => c.description).join(", ")}
          </Button>
        )}
      </Stack>
    }>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 2 }}>
        <Box>
          <Typography variant="subtitle2" gutterBottom>Session</Typography>
          <KeyValue rows={rows} empty="Not connected" />
        </Box>
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Telemetry <Typography component="span" variant="body2" color="text.secondary">(decoded by the device model)</Typography>
          </Typography>
          <KeyValue rows={(telemetry?.fields ?? []).map((f) => [fieldLabel(f), formatField(f)])} empty="No telemetry yet" />
        </Box>
      </Box>
      <Typography variant="subtitle2" sx={{ mt: 2 }} gutterBottom>
        Raw telemetry tags <Typography component="span" variant="body2" color="text.secondary">(changed bytes highlighted; hover for offset)</Typography>
      </Typography>
      {Object.keys(raw).length === 0
        ? <Typography color="text.secondary">Telemetry frames appear here once the session is authorized.</Typography>
        : <CardGrid sx={{ gap: 1.5 }}>{Object.values(raw).map((f) => <RawTable key={f.cmd} frame={f} />)}</CardGrid>}
    </Section>
  );
}

const Changed = styled("mark")(({ theme }) => ({
  background: `color-mix(in srgb, ${theme.palette.warning.main} 35%, transparent)`,
  color: "inherit",
  borderRadius: 2,
}));

function RawTable({ frame }: { frame: RawFrame }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        cmd {frame.cmd} · {frame.encrypted ? "encrypted" : "clear"} · {frame.tags.length} tags · {frame.at.toLocaleTimeString()}
      </Typography>
      <Table size="small" sx={{ "& td": { fontFamily: MONO, fontSize: 12, py: 0.25, px: 0.75, wordBreak: "break-all", verticalAlign: "top" } }}>
        <TableBody>
          {frame.tags.map(([key, hexNow]) => {
            const before = frame.previous?.get(key);
            const now = hexNow.match(/../g) ?? [];
            const prev = before?.match(/../g) ?? [];
            return (
              <TableRow key={key} selected={!!frame.previous && before !== hexNow}>
                <TableCell sx={{ color: "text.secondary", width: "2.5em" }}>{key.toString(16)}</TableCell>
                <TableCell>
                  {now.map((b, i) => {
                    const title = `byte ${i} = ${parseInt(b, 16)}`;
                    return frame.previous && prev[i] !== b
                      ? <Changed key={i} title={title}>{b}</Changed>
                      : <span key={i} title={title}>{b}</span>;
                  })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

// ------------------------------------------------------------ environment, device, advertisements

function ApiSection() {
  const { environment: env } = useAppState();
  const rows: [string, string][] = env ? [
    ["navigator.bluetooth", env.present ? "present" : "missing"],
    ["secure context", String(env.secureContext)],
    ["user agent", env.userAgent],
    ...(env.present ? [
      ["getAvailability()", env.availabilityError ?? String(env.available)],
      ["getDevices()", env.getDevicesSupported ? "supported" : "unsupported"],
      ...(env.getDevicesSupported ? [["permitted devices",
        env.permittedDevices.map((d) => `${d.name ?? "(unnamed)"} [${d.id}]`).join(", ") || "none"]] : []),
      ["watchAdvertisements", env.watchAdvertisementsSupported ? "supported" : "unsupported (enable flag)"],
    ] as [string, string][] : []),
  ] : [];
  return <Section title="Bluetooth API"><KeyValue rows={rows} empty="checking…" /></Section>;
}

function DeviceSection() {
  const { connection: c } = useAppState();
  const rows: [string, string][] = c.device ? [
    ["name", c.device.name ?? "(none)"],
    ["id", c.device.id],
    ["gatt.connected", String(c.connected)],
    ["watchingAdvertisements", String(c.watchingAdvertisements ?? "n/a")],
  ] : [];
  return <Section title="Device"><KeyValue rows={rows} empty="Not connected" /></Section>;
}

function AdvertisementSection() {
  const { advertisement: a, advertisementsUnsupported } = useAppState();
  const rows: [string, string][] = a ? [
    ["received", a.at.toLocaleTimeString()],
    ["name", a.name ?? "(none)"],
    ["rssi", a.rssi != null ? `${a.rssi} dBm` : "n/a"],
    ["txPower", a.txPower != null ? `${a.txPower} dBm` : "n/a"],
    ["appearance", a.appearance != null ? `0x${a.appearance.toString(16)}` : "n/a"],
    ["uuids", a.uuids.map(shortUuid).join(", ") || "none"],
    ...a.manufacturerData.map(({ companyId, bytes }): [string, string] =>
      [`mfr 0x${companyId.toString(16).padStart(4, "0")}`, toHex(bytes)]),
    ...a.serviceData.map(({ uuid, bytes }): [string, string] => [`svc ${shortUuid(uuid)}`, toHex(bytes)]),
    ...(a.anker ? [
      ["anker product", `${a.anker.productType} (${a.anker.productName ?? "unknown to SolixBLE"})`],
      ["anker sku", a.anker.sku],
      ["anker mac", a.anker.mac],
      ["anker capability", a.anker.capability == null ? "absent" : `0x${a.anker.capability.toString(16)}`],
    ] as [string, string][] : []),
  ] : [];
  return (
    <Section title="Advertisements">
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Needs <Mono>chrome://flags/#enable-experimental-web-platform-features</Mono>.
      </Typography>
      <KeyValue rows={rows} empty={advertisementsUnsupported ?? "No advertisement received"} />
    </Section>
  );
}

// ------------------------------------------------------------ GATT tree

function GattSection() {
  const { gatt } = useAppState();
  return (
    <Section wide title="GATT services">
      {gatt.status === "idle" && <Typography color="text.secondary">Connect to a device to enumerate services.</Typography>}
      {gatt.status === "loading" && <Typography color="text.secondary">Enumerating services…</Typography>}
      {gatt.status === "error" && (
        <>
          <Typography color="error">getPrimaryServices(): {gatt.error}</Typography>
          <Typography color="text.secondary">
            Only services listed in optionalServices are visible. Add UUIDs under Options and connect again.
          </Typography>
        </>
      )}
      {gatt.status === "ready" && gatt.services.map((s) => <ServiceView key={s.uuid} service={s} />)}
    </Section>
  );
}

function ServiceView({ service: s }: { service: ServiceInfo }) {
  return (
    <Accordion variant="outlined" defaultExpanded disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        {s.name && <Typography sx={{ fontWeight: 600, mr: 1 }}>{s.name}</Typography>}
        <Mono>{shortUuid(s.uuid)}{s.isPrimary ? "  (primary)" : ""}</Mono>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {s.characteristics.map((c) => <CharacteristicView key={c.uuid} c={c} />)}
        {s.error && <Typography color="error" sx={{ px: 2, py: 1 }}>{s.error}</Typography>}
        {!s.error && !s.characteristics.length && <Typography color="text.secondary" sx={{ px: 2, py: 1 }}>no characteristics</Typography>}
      </AccordionDetails>
    </Accordion>
  );
}

function CharacteristicView({ c }: { c: CharacteristicInfo }) {
  const store = useStore();
  const [value, setValue] = useState<{ text: string; error?: boolean }>(
    c.value ? { text: `[read]\n${describeValue(c.value)}` } : c.readError ? { text: c.readError, error: true } : { text: "" });
  const [notifying, setNotifying] = useState(false);
  const show = (v: DataView, how: string) => setValue({ text: `[${how} ${new Date().toLocaleTimeString()}]\n${describeValue(v)}` });
  const read = async () => { try { show(await c.read(), "read"); } catch (e) { setValue({ text: errMsg(e), error: true }); } };
  const toggle = async () => {
    try {
      await c.setNotifications(!notifying, (v) => {
        show(v, "notify");
        store.log(`notify ${shortUuid(c.uuid)}: ${toHex(v)}`);
      });
      setNotifying(!notifying);
    } catch (e) {
      store.log(`notifications ${shortUuid(c.uuid)}: ${errMsg(e)}`, "err");
    }
  };
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", pl: 3, pr: 1.5, py: 1 }}>
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        {c.name && <Typography sx={{ fontWeight: 600 }}>{c.name}</Typography>}
        <Mono>{shortUuid(c.uuid)}</Mono>
        {c.properties.map((p) => <Pill key={p} label={p} />)}
        {c.canRead && <Button size="small" onClick={() => void read()}>read</Button>}
        {c.canNotify && <Button size="small" onClick={() => void toggle()}>{notifying ? "unsubscribe" : "subscribe"}</Button>}
      </Stack>
      {value.text && (
        <Box component="pre" sx={{ fontFamily: MONO, fontSize: 12, m: 0, mt: 0.75, whiteSpace: "pre-wrap", wordBreak: "break-all",
          color: value.error ? "error.main" : undefined }}>{value.text}</Box>
      )}
      {c.descriptors.map((d) => (
        <Typography key={d.uuid} variant="body2" sx={{ fontFamily: MONO, fontSize: 12, color: "text.secondary", mt: 0.5 }}>
          ↳ {d.name ? `${d.name} ` : ""}{shortUuid(d.uuid)}: {d.value ? describeValue(d.value).replace(/\n/g, "  |  ") : d.error}
        </Typography>
      ))}
      {c.descriptorError && <Typography variant="body2" color="error">getDescriptors(): {c.descriptorError}</Typography>}
    </Box>
  );
}

// ------------------------------------------------------------ log

function LogSection() {
  const store = useStore();
  const { log } = useAppState();
  return (
    <Section wide title="Log" action={<Button size="small" onClick={() => store.clearLog()}>clear</Button>}>
      <Box component="pre" ref={(el: HTMLPreElement | null) => { if (el) el.scrollTop = el.scrollHeight; }}
        sx={{ fontFamily: MONO, fontSize: 12, maxHeight: 360, overflow: "auto", m: 0, whiteSpace: "pre-wrap" }}>
        {log.map((e) => (
          <Box component="span" key={e.id} sx={{
            display: "block",
            color: e.level === "err" ? "error.main" : e.level === "ok" ? "success.main" : e.level === "warn" ? "warning.main" : undefined,
            fontWeight: e.level === "warn" ? 600 : undefined,
          }}>
            {e.at.toISOString().slice(11, 23)}  {e.message}
          </Box>
        ))}
      </Box>
    </Section>
  );
}
