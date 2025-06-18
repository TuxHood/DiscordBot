# Discord Bot

This repository contains **Arisu**, a Discord bot implemented with `discord.py`.

## Setup

1. **Install Python and create a virtual environment**

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

   Then install the required packages:

   ```bash
   pip install -r discord_bot_server/requirements.txt
   ```

2. **Install FFmpeg**

   FFmpeg is required for music playback. On Debian-based systems you can install it with:

   ```bash
   sudo apt install ffmpeg
   ```

3. **Configure the bot token**

   Create a file named `.env` in the repository root and add your Discord bot token:

   ```env
   Arisu_Token=YOUR_TOKEN_HERE
   ```

## Running the Bot

Use the provided script to update dependencies and launch the bot:

```bash
bash discord_bot_server/update.sh
```

## Features (Cogs)

The bot's functionality is organized into cogs located in `discord_bot_server/cogs`:

- **music** – Play audio from YouTube links or searches. Supports queueing, skip, pause, resume and more.
- **autorole** – Automatically assigns a predefined role to members when they join a server.
- **reactionroles** – Allows administrators to assign or remove roles based on message reactions.
- **test** – Provides a simple `!goodnight` command.


