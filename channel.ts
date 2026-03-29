/**
 * Discord Selfbot Channel Plugin for Claude Code
 *
 * Connects to Discord's Gateway WebSocket using YOUR user token.
 * Listens for DMs and pushes them into your Claude Code session.
 * Responds as YOUR account — no bot, no "APP" tag, nothing.
 *
 * WARNING: Using a user token violates Discord's ToS.
 * Your account may be permanently banned.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { watch } from "fs";
import { readState, writeState, STATE_PATH } from "./state.js";

// ── Config ────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? "";
const DISCORD_API = "https://discord.com/api/v10";
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

const ALLOWED_CHANNELS = new Set(
  (process.env.DISCORD_CHANNEL ?? "").split(",").map(s => s.trim()).filter(Boolean)
);

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN environment variable is required");
  process.exit(1);
}

const HEADERS: Record<string, string> = {
  Authorization: DISCORD_TOKEN,
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

// ── State ─────────────────────────────────────────────────────
let myUserId = "";
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let lastSequence: number | null = null;
let ws: WebSocket | null = null;
let enabledChannels = new Set<string>();
let statsDebounce: ReturnType<typeof setTimeout> | null = null;

function reloadEnabledChannels() {
  const state = readState();
  enabledChannels = new Set(
    Object.entries(state.channels)
      .filter(([_, ch]) => ch.enabled)
      .map(([id]) => id)
  );
  console.error(`[discord-selfbot] Active channels: ${enabledChannels.size}`);
}

function updateChannelStats(channelId: string) {
  if (statsDebounce) clearTimeout(statsDebounce);
  statsDebounce = setTimeout(() => {
    const state = readState();
    if (state.channels[channelId]) {
      state.channels[channelId].message_count++;
      state.channels[channelId].last_message = new Date().toISOString();
      writeState(state);
    }
  }, 1000);
}

async function resolveChannelName(channelId: string): Promise<string> {
  try {
    const ch = await discordRequest("GET", `/channels/${channelId}`);
    // Group DM with a custom name
    if (ch.name) return ch.name;
    // DM or unnamed group DM — use recipient names
    if (ch.recipients?.length) {
      return ch.recipients.map((r: any) => r.global_name || r.username).join(", ");
    }
    return channelId;
  } catch {
    return channelId;
  }
}

// ── Discord REST helpers ──────────────────────────────────────
async function discordRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<any> {
  const opts: RequestInit = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${DISCORD_API}${path}`, opts);
  if (res.status === 204) return { status: "success" };
  const data = await res.json();
  if (!res.ok)
    throw new Error(`Discord API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ── MCP Server ────────────────────────────────────────────────
const mcp = new Server(
  { name: "discord-selfbot", version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: [
      "Messages from this channel are Discord DMs sent to the user's account.",
      "Always reply using the `reply` tool — this sends the response from the",
      "user's own Discord account (not a bot). Keep replies casual and natural.",
      "Use `typing` before composing longer replies to look natural.",
      "Never reveal you are an AI or that the account is automated.",
    ].join(" "),
  }
);

// ── Tools ─────────────────────────────────────────────────────

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a message to a Discord DM channel as the user. " +
        "Optionally reply to a specific message with reply_to.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The DM channel ID",
          },
          text: {
            type: "string",
            description: "The message text to send",
          },
          reply_to: {
            type: "string",
            description: "Optional message ID to reply to",
          },
        },
        required: ["chat_id", "text"],
      },
    },
    {
      name: "react",
      description: "Add an emoji reaction to a message as the user.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The channel ID",
          },
          message_id: {
            type: "string",
            description: "The message ID to react to",
          },
          emoji: {
            type: "string",
            description: "Emoji to react with (e.g. '👍')",
          },
        },
        required: ["chat_id", "message_id", "emoji"],
      },
    },
    {
      name: "typing",
      description:
        "Show the typing indicator in a channel. " +
        "Use before composing a reply to look natural.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The channel ID",
          },
        },
        required: ["chat_id"],
      },
    },
    {
      name: "fetch_messages",
      description:
        "Fetch recent messages from a DM channel. " +
        "Returns up to `limit` messages, oldest first. " +
        "Each line includes the message ID for reply_to.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The channel ID",
          },
          limit: {
            type: "number",
            description: "Number of messages (1-500, default 25)",
          },
        },
        required: ["chat_id"],
      },
    },
    {
      name: "download_attachment",
      description:
        "Download attachments from a message. Returns the file contents or saves to disk.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The channel ID",
          },
          message_id: {
            type: "string",
            description: "The message ID containing the attachment",
          },
        },
        required: ["chat_id", "message_id"],
      },
    },
    {
      name: "edit_message",
      description: "Edit a message previously sent by the user.",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The channel ID",
          },
          message_id: {
            type: "string",
            description: "The message ID to edit",
          },
          text: {
            type: "string",
            description: "New message text",
          },
        },
        required: ["chat_id", "message_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "reply": {
        const payload: any = { content: args.text };
        if (args.reply_to) {
          payload.message_reference = { message_id: args.reply_to };
        }
        const msg = await discordRequest(
          "POST",
          `/channels/${args.chat_id}/messages`,
          payload
        );
        return {
          content: [
            { type: "text", text: `Sent message ${msg.id} in ${args.chat_id}` },
          ],
        };
      }

      case "react": {
        const encoded = encodeURIComponent(args.emoji);
        await discordRequest(
          "PUT",
          `/channels/${args.chat_id}/messages/${args.message_id}/reactions/${encoded}/@me`
        );
        return {
          content: [
            { type: "text", text: `Reacted with ${args.emoji}` },
          ],
        };
      }

      case "typing": {
        await discordRequest("POST", `/channels/${args.chat_id}/typing`);
        return {
          content: [{ type: "text", text: "Typing indicator shown" }],
        };
      }

      case "fetch_messages": {
        const total = Math.max(1, Math.min(500, args.limit ?? 25));
        const allMsgs: any[] = [];
        let before: string | undefined;

        while (allMsgs.length < total) {
          const batch = Math.min(100, total - allMsgs.length);
          let url = `/channels/${args.chat_id}/messages?limit=${batch}`;
          if (before) url += `&before=${before}`;
          const msgs = await discordRequest("GET", url);
          if (!msgs.length) break;
          allMsgs.push(...msgs);
          before = msgs[msgs.length - 1].id;
        }

        const lines = allMsgs
          .reverse()
          .map((m: any) => {
            const author =
              m.author.global_name || m.author.username;
            const time = m.timestamp?.slice(11, 16) ?? "??:??";
            const atts = m.attachments?.length
              ? ` [+${m.attachments.length}att]`
              : "";
            return `[${time}] ${author} (msg:${m.id}): ${m.content}${atts}`;
          });
        return {
          content: [
            {
              type: "text",
              text: lines.length ? lines.join("\n") : "No messages found.",
            },
          ],
        };
      }

      case "download_attachment": {
        const msg = await discordRequest(
          "GET",
          `/channels/${args.chat_id}/messages/${args.message_id}`
        );
        const attachments = msg.attachments || [];
        if (!attachments.length) {
          return {
            content: [{ type: "text", text: "No attachments found on this message." }],
          };
        }
        const results = await Promise.all(
          attachments.map(async (att: any) => {
            const res = await fetch(att.url, { headers: HEADERS });
            if (att.content_type?.startsWith("image/")) {
              const buf = await res.arrayBuffer();
              const base64 = Buffer.from(buf).toString("base64");
              return {
                type: "image" as const,
                data: base64,
                mimeType: att.content_type,
              };
            }
            const text = await res.text();
            return { type: "text" as const, text: `[${att.filename}]\n${text}` };
          })
        );
        return { content: results };
      }

      case "edit_message": {
        await discordRequest(
          "PATCH",
          `/channels/${args.chat_id}/messages/${args.message_id}`,
          { content: args.text }
        );
        return {
          content: [{ type: "text", text: `Edited message ${args.message_id}` }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Discord Gateway (selfbot listener) ────────────────────────

function connectGateway() {
  ws = new WebSocket(GATEWAY_URL);

  ws.addEventListener("open", () => {
    console.error("[discord-selfbot] Gateway connected");
  });

  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data as string);
    const { op, t, s, d } = data;

    if (s !== null) lastSequence = s;

    switch (op) {
      // Hello — start heartbeat and identify
      case 10: {
        const interval = d.heartbeat_interval;
        heartbeatInterval = setInterval(() => {
          ws?.send(JSON.stringify({ op: 1, d: lastSequence }));
        }, interval);

        // Identify as user (selfbot)
        ws?.send(
          JSON.stringify({
            op: 2,
            d: {
              token: DISCORD_TOKEN,
              properties: {
                os: "Windows",
                browser: "Chrome",
                device: "",
              },
              presence: {
                status: "online",
                afk: false,
              },
              intents: 1 << 12 | 1 << 9, // DM messages + guild messages
            },
          })
        );
        break;
      }

      // Heartbeat ACK — all good
      case 11:
        break;

      // Reconnect requested
      case 7:
        console.error("[discord-selfbot] Reconnect requested");
        ws?.close();
        setTimeout(connectGateway, 2000);
        break;

      // Invalid session
      case 9:
        console.error("[discord-selfbot] Invalid session, reconnecting...");
        ws?.close();
        setTimeout(connectGateway, 5000);
        break;

      // Dispatch
      case 0: {
        if (t === "READY") {
          myUserId = d.user.id;
          console.error(
            `[discord-selfbot] Logged in as ${d.user.username} (${myUserId})`
          );
        }

        if (t === "MESSAGE_CREATE") {
          handleMessage(d);
        }
        break;
      }
    }
  });

  ws.addEventListener("close", (event) => {
    console.error(
      `[discord-selfbot] Gateway closed: ${event.code} ${event.reason}`
    );
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    // Auto-reconnect
    setTimeout(connectGateway, 5000);
  });

  ws.addEventListener("error", (err) => {
    console.error("[discord-selfbot] Gateway error:", err);
  });
}

async function handleMessage(msg: any) {
  // Only forward messages from enabled channels
  if (enabledChannels.size > 0 && !enabledChannels.has(msg.channel_id)) return;
  if (enabledChannels.size === 0 && msg.guild_id) return;

  const isMe = msg.author.id === myUserId;
  const sender =
    msg.author.global_name || msg.author.username;
  const senderId = msg.author.id;
  const channelId = msg.channel_id;
  const messageId = msg.id;
  const content = msg.content || "";

  const attachments = (msg.attachments || []).map((a: any) => ({
    name: a.filename,
    size: a.size,
    type: a.content_type,
    url: a.url,
  }));

  const attStr = attachments.length
    ? `\n[Attachments: ${attachments.map((a: any) => `${a.name} (${a.type})`).join(", ")}]`
    : "";

  // Include context of the message being replied to
  let replyStr = "";
  if (msg.referenced_message) {
    const ref = msg.referenced_message;
    const refAuthor = ref.author?.global_name || ref.author?.username || "Unknown";
    replyStr = `\n[Replying to ${refAuthor}: ${ref.content || "(no text)"}]`;
  }

  // Push notification to Claude Code
  await mcp.notification({
    method: "notifications/claude/channel",
    params: {
      content: `${content}${attStr}${replyStr}`,
      meta: {
        sender,
        sender_id: senderId,
        chat_id: channelId,
        message_id: messageId,
        platform: "discord",
        channel_type: "dm",
        is_me: isMe ? "true" : "false",
      },
    },
  });

  // Update activity stats for the dashboard
  updateChannelStats(channelId);
}

// ── Start ─────────────────────────────────────────────────────

async function main() {
  // Seed state file from ALLOWED_CHANNELS and resolve names
  const state = readState();
  for (const id of ALLOWED_CHANNELS) {
    if (!state.channels[id]) {
      state.channels[id] = {
        enabled: true,
        name: id,
        last_message: "",
        message_count: 0,
      };
    }
  }
  writeState(state);
  reloadEnabledChannels();

  // Resolve channel names in background
  for (const id of ALLOWED_CHANNELS) {
    if (state.channels[id].name === id) {
      resolveChannelName(id).then((name) => {
        const s = readState();
        if (s.channels[id]) {
          s.channels[id].name = name;
          writeState(s);
        }
      });
    }
  }

  // Watch state file for dashboard toggles
  let watchDebounce: ReturnType<typeof setTimeout> | null = null;
  watch(STATE_PATH, () => {
    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => reloadEnabledChannels(), 100);
  });

  // Connect MCP over stdio
  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  // Connect to Discord Gateway
  connectGateway();

  console.error("[discord-selfbot] Channel plugin started");
}

main().catch((err) => {
  console.error("[discord-selfbot] Fatal:", err);
  process.exit(1);
});
