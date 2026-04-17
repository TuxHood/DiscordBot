const {
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} = require('@discordjs/voice');

const { resolveTrack } = require('./extractor');
const { GuildPlayer } = require('./guildPlayer');

class VoiceManager {
  constructor(options) {
    this.client = options.client;
    this.logger = options.logger;
    this.defaultVolume = options.defaultVolume;
    this.players = new Map();
  }

  getOrCreatePlayer(guildId) {
    const existing = this.players.get(guildId);
    if (existing) {
      return existing;
    }

    const player = new GuildPlayer({
      guildId,
      logger: this.logger.child({ scope: 'guildPlayer', guildId }),
      defaultVolume: this.defaultVolume
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

    const player = this.getOrCreatePlayer(guild.id);
    const connection = joinVoiceChannel({
      guildId: guild.id,
      channelId: voiceChannel.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true
    });

    this.attachConnectionHandlers(guild.id, connection, player);

    await entersState(connection, VoiceConnectionStatus.Ready, 20000);

    player.setConnection(connection);
    this.logger.info({ guildId: guild.id, channelId: voiceChannel.id }, 'Voice connection ready');
    return player;
  }

  attachConnectionHandlers(guildId, connection, player) {
    connection.on(VoiceConnectionStatus.Ready, () => {
      this.logger.info({ guildId }, 'Voice connection entered Ready state');
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      this.logger.warn({ guildId }, 'Voice connection disconnected');
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
        this.logger.info({ guildId }, 'Voice connection recovered from disconnect');
      } catch (err) {
        this.logger.warn({ err, guildId }, 'Voice connection did not recover, destroying');
        connection.destroy();
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.logger.info({ guildId }, 'Voice connection destroyed');
      player.clearConnection();
      player.stop();
    });

    connection.on('error', (err) => {
      this.logger.error({ err, guildId }, 'Voice connection error');
    });
  }

  async leave(guildId) {
    const player = this.getPlayer(guildId);
    if (player) {
      player.stop();
      player.clearConnection();
    }

    const connection = getVoiceConnection(guildId);
    if (connection) {
      connection.destroy();
    }
  }

  async play(options) {
    const guild = options.guild;
    const voiceChannel = options.voiceChannel;
    const query = options.query;
    const requestedBy = options.requestedBy || 'unknown';

    if (!guild) {
      throw new Error('Guild is required for play');
    }

    const existingConnection = getVoiceConnection(guild.id);
    let player = this.getOrCreatePlayer(guild.id);

    if (!existingConnection) {
      if (!voiceChannel) {
        throw new Error('Join a voice channel first or provide channelId over API');
      }
      player = await this.join({ guild, voiceChannel });
    } else if (!player.connection) {
      player.setConnection(existingConnection);
    }

    const track = await resolveTrack(query, requestedBy, this.logger);
    const enqueueResult = await player.enqueue(track);

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

    player.stop();
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