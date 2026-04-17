import asyncio
import re
import logging
from typing import Dict, List, Optional, Union

import discord
from discord.ext import commands, tasks
import mafic

log = logging.getLogger("music")


def pick_first_track(result: Union[List[mafic.Track], mafic.Playlist, None]) -> Optional[mafic.Track]:
    """Handle Mafic return types: list[Track] | Playlist | None."""
    if result is None:
        return None
    if isinstance(result, list):
        return result[0] if result else None
    if isinstance(result, mafic.Playlist):
        if result.tracks:
            idx = getattr(result, "selected_track", None)
            if isinstance(idx, int) and 0 <= idx < len(result.tracks):
                return result.tracks[idx]
            return result.tracks[0]
    return None


def player_is_playing(vc: object) -> bool:
    """Robust check across Mafic versions for 'is the player playing?'."""
    if not isinstance(vc, mafic.Player):
        return False

    # 1) Some versions have a boolean property 'playing'
    val = getattr(vc, "playing", None)
    if isinstance(val, bool):
        return val

    # 2) Some have a method 'is_playing()'
    meth = getattr(vc, "is_playing", None)
    if callable(meth):
        try:
            return bool(meth())
        except Exception:
            pass

    # 3) Fallback: consider 'current'/'track' presence as playing-ish
    for attr in ("current", "track", "current_track"):
        if getattr(vc, attr, None) is not None:
            return True

    return False


