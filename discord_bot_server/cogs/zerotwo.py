import os
import aiohttp
import discord
from discord.ext import commands

# Config via env (override these if you want)
N8N_ZERO_TWO_WEBHOOK   = os.getenv("N8N_ZERO_TWO_WEBHOOK", "http://10.10.10.113:5678/webhook/zero-two")
N8N_VOICE_STATE_WEBHOOK = os.getenv("N8N_VOICE_STATE_WEBHOOK", "http://10.10.10.113:5678/webhook/zero-two-voice")

class ZeroTwoCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.http = None  # lazy-created aiohttp session
        # cache of the bot's own VC state per guild (kept fresh by on_voice_state_update)
        self.voice_state = {}  # { guild_id: {"connected": bool, "channel_id": str|None} }

    async def _session(self) -> aiohttp.ClientSession:
        if self.http is None or self.http.closed:
            self.http = aiohttp.ClientSession()
        return self.http

    def cog_unload(self):
        # close http session on unload
        if self.http and not self.http.closed:
            self.bot.loop.create_task(self.http.close())

    def _is_connected(self, guild: discord.Guild):
        """Return (connected_bool, channel_id_str_or_None). Uses cache; falls back to guild.me.voice."""
        if not guild:
            return False, None
        cached = self.voice_state.get(guild.id)
        if cached:
            return cached.get("connected", False), cached.get("channel_id")
        me = guild.me
        ch = getattr(getattr(me, "voice", None), "channel", None)
        return (ch is not None), (str(ch.id) if ch else None)

    # --- Voice state notifier: tells n8n whenever THIS BOT joins/leaves/moves ---
    @commands.Cog.listener()
    async def on_voice_state_update(self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
        if not self.bot.user or member.id != self.bot.user.id:
            return

        connected = after.channel is not None
        channel_id = str(after.channel.id) if after.channel else None
        self.voice_state[member.guild.id] = {"connected": connected, "channel_id": channel_id}

        # best-effort webhook to n8n so it can persist state (Data Store/Postgres)
        try:
            s = await self._session()
            await s.post(
                N8N_VOICE_STATE_WEBHOOK,
                json={"guild_id": str(member.guild.id), "channel_id": channel_id, "connected": connected},
                timeout=5
            )
        except Exception as e:
            print(f"[voice-state] notify failed: {e}")

    # --- Your existing command, now VC-aware and non-blocking ---
    @commands.command(name="ask")
    async def ask_zero_two(self, ctx: commands.Context, *, message: str):
        """Ask Zero Two. If she's in VC, n8n will TTS via Lavalink; else, it returns text."""
        guild_id = str(ctx.guild.id) if ctx.guild else "DM"
        connected, bot_channel_id = self._is_connected(ctx.guild)

        payload = {
            "source": "discord",
            "user": str(ctx.author),
            "user_id": str(ctx.author.id),
            "message": message,
            "channel_id": str(ctx.channel.id),
            "message_id": str(ctx.message.id),
            "guild_id": guild_id,

            # Let n8n branch: speak only if the bot is already connected in this guild
            "speak": connected,
            "voice": {
                "connected": connected,
                "guild_id": None if guild_id == "DM" else guild_id,
                "bot_channel_id": bot_channel_id
            }
        }

        reply = "✅ Sent to Zero Two."
        try:
            s = await self._session()
            async with s.post(N8N_ZERO_TWO_WEBHOOK, json=payload, timeout=20) as r:
                if r.status == 200:
                    # If your n8n flow returns JSON, use it (optional)
                    try:
                        data = await r.json(content_type=None)
                        if data.get("spoken"):
                            await ctx.message.add_reaction("🗣️")
                        if data.get("reply"):
                            reply = data["reply"]
                    except Exception:
                        text = await r.text()
                        if text.strip():
                            reply = text[:1900]
                else:
                    reply = f"⚠️ Zero Two webhook error: HTTP {r.status}"
        except Exception as e:
            reply = f"⚠️ Failed to reach Zero Two: {e}"

        await ctx.send(reply)

async def setup(bot: commands.Bot):
    await bot.add_cog(ZeroTwoCog(bot))
