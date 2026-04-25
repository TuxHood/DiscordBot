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

function buildDiscordLangGraphPayload(options) {
  const message = options.message;
  const text = String(options.text || '').trim();
  const messageMode = options.messageMode || 'normal';

  const payload = {
    event: {
      source: 'discord',
      source_user_id: message.author.id,
      source_message_id: message.id,
      guild_id: message.guild ? message.guild.id : null,
      channel_id: message.channel.id,
      timestamp: message.createdAt.toISOString(),
      text,
      message_mode: messageMode
    }
  };

  if (options.testMetadata) {
    payload.event.test_metadata = options.testMetadata;
  }

  if (options.interactionMetadata) {
    payload.event.interaction_metadata = options.interactionMetadata;
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

  logger.info({ url, payload }, 'Sending LangGraph payload');

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
  sendTestPayloadToLangGraph: sendPayloadToLangGraph
};
