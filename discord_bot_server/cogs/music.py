import discord
from discord.ext import commands
import yt_dlp
import asyncio
import random

class Music(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.voice_clients = {}
        self.queues = {}
        self.ytdl = yt_dlp.YoutubeDL({
            "format": "bestaudio",
            "noplaylist": True,
            "default_search": "ytsearch"
        })
        self.ffmpeg_options = {
            'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
            'options': '-vn -filter:a "volume=0.25"'
        }
        self.current_tracks = {}  # Track currently playing

    def add_to_queue(self, guild_id, query):
        if guild_id not in self.queues:
            self.queues[guild_id] = []
        self.queues[guild_id].append(query)

    def get_next_song(self, guild_id):
        if guild_id in self.queues and self.queues[guild_id]:
            return self.queues[guild_id].pop(0)
        return None

    async def play_next(self, ctx):
        next_query = self.get_next_song(ctx.guild.id)
        if next_query:
            try:
                data = await asyncio.get_event_loop().run_in_executor(None, lambda: self.ytdl.extract_info(next_query, download=False))
                if 'entries' in data:
                    data = data['entries'][0]
                song = data['url']
                self.current_tracks[ctx.guild.id] = data['title']
                player = discord.FFmpegOpusAudio(song, **self.ffmpeg_options)
                vc = self.voice_clients[ctx.guild.id]
                vc.play(player, after=lambda e: asyncio.run_coroutine_threadsafe(self.play_next(ctx), self.bot.loop))
                await ctx.send(f"▶️ Now playing: **{data['title']}**")
            except Exception as e:
                await ctx.send(f"❌ Failed to play next track: {e}")
        else:
            if ctx.guild.id in self.voice_clients:
                await self.voice_clients[ctx.guild.id].disconnect()
                del self.voice_clients[ctx.guild.id]
                self.current_tracks.pop(ctx.guild.id, None)

    @commands.command()
    async def play(self, ctx, *, query: str):
        if ctx.author.voice is None:
            await ctx.send("❗ You need to be in a voice channel first!")
            return

        try:
            channel = ctx.author.voice.channel
            vc = self.voice_clients.get(ctx.guild.id)

            if vc:
                if not vc.is_connected():
                    try:
                        await vc.disconnect(force=True)
                    except Exception:
                        pass
                    vc = await channel.connect()
                elif vc.channel != channel:
                    await vc.move_to(channel)
            else:
                vc = await channel.connect()

            self.voice_clients[ctx.guild.id] = vc

            # Queue logic
            self.add_to_queue(ctx.guild.id, query)
            if not vc.is_playing():
                await self.play_next(ctx)
            else:
                await ctx.send("🎵 Added to queue.")

        except discord.Forbidden:
            await ctx.send("🚫 I don't have permission to join that channel!")
        except discord.ClientException as e:
            await ctx.send(f"❌ Voice client error: {e}")
        except Exception as e:
            await ctx.send(f"❌ Unexpected: `{type(e).__name__}: {e}`")

    
    @commands.command()
    async def pause(self, ctx):
        if ctx.guild.id in self.voice_clients:
            self.voice_clients[ctx.guild.id].pause()
            await ctx.send("⏸️ Paused.")

    @commands.command()
    async def resume(self, ctx):
        if ctx.guild.id in self.voice_clients:
            self.voice_clients[ctx.guild.id].resume()
            await ctx.send("▶️ Resumed.")

    @commands.command()
    async def stop(self, ctx):
        if ctx.guild.id in self.voice_clients:
            self.voice_clients[ctx.guild.id].stop()
            await self.voice_clients[ctx.guild.id].disconnect()
            del self.voice_clients[ctx.guild.id]
            self.queues[ctx.guild.id] = []
            self.current_tracks.pop(ctx.guild.id, None)
            await ctx.send("⏹️ Stopped and cleared queue.")

    @commands.command()
    async def skip(self, ctx):
        if ctx.guild.id in self.voice_clients and self.voice_clients[ctx.guild.id].is_playing():
            self.voice_clients[ctx.guild.id].stop()
            await ctx.send("⏭️ Skipped current track.")
        else:
            await ctx.send("⚠️ Nothing is playing to skip.")

    @commands.command()
    async def queue(self, ctx):
        if ctx.guild.id not in self.queues or not self.queues[ctx.guild.id]:
            await ctx.send("📭 The queue is currently empty.")
        else:
            queue_list = "\n".join(f"{i+1}. {url}" for i, url in enumerate(self.queues[ctx.guild.id]))
            await ctx.send(f"**🎶 Current Queue:**\n{queue_list}")

    @commands.command()
    async def now(self, ctx):
        track = self.current_tracks.get(ctx.guild.id)
        if track:
            await ctx.send(f"🎧 Now playing: **{track}**")
        else:
            await ctx.send("⚠️ No track is currently playing.")

    @commands.command()
    async def leave(self, ctx):
        if ctx.guild.id in self.voice_clients:
            await self.voice_clients[ctx.guild.id].disconnect()
            del self.voice_clients[ctx.guild.id]
            self.current_tracks.pop(ctx.guild.id, None)
            await ctx.send("👋 Left the voice channel.")
        else:
            await ctx.send("⚠️ I'm not in a voice channel.")

    @commands.command()
    async def remove(self, ctx, index: int):
        if ctx.guild.id in self.queues and 0 < index <= len(self.queues[ctx.guild.id]):
            removed = self.queues[ctx.guild.id].pop(index - 1)
            await ctx.send(f"❌ Removed track {index}: {removed}")
        else:
            await ctx.send("⚠️ Invalid index.")

    @commands.command()
    async def shuffle(self, ctx):
        if ctx.guild.id in self.queues and len(self.queues[ctx.guild.id]) > 1:
            random.shuffle(self.queues[ctx.guild.id])
            await ctx.send("🔀 Queue shuffled.")
        else:
            await ctx.send("⚠️ Not enough songs in the queue to shuffle.")

    @commands.command()
    async def helpmusic(self, ctx):
        help_text = (
            "🎵 **Music Bot Commands** 🎵\n"
            "`!play <query>` - Play or queue a song.\n"
            "`!pause` - Pause the current track.\n"
            "`!resume` - Resume playback.\n"
            "`!stop` - Stop and clear the queue.\n"
            "`!skip` - Skip to the next song.\n"
            "`!queue` - Show the song queue.\n"
            "`!now` - Show the currently playing track.\n"
            "`!leave` - Make the bot leave the voice channel.\n"
            "`!remove <index>` - Remove a song by its position in the queue.\n"
            "`!shuffle` - Shuffle the current queue."
        )
        await ctx.send(help_text)


async def setup(bot):
    await bot.add_cog(Music(bot))
