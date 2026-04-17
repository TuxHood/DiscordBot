# Discord Bot

The current deployment path is the Node.js bot in [discord_bot_js/](discord_bot_js). The Python bot remains in the repository for reference, but it is not the active runtime.

## Requirements

- Node.js 22.12 or newer
- FFmpeg available on the host system

## Setup

1. Change into the bot directory:

   ```bash
   cd discord_bot_js
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

4. Fill in `DISCORD_TOKEN` and `API_TOKEN` in `.env`.

5. Start the bot:

   ```bash
   npm start
   ```

`N8N_WEBHOOK_URL` is optional and only used for mention forwarding.

## Local API

The HTTP API listens on `HTTP_HOST:HTTP_PORT` and protects `/api/music/*` with the `x-api-token` header.

```bash
x-api-token: your API_TOKEN value
```

Endpoints:

- `GET /api/health`
- `POST /api/music/play`
- `POST /api/music/pause`
- `POST /api/music/resume`
- `POST /api/music/skip`
- `POST /api/music/stop`
- `GET /api/music/queue`

## Notes

- The bot code lives in [discord_bot_js/src](discord_bot_js/src).
- `discord_bot_js/update.sh` is provided for systemd-style restart/update workflows.


