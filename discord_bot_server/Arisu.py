import discord
import os
import asyncio
from dotenv import load_dotenv
from discord.ext import commands, tasks
from itertools import cycle
import sqlite3

#[IMPORTANT] Add required text files 
requirements = ["reaction_role"]

#Initialize Token from .env
load_dotenv(override=True)
token = os.getenv('Arisu_Token')

if not token:
    print("Bot token not found !")
elif token.strip() != token:
    print("Bot token contains spaces, please remove them.")
else:
    print("Bot token is valid.")
    
#Set Bot commands to / for users interactions
     
client = commands.Bot(command_prefix="!",intents=discord.Intents.all())

#Loops a series of statuses aka playing "text..."

client_statuses = cycle(["as a maid","with the server, teehee"])

@tasks.loop(seconds=30)
async def change_client_status():
    await client.change_presence(activity=discord.Game(next(client_statuses)))

@client.event
async def on_ready():
    print ("Bot is ready")
    change_client_status.start()
    try:
        synced_commands = await client.tree.sync()
        print(f"Synced {len(synced_commands)} commands.")
    except Exception as e:
        print("An error with syncing application commands has occurred: ", e)
        
@client.event
async def on_guild_join(guild):
    conn = sqlite3.connect("servers_info/main.db")
    cursor = conn.cursor()
    cursor.execute("INSERT INTO Guilds (guild_id) VALUES (?)", (guild.id,))
    conn.commit()
    conn.close()
    
@client.event
async def on_guild_remove(guild):
    conn = sqlite3.connect("servers_info/main.db")
    cursor = conn.cursor()
    cursor.execute("DELETE * FROM Guilds WHERE guild_id = ?", (guild.id,))
    conn.commit()
    conn.close()

@client.tree.command(name="hello", description="Says Hello back") #Snake case naming conventions
async def hello(interaction: discord.Interaction):
    await interaction.response.send_message(f"{interaction.user.mention} Hello!", ephemeral = True)

'''
@client.event
async def on_guild_join():  #Setup info for new server
    for guild in client.guilds:
        filename = guild.name
        if filename not in os.listdir("./servers_info"): 
            os.mkdir(f"./servers_info/{filename}")
        for file_required in requirements:
            if file_required not in os.listdir(fr"./servers_info/{filename}"): 
                with open(os.path.join(fr"./servers_info/{filename}", file_required), 'w') as fp:
                    pass
'''
                    
async def load():
    for filename in os.listdir("./cogs"):
        if filename.endswith(".py"):
            await client.load_extension(f"cogs.{filename[:-3]}")
            
async def main():
    async with client:
        await load()
        await client.start(token)

@client.command()
async def hello(ctx):
    await ctx.send(f"Hi, {ctx.author.mention}")   

'''
@client.command()
async def update(ctx):
    for guild in client.guilds:
        filename = guild.name
        if filename not in os.listdir("./servers_info"): 
            os.mkdir(f"./servers_info/{filename}")
        for file_required in requirements:
            sqlite3.connect(f"./servers_info/{filename}/{file_required}.db")
    await ctx.send(f"Update successful")
'''


    

#Initialize Bot

asyncio.run(main())