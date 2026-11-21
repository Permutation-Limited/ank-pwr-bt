// SOLIX C2000 Gen 2 (A1783; A1785 shares the map). Field map ported from
// anker-solix-api's mqttmap.py (_A1783_0421, MIT, github.com/thomluther/
// anker-solix-api), which decodes the same tags from Anker's cloud messages.
// Offsets index the bytes after each tag's type byte, as there.
//
// Checked against a live C2000 Gen 2 over BLE:
// - Every mapped value matched the device (limits 1800/800 W, MTU 204,
//   60 Hz, display schedule 08:00-18:00, charge limits 100/1 %, expansion
//   pack 92 %, solar watts in a8 and a6.04).
// - a5.03 battery health is omitted: firmware sends only the low byte of a
//   0.1 % value (100.0 % = 1000 = 0x3E8 -> 232).
// - Per-port voltage and current are not in this telemetry.
// - a4.31 bit 0x08 is mains presence, not part of battery-only (see Settings).
// - a3.00 working status and a5.01 battery status stayed idle/standby for 35 s
//   of 850 W AC charging; upstream says battery status follows any flow.

import { type TagSpec, decodeTags } from "../fieldmap";
import { GEN2_ON_AUTHORIZED, GEN2_TELEMETRY_CMDS } from "./gen2";
import type { DeviceModel, SettingSpec } from "./types";

const OFF_ON = { 0: "off", 1: "on" };
const PORT_STATUS = { 0: "inactive", 1: "discharging", 2: "charging" };

