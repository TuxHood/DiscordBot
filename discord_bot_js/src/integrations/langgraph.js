function buildLangGraphUrl(config) {
  const endpoint = String(config.langGraphTestEndpoint || '/invoke').trim();
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }

  const base = String(config.langGraphBaseUrl || 'http://127.0.0.1:8000').trim().replace(/\/+$/, '');
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  return base + normalizedEndpoint;
}

function stripBotMentionText(content, botUserId) {
  const mentionRegex = new RegExp('<@!?' + botUserId + '>', 'g');
  return String(content || '')
    .replace(mentionRegex, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getNonEmptyString(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

function deriveSourceIdentity(message) {
  const author = message && message.author ? message.author : null;
  const member = message && message.member ? message.member : null;

  const sourceUserId = getNonEmptyString(author && author.id);
  const sourceUsername = getNonEmptyString(author && author.username)
    || getNonEmptyString(author && author.tag)
    || sourceUserId
    || 'unknown';
  const sourceGlobalName = getNonEmptyString(author && author.globalName);
  const guildDisplayName = getNonEmptyString(member && member.displayName);
  const sourceDisplayName = guildDisplayName || sourceGlobalName || sourceUsername;

  return {
    source_user_id: sourceUserId || null,
    source_username: sourceUsername,
    source_display_name: sourceDisplayName,
    source_global_name: sourceGlobalName || null
  };
}

function isUsefulContextContent(content, commandPrefix) {
  const trimmed = String(content || '').trim();
  if (!trimmed) {
    return false;
  }

  if (commandPrefix && trimmed.startsWith(commandPrefix)) {
    return false;
  }

  return true;
}

function toContextMessage(message) {
  return {
    message_id: message.id,
    author_id: message.author.id,
    content: String(message.content || '').trim(),
    timestamp: message.createdAt.toISOString()
  };
}

async function getReferencedMessageMetadata(options) {
  const message = options.message;
  const logger = options.logger;

  if (!message.reference || !message.reference.messageId) {
    return null;
  }

  try {
    const referenced = await message.fetchReference();
    if (!referenced) {
      return null;
    }

    return {
      reply_to_message_id: referenced.id,
      reply_to_author_id: referenced.author ? referenced.author.id : null,
      reply_to_author_is_bot: Boolean(referenced.author && referenced.author.bot),
      reply_to_content: String(referenced.content || '').trim()
    };
  } catch (err) {
    logger.debug({ err, messageId: message.id }, 'Unable to fetch referenced message metadata');
    return null;
  }
}

async function collectRecentChannelContext(options) {
  const message = options.message;
  const commandPrefix = options.commandPrefix;
  const userId = options.userId;
  const botUserId = options.botUserId;
  const logger = options.logger;
  const maxPerType = options.maxPerType || 3;

  const recentContext = {
    user_messages: [],
    bot_messages: []
  };

  try {
    const history = await message.channel.messages.fetch({ limit: 40 });

    for (const candidate of history.values()) {
      if (candidate.id === message.id) {
        continue;
      }

      if (!isUsefulContextContent(candidate.content, commandPrefix)) {
        continue;
      }

      if (candidate.author && candidate.author.id === userId) {
        if (recentContext.user_messages.length < maxPerType) {
          recentContext.user_messages.push(toContextMessage(candidate));
        }
      } else if (candidate.author && candidate.author.id === botUserId) {
        if (recentContext.bot_messages.length < maxPerType) {
          recentContext.bot_messages.push(toContextMessage(candidate));
        }
      }

      if (
        recentContext.user_messages.length >= maxPerType
        && recentContext.bot_messages.length >= maxPerType
      ) {
        break;
      }
    }
  } catch (err) {
    logger.debug({ err, channelId: message.channel.id, messageId: message.id }, 'Failed to collect recent channel context');
  }

  recentContext.user_messages.reverse();
  recentContext.bot_messages.reverse();

  return recentContext;
}

function buildDiscordLangGraphPayload(options) {
  const message = options.message;
  const text = String(options.text || '').trim();
  const messageMode = options.messageMode || 'normal';
  const sourceIdentity = deriveSourceIdentity(message);

  const payload = {
    event: {
      source: 'discord',
      source_user_id: sourceIdentity.source_user_id,
      source_display_name: sourceIdentity.source_display_name,
      source_username: sourceIdentity.source_username,
      source_message_id: message.id,
      guild_id: message.guild ? message.guild.id : null,
      channel_id: message.channel.id,
      timestamp: message.createdAt.toISOString(),
      text,
      message_mode: messageMode
    }
  };

  if (sourceIdentity.source_global_name) {
    payload.event.source_global_name = sourceIdentity.source_global_name;
  }

  if (options.testMetadata) {
    payload.event.test_metadata = options.testMetadata;
  }

  if (options.interactionMetadata) {
    payload.event.interaction_metadata = options.interactionMetadata;
  }

  if (options.recentContext) {
    payload.event.recent_context = options.recentContext;
  }

  return payload;
}

function extractReplyFromLangGraphResponse(payload) {
  if (payload === null || payload === undefined) {
    return '';
  }

  if (typeof payload === 'string') {
    return payload.trim();
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const extracted = extractReplyFromLangGraphResponse(item);
      if (extracted) {
        return extracted;
      }
    }
    return '';
  }

  if (typeof payload === 'object') {
    if (payload.final_response !== undefined) {
      const direct = extractReplyFromLangGraphResponse(payload.final_response);
      if (direct) {
        return direct;
      }
    }

    if (payload.output !== undefined) {
      const nested = extractReplyFromLangGraphResponse(payload.output);
      if (nested) {
        return nested;
      }
    }

    return '';
  }

  return String(payload).trim();
}

async function sendPayloadToLangGraph(options) {
  const config = options.config;
  const logger = options.logger;
  const payload = options.payload;

  const url = buildLangGraphUrl(config);
  const headers = {
    'content-type': 'application/json'
  };

  if (config.langGraphApiKey) {
    headers.authorization = 'Bearer ' + config.langGraphApiKey;
  }

  logger.info(
    {
      url,
      messageMode: payload && payload.event ? payload.event.message_mode : undefined,
      trigger: payload && payload.event && payload.event.interaction_metadata
        ? payload.event.interaction_metadata.trigger
        : undefined,
      textLength: payload && payload.event && payload.event.text ? payload.event.text.length : 0,
      sourceUserId: payload && payload.event ? payload.event.source_user_id : undefined,
      sourceDisplayName: payload && payload.event ? payload.event.source_display_name : undefined,
      sourceUsername: payload && payload.event ? payload.event.source_username : undefined
    },
    'Sending LangGraph payload'
  );

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.langGraphTimeoutMs)
    });
  } catch (err) {
    logger.error({ err, url }, 'LangGraph request failed before response');
    return {
      ok: false,
      error: err && err.message ? err.message : 'request failed',
      status: null,
      replyText: ''
    };
  }

  const rawBody = await response.text();
  let parsed;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsed = null;
  }

  const replyText = extractReplyFromLangGraphResponse(parsed) || rawBody.trim();

  logger.info(
    {
      url,
      status: response.status,
      parsedReply: replyText || '<empty>',
      rawBodyLength: rawBody.length
    },
    'LangGraph response received'
  );

  if (!response.ok) {
    return {
      ok: false,
      error: 'HTTP ' + response.status,
      status: response.status,
      replyText
    };
  }

  return {
    ok: true,
    error: null,
    status: response.status,
    replyText
  };
}

module.exports = {
  sendPayloadToLangGraph,
  buildDiscordLangGraphPayload,
  stripBotMentionText,
  getReferencedMessageMetadata,
  collectRecentChannelContext,
  sendTestPayloadToLangGraph: sendPayloadToLangGraph
};
