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
import Switch from "@mui/material/Switch";
import { styled } from "@mui/material/styles";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import {
  type CharacteristicInfo, type ServiceInfo, type SettingField, type SettingSpec, type TelemetryField,
  type TimestampStyle, buildParams, errMsg, fromHex, parseParams, settingCmd, shortUuid,
} from "../ble";
import { CardGrid, KeyValue, Mono, Pill, Section, type Tone } from "./common";
import { describeValue, formatField, rawValue, toHex } from "./format";
import { type ConnectOptions, type RawFrame, useAppState, useStore } from "./store";
import { MONO } from "./theme";

export function DebugPage() {
  return (
    <Stack spacing={2}>
      <Controls />
      <CardGrid>
        <SolixSection />
        <SettingsSection />
        <TelemetrySection />
        <RawSection />
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
  const { session } = useAppState();
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
      <KeyValue rows={rows} empty="Not connected" />
    </Section>
  );
}

// ------------------------------------------------------------ settings (experimental)


const fieldDefault = (f: SettingField) =>
  f.default ?? (f.options ? Number(Object.keys(f.options)[0]) : f.min ?? 0);

/**
 * One control per settings command the model knows. Commands come from
 * public repos and are mostly unproven over BLE: send one, watch the log for
 * the reply and the telemetry for the change.
 */
function SettingsSection() {
  const store = useStore();
  const { session, telemetry } = useAppState();
  const [timestamp, setTimestamp] = useState<TimestampStyle>("fe");
  const [header, setHeader] = useState(0x21);
  const specs = store.client.settingSpecs;
  const ready = session?.state === "authorized";
  const fields = new Map((telemetry?.fields ?? []).map((f) => [f.key, f]));
  const groups = new Map<string, SettingSpec[]>();
  for (const s of specs) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  return (
    <Section wide title="Settings (experimental)" action={
      <Stack direction="row" spacing={1}>
        <TextField select size="small" label="Timestamp" value={timestamp} sx={{ minWidth: 170 }}
          onChange={(e) => setTimestamp(e.target.value as TimestampStyle)}>
          <MenuItem value="fe">fe: u32 seconds (SolixBLE)</MenuItem>
          <MenuItem value="fd">fd: ms string (MQTT V2)</MenuItem>
          <MenuItem value="none">none</MenuItem>
        </TextField>
        <TextField select size="small" label="a1 header" value={header} sx={{ minWidth: 130 }}
          onChange={(e) => setHeader(Number(e.target.value))}>
          <MenuItem value={0x21}>21 (BLE)</MenuItem>
          <MenuItem value={0x22}>22 (MQTT)</MenuItem>
        </TextField>
      </Stack>
    }>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Command definitions come from SolixBLE and anker-solix-api's MQTT map; only the ones marked
        "proven" have been seen working over Bluetooth. Send one at a time and check the log for the
        device's reply and the telemetry for the change.
      </Typography>
      {specs.length === 0
        ? <Typography color="text.secondary">{session ? `No settings known for ${session.model.name}` : "Not connected"}</Typography>
        : (
          <CardGrid sx={{ gap: 2.5, gridTemplateColumns: "repeat(auto-fill, minmax(min(340px, 100%), 1fr))" }}>
            {[...groups].map(([group, list]) => (
              <Box key={group}>
                <Typography variant="subtitle2" gutterBottom>{group}</Typography>
                <Stack spacing={1.5}>
                  {list.map((spec) => (
                    <SettingControl key={spec.id} spec={spec} fields={fields} disabled={!ready}
                      send={(values) => store.client.sendSetting(spec, values, { timestamp, header })} />
                  ))}
                </Stack>
              </Box>
            ))}
          </CardGrid>
        )}
      <RawCommand disabled={!ready} timestamp={timestamp} />
    </Section>
  );
}