export const C2000G2_FIELDS: readonly TagSpec[] = [
  {
    tag: 0xa2, group: "Device", fields: [
      { key: "device_sn", label: "Serial number", type: "str", at: 1 },
      { key: "device_pn", label: "Part number", type: "str", at: 20 },
      { key: "sw_version", label: "Firmware", type: "version", at: 26 },
      { key: "model_variant", label: "Model variant", type: "ui", at: 30, values: { 0: "1800 W AC input", 1: "2300 W AC input" } },
    ],
  },
  {
    tag: 0xa3, group: "Device", fields: [
      { key: "working_status", label: "Working status", type: "ui", at: 0,
        values: { 0: "idle", 1: "discharging", 2: "charging", 3: "sleep", 4: "shutdown", 5: "firmware update" } },
      { key: "error_code", label: "Error code", type: "ui", at: 1 },
      { key: "package_count", label: "Battery packs", type: "ui", at: 2 },
      { key: "package_use_count", label: "Battery packs in use", type: "ui", at: 3 },
      { key: "ac_input_limit_max", label: "AC charge limit (max supported)", type: "sile", at: 4, unit: "W" },
      { key: "ota_progress", label: "Firmware update progress", type: "ui", at: 6, unit: "%" },
      { key: "mtu_size", label: "MTU", type: "sile", at: 8 },
      { key: "silent_charge_power", label: "Silent charge power", type: "sile", at: 10, unit: "W" },
      { key: "weak_light_lock", label: "Weak light lock", type: "ui", at: 12, values: OFF_ON },
    ],
  },
  {
    tag: 0xa5, group: "Battery", fields: [
      { key: "temperature", label: "Temperature", type: "ui", at: 0, signed: true, unit: "°C", role: "temperature" },
      { key: "battery_status", label: "Battery status", type: "ui", at: 1, values: { 0: "standby", 1: "discharging", 2: "charging" } },
      // Upstream: "Total SOC of main + Exp batteries?"; read 100 with the expansion at 92.
      { key: "battery_soc", label: "Battery (a5, unverified)", type: "ui", at: 2, unit: "%" },
    ],
  },
  {
    tag: 0xa6, group: "Power", fields: [
      { key: "main_battery_soc", label: "Main battery", type: "ui", at: 8, unit: "%", role: "battery" },
      { key: "remaining_time_hours", label: "Time remaining", type: "sile", at: 6, signed: false, factor: 0.1, unit: "h",
        role: "time_remaining", hideWhen: 0 },
      { key: "output_power_total", label: "Total output", type: "sile", at: 0, unit: "W", role: "output_total" },
      { key: "ac_input_power_total", label: "AC input total", type: "sile", at: 2, unit: "W" },
      { key: "dc_input_power_total", label: "DC input total (solar + car)", type: "sile", at: 4, unit: "W" },
    ],
  },
  {
    tag: 0xa7, group: "AC", fields: [
      { key: "ac_input_power", label: "AC", type: "sile", at: 4, unit: "W", role: "input" },
      { key: "ac_output_power", label: "AC", type: "sile", at: 1, unit: "W", role: "output" },
      { key: "ac_output_power_switch", label: "AC output", type: "ui", at: 0, values: OFF_ON },
      { key: "ac_input_plug_status", label: "AC input plug", type: "ui", at: 3,
        values: { 0: "disconnected", 1: "connected", 2: "disabled (battery only)" } },
    ],
  },
  {
    tag: 0xa8, group: "Solar / DC input", fields: [
      { key: "dc_input_power", label: "Solar / DC", type: "sile", at: 1, unit: "W", role: "input" },
      { key: "dc_input_plug_status", label: "Solar / DC plug", type: "ui", at: 0, values: { 0: "disconnected", 1: "connected" } },
    ],
  },
  ...([[0xaa, "usbc_1", "USB-C1"], [0xab, "usbc_2", "USB-C2"], [0xac, "usbc_3", "USB-C3"], [0xae, "usba_1", "USB-A"]] as const)
    .map(([tag, key, label]): TagSpec => ({
      tag, group: "USB ports", fields: [
        { key: `${key}_power`, label, type: "sile", at: 1, unit: "W", role: "output" },
        { key: `${key}_status`, label: `${label} status`, type: "ui", at: 0, values: PORT_STATUS },
      ],
    })),
  {
    tag: 0xb2, group: "Car / DC output", fields: [
      { key: "dc_output_power_total", label: "Car / DC", type: "sile", at: 1, unit: "W", role: "output" },
      { key: "dc_output_power_switch", label: "Car / DC output", type: "ui", at: 0, values: OFF_ON },
    ],
  },
  {
    tag: 0xc0, group: "Expansion battery", sequential: true, requires: "exp_1_sn", fields: [
      { key: "exp_1_sn", label: "Serial number", type: "str", hideWhen: "" },
      { key: "exp_1_id", label: "Slot", type: "ui" },
      { key: "exp_1_version", label: "Firmware", type: "version" },
      { key: "exp_1_temperature", label: "Temperature", type: "ui", signed: true, unit: "°C" },
      { key: "exp_1_status", label: "Status", type: "ui", values: { 0: "idle", 1: "discharging", 2: "charging" } },
      { key: "exp_1_soc", label: "Expansion battery", type: "ui", unit: "%", role: "expansion_battery" },
      // Skips the health byte (firmware bug, see top) and the constant blink status.
      { key: "exp_1_switch_status", label: "Output", type: "ui", skip: 2, values: OFF_ON },
      { key: "exp_1_error_code", label: "Error code", type: "ui" },
      { key: "exp_1_connection_status", label: "Connection", type: "ui", values: { 0: "not fitted", 1: "fitted" } },
      { key: "exp_1_balance_status", label: "Balancing", type: "ui" },
      { key: "exp_1_type", label: "Model", type: "str" },
    ],
  },
  {
    tag: 0xce, group: "Connected accessory", requires: "device_1_pn", fields: [
      { key: "device_1_pn", label: "Part number", type: "str", at: 0, hideWhen: "" },
      { key: "device_1_sn", label: "Serial number", type: "str", at: 18 },
      { key: "device_1_mode", label: "Mode", type: "ui", at: 40, values: { 1: "reverse charge", 2: "charge", 3: "standby" } },
      { key: "device_1_output_power", label: "Output", type: "sile", at: 41, unit: "W" },
    ],
  },
  {
    tag: 0xa4, group: "Settings", fields: [
      { key: "max_soc", label: "Max charge limit", type: "ui", at: 23, unit: "%", role: "setting" },
      { key: "min_soc", label: "Min discharge limit", type: "ui", at: 24, unit: "%", role: "setting" },
      { key: "ac_input_limit", label: "AC charge limit", type: "sile", at: 4, unit: "W", role: "setting" },
      { key: "ac_fast_charge_switch", label: "Ultrafast charging", type: "ui", at: 20, values: OFF_ON },
      { key: "ac_frequency", label: "AC frequency", type: "ui", at: 6, unit: "Hz" },
      { key: "ac_output_mode", label: "AC output mode", type: "ui", at: 7, values: { 0: "normal", 1: "smart (auto-off below 14 W)" } },
      { key: "ac_output_timeout_seconds", label: "AC output auto-off", type: "var", at: 0, signed: false, format: "seconds" },
      { key: "dc_12v_output_mode", label: "Car / DC output mode", type: "ui", at: 12, values: { 0: "normal", 1: "smart (auto-off below 3 W)" } },
      { key: "dc_output_timeout_seconds", label: "Car / DC output auto-off", type: "var", at: 8, signed: false, format: "seconds" },
      { key: "device_timeout_minutes", label: "Device auto-off", type: "sile", at: 13, unit: "min" },
      { key: "port_memory_switch", label: "Port memory", type: "ui", at: 22, values: OFF_ON },
      { key: "outage_alert_switch", label: "Outage alert", type: "ui", at: 31, mask: 0x02, values: OFF_ON },
      // Upstream maps battery-only to mask 0x0C, but on this unit bit 0x08 alone
      // tracks mains: set while AC is absent, cleared ~2 s after it returns
      // (verified by switching the station's AC supply on and off).
      { key: "ac_grid_absent", label: "AC grid", type: "ui", at: 31, mask: 0x08, values: { 0: "present", 1: "absent" } },
      { key: "battery_only_switch", label: "Battery-only mode (unverified)", type: "ui", at: 31, mask: 0x04,
        values: { 0: "off (AC input accepted)", 1: "on (AC input disabled)" } },
      { key: "temp_unit_fahrenheit", label: "Temperature unit", type: "ui", at: 19, values: { 0: "°C", 1: "°F" } },
      { key: "display_language", label: "Display language", type: "ui", at: 25,
        values: { 0: "English", 1: "Chinese", 2: "French", 3: "German", 4: "Japanese" } },
    ],
  },
  {
    tag: 0xa4, group: "Display", fields: [
      { key: "display_switch", label: "Screen lit", type: "ui", at: 21, values: OFF_ON },
      { key: "display_mode", label: "Brightness", type: "ui", at: 17, values: { 1: "low", 2: "medium", 3: "high" } },
      { key: "display_timeout_seconds", label: "Display timeout", type: "sile", at: 15, format: "seconds" },
    ],
  },
  {
    tag: 0xda, group: "Display", fields: [
      { key: "clock_switch", label: "Clock screensaver", type: "ui", at: 0, mask: 0x80, values: OFF_ON },
      { key: "clock_mode", label: "Clock format", type: "ui", at: 10, values: { 0: "12 h", 1: "24 h" } },
      { key: "clock_display_start_minutes", label: "Clock from", type: "sile", at: 11, format: "minutes_of_day" },
      { key: "clock_display_end_minutes", label: "Clock until", type: "sile", at: 13, format: "minutes_of_day" },
      { key: "clock_display_weekdays", label: "Clock days", type: "ui", at: 15, format: "weekdays" },
      { key: "display_night_switch", label: "Night mode", type: "ui", at: 16, values: OFF_ON },
      { key: "display_brightness_level", label: "Day brightness", type: "ui", at: 17, values: { 0: "5 %", 1: "20 %" } },
      { key: "display_night_brightness_level", label: "Night brightness", type: "ui", at: 18, values: { 0: "5 %", 1: "20 %" } },
      { key: "display_night_start_minutes", label: "Night from", type: "sile", at: 19, format: "minutes_of_day" },
      { key: "display_night_end_minutes", label: "Night until", type: "sile", at: 21, format: "minutes_of_day" },
    ],
  },
  {
    tag: 0xd9, group: "Backup & time-of-use", sequential: true, fields: [
      { key: "active_tariff", label: "Active tariff", type: "ui", values: { 0: "none", 1: "peak", 2: "mid-peak", 3: "off-peak" } },
      { key: "usage_mode", label: "Usage mode", type: "ui",
        values: { 0: "standard / UPS", 1: "time-of-use", 2: "self-consumption", 3: "custom" } },
      { key: "backup_soc", label: "Backup reserve", type: "ui", unit: "%" },
      { key: "backup_charge_soc", label: "Backup charge limit", type: "ui", unit: "%" },
      { key: "backup_discharge_soc", label: "Backup discharge limit", type: "ui", unit: "%" },
      // The variable-length TOU schedule and backup window timestamps follow; not decoded.
    ],
  },
  {
    tag: 0xdc, group: "Device", fields: [
      { key: "port_memory_switch_error", label: "Last port fault", type: "ui", at: 0, values: {
        0: "none", 1: "discharge over-temperature", 2: "discharge low-temperature", 3: "low battery",
        4: "BMS communication error", 5: "over-current", 6: "MOS over-temperature", 7: "pre-discharge MOS fault",
        8: "main charge MOS fault", 9: "main discharge MOS fault",
      } },
      { key: "port_memory_switch_error_timestamp", label: "Port restore due", type: "var", at: 1, signed: false,
        format: "timestamp", hideWhen: 0 },
    ],
  },
  {
    tag: 0xf9, group: "Firmware", fields: [
      { key: "mcu_version", label: "Main controller", type: "version", at: 0 },
      { key: "sub_mcu_version", label: "Sub controller", type: "version", at: 4 },
      { key: "inverter_version", label: "Inverter", type: "version", at: 12 },
      { key: "bms_version", label: "BMS", type: "version", at: 16 },
      { key: "sub_package_version", label: "Expansion pack", type: "version", at: 20 },
      { key: "hw_version", label: "Comms module", type: "version", at: 24 },
    ],
  },
];