class Music(commands.Cog):
    """Music commands using Mafic + Lavalink v4."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.queues: Dict[int, asyncio.Queue[mafic.Track]] = {}
        self.autoplay_loop.start()

    def get_queue(self, guild_id: int) -> asyncio.Queue[mafic.Track]:
        if guild_id not in self.queues:
            self.queues[guild_id] = asyncio.Queue()
        return self.queues[guild_id]

    async def wait_for_player_connected(self, player: mafic.Player, timeout: float = 10.0) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout

        while loop.time() < deadline:
            if getattr(player, "connected", False):
                return
            await asyncio.sleep(0.1)

        raise commands.CommandError("Voice connection timed out before the player finished connecting.")

    async def ensure_player(self, ctx: commands.Context) -> mafic.Player:
        """Ensure a voice connection + Mafic Player for this guild."""
        if not isinstance(ctx.author, discord.Member):
            raise commands.CommandError("This command must be used in a guild.")
        if not ctx.author.voice or not ctx.author.voice.channel:
            await ctx.send("You must join a voice channel first.")
            raise commands.CommandError("Author not in a voice channel.")

        target_channel = ctx.author.voice.channel
        player = ctx.voice_client
        if player and isinstance(player, mafic.Player):
            current_channel = getattr(player, "channel", None)

            if current_channel and current_channel.id != target_channel.id:
                await player.disconnect(force=True)
                player = None
            else:
                if not getattr(player, "connected", False):
                    await self.wait_for_player_connected(player)
                return player

        log.info("Connecting to voice channel %s in guild %s", target_channel, ctx.guild.id)
        player = await target_channel.connect(cls=mafic.Player)
        await self.wait_for_player_connected(player)
        return player

    # ---------- Background: auto play next ----------
    @tasks.loop(seconds=1.0)
    async def autoplay_loop(self):
        for guild in list(self.bot.guilds):
            try:
                vc = guild.voice_client
                if not vc or not isinstance(vc, mafic.Player):
                    continue
                if player_is_playing(vc):
                    continue

                q = self.get_queue(guild.id)
                if not q.empty():
                    next_track = await q.get()
                    title = getattr(next_track, "title", "unknown")
                    log.info("Auto-playing next track in guild %s: %s", guild.id, title)
                    await vc.play(next_track)
            except Exception as e:
                log.exception("Autoplay loop error in guild %s: %s", guild.id, e)

    @autoplay_loop.before_loop
    async def before_autoplay_loop(self):
        await self.bot.wait_until_ready()

    # ---------- Diagnostics ----------
    @commands.command(help="Show Lavalink/player diagnostics.")
    async def diag(self, ctx: commands.Context):
        pool = getattr(self.bot, "lavalink", None)
        label, connected, nodes_count = "None", False, 0
        if pool and hasattr(pool, "nodes"):
            try:
                nodes = list(pool.nodes.values())
                nodes_count = len(nodes)
                if nodes:
                    label = getattr(nodes[0], "label", "Unknown")
                    connected = bool(getattr(nodes[0], "connected", False))
            except Exception:
                pass

        vc = ctx.voice_client
        q = self.get_queue(ctx.guild.id)
        playing = player_is_playing(vc)

        await ctx.send(
            "```yaml\n"
            f"guild: {ctx.guild.id}\n"
            f"nodes_count: {nodes_count}\n"
            f"node: {label}\n"
            f"node_connected: {connected}\n"
            f"player_present: {isinstance(vc, mafic.Player)}\n"
            f"playing: {playing}\n"
            f"queue_size: {q.qsize()}\n"
            "```"
        )

    # ---------- Commands (prefix: !) ----------
    @commands.command(help="Join your voice channel.")
    async def join(self, ctx: commands.Context):
        player = await self.ensure_player(ctx)
        await ctx.send(f"Joined {player.channel.mention}.")

    @commands.command(help="Play a track from URL or search (e.g., 'lofi').")
    async def play(self, ctx: commands.Context, *, query: str):
        player = await self.ensure_player(ctx)

        try:
            if re.match(r"^https?://", query, re.IGNORECASE):
                result = await player.fetch_tracks(query)
                log.info("Fetched tracks via URL for guild %s", ctx.guild.id)
            else:
                result = await player.fetch_tracks(query, search_type=mafic.SearchType.YOUTUBE)
                log.info("Searched YouTube for '%s' in guild %s", query, ctx.guild.id)
        except Exception as e:
            log.exception("Search failed: %s", e)
            await ctx.send(f"Search failed: `{e}`")
            return

        track = pick_first_track(result)
        if not track:
            await ctx.send("No results found.")
            return

        if not player_is_playing(player):
            try:
                await player.play(track)
            except mafic.PlayerNotConnected:
                await self.wait_for_player_connected(player)
                await player.play(track)

            title = getattr(track, "title", "unknown")
            log.info("Now playing in guild %s: %s", ctx.guild.id, title)
            await ctx.send(f"▶️ Now playing: **{title}**")
        else:
            q = self.get_queue(ctx.guild.id)
            await q.put(track)
            title = getattr(track, "title", "unknown")
            log.info("Queued in guild %s: %s", ctx.guild.id, title)
            await ctx.send(f"➕ Queued: **{title}**")

    @commands.command(help="Skip the current track.")
    async def skip(self, ctx: commands.Context):
        player = ctx.voice_client
        if not player or not isinstance(player, mafic.Player) or not player_is_playing(player):
            await ctx.send("Nothing is playing.")
            return
        await player.stop()
        await ctx.send("⏭️ Skipped.")

    @commands.command(help="Stop playback and clear the queue.")
    async def stop(self, ctx: commands.Context):
        player = ctx.voice_client
        q = self.get_queue(ctx.guild.id)
        while not q.empty():
            try:
                q.get_nowait()
                q.task_done()
            except Exception:
                break
        if player and isinstance(player, mafic.Player):
            await player.stop()
        await ctx.send("⏹️ Stopped and cleared the queue.")

    @commands.command(help="Disconnect the bot from voice.")
    async def leave(self, ctx: commands.Context):
        player = ctx.voice_client
        if player and isinstance(player, mafic.Player):
            await player.disconnect()
            await ctx.send("👋 Left the channel.")
        else:
            await ctx.send("I’m not in a voice channel.")


async def setup(bot: commands.Bot):
    await bot.add_cog(Music(bot))
