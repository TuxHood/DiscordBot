const pino = require('pino');
const { Client, GatewayIntentBits } = require('discord.js');

const { config } = require('./config');
const { VoiceManager } = require('./voice/voiceManager');
const { startApiServer } = require('./api/server');
const { registerN8nMentionForwarding } = require('./integrations/n8n');
const {
  sendPayloadToLangGraph,
  buildDiscordLangGraphPayload,
  stripBotMentionText
} = require('./integrations/langgraph');

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

client.once('clientReady', () => {
  logger.info({ user: client.user ? client.user.tag : 'unknown' }, 'Discord client is ready');
});

client.on('error', (err) => {
  logger.error({ err }, 'Discord client error');
});

async function getReplyToBotMessageId(message) {
  if (!client.user || !message.reference || !message.reference.messageId) {
    return null;
  }

  try {
    const referenced = await message.fetchReference();
    if (referenced && referenced.author && referenced.author.id === client.user.id) {
      return referenced.id;
    }
  } catch (err) {
    logger.debug({ err, messageId: message.id }, 'Unable to fetch referenced message');
  }

  return null;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) {
    return;
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

  const replyToBotMessageId = await getReplyToBotMessageId(message);
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
      reply_to_bot_message_id: replyToBotMessageId
    }
  });

  logger.info(
    {
      trigger,
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      messageId: message.id,
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
// registerN8nMentionForwarding({ client, config, logger });

startApiServer({ client, config, logger, voiceManager })
  .then(() => {
    logger.info('HTTP API server started');
  })
  .catch((err) => {
    logger.fatal({ err }, 'Failed to start HTTP API server');
    process.exit(1);
  });

client
  .login(config.discordToken)
  .then(() => {
    logger.info('Discord login initiated');
  })
  .catch((err) => {
    logger.fatal({ err }, 'Discord login failed');
    process.exit(1);
  });

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});