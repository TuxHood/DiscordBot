const pino = require('pino');
const { ActivityType, Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');

const { config } = require('./config');
const { VoiceManager } = require('./voice/voiceManager');
const { startApiServer } = require('./api/server');
const { registerN8nMentionForwarding } = require('./integrations/n8n');
const {
  sendPayloadToLangGraph,
  buildDiscordLangGraphPayload,
  stripBotMentionText,
  getReferencedMessageMetadata,
  collectRecentChannelContext
} = require('./integrations/langgraph');

// Discord Coding Policy & Handlers
const {
  classifyDiscordCodeIntent,
  ALLOW_HEAVY_CODING,
  ALLOW_CODE_ATTACHMENTS,
  MAX_GENERATED_FILE_BYTES
} = require('./policies/discordCodingPolicy');

const {
  generateTemplate
} = require('./handlers/codeGenerator');

const {
  validateAttachment,
  classifyAttachment,
  downloadAttachment,
  storeFileMetadata,
  summarizeFile
} = require('./handlers/fileHandler');

const logger = pino({
  level: config.logLevel,
  transport: process.env.NODE_ENV === 'production'
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard'
        }
      }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

const voiceManager = new VoiceManager({
  client,
  logger,
  defaultVolume: config.defaultVolume,
  lavalink: {
    host: config.lavalinkHost,
    port: config.lavalinkPort,
    password: config.lavalinkPassword,
    secure: config.lavalinkSecure
  }
});

const applyPresence = () => {
  try {
    if (!client.user) {
      return;
    }

    if (config.presenceMode === 'live') {
      client.user.setPresence({
        activities: [{
          name: config.livePresenceName,
          type: ActivityType.Streaming,
          url: config.liveStreamUrl
        }],
        status: 'online'
      });
      return;
    }

    client.user.setPresence({
      activities: [{
        name: config.normalPresenceName,
        type: ActivityType.Playing
      }],
      status: 'online'
    });
  } catch (err) {
    logger.error({ err }, 'Failed to change bot status');
  }
};

client.once('ready', () => {
  logger.info({ user: client.user ? client.user.tag : 'unknown', presenceMode: config.presenceMode }, 'Discord client is ready');
  applyPresence();
});

client.on('error', (err) => {
  logger.error({ err }, 'Discord client error');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) {
    return;
  }

  // Helper: Check if message is addressed to bot
  const isAddressed = () => {
    // Direct mention
    if (client.user && message.mentions.has(client.user)) {
      return true;
    }
    // Reply to bot
    if (message.reference) {
      return true;
    }
    // Prefix command
    if (message.content.startsWith(config.prefix)) {
      return true;
    }
    // DM
    if (message.isDMChannel && message.isDMChannel()) {
      return true;
    }
    return false;
  };

  // POLICY: Handle file attachments (only if addressed)
  if (message.attachments && message.attachments.size > 0) {
    const addressed = isAddressed();
    
    if (!addressed) {
      // Silently ignore unaddressed attachments
      logger.debug(
        {
          guildId: message.guildId,
          channelId: message.channelId,
          userId: message.author.id,
          attachmentCount: message.attachments.size
        },
        'Ignoring unaddressed attachments'
      );
      // If message has no text content, don't process further
      if (!message.content || message.content.trim() === '') {
        return;
      }
      // Otherwise continue to process any text commands
    } else {
      // Bot is addressed - process attachments
      try {
        const attachmentArray = Array.from(message.attachments.values());
        const codeFiles = [];
        const images = [];
        const unsupported = [];

        for (const att of attachmentArray) {
          const classification = classifyAttachment(att);
          
          if (classification.category === 'code_text') {
            if (classification.valid) {
              try {
                const { content: fileContent } = await downloadAttachment(att);
                const summary = summarizeFile(att.name, fileContent);
                
                storeFileMetadata(
                  message.guildId,
                  message.channelId,
                  message.id,
                  message.author.id,
                  att.name,
                  fileContent
                );
                
                let summaryText = `✅ **${summary.filename}** (${summary.size} bytes, ${summary.lines} lines)`;
                if (summary.hasPreview && summary.preview.length > 0) {
                  summaryText += `\n\`\`\`\n${summary.preview}\n\`\`\``;
                }
                codeFiles.push(summaryText);
                
                logger.info(
                  {
                    filename: att.name,
                    size: summary.size,
                    userId: message.author.id,
                    guildId: message.guildId,
                    category: 'code_text'
                  },
                  'Discord code file intake received'
                );
              } catch (err) {
                logger.error({ err, filename: att.name }, 'Error downloading code file');
                unsupported.push(`⚠️  **${att.name}**: Failed to download`);
              }
            } else {
              unsupported.push(`⚠️  **${att.name}**: ${classification.reason}`);
            }
          } else if (classification.category === 'image') {
            images.push({
              name: att.name,
              url: att.url,
              contentType: classification.contentType,
              size: att.size
            });
            
            logger.info(
              {
                filename: att.name,
                userId: message.author.id,
                guildId: message.guildId,
                category: 'image'
              },
              'Discord image received'
            );
          } else {
            unsupported.push(`📦 **${att.name}**: ${classification.reason}`);
          }
        }

        const responses = [];

        if (codeFiles.length > 0) {
          let fileReply = '✅ **Code files received:**\n' + codeFiles.join('\n\n');
          fileReply += '\n\n💾 I\'ve saved these to my intake folder. I won\'t execute them.\n\nI can create a coding workspace if you want me to properly inspect or refactor these. Just ask!';
          responses.push(fileReply);
        }

        if (images.length > 0) {
          let imageReply = `✅ I received ${images.length} image(s), darling. `;
          imageReply += 'I can see images now, but my Discord vision path is not wired yet. ';
          imageReply += 'I won\'t treat them as code files, but I also can\'t analyze them in Discord right now. ';
          imageReply += 'You can still ask me about them using OpenWebUI if you need analysis!';
          responses.push(imageReply);
        }

        if (unsupported.length > 0) {
          responses.push('⚠️  **Unsupported files:**\n' + unsupported.join('\n') + '\n\nI can take code/text files here, but these types need the workspace.');
        }

        if (responses.length > 0) {
          const fullReply = responses.join('\n\n');
          await message.reply({
            content: fullReply.length > 2000 ? fullReply.slice(0, 1997) + '...' : fullReply,
            flags: 64
          });
        }

        // Don't process as command after handling attachments if only attachments present
        if (!message.content.startsWith(config.prefix)) {
          return;
        }
      } catch (err) {
        logger.error({ err }, 'Error handling attachments');
        await message.reply({
          content: `Error processing files: ${err.message}`,
          flags: 64
        });
        return;
      }
    }
  }

  const isCommand = message.content.startsWith(config.prefix);

  if (isCommand) {
    const withoutPrefix = message.content.slice(config.prefix.length).trim();
    if (!withoutPrefix) {
      return;
    }

    const parts = withoutPrefix.split(/\s+/);
    const command = parts.shift().toLowerCase();

    try {
      if (command === 'hello') {
        await message.reply('Hello from the Node.js bot.');
        return;
      }

      if (command === 'test') {
        const testMessage = parts.join(' ').trim();
        if (!testMessage) {
          await message.reply('Usage: !test <message>');
          return;
        }

        const payload = buildDiscordLangGraphPayload({
          message,
          text: testMessage,
          messageMode: 'test',
          testMetadata: {
            original_message: message.content,
            command: config.prefix + 'test',
            payload: testMessage,
            purpose: 'discord_langgraph_bridge_test'
          }
        });

        logger.info(
          {
            command,
            guildId: message.guild ? message.guild.id : null,
            channelId: message.channel.id,
            userId: message.author.id,
            messageId: message.id
          },
          'LangGraph test command received'
        );

        const result = await sendPayloadToLangGraph({
          config,
          logger,
          payload
        });

        if (!result.ok) {
          logger.error(
            { command, guildId: message.guild.id, error: result.error, status: result.status },
            'LangGraph test command failed'
          );
          await message.reply('LangGraph test failed. Check bot logs.');
          return;
        }

        const replyText = (result.replyText || '').trim() || 'LangGraph returned an empty response.';
        await message.reply(replyText.length > 2000 ? replyText.slice(0, 1997) + '...' : replyText);
        return;
      }

      if (command === 'join') {
        const memberChannel = message.member && message.member.voice ? message.member.voice.channel : null;
        if (!memberChannel) {
          await message.reply('Join a voice channel first.');
          return;
        }

        await voiceManager.join({
          guild: message.guild,
          voiceChannel: memberChannel,
          textChannel: message.channel
        });
        await message.reply('Joined voice channel ' + memberChannel.name + '.');
        return;
      }

      if (command === 'leave') {
        await voiceManager.leave(message.guild.id);
        await message.reply('Left the voice channel.');
        return;
      }

      if (command === 'play') {
        const query = parts.join(' ').trim();
        if (!query) {
          await message.reply('Usage: !play <url or search query>');
          return;
        }

        const memberChannel = message.member && message.member.voice ? message.member.voice.channel : null;
        const result = await voiceManager.play({
          guild: message.guild,
          voiceChannel: memberChannel,
          textChannel: message.channel,
          query,
          requestedBy: message.author.tag
        });

        if (result.started) {
          await message.reply('Now playing: ' + result.track.title);
        } else {
          await message.reply('Queued at position ' + result.position + ': ' + result.track.title);
        }
        return;
      }

      if (command === 'pause') {
        const paused = await voiceManager.pause(message.guild.id);
        await message.reply(paused ? 'Paused playback.' : 'Nothing to pause.');
        return;
      }

      if (command === 'resume') {
        const resumed = await voiceManager.resume(message.guild.id);
        await message.reply(resumed ? 'Resumed playback.' : 'Nothing to resume.');
        return;
      }

      if (command === 'skip') {
        const skipped = await voiceManager.skip(message.guild.id);
        await message.reply(skipped ? 'Skipped current track.' : 'Nothing to skip.');
        return;
      }

      if (command === 'stop') {
        await voiceManager.stop(message.guild.id);
        await message.reply('Stopped playback and cleared the queue.');
        return;
      }

      if (command === 'queue') {
        const snapshot = await voiceManager.getQueue(message.guild.id);
        if (!snapshot.current && snapshot.items.length === 0) {
          await message.reply('Queue is empty.');
          return;
        }

        const lines = [];
        if (snapshot.current) {
          lines.push('Now: ' + snapshot.current.title);
        }

        snapshot.items.slice(0, 10).forEach((item, index) => {
          lines.push((index + 1) + '. ' + item.title + ' (' + item.url + ')');
        });

        if (snapshot.items.length > 10) {
          lines.push('...and ' + (snapshot.items.length - 10) + ' more');
        }

        await message.reply(lines.join('\n'));
        return;
      }

      await message.reply('Unknown command. Available: !hello !test !join !leave !play !pause !resume !skip !stop !queue');
    } catch (err) {
      logger.error({ err, command, guildId: message.guild.id }, 'Command failed');
      await message.reply('Command failed: ' + (err && err.message ? err.message : 'Unknown error'));
    }

    return;
  }

  // POLICY: Check coding intent before LangGraph routing
  const intent = classifyDiscordCodeIntent(message.content);

  if (intent.isHeavyCodingRequest && !ALLOW_HEAVY_CODING) {
    logger.info(
      {
        intent: 'heavy_coding',
        action: 'deferred',
        userId: message.author.id,
        guildId: message.guildId
      },
      'Discord heavy coding request blocked by policy'
    );

    await message.reply({
      content: `I don't run heavy coding jobs directly in Discord, darling. It gets messy fast.\n\nI can send you small starter files here, but full projects belong in a proper workspace.\n\nSend me a code file and I'll save it, or open the coding workspace on the dashboard and I'll help you there.`,
      flags: 64
    });
    return;
  }

  if (intent.isSmallFileRequest && ALLOW_CODE_ATTACHMENTS && intent.suggestedTemplate) {
    try {
      const generated = generateTemplate(intent.suggestedTemplate);
      const contentBytes = Buffer.byteLength(generated.content, 'utf8');

      if (contentBytes > MAX_GENERATED_FILE_BYTES) {
        await message.reply({
          content: `That file template would be too large to send as an attachment. Try asking for the code workspace instead.`,
          flags: 64
        });
        return;
      }

      const attachment = new AttachmentBuilder(
        Buffer.from(generated.content, 'utf8'),
        { name: generated.filename }
      );

      logger.info(
        {
          template: intent.suggestedTemplate,
          filename: generated.filename,
          bytes: contentBytes,
          userId: message.author.id,
          guildId: message.guildId
        },
        'Discord small file generated'
      );

      await message.reply({
        content: `Here, I made it as a file so Discord doesn't butcher the formatting.`,
        files: [attachment],
        flags: 64
      });
      return;
    } catch (err) {
      logger.error({ err, template: intent.suggestedTemplate }, 'Error generating file for Discord');
      await message.reply({
        content: `Error generating file: ${err.message}`,
        flags: 64
      });
      return;
    }
  }

  // Normal mention/reply routing to LangGraph
  const replyMetadata = await getReferencedMessageMetadata({ message, logger });
  const replyToBotMessageId = replyMetadata && replyMetadata.reply_to_author_is_bot
    ? replyMetadata.reply_to_message_id
    : null;
  const wasMentioned = Boolean(client.user && message.mentions.has(client.user));
  let trigger = null;
  let textForLangGraph = '';

  if (replyToBotMessageId) {
    trigger = 'reply';
    textForLangGraph = message.content.trim();
  } else if (wasMentioned && client.user) {
    trigger = 'mention';
    textForLangGraph = stripBotMentionText(message.content, client.user.id);
  }

  if (!trigger) {
    return;
  }

  if (!textForLangGraph) {
    if (trigger === 'mention') {
      await message.reply('What do you want me to help with?');
    }
    return;
  }

  const payload = buildDiscordLangGraphPayload({
    message,
    text: textForLangGraph,
    messageMode: 'normal',
    interactionMetadata: {
      trigger,
      original_message: message.content,
      reply_to_message_id: replyMetadata ? replyMetadata.reply_to_message_id : null,
      reply_to_author_id: replyMetadata ? replyMetadata.reply_to_author_id : null,
      reply_to_author_is_bot: replyMetadata ? replyMetadata.reply_to_author_is_bot : null,
      reply_to_content: replyMetadata ? replyMetadata.reply_to_content : null
    },
    recentContext: await collectRecentChannelContext({
      message,
      commandPrefix: config.prefix,
      userId: message.author.id,
      botUserId: client.user ? client.user.id : '',
      maxPerType: 3,
      logger
    })
  });

  logger.info(
    {
      trigger,
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      messageId: message.id,
      hasReplyContent: Boolean(replyMetadata && replyMetadata.reply_to_content),
      userContextCount: payload.event.recent_context.user_messages.length,
      botContextCount: payload.event.recent_context.bot_messages.length,
      replyToBotMessageId
    },
    'LangGraph conversational ingress received'
  );

  try {
    await message.channel.sendTyping();

    const result = await sendPayloadToLangGraph({
      config,
      logger,
      payload
    });

    if (!result.ok) {
      logger.error(
        { trigger, guildId: message.guild.id, error: result.error, status: result.status },
        'LangGraph conversational request failed'
      );
      await message.reply("I couldn't answer that right now.");
      return;
    }

    const replyText = (result.replyText || '').trim() || 'I do not have a response right now.';
    await message.reply(replyText.length > 2000 ? replyText.slice(0, 1997) + '...' : replyText);
  } catch (err) {
    logger.error({ err, trigger, guildId: message.guild.id }, 'Conversational routing failed');
    await message.reply("I couldn't answer that right now.");
  }
});

// n8n mention ingress intentionally disabled.

client.login(config.discordToken)
  .then(() => {
    logger.info('Discord client logged in successfully');
  })
  .catch((err) => {
    logger.error({ err }, 'Failed to log in to Discord');
    process.exit(1);
  });

startApiServer({ client, logger, config });

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  client.destroy();
  process.exit(0);
});

module.exports = { client };
