import discord
from discord.ext import commands
import requests

class ZeroTwoCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.webhook_url = "http://10.10.10.113:5678/webhook/zero-two"
    @commands.command(name="ask")
    async def ask_zero_two(self, ctx, *, message):
        """Ask Zero Two a question and get a reply via n8n"""
        payload = {
            "source": "discord",  # To identify origin in n8n
            "user": str(ctx.author),
            "user_id": str(ctx.author.id),
            "message": message,
            "channel_id": str(ctx.channel.id),
            "message_id": str(ctx.message.id),
            "guild_id": str(ctx.guild.id) if ctx.guild else "DM"
        }

        try:
            response = requests.post(self.webhook_url, json=payload, timeout=10)
            response.raise_for_status()
        except Exception as e:
            zero_two_reply = f"Failed to get response from Zero Two: {e}"

        await ctx.send(zero_two_reply)

async def setup(bot):
    await bot.add_cog(ZeroTwoCog(bot))
