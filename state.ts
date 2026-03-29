import { existsSync, renameSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

export interface ChannelEntry {
  enabled: boolean;
  name: string;
  last_message: string;
  message_count: number;
}

export interface ChannelState {
  channels: Record<string, ChannelEntry>;
  updated_at: string;
}

export const STATE_PATH = join(import.meta.dir, "channel_state.json");
const TMP_PATH = STATE_PATH + ".tmp";

export function readState(): ChannelState {
  if (!existsSync(STATE_PATH)) {
    return { channels: {}, updated_at: new Date().toISOString() };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return { channels: {}, updated_at: new Date().toISOString() };
  }
}

export function writeState(state: ChannelState): void {
  state.updated_at = new Date().toISOString();
  writeFileSync(TMP_PATH, JSON.stringify(state, null, 2));
  renameSync(TMP_PATH, STATE_PATH);
}