function SettingControl({ spec, fields, disabled, send }: {
  spec: SettingSpec; fields: Map<string, TelemetryField>; disabled: boolean; send(values: number[]): Promise<void>;
}) {
  const store = useStore();
  // Follow telemetry until the user edits a value.
  const [draft, setDraft] = useState<(number | undefined)[]>([]);
  const [busy, setBusy] = useState(false);
  const live = spec.fields.map((f) => (f.stateKey ? fields.get(f.stateKey) : undefined));
  const values = spec.fields.map((f, i) => draft[i] ?? rawValue(live[i]) ?? fieldDefault(f));
  const set = (i: number, v: number) => setDraft((d) => { const n = [...d]; n[i] = v; return n; });
  const submit = async (vals = values) => {
    setBusy(true);
    try {
      await send(vals);
      setDraft([]);
    } catch (e) {
      store.log(`${spec.label}: ${errMsg(e)}`, "err");
    } finally {
      setBusy(false);
    }
  };
  const current = live.map((f) => (f ? formatField(f) : null)).filter(Boolean).join(" · ");
  return (
    <Box sx={{ borderLeft: 2, borderColor: spec.verified ? "success.main" : "divider", pl: 1.5 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", mb: 0.75 }}>
        <Typography sx={{ fontWeight: 600 }}>{spec.label}</Typography>
        <Mono sx={{ fontSize: 12, color: "text.secondary" }}>
          {settingCmd(spec.msgtype)} {spec.fields.map((f) => f.tag.toString(16)).join("+")}
        </Mono>
        <Pill label={spec.verified ? "proven" : "untested"} tone={spec.verified ? "success" : "default"} />
        {current && <Typography variant="body2" color="text.secondary">now: {current}</Typography>}
      </Stack>
      {spec.toggle ? (
        // A live action: the switch shows the device's current state and flips it at once.
        <FormControlLabel label={values[0] ? "on" : "off"} disabled={disabled || busy}
          control={<Switch checked={values[0] === 1} onChange={(e) => void submit([e.target.checked ? 1 : 0])} />} />
      ) : (
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        {spec.fields.map((f, i) => f.options
          ? (
            <TextField key={f.tag} select size="small" label={f.label} value={values[i]} sx={{ minWidth: 140 }}
              onChange={(e) => set(i, Number(e.target.value))}>
              {Object.entries(f.options).map(([v, label]) => <MenuItem key={v} value={Number(v)}>{label}</MenuItem>)}
              {/* The device may hold a value outside the known options; show it rather than a wrong one. */}
              {!(values[i]! in f.options) && <MenuItem value={values[i]}>{values[i]} (current)</MenuItem>}
            </TextField>
          )
          : (
            <TextField key={f.tag} size="small" type="number" label={f.unit ? `${f.label} (${f.unit})` : f.label}
              value={values[i]} sx={{ width: 150 }} onChange={(e) => set(i, Number(e.target.value))}
              slotProps={{ htmlInput: { min: f.min, max: f.max, step: f.step ?? 1 } }} />
          ))}
        <Button size="small" variant="outlined" disabled={disabled || busy} onClick={() => void submit()}>Send</Button>
      </Stack>
      )}
      {spec.caution && <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>{spec.caution}</Typography>}
      {spec.note && <Typography variant="caption" color="text.secondary">{spec.note}</Typography>}
    </Box>
  );
}

/** Free-form command: cmd with flags (e.g. 4101) and TLV tags in hex, timestamp appended. */
function RawCommand({ disabled, timestamp }: { disabled: boolean; timestamp: TimestampStyle }) {
  const store = useStore();
  const [cmd, setCmd] = useState("4101");
  const [tags, setTags] = useState("a10121 a2020101");
  const send = async () => {
    try {
      if (!/^[0-9a-f]{4}$/i.test(cmd)) throw new Error("cmd must be 4 hex digits, e.g. 4101");
      const parsed = parseParams(fromHex(tags));
      if (parsed.status !== null) throw new Error("tags must start at a1 or above");
      const list = [...parsed.params];
      if (buildParams(list).length !== fromHex(tags).length) throw new Error("tags don't parse as complete TLVs");
      await store.client.sendCommand(cmd.toLowerCase(), list, timestamp);
      store.log(`sent raw ${cmd} ${tags}`, "ok");
    } catch (e) {
      store.log(`raw command: ${errMsg(e)}`, "err");
    }
  };
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle2" gutterBottom>Raw command</Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <TextField size="small" label="cmd" value={cmd} onChange={(e) => setCmd(e.target.value.trim())} sx={{ width: 90 }}
          slotProps={{ input: { sx: { fontFamily: MONO } } }} />
        <TextField size="small" label="TLV tags (hex, timestamp added)" value={tags} onChange={(e) => setTags(e.target.value)}
          sx={{ flex: 1, minWidth: 220 }} slotProps={{ input: { sx: { fontFamily: MONO } } }} />
        <Button size="small" variant="outlined" disabled={disabled} onClick={() => void send()}>Send</Button>
      </Stack>
    </Box>
  );
}

/** Decoded fields, one block per group the device model assigns. */
function TelemetrySection() {
  const { telemetry, session } = useAppState();
  const groups = new Map<string, TelemetryField[]>();
  for (const f of telemetry?.fields ?? []) {
    const g = f.group ?? "Telemetry";
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  return (
    <Section wide title="Telemetry" action={session && (
      <Typography variant="body2" color="text.secondary">decoded by the {session.model.name} model</Typography>
    )}>
      {groups.size === 0
        ? <Typography color="text.secondary">No telemetry yet</Typography>
        : (
          <CardGrid sx={{ gap: 2.5, gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))" }}>
            {[...groups].map(([group, fields]) => (
              <Box key={group}>
                <Typography variant="subtitle2" gutterBottom>{group}</Typography>
                <KeyValue rows={fields.map((f) => [fieldLabel(f), formatField(f)])} />
              </Box>
            ))}
          </CardGrid>
        )}
    </Section>
  );
}

function RawSection() {
  const { raw } = useAppState();
  return (
    <Section wide title="Raw telemetry tags" action={
      <Typography variant="body2" color="text.secondary">changed bytes highlighted; hover for offset</Typography>
    }>
      {Object.keys(raw).length === 0
        ? <Typography color="text.secondary">Telemetry frames appear here once the session is authorized.</Typography>
        : <CardGrid sx={{ gap: 1.5 }}>{Object.values(raw).map((f) => <RawTable key={f.cmd} frame={f} />)}</CardGrid>}
      <Recorder />
    </Section>
  );
}

/**
 * Records every telemetry frame (raw tags + decoded fields) so fields can be
 * mapped offline: start it, change one thing on the station at a time, then
 * copy or download the JSON.
 */
function Recorder() {
  const store = useStore();
  const { recording, connection } = useAppState();
  const [copied, setCopied] = useState(false);
  const n = recording.frames.length;
  const copy = async () => {
    await navigator.clipboard.writeText(store.recordingJson());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([store.recordingJson()], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `telemetry-${new Date().toISOString().slice(0, 19)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, alignItems: "center", flexWrap: "wrap" }}>
      <Button size="small" variant={recording.active ? "contained" : "outlined"} color={recording.active ? "error" : "inherit"}
        disabled={!recording.active && !connection.connected} onClick={() => store.toggleRecording()}>
        {recording.active ? "Stop recording" : "Record telemetry"}
      </Button>
      <Typography variant="body2" color="text.secondary">
        {recording.active ? `Recording… ${n} frames` : n ? `${n} frames recorded` : "Record frames to map new fields offline"}
      </Typography>
      {n > 0 && !recording.active && (
        <>
          <Button size="small" onClick={() => void copy()}>{copied ? "Copied" : "Copy JSON"}</Button>
          <Button size="small" onClick={download}>Download JSON</Button>
        </>
      )}
    </Stack>
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
