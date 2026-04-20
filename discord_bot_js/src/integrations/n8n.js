function stripBotMention(content, botUserId) {
  const mentionRegex = new RegExp('<@!?' + botUserId + '>', 'g');
  return content.replace(mentionRegex, '').trim();
}

function registerN8nMentionForwarding(options) {
  const client = options.client;
  const config = options.config;
  const logger = options.logger;

  if (!config.n8nWebhookUrl) {
    logger.info('N8N_WEBHOOK_URL not set, mention forwarding is disabled');
    return;
  }

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild || !client.user) {
      return;
    }

    if (!message.mentions.has(client.user)) {
      return;
    }

    if (message.content.startsWith(config.prefix)) {
      return;
    }

    const prompt = stripBotMention(message.content, client.user.id);
    if (!prompt) {
      return;
    }

    const payload = {
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      username: message.author.tag,
      content: prompt
    };

    try {
      const response = await fetch(config.n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.n8nTimeoutMs)
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error('n8n webhook returned ' + response.status + ': ' + bodyText);
      }

      // n8n already handles the Discord reply in the workflow.
      return;
    } catch (err) {
      logger.error({ err, guildId: message.guild.id }, 'Failed to forward message to n8n');
      await message.reply('n8n request failed: ' + (err && err.message ? err.message : 'unknown error'));
    }
  });

  logger.info('n8n mention forwarding enabled');
}

module.exports = {
  registerN8nMentionForwarding
};