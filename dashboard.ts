#!/usr/bin/env bun

import { watchFile } from "fs";
import { readState, writeState, STATE_PATH } from "./state.js";
import type { ChannelState } from "./state.js";

// ── Terminal helpers ─────────────────────────────────────────
const write = (s: string) => process.stdout.write(s);
const ESC = "\x1b";
const enterAlt = () => write(`${ESC}[?1049h${ESC}[?25l`);
const exitAlt = () => write(`${ESC}[?1049l${ESC}[?25h`);
const clear = () => write(`${ESC}[2J${ESC}[H`);
const moveTo = (r: number, c: number) => write(`${ESC}[${r};${c}H`);
const bold = (s: string) => `${ESC}[1m${s}${ESC}[0m`;
const green = (s: string) => `${ESC}[32m${s}${ESC}[0m`;
const red = (s: string) => `${ESC}[31m${s}${ESC}[0m`;
const dim = (s: string) => `${ESC}[90m${s}${ESC}[0m`;

// ── State ────────────────────────────────────────────────────
let state: ChannelState = readState();
let cursor = 0;
let skipNextWatch = false;

function channelIds(): string[] {
  return Object.keys(state.channels);
}

// ── Render ───────────────────────────────────────────────────
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const visLen = (s: string) => stripAnsi(s).length;

function padRow(content: string, w: number): string {
  const len = visLen(content);
  return `│ ${content}${" ".repeat(Math.max(0, w - 4 - len))} │`;
}

function render() {
  clear();
  const ids = channelIds();
  const w = 60;

  moveTo(1, 1);
  write(`┌${"─".repeat(w - 2)}┐`);

  moveTo(2, 1);
  write(padRow(bold("Discord Channel Dashboard"), w));

  moveTo(3, 1);
  write(padRow("", w));

  if (ids.length === 0) {
    moveTo(4, 1);
    write(padRow(dim("No channels configured. Start channel.ts first."), w));
    moveTo(5, 1);
    write(`└${"─".repeat(w - 2)}┘`);
    return;
  }

  ids.forEach((id, i) => {
    const ch = state.channels[id];
    const selected = i === cursor;
    const arrow = selected ? bold("▸") : " ";
    const dot = ch.enabled ? green("●") : red("○");
    const name = ch.name !== id ? ch.name : dim(id.slice(0, 12));
    const msgs = ch.message_count > 0 ? dim(`${ch.message_count} msgs`) : "";

    const left = `${arrow} ${dot} ${name}`;
    const leftLen = visLen(left);
    const msgsLen = visLen(msgs);
    const gap = Math.max(2, w - 4 - leftLen - msgsLen);

    moveTo(4 + i, 1);
    write(`│ ${left}${" ".repeat(gap)}${msgs} │`);
  });

  const footerRow = 4 + ids.length;
  moveTo(footerRow, 1);
  write(padRow("", w));

  moveTo(footerRow + 1, 1);
  write(padRow(dim("↑↓ navigate  ␣ toggle  q quit"), w));

  moveTo(footerRow + 2, 1);
  write(`└${"─".repeat(w - 2)}┘`);
}

// ── Toggle ───────────────────────────────────────────────────
function toggle() {
  const ids = channelIds();
  if (ids.length === 0) return;
  const id = ids[cursor];
  state.channels[id].enabled = !state.channels[id].enabled;
  skipNextWatch = true;
  writeState(state);
  render();
}

// ── Input ────────────────────────────────────────────────────
function handleKey(buf: Buffer) {
  const key = buf.toString();
  const ids = channelIds();

  if (key === "q" || key === "\x03") {
    cleanup();
    return;
  }

  if (key === " " || key === "\r") {
    toggle();
    return;
  }

  // Arrow keys
  if (key === `${ESC}[A`) {
    cursor = Math.max(0, cursor - 1);
    render();
  } else if (key === `${ESC}[B`) {
    cursor = Math.min(ids.length - 1, cursor + 1);
    render();
  }
}

// ── Cleanup ──────────────────────────────────────────────────
function cleanup() {
  exitAlt();
  process.stdin.setRawMode(false);
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", handleKey);

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Watch for state changes from channel.ts
watchFile(STATE_PATH, { interval: 500 }, () => {
  if (skipNextWatch) {
    skipNextWatch = false;
    return;
  }
  state = readState();
  const ids = channelIds();
  if (cursor >= ids.length) cursor = Math.max(0, ids.length - 1);
  render();
});

enterAlt();
render();
