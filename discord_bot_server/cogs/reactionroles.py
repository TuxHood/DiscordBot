import discord
from discord import app_commands
from discord.ext import commands
from discord.ext.commands import has_permissions
import sqlite3
import re

class ReactionRole(commands.Cog):
    def __init__(self, client):
        self.client = client

    @commands.Cog.listener()
    async def on_ready(self):
        print(f"{__name__} is online")

    async def process_reaction(self, payload, add_role: bool):
        guild = self.client.get_guild(payload.guild_id)
        if not guild:
            print("Guild not found.")
            return

        reaction_value = payload.emoji.id if payload.emoji.is_custom_emoji() else payload.emoji.name
        

        # Connect to the database
        connection = sqlite3.connect("./servers_info/main.db")
        cursor = connection.cursor()

        # Fetch role associated with message and emoji
        cursor.execute(
            "SELECT role_id FROM Reaction_Role WHERE message_id = ? AND reaction = ?",
            (payload.message_id, reaction_value)
        )
        result = cursor.fetchone()
        connection.close()

        if not result:
            print(f"No role found for message ID {payload.message_id} and emoji {payload.emoji.name}")
            return

        role_id = result[0]
        role = guild.get_role(role_id)
        if not role:
            print(f"Role with ID {role_id} not found.")
            return

        # Get the member who reacted
        member = guild.get_member(payload.user_id) or await guild.fetch_member(payload.user_id)
        if not member:
            print("Member not found.")
            return

        # Add or remove the role
        try:
            if add_role:
                await member.add_roles(role)
                print(f"{member.name} now has the role {role.name}")
            else:
                await member.remove_roles(role)
                print(f"{member.name} no longer has the role {role.name}")
        except discord.Forbidden:
            print("Bot lacks permission to modify roles.")
        except discord.HTTPException as e:
            print(f"Failed to modify role: {e}")

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload):
        await self.process_reaction(payload, add_role=True)

    @commands.Cog.listener()
    async def on_raw_reaction_remove(self, payload):
        await self.process_reaction(payload, add_role=False)

    @app_commands.command(name="admin_set_reaction_role", description="[ADMIN] Set a reaction role for a specific message.")
    @has_permissions(administrator=True)
    async def admin_set_reaction_role(self, interaction: discord.Interaction, message_id: str, role: discord.Role, emoji: str):
        # Ensure the role is valid
        if not role:
            await interaction.response.send_message("Invalid role.", ephemeral=True)
            return

        custom_emoji_pattern = r"<(a?):([a-zA-Z0-9_]+):(\d+)>"

        # Check if emoji is a custom emoji
        if re.match(custom_emoji_pattern, emoji):
            match = re.match(custom_emoji_pattern, emoji)
            emoji = match.group(3)  # Custom emoji ID
        
        print(f"Emoji: {emoji}")  # Debugging

        # Connect to the database
        connection = sqlite3.connect("./servers_info/main.db")
        cursor = connection.cursor()

        # Ensure the table exists
        cursor.execute(
            """CREATE TABLE IF NOT EXISTS Reaction_Role (
                message_id INTEGER NOT NULL,
                reaction TEXT NOT NULL,
                role_id INTEGER NOT NULL,
                PRIMARY KEY (message_id, role_id, reaction)
            )"""
        )

        try:
            # Check if the combination of message_id and role_id exists
            cursor.execute(
                "SELECT COUNT(*) FROM Reaction_Role WHERE message_id = ? AND role_id = ?",
                (int(message_id), role.id)
            )
            result = cursor.fetchone()

            if result[0] > 0:
                # If entry exists, update the reaction for the role
                cursor.execute(
                    "UPDATE Reaction_Role SET reaction = ? WHERE message_id = ? AND role_id = ?",
                    (emoji, int(message_id), role.id)
                )
            else:
                # If no entry exists, insert a new one
                cursor.execute(
                    "INSERT INTO Reaction_Role (message_id, reaction, role_id) VALUES (?, ?, ?)",
                    (int(message_id), emoji, role.id)
                )
            
            connection.commit()
        except sqlite3.Error as e:
            await interaction.response.send_message(f"Database error: {e}", ephemeral=True)
            connection.close()
            return

        connection.close()

        await interaction.response.send_message(
            f"Reaction role set: Message ID `{message_id}`, Role `{role.name}`, Emoji `{emoji}`."
        )
        
    @app_commands.command(name="admin_remove_reaction_role", description="[ADMIN] Remove a reaction role for a specific message.")
    @has_permissions(administrator=True)
    async def admin_remove_reaction_role(self, interaction: discord.Interaction, message_id: str, role: discord.Role, emoji: str):
        # Ensure the role is valid
        if not role:
            await interaction.response.send_message("Invalid role.", ephemeral=True)
            return

        custom_emoji_pattern = r"<(a?):([a-zA-Z0-9_]+):(\d+)>"

        # If the emoji is custom, extract the emoji ID
        if re.match(custom_emoji_pattern, emoji):
            match = re.match(custom_emoji_pattern, emoji)
            emoji = match.group(3)  # Extract custom emoji ID
        
        print(f"Emoji: {emoji}")  # Debugging

        # Connect to the database
        connection = sqlite3.connect("./servers_info/main.db")
        cursor = connection.cursor()

        try:
            # Check if the combination of message_id, role_id, and emoji exists
            cursor.execute(
                "SELECT COUNT(*) FROM Reaction_Role WHERE message_id = ? AND role_id = ? AND reaction = ?",
                (int(message_id), role.id, emoji)
            )
            result = cursor.fetchone()

            if result[0] > 0:
                # If the entry exists, delete it
                cursor.execute(
                    "DELETE FROM Reaction_Role WHERE message_id = ? AND role_id = ? AND reaction = ?",
                    (int(message_id), role.id, emoji)
                )
                
                # Commit the transaction before running VACUUM
                connection.commit()

                # Now run VACUUM to reclaim space
                cursor.execute("VACUUM")

                await interaction.response.send_message(
                    f"Reaction role removed: Message ID `{message_id}`, Role `{role.name}`, Emoji `{emoji}`."
                )
            else:
                # If no matching entry exists, inform the user
                await interaction.response.send_message(
                    f"No such reaction role found for Message ID `{message_id}`, Role `{role.name}`, Emoji `{emoji}`.",
                    ephemeral=True
                )
        except sqlite3.Error as e:
            await interaction.response.send_message(f"Database error: {e}", ephemeral=True)
        finally:
            connection.close()

    # Error handling for permission-related errors
    @admin_set_reaction_role.error
    async def admin_set_reaction_role_error(self, interaction: discord.Interaction, error):
        if isinstance(error, commands.MissingPermissions):
            await interaction.response.send_message("Command denied: You are not an Admin!", ephemeral=True)
        else:
            await interaction.response.send_message(f"An unexpected error occurred: {error}", ephemeral=True)

    @admin_remove_reaction_role.error
    async def admin_remove_reaction_role_error(self, interaction: discord.Interaction, error):
        if isinstance(error, commands.MissingPermissions):
            await interaction.response.send_message("Command denied: You are not an Admin!", ephemeral=True)
        else:
            await interaction.response.send_message(f"An unexpected error occurred: {error}", ephemeral=True)

async def setup(client):
    await client.add_cog(ReactionRole(client))
