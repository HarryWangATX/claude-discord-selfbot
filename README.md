# Discord Selfbot Channel for Claude Code

A custom Claude Code channel plugin that connects to Discord using **your own user token** — no bot account needed. Both listening and responding happen through your account. Zero bot presence in your server.

> **⚠️ Using a user token violates Discord's Terms of Service. Your account may be permanently banned.**

## How it works

```
Someone DMs you on Discord
        │
        ▼
Gateway WebSocket (your user token) receives it
        │
        ▼
Channel plugin pushes it into Claude Code session
        │
        ▼
Claude processes it + replies using your account
        │
        ▼
Response appears FROM YOU — no bot, no "APP" tag
```

Everything goes through your account. There is no bot in your member list, no bot token, nothing visible to anyone.

---

## Prerequisites

- **Claude Code v2.1.80+** — `claude --version`
- **Bun runtime** — `curl -fsSL https://bun.sh/install | bash`
- **Claude.ai Pro or Max subscription** (API keys don't work with Channels)
- **Your Discord user token** (see below)

---

## Get your Discord user token

**Browser method:**
1. Open https://discord.com/app
2. Press `F12` → Network tab
3. Click around in Discord
4. Find any request to `discord.com/api`
5. Copy the `Authorization` header value

**Console shortcut:**
```js
(webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken).exports.default.getToken()
```

---

## Setup

### 1. Clone and install

```bash
git clone <this-repo> discord-selfbot-channel
cd discord-selfbot-channel
bun install
```

Or if you downloaded the files:

```bash
cd discord-selfbot-channel
bun install
```

### 2. Configure `.env`

Copy the example and fill in your values:

```bash
cp .env.example .env
```

```
DISCORD_TOKEN=your_token_here
DISCORD_CHANNEL=channel_id_1,channel_id_2
```

#### `DISCORD_TOKEN` (required)

Your Discord user token. See [Get your Discord user token](#get-your-discord-user-token) above.

#### `DISCORD_CHANNEL` (optional)

Comma-separated list of channel IDs to listen to. Supports DMs, group DMs, and server channels.

- If set, the bot only responds in those channels.
- If empty/unset, the bot responds to all DMs.

**To get a channel ID:**
1. Open Discord Settings > Advanced > enable **Developer Mode**
2. Right-click a channel, DM, or group DM > **Copy Channel ID**

### 3. Launch

From the project directory:

```bash
cd discord-selfbot-channel
claude --dangerously-load-development-channels server:discord-selfbot
```

### 4. Test it

Have someone (or use another account) send you a DM on Discord. You should see it appear in your Claude Code session. Claude will process it and reply as you.

---

## Dashboard

Toggle channels on/off in real-time while the bot is running. In a separate terminal:

```bash
bun run dashboard.ts
```

```
┌──────────────────────────────────────────────────────────┐
│ Discord Channel Dashboard                                │
│                                                          │
│ ▸ ● study group (123456789012345678)           12 msgs    │
│   ● alice (234567890123456789)                           │
│   ○ bob, carol (345678901234567890)            3 msgs    │
│   ● gaming chat (456789012345678901)                     │
│                                                          │
│ ↑↓ navigate  ␣ toggle  q quit                           │
└──────────────────────────────────────────────────────────┘
```

- **Arrow keys** to navigate
- **Space** to toggle a channel on/off
- **q** to quit

Changes take effect immediately — the bot watches the state file and reloads.

---

## Running 24/7

Use `tmux` or `screen` to keep the session alive:

```bash
# Create a persistent session
tmux new-session -d -s discord \
  "cd /path/to/discord-selfbot-channel && claude --dangerously-load-development-channels server:discord-selfbot"

# Attach to check on it
tmux attach -t discord

# Detach without stopping: Ctrl+B, then D
```

---

## Tools available to Claude

| Tool             | Description                                      |
|------------------|--------------------------------------------------|
| `reply`          | Send a message / reply as you                    |
| `react`          | Add an emoji reaction as you                     |
| `typing`         | Show typing indicator (looks natural)            |
| `fetch_messages` | Read recent messages from a DM                   |
| `edit_message`   | Edit a previously sent message                   |

---

## What gets forwarded

- If `DISCORD_CHANNEL` is set in `.env`, only those channels are listened to (DMs, group DMs, or server channels).
- If `DISCORD_CHANNEL` is empty/unset, all DMs are forwarded.
- Your own messages are always ignored (prevents loops).

## Customizing behavior

Edit `CLAUDE.md` to control how Claude responds — tone, personality, rules, etc.

The `chat_context/` directory stores per-channel conversation summaries so Claude remembers context across sessions. These are automatically created and compressed over time.

---

## Tips

- **Use typing indicator.** The plugin instructions tell Claude to call `typing` before composing replies, which makes it look like you're actually typing.
- **Don't respond instantly.** A human doesn't reply in 200ms. The typing indicator adds natural delay.
- **Keep replies casual.** The plugin instructions tell Claude to match Discord tone.
- **Token rotation.** If you change your password or toggle 2FA, grab a fresh token.
- **One session at a time.** Discord only allows one Gateway connection per user token. If you're also logged into Discord normally, the selfbot connection may conflict. Running it on a separate machine or when you're "offline" works best.

---

## Troubleshooting

**"Gateway closed: 4004"**
- Invalid token. Grab a fresh one.

**"Gateway closed: 4013" or "Invalid intents"**
- Discord may be blocking the intents. This is rare for user accounts but can happen.

**Messages not appearing in Claude Code**
- Make sure you launched with `--dangerously-load-development-channels server:discord-selfbot`
- Make sure you're running from the project directory

**Conflict with regular Discord client**
- Discord allows only one active Gateway connection per token. Your normal Discord client may disconnect when the selfbot connects (or vice versa). Consider running this when you're "away" or on a secondary machine.

**Claude replies but message doesn't appear in Discord**
- Check the Claude Code terminal for API errors (usually 401 = expired token, 403 = wrong channel permissions)
