// On/off switch for an output port the device model can control
// (SettingSpec.output), shown inline in the status page's Output card. It
// follows telemetry; a click sends the command and waits for the station to
// report the new state. Turning off a port that is drawing power asks first.

import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import { useEffect, useState } from "react";
import { type SettingSpec, errMsg } from "../ble";
import { useStore } from "./store";

/** How long to wait for telemetry to confirm a switch before giving up. */
const CONFIRM_MS = 10_000;

export interface OutputSwitchProps {
  spec: SettingSpec;
  /** Port name for the confirmation, e.g. "AC". */
  label: string;
  /** Current state from telemetry: 1 on, 0 off, undefined unknown. */
  state: number | undefined;
  watts: number;
  disabled: boolean;
  /** Progress or error text for the row, or null when there's nothing to say. */
  onMessage(message: { text: string; error: boolean } | null): void;
}

export function OutputSwitch({ spec, label, state, watts, disabled, onMessage }: OutputSwitchProps) {
  const store = useStore();
  const [pending, setPending] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Done once telemetry reports the requested state; give up after a while.
  useEffect(() => {
    if (pending === null) return;
    if (state === pending) { setPending(null); onMessage(null); return; }
    const t = setTimeout(() => {
      setPending(null);
      onMessage({ text: "No change reported by the station", error: true });
    }, CONFIRM_MS);
    return () => clearTimeout(t);
  }, [pending, state, onMessage]);

  const send = async (target: number) => {
    setPending(target);
    onMessage({ text: `Turning ${target ? "on" : "off"}…`, error: false });
    try {
      await store.client.sendSetting(spec, [target]);
    } catch (e) {
      setPending(null);
      onMessage({ text: errMsg(e), error: true });
    }
  };
  // Cutting a live load deserves a second look (it may be powering a router).
  const request = (target: number) => (target === 0 && watts > 0 ? setConfirming(true) : void send(target));

  const busy = pending !== null;
  return (
    <>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        {busy && <CircularProgress size={16} />}
        <Switch size="small" checked={busy ? pending === 1 : state === 1}
          disabled={disabled || busy || state === undefined}
          onChange={(e) => request(e.target.checked ? 1 : 0)}
          slotProps={{ input: { "aria-label": `${label} output` } }} />
      </Stack>
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>Turn off {label} output?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            It is powering {Math.round(watts)} W right now. Anything plugged into it will lose power.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)} autoFocus>Cancel</Button>
          <Button color="error" onClick={() => { setConfirming(false); void send(0); }}>Turn off</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
