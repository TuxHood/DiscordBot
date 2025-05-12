import discord
from discord.ext import commands

class Test(commands.Cog):
    def __init__(self, client):
        self.client = client

    @commands.Cog.listener()
    async def on_ready(self):
        print(f"{__name__} is online")
        
    @commands.command(aliases=["gn"])
    async def goodnight(self, ctx):
        await ctx.send(f"Good Night, {ctx.author.mention}")
        
async def setup(client):
    await client.add_cog(Test(client))