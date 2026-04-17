const { AudioPlayerStatus, createAudioPlayer } = require('@discordjs/voice');

const { TrackQueue } = require('./queue');
const { createTrackResource } = require('./extractor');

class GuildPlayer {
  constructor(options) {
    this.guildId = options.guildId;
    this.logger = options.logger;
    this.defaultVolume = options.defaultVolume;

    this.queue = new TrackQueue();
    this.audioPlayer = createAudioPlayer();
    this.connection = null;
    this.currentTrack = null;
    this.advancing = false;

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      this.currentTrack = null;
      this.playNext().catch((err) => {
        this.logger.error({ err, guildId: this.guildId }, 'Failed to play next track on idle');
      });
    });

    this.audioPlayer.on('error', (err) => {
      this.logger.error({ err, guildId: this.guildId }, 'Audio player error');
      this.currentTrack = null;
      this.playNext().catch((nextErr) => {
        this.logger.error({ err: nextErr, guildId: this.guildId }, 'Failed to recover after audio player error');
      });
    });
  }

  setConnection(connection) {
    this.connection = connection;
    connection.subscribe(this.audioPlayer);
  }

  clearConnection() {
    this.connection = null;
  }

  async enqueue(track) {
    const position = this.queue.enqueue(track);
    const status = this.audioPlayer.state.status;

    if (status !== AudioPlayerStatus.Playing && status !== AudioPlayerStatus.Paused && !this.currentTrack) {
      await this.playNext();
      return {
        started: true,
        position: 0
      };
    }

    return {
      started: false,
      position
    };
  }

  async playNext() {
    if (this.advancing) {
      return false;
    }

    if (!this.connection) {
      this.logger.warn({ guildId: this.guildId }, 'playNext called without connection');
      return false;
    }

    if (this.queue.length === 0) {
      return false;
    }

    this.advancing = true;
    try {
      const nextTrack = this.queue.dequeue();
      if (!nextTrack) {
        return false;
      }

      const resource = createTrackResource(nextTrack, {
        logger: this.logger,
        defaultVolume: this.defaultVolume
      });
      this.currentTrack = nextTrack;
      this.audioPlayer.play(resource);
      this.logger.info({ guildId: this.guildId, title: nextTrack.title }, 'Started playback');
      return true;
    } finally {
      this.advancing = false;
    }
  }

  pause() {
    return this.audioPlayer.pause();
  }

  resume() {
    return this.audioPlayer.unpause();
  }

  skip() {
    return this.audioPlayer.stop(true);
  }

  stop() {
    this.queue.clear();
    this.currentTrack = null;
    this.audioPlayer.stop(true);
  }

  destroy() {
    this.stop();
    this.audioPlayer.removeAllListeners();
  }

  getSnapshot() {
    return {
      current: this.currentTrack ? { ...this.currentTrack } : null,
      items: this.queue.snapshot()
    };
  }
}

module.exports = {
  GuildPlayer
};