const express = require('express');

async function getGuild(client, guildId) {
  let guild = client.guilds.cache.get(guildId);
  if (guild) {
    return guild;
  }

  guild = await client.guilds.fetch(guildId);
  return guild;
}

async function getVoiceChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }

  let channel = guild.channels.cache.get(channelId);
  if (!channel) {
    channel = await guild.channels.fetch(channelId);
  }

  if (!channel || !channel.isVoiceBased || !channel.isVoiceBased()) {
    throw new Error('Provided channelId is not a voice channel');
  }

  return channel;
}

function createMusicRouter(options) {
  const router = express.Router();
  const client = options.client;
  const voiceManager = options.voiceManager;
  const logger = options.logger;

  function pickValue(source, keys) {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        return source[key];
      }
    }

    return null;
  }

  router.post('/play', async (req, res) => {
    try {
      const guildId = pickValue(req.body, ['guildId', 'guild_id']);
      const query = req.body.query;
      const channelId = pickValue(req.body, ['channelId', 'channel_id', 'voice_channel_id']);
      const requestedBy = pickValue(req.body, ['requestedBy', 'requested_by']) || 'api';

      if (!guildId || !query) {
        res.status(400).json({ error: 'guildId and query are required' });
        return;
      }

      const guild = await getGuild(client, guildId);
      const voiceChannel = await getVoiceChannel(guild, channelId);

      const result = await voiceManager.play({
        guild,
        voiceChannel,
        textChannel: null,
        query,
        requestedBy
      });

      res.json({
        ok: true,
        started: result.started,
        position: result.position,
        track: result.track
      });
    } catch (err) {
      logger.error({ err }, 'API play failed');
      res.status(500).json({ error: err.message || 'play failed' });
    }
  });

  router.post('/pause', async (req, res) => {
    try {
      const guildId = pickValue(req.body, ['guildId', 'guild_id']);
      if (!guildId) {
        res.status(400).json({ error: 'guildId is required' });
        return;
      }

      const paused = await voiceManager.pause(guildId);
      res.json({ ok: true, paused });
    } catch (err) {
      logger.error({ err }, 'API pause failed');
      res.status(500).json({ error: err.message || 'pause failed' });
    }
  });

  router.post('/resume', async (req, res) => {
    try {
      const guildId = pickValue(req.body, ['guildId', 'guild_id']);
      if (!guildId) {
        res.status(400).json({ error: 'guildId is required' });
        return;
      }

      const resumed = await voiceManager.resume(guildId);
      res.json({ ok: true, resumed });
    } catch (err) {
      logger.error({ err }, 'API resume failed');
      res.status(500).json({ error: err.message || 'resume failed' });
    }
  });

  router.post('/skip', async (req, res) => {
    try {
      const guildId = pickValue(req.body, ['guildId', 'guild_id']);
      if (!guildId) {
        res.status(400).json({ error: 'guildId is required' });
        return;
      }

      const skipped = await voiceManager.skip(guildId);
      res.json({ ok: true, skipped });
    } catch (err) {
      logger.error({ err }, 'API skip failed');
      res.status(500).json({ error: err.message || 'skip failed' });
    }
  });

  router.post('/stop', async (req, res) => {
    try {
      const guildId = pickValue(req.body, ['guildId', 'guild_id']);
      if (!guildId) {
        res.status(400).json({ error: 'guildId is required' });
        return;
      }

      await voiceManager.stop(guildId);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'API stop failed');
      res.status(500).json({ error: err.message || 'stop failed' });
    }
  });

  router.get('/queue', async (req, res) => {
    try {
      const guildId = pickValue(req.query, ['guildId', 'guild_id']);
      if (!guildId) {
        res.status(400).json({ error: 'guildId is required' });
        return;
      }

      const queue = await voiceManager.getQueue(guildId);
      res.json({ ok: true, queue });
    } catch (err) {
      logger.error({ err }, 'API queue failed');
      res.status(500).json({ error: err.message || 'queue failed' });
    }
  });

  return router;
}

module.exports = {
  createMusicRouter
};