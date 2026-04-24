import logging
from typing import Any, Dict

import aiohttp
import discord
from discord.ext import commands

from langgraph_client import send_test_payload_to_langgraph


log = logging.getLogger(__name__)


class LangGraphTestCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.http = None

    async def _session(self):
        if self.http is None or self.http.closed:
            self.http = aiohttp.ClientSession()
        return self.http

    def cog_unload(self):
        if self.http and not self.http.closed:
            self.bot.loop.create_task(self.http.close())

    @commands.Cog.listener()
    async def on_ready(self):
        log.info("LangGraphTestCog is online")

    def _build_payload(self, ctx: commands.Context, message_text: str) -> Dict[str, Any]:
        guild_id = str(ctx.guild.id) if ctx.guild else None
        channel_id = str(ctx.channel.id)
        payload = {
            "event": {
                "source": "discord",
                "source_user_id": str(ctx.author.id),
                "source_message_id": str(ctx.message.id),
                "guild_id": guild_id,
                "channel_id": channel_id,
                "timestamp": ctx.message.created_at.isoformat(),
                "text": message_text,
                "message_mode": "test",
                "test_metadata": {
                    "original_message": ctx.message.content,
                    "command": "!test",
                    "payload": message_text,
                    "purpose": "discord_langgraph_bridge_test",
                },
            }
        }

        return payload

    @commands.command(name="test")
    async def test_langgraph_bridge(self, ctx: commands.Context, *, message: str = ""):
        message_text = message.strip()

        if not message_text:
            await ctx.reply("Usage: !test <message>", mention_author=False)
            return

        payload = self._build_payload(ctx, message_text)
        log.info(
            "LangGraph test command received: user=%s message_id=%s guild_id=%s channel_id=%s",
            ctx.author.id,
            ctx.message.id,
            ctx.guild.id if ctx.guild else None,
            ctx.channel.id,
        )
        log.info("LangGraph test payload built: %s", payload)

        try:
            async with ctx.typing():
                session = await self._session()
                result = await send_test_payload_to_langgraph(session, payload, logger=log)

            if not result.ok:
                log.error(
                    "LangGraph test request failed: url=%s status=%s error=%s raw_body=%s",
                    result.url,
                    result.status,
                    result.error,
                    result.raw_body,
                )
                await ctx.reply(
                    f"LangGraph request failed: {result.error or 'unknown error'}",
                    mention_author=False,
                )
                return

            reply_text = result.reply_text.strip() or "LangGraph returned an empty response."
            if len(reply_text) > 2000:
                reply_text = reply_text[:1990] + "..."

            log.info("LangGraph test reply ready: %s", reply_text)
            await ctx.reply(reply_text, mention_author=False)
        except Exception as exc:
            log.exception("Unhandled LangGraph test command failure: %s", exc)
            await ctx.reply("LangGraph bridge error: unable to complete the request.", mention_author=False)


async def setup(bot: commands.Bot):
    await bot.add_cog(LangGraphTestCog(bot))
