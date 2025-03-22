import discord
from discord.ext import commands
from discord.ext.commands import has_permissions
from discord import app_commands
import sqlite3

class AutoRole(commands.Cog):
    def __init__(self, client):
        self.client = client

    @commands.Cog.listener()
    async def on_ready(self):
        print(f"{__name__} is online")
        
    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        connection = sqlite3.connect("./servers_info/main.db")
        cursor = connection.cursor()
        
        cursor.execute("SELECT auto_role_id FROM Auto_role WHERE guild_id = ?", (member.guild.id))
        
        auto_role_id = cursor.fetchone()
           
        if auto_role_id:
            await member.add_roles(member.guild.get_role(auto_role_id))
        
    @app_commands.command(name="set_auto_role", description = "[ADMIN] Sets an automatic join role for this server.")
    @has_permissions(administrator=True)
    async def set_auto_role(self, interaction: discord.Interaction, role: discord.Role):
        connection = sqlite3.connect("./servers_info/main.db")
        cursor = connection.cursor()
        
        cursor.execute("UPDATE Auto_role SET auto_role_id = ? WHERE guild_id = ?", (role.id, interaction.guild_id))
        connection.commit()
        connection.close()
        await interaction.response.send_message(f"Automatic join role set to {role.name}.")
        
     # Error handling for permission-related errors
    @set_auto_role.error
    async def set_auto_role_error(self, interaction: discord.Interaction, error):
        if isinstance(error, commands.MissingPermissions):
            await interaction.response.send_message("Command denied: You are not an Admin!", ephemeral=True)
        else:
            await interaction.response.send_message(f"An unexpected error occurred: {error}", ephemeral=True)
        
async def setup(client):
    await client.add_cog(AutoRole(client))