import os
import asyncio
import warnings
import logging
import sqlite3
from itertools import cycle

import discord
from discord.ext import commands, tasks
from dotenv import load_dotenv
import mafic

# ---------- Logging (SEE CONSOLE) ----------
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s:%(name)s: %(message)s",
)
logging.getLogger("discord").setLevel(logging.INFO)
logging.getLogger("mafic").setLevel(logging.DEBUG)     # <— noisy but useful
logging.getLogger("websockets").setLevel(logging.WARNING)
log = logging.getLogger("arisu")

# ---------- Mafic version warning (name differs across versions) ----------
try:
    from mafic.pool import UnsupportedVersionWarning as MaficVersionWarning
except Exception:
    try:
        from mafic.pool import UnknownVersionWarning as MaficVersionWarning
    except Exception:
        MaficVersionWarning = Warning
warnings.filterwarnings("ignore", category=MaficVersionWarning)

# ---------- Env / Token ----------
load_dotenv(override=True)
TOKEN = os.getenv("Arisu_Token")

if not TOKEN:
    print("Bot token not found!")
elif TOKEN.strip() != TOKEN:
    print("Bot token contains spaces, please remove them.")
else:
    print("Bot token is valid.")

# ---------- Bot / Intents ----------
intents = discord.Intents.all()
client = commands.Bot(command_prefix="!", intents=intents)

# ---------- Presence ----------
# client_statuses = cycle(["I am the tester?...", "master needs my help."])
client_statuses = cycle(["as a maid","with the server, teehee"])

@tasks.loop(seconds=30)
async def change_client_status():
    try:
        await client.change_presence(activity=discord.Game(next(client_statuses)))
    except Exception:
        pass

# ---------- Lavalink (Mafic) ----------
async def ensure_lavalink_node():
    if not hasattr(client, "lavalink"):
        client.lavalink = mafic.NodePool(client)
    # Your remote node (we already opened 2333)
    await client.lavalink.create_node(
        host="10.10.10.84",
        port=2333,
        password="zerotwo",
        label="MAIN",
        # secure=False  # default
    )
    log.info("Connected Lavalink node MAIN at 10.10.10.84:2333")

# Forward Discord VOICE_* gateway events to Mafic
@client.event
async def on_socket_response(payload):
    if hasattr(client, "lavalink"):
        await client.lavalink.on_socket_response(payload)

# ---------- Events ----------
@client.event
async def on_ready():
    log.info("Bot is ready")
    change_client_status.start()
    await ensure_lavalink_node()
    try:
        synced = await client.tree.sync()
        log.info("Synced %d commands.", len(synced))
    except Exception as e:
        log.exception("Slash sync failed: %s", e)

@client.event
async def on_command_error(ctx, error):
    # Surface command errors to console and chat
    log.exception("Command error in %s: %s", ctx.command, error)
    try:
        await ctx.send(f"⚠️ {type(error).__name__}: {error}")
    except Exception:
        pass

# quick sanity text & slash
@client.command()
async def hello(ctx: commands.Context):
    await ctx.send(f"Hi, {ctx.author.mention}")

@client.tree.command(name="hello", description="Says Hello back")
async def hello_slash(interaction: discord.Interaction):
    await interaction.response.send_message(f"{interaction.user.mention} Hello!", ephemeral=True)

# ---------- SQLite (fixed DELETE syntax) ----------
@client.event
async def on_guild_join(guild: discord.Guild):
    os.makedirs("servers_info", exist_ok=True)
    conn = sqlite3.connect("servers_info/main.db")
    cur = conn.cursor()
    cur.execute("CREATE TABLE IF NOT EXISTS Guilds (guild_id INTEGER PRIMARY KEY)")
    cur.execute("INSERT OR IGNORE INTO Guilds (guild_id) VALUES (?)", (guild.id,))
    conn.commit()
    conn.close()

@client.event
async def on_guild_remove(guild: discord.Guild):
    conn = sqlite3.connect("servers_info/main.db")
    cur = conn.cursor()
    cur.execute("DELETE FROM Guilds WHERE guild_id = ?", (guild.id,))
    conn.commit()
    conn.close()

# ---------- Auto-load cogs ----------
async def load_cogs():
    os.makedirs("./cogs", exist_ok=True)
    for filename in os.listdir("./cogs"):
        if filename.endswith(".py"):
            await client.load_extension(f"cogs.{filename[:-3]}")
            log.info("Loaded cog: cogs.%s", filename[:-3])

async def main():
    async with client:
        await load_cogs()
        await client.start(TOKEN)

if __name__ == "__main__":
    asyncio.run(main())

