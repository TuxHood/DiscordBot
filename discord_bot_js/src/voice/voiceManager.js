const { Connectors, LoadType, Shoukaku } = require('shoukaku');
const { GuildPlayer } = require('./guildPlayer');

class VoiceManager {
  constructor(options) {
    this.client = options.client;
    this.logger = options.logger;
    this.players = new Map();

    const lavalink = options.lavalink || {};
    const connector = new Connectors.DiscordJS(this.client);
    this.shoukaku = new Shoukaku(connector, [
      {
        name: 'main',
        url: `${lavalink.host}:${lavalink.port}`,
        auth: lavalink.password,
        secure: Boolean(lavalink.secure)
      }
    ]);

    this.shoukaku.on('ready', (name) => {
      this.logger.info({ node: name }, 'Lavalink node connected');
    });

    this.shoukaku.on('error', (name, err) => {
      this.logger.error({ err, node: name }, 'Lavalink node error');
    });

    this.shoukaku.on('close', (name, code, reason) => {
      this.logger.warn({ node: name, code, reason }, 'Lavalink node closed');
    });
  }

  getOrCreatePlayer(guildId, lavalinkPlayer) {
    const existing = this.players.get(guildId);
    if (existing) {
      if (lavalinkPlayer) {
        existing.setPlayer(lavalinkPlayer);
      }
      return existing;
    }

    const player = new GuildPlayer({
      guildId,
      logger: this.logger.child({ scope: 'guildPlayer', guildId }),
      player: lavalinkPlayer
    });

    this.players.set(guildId, player);
    return player;
  }

  getPlayer(guildId) {
    return this.players.get(guildId) || null;
  }

  async join(options) {
    const guild = options.guild;
    const voiceChannel = options.voiceChannel;

    if (!guild || !voiceChannel) {
      throw new Error('Guild and voice channel are required for join');
    }

    const shardId = guild.shardId || 0;
    const lavalinkPlayer = await this.shoukaku.joinVoiceChannel({
      guildId: guild.id,
      shardId,
      channelId: voiceChannel.id,
      deaf: true
    });

    const player = this.getOrCreatePlayer(guild.id, lavalinkPlayer);
    this.logger.info({ guildId: guild.id, channelId: voiceChannel.id }, 'Lavalink player joined voice');
    return player;
  }

  async leave(guildId) {
    const player = this.getPlayer(guildId);
    if (player) {
      await player.stop();
      await player.destroy();
      this.players.delete(guildId);
    }

    if (this.shoukaku.players.has(guildId)) {
      await this.shoukaku.leaveVoiceChannel(guildId);
    }
  }

  async resolveTrack(query, requestedBy) {
    const node = this.shoukaku.getIdealNode();
    if (!node) {
      throw new Error('No Lavalink nodes are available');
    }

    const trimmed = String(query || '').trim();
    if (!trimmed) {
      throw new Error('Query is required');
    }

    const isUrl = /^(https?:\/\/)/i.test(trimmed);
    const identifier = isUrl ? trimmed : `ytsearch:${trimmed}`;

    let result;
    try {
      result = await node.rest.resolve(identifier);
    } catch (err) {
      this.logger.error({ err, query: trimmed }, 'Lavalink load failed');
      throw new Error('Failed to load track from Lavalink');
    }

    if (!result) {
      throw new Error('No playable tracks found for query');
    }

    if (result.loadType === LoadType.ERROR) {
      this.logger.error({ error: result.data, query: trimmed }, 'Lavalink load returned an error');
      throw new Error('Failed to load track from Lavalink');
    }

    if (result.loadType === LoadType.EMPTY) {
      throw new Error('No playable tracks found for query');
    }

    let selected = null;
    if (result.loadType === LoadType.TRACK) {
      selected = result.data;
    } else if (result.loadType === LoadType.SEARCH) {
      selected = Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
    } else if (result.loadType === LoadType.PLAYLIST) {
      const tracks = result.data && Array.isArray(result.data.tracks) ? result.data.tracks : [];
      const selectedTrack = result.data && result.data.info ? result.data.info.selectedTrack : -1;
      if (tracks.length > 0) {
        if (selectedTrack >= 0 && selectedTrack < tracks.length) {
          selected = tracks[selectedTrack];
        } else {
          selected = tracks[0];
        }
      }
    }

    if (!selected) {
      throw new Error('No playable tracks found for query');
    }

    const durationMs = selected.info && Number.isFinite(selected.info.length)
      ? selected.info.length
      : 0;

    return {
      encoded: selected.encoded,
      title: selected.info && selected.info.title ? selected.info.title : 'Unknown',
      url: selected.info && selected.info.uri ? selected.info.uri : trimmed,
      durationSec: Math.floor(durationMs / 1000),
      requestedBy: requestedBy || 'unknown',
      sourceName: selected.info ? selected.info.sourceName : 'unknown'
    };
  }

  async play(options) {
    const guild = options.guild;
    const voiceChannel = options.voiceChannel;
    const query = options.query;
    const requestedBy = options.requestedBy || 'unknown';

    if (!guild) {
      throw new Error('Guild is required for play');
    }

    let player = this.getPlayer(guild.id);
    if (!this.shoukaku.players.has(guild.id)) {
      if (!voiceChannel) {
        throw new Error('Join a voice channel first or provide channelId over API');
      }
      player = await this.join({ guild, voiceChannel });
    } else if (!player) {
      const lavalinkPlayer = this.shoukaku.players.get(guild.id);
      player = this.getOrCreatePlayer(guild.id, lavalinkPlayer);
    }

    const track = await this.resolveTrack(query, requestedBy);
    const enqueueResult = await player.enqueue(track);

    if (enqueueResult.started) {
      this.logger.info({ guildId: guild.id, title: track.title }, 'Track started');
    } else {
      this.logger.info({ guildId: guild.id, title: track.title, position: enqueueResult.position }, 'Track queued');
    }

    return {
      track,
      started: enqueueResult.started,
      position: enqueueResult.position
    };
  }

  async pause(guildId) {
    const player = this.getPlayer(guildId);
    if (!player) {
      return false;
    }

    return player.pause();
  }

  async resume(guildId) {
    const player = this.getPlayer(guildId);
    if (!player) {
      return false;
    }

    return player.resume();
  }

  async skip(guildId) {
    const player = this.getPlayer(guildId);
    if (!player) {
      return false;
    }

    return player.skip();
  }

  async stop(guildId) {
    const player = this.getPlayer(guildId);
    if (!player) {
      return;
    }

    await player.stop();
  }

  async getQueue(guildId) {
    const player = this.getPlayer(guildId);
    if (!player) {
      return {
        current: null,
        items: []
      };
    }

    return player.getSnapshot();
  }
}

module.exports = {
  VoiceManager
};