// ------------------------------------------------------------------ settings
// From anker-solix-api's mqttmap.py "A1783" command groups (MQTT message
// types 0101 AC, 0102 DC, 0103 other, 0090 usage mode, 0091 display), sent
// over BLE as 4101 etc. The station answers with 0x800 | msgtype (4101 ->
// 4901, 4090 -> 4890), status 00 and a1 = 31.
//
// Verified on a live C2000 Gen 2 (fw 1.2.1.6) over BLE, fe timestamp, a1 = 21:
// each setting was changed and set back, and telemetry followed within ~4 s.
// The AC group (4101) is untested here: the test unit's AC output powers the
// owner's network, so nothing was sent on that message.

const SWITCH = { 0: "off", 1: "on" };
const NORMAL_SMART = { 0: "normal", 1: "smart" };
const UPSTREAM = "anker-solix-api MQTT map (A1783); untested over BLE";
const VERIFIED = "anker-solix-api MQTT map (A1783); verified on a C2000 Gen 2 over BLE";

export const C2000G2_SETTINGS: readonly SettingSpec[] = [
  // 0101: AC
  { id: "ac_output_switch", label: "AC output", group: "AC", msgtype: 0x101, verified: true,
    note: "Proven by SolixBLE on a C1000 Gen 2; same message in the A1783 map; not yet tried on a C2000",
    fields: [{ tag: 0xa2, type: "ui", label: "AC output", options: SWITCH, stateKey: "ac_output_power_switch" }] },
  { id: "ac_charge_limit", label: "AC recharging power", group: "AC", msgtype: 0x101, note: UPSTREAM,
    fields: [{ tag: 0xa4, type: "sile", label: "Limit", min: 200, max: 2400, step: 100, unit: "W", stateKey: "ac_input_limit" }] },
  { id: "ac_fast_charge_switch", label: "Ultrafast charging", group: "AC", msgtype: 0x101, note: UPSTREAM,
    fields: [{ tag: 0xa7, type: "ui", label: "Ultrafast", options: SWITCH, stateKey: "ac_fast_charge_switch" }] },
  { id: "battery_only_switch", label: "Battery-only (AC input off)", group: "AC", msgtype: 0x101,
    note: `${UPSTREAM}; sile type upstream; turning on also disables ultrafast`,
    fields: [{ tag: 0xab, type: "sile", label: "Battery-only", options: SWITCH, stateKey: "battery_only_switch" }] },
  { id: "ac_output_mode", label: "Smart AC output mode", group: "AC", msgtype: 0x101, note: UPSTREAM,
    fields: [{ tag: 0xa6, type: "ui", label: "Mode", options: NORMAL_SMART, stateKey: "ac_output_mode" }] },
  { id: "ac_output_timeout", label: "AC output auto-off", group: "AC", msgtype: 0x101, note: `${UPSTREAM}; 0 = never`,
    fields: [{ tag: 0xa3, type: "var", label: "Timeout", min: 0, max: 86400, step: 300, unit: "s", default: 0 }] },
  { id: "ac_frequency", label: "AC frequency", group: "AC", msgtype: 0x101, note: UPSTREAM,
    caution: "Upstream warns this is a setup setting with device dependencies; don't change it with loads attached.",
    fields: [{ tag: 0xa5, type: "ui", label: "Frequency", options: { 50: "50 Hz", 60: "60 Hz" }, stateKey: "ac_frequency" }] },

  // 0102: car / 12 V DC
  { id: "dc_output_switch", label: "Car / 12 V DC output", group: "DC", msgtype: 0x102, verified: true,
    note: "SolixBLE (C1000 Gen 2); verified on a C2000 Gen 2 over BLE",
    fields: [{ tag: 0xa2, type: "ui", label: "DC output", options: SWITCH, stateKey: "dc_output_power_switch" }] },
  { id: "dc_12v_output_mode", label: "Car charger power saving mode", group: "DC", msgtype: 0x102, verified: true, note: VERIFIED,
    fields: [{ tag: 0xa4, type: "ui", label: "Mode", options: NORMAL_SMART, stateKey: "dc_12v_output_mode" }] },
  { id: "dc_output_timeout", label: "Car / DC output auto-off", group: "DC", msgtype: 0x102,
    note: `${UPSTREAM}; 0 = never. Accepted (status 00) with the outlet off, but the countdown in telemetry stayed at 0`,
    fields: [{ tag: 0xa3, type: "var", label: "Timeout", min: 0, max: 86400, step: 300, unit: "s", default: 0 }] },

  // 0090: usage mode / backup
  { id: "usage_mode", label: "Power usage scenario", group: "Backup & time-of-use", msgtype: 0x090, verified: true, note: VERIFIED,
    fields: [{ tag: 0xa2, type: "ui", label: "Mode", options: { 0: "standard / UPS", 1: "time-of-use" }, stateKey: "usage_mode" }] },
  { id: "backup_soc", label: "Backup reserve", group: "Backup & time-of-use", msgtype: 0x090, verified: true,
    note: `${VERIFIED}; range min discharge + 5 to max charge`,
    fields: [{ tag: 0xa5, type: "ui", label: "Reserve", min: 5, max: 100, unit: "%", stateKey: "backup_soc" }] },
  // 005e: backup plans. a3 = plan (3 = backup), a4 = which option (1 = Storm Guard), a5 = on/off.
  // The Fast Charging Plan (a4 = 0) also needs a6/a7 start and end timestamps; not offered here.
  { id: "storm_guard", label: "Storm Guard", group: "Backup & time-of-use", msgtype: 0x05e, note: UPSTREAM,
    fields: [
      { tag: 0xa3, type: "ui", label: "Plan", options: { 3: "backup" } },
      { tag: 0xa4, type: "ui", label: "Option", options: { 1: "Storm Guard" } },
      { tag: 0xa5, type: "ui", label: "Storm Guard", options: SWITCH },
    ] },

  // 0103: battery limits and device
  { id: "soc_limits", label: "Charge / discharge limits", group: "Battery", msgtype: 0x103, verified: true, note: VERIFIED,
    fields: [
      { tag: 0xaa, type: "ui", label: "Max charge", unit: "%", stateKey: "max_soc",
        options: { 80: "80 %", 85: "85 %", 90: "90 %", 95: "95 %", 100: "100 %" } },
      { tag: 0xab, type: "ui", label: "Min discharge", unit: "%", stateKey: "min_soc",
        options: { 1: "1 %", 5: "5 %", 10: "10 %", 15: "15 %", 20: "20 %" } },
    ] },
  { id: "port_memory_switch", label: "Output port memory", group: "Device", msgtype: 0x103, verified: true, note: VERIFIED,
    fields: [{ tag: 0xa8, type: "ui", label: "Port memory", options: SWITCH, stateKey: "port_memory_switch" }] },
  { id: "outage_alert_switch", label: "Grid outage alert", group: "Device", msgtype: 0x103, verified: true, note: VERIFIED,
    fields: [{ tag: 0xb0, type: "ui", label: "Outage alert", options: SWITCH, stateKey: "outage_alert_switch" }] },
  { id: "device_timeout", label: "Device timeout", group: "Device", msgtype: 0x103, note: UPSTREAM,
    fields: [{ tag: 0xa6, type: "sile", label: "Timeout", stateKey: "device_timeout_minutes",
      options: { 0: "never", 30: "30 min", 60: "1 h", 120: "2 h", 240: "4 h", 360: "6 h", 720: "12 h", 1440: "24 h" } }] },
  { id: "display_language", label: "Device language", group: "Device", msgtype: 0x103, note: UPSTREAM,
    fields: [{ tag: 0xa9, type: "ui", label: "Language", stateKey: "display_language",
      options: { 0: "English", 1: "Chinese", 2: "French", 3: "German", 4: "Japanese" } }] },
  { id: "temp_unit", label: "Temperature unit", group: "Device", msgtype: 0x103, verified: true, note: VERIFIED,
    fields: [{ tag: 0xa5, type: "ui", label: "Unit", options: { 0: "°C", 1: "°F" }, stateKey: "temp_unit_fahrenheit" }] },

  // 0103 / 0091: display
  { id: "display_switch", label: "Screen", group: "Display", msgtype: 0x103, verified: true, toggle: true,
    note: "Turns the screen on or off right now, like the power button; not in the Anker app. It doesn't change "
      + "any setting: the screen timeout and the station's own rules (e.g. screen on while recharging) still apply.",
    fields: [{ tag: 0xa2, type: "ui", label: "Display", options: SWITCH, stateKey: "display_switch" }] },
  { id: "display_mode", label: "Screen brightness", group: "Display", msgtype: 0x103, verified: true, note: VERIFIED,
    fields: [{ tag: 0xa3, type: "ui", label: "Brightness", options: { 1: "low", 2: "medium", 3: "high" }, stateKey: "display_mode" }] },
  { id: "display_timeout", label: "Screen timeout", group: "Display", msgtype: 0x103, verified: true,
    note: `${VERIFIED}; the Anker app shows the value written here. Per the manual the screen stays on `
      + "while recharging and during the screensaver hours; it stayed lit at 20 s while charging from solar.",
    fields: [{ tag: 0xa4, type: "sile", label: "Timeout", stateKey: "display_timeout_seconds",
      options: { 0: "never", 10: "10 s", 20: "20 s", 30: "30 s", 60: "1 min", 300: "5 min", 1800: "30 min" } }] },

  // 0091 a2: one byte, screensaver on = 0x80, low 3 bits = theme (0-2 built in). Read back in da[0].
  { id: "screensaver", label: "Screensaver", group: "Display", msgtype: 0x091,
    note: `${UPSTREAM}; packed byte: also sets the theme to built-in theme 1`,
    fields: [{ tag: 0xa2, type: "ui", label: "Screensaver", stateKey: "clock_switch",
      mask: 0x80, options: SWITCH }] },
];

const NAMES = [/^SOLIX C2000X? Gen 2/];
const PART_NUMBERS = ["A1783", "A1785"];

export const c2000g2: DeviceModel = {
  id: "solix-c2000-gen2",
  name: "SOLIX C2000 Gen 2",
  preferredOuter: "encrypted",
  matches: ({ name, partNumber }) =>
    (!!name && NAMES.some((re) => re.test(name))) || (!!partNumber && PART_NUMBERS.includes(partNumber)),
  onAuthorized: GEN2_ON_AUTHORIZED,
  settings: C2000G2_SETTINGS,
  partNumber: (p) => decodeTags([C2000G2_FIELDS[0]!], p).find((f) => f.key === "device_pn")?.value as string | undefined,
  decodeTelemetry: (cmd, p) => (GEN2_TELEMETRY_CMDS.includes(cmd) ? decodeTags(C2000G2_FIELDS, p) : []),
};
