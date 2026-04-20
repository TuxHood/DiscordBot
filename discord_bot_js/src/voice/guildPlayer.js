const { TrackQueue } = require('./queue');

class GuildPlayer {
  constructor(options) {
    this.guildId = options.guildId;
    this.logger = options.logger;

    this.queue = new TrackQueue();
    this.player = null;
    this.currentTrack = null;
    this.advancing = false;
    this.stopRequested = false;
    this.boundEvents = {
      start: this.onTrackStart.bind(this),
      end: this.onTrackEnd.bind(this),
      exception: this.onTrackException.bind(this),
      stuck: this.onTrackStuck.bind(this)
    };

    if (options.player) {
      this.setPlayer(options.player);
    }
  }

  setPlayer(player) {
    if (!player) {
      return;
    }

    if (this.player === player) {
      return;
    }

    if (this.player) {
      this.player.off('start', this.boundEvents.start);
      this.player.off('end', this.boundEvents.end);
      this.player.off('exception', this.boundEvents.exception);
      this.player.off('stuck', this.boundEvents.stuck);
    }

    this.player = player;
    this.player.on('start', this.boundEvents.start);
    this.player.on('end', this.boundEvents.end);
    this.player.on('exception', this.boundEvents.exception);
    this.player.on('stuck', this.boundEvents.stuck);
  }

  onTrackStart() {
    if (!this.currentTrack) {
      return;
    }

    this.logger.info({ guildId: this.guildId, title: this.currentTrack.title }, 'Track started');
  }

  onTrackEnd(reason) {
    const endedReason = reason && reason.reason ? reason.reason : 'unknown';
    this.currentTrack = null;

    if (this.stopRequested && endedReason === 'stopped') {
      this.stopRequested = false;
      return;
    }

    if (
      endedReason === 'finished' ||
      endedReason === 'loadFailed' ||
      endedReason === 'cleanup' ||
      endedReason === 'stopped'
    ) {
      this.playNext().catch((err) => {
        this.logger.error({ err, guildId: this.guildId }, 'Failed to play next Lavalink track on end event');
      });
    }
  }

  onTrackException(data) {
    this.logger.error({ guildId: this.guildId, exception: data && data.exception ? data.exception : data }, 'Lavalink track exception');
    this.currentTrack = null;
    this.playNext().catch((err) => {
      this.logger.error({ err, guildId: this.guildId }, 'Failed to recover after Lavalink track exception');
    });
  }

  onTrackStuck(data) {
    this.logger.error({ guildId: this.guildId, data }, 'Lavalink track stuck');
    this.currentTrack = null;
    this.playNext().catch((err) => {
      this.logger.error({ err, guildId: this.guildId }, 'Failed to recover after Lavalink track stuck event');
    });
  }

  async enqueue(track) {
    const position = this.queue.enqueue(track);

    if (!this.currentTrack && !this.advancing) {
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

    if (!this.player) {
      this.logger.warn({ guildId: this.guildId }, 'playNext called without Lavalink player');
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

      if (!nextTrack.encoded) {
        throw new Error('Track is missing Lavalink encoded value');
      }

      this.stopRequested = false;
      this.currentTrack = nextTrack;
      await this.player.playTrack({ track: { encoded: nextTrack.encoded } });
      return true;
    } catch (err) {
      this.logger.error({ err, guildId: this.guildId }, 'Failed to start Lavalink playback');
      this.currentTrack = null;
      return false;
    } finally {
      this.advancing = false;
    }
  }

  async pause() {
    if (!this.player || !this.currentTrack) {
      return false;
    }

    await this.player.setPaused(true);
    return true;
  }

  async resume() {
    if (!this.player || !this.currentTrack) {
      return false;
    }

    await this.player.setPaused(false);
    return true;
  }

  async skip() {
    if (!this.player || !this.currentTrack) {
      return false;
    }

    await this.player.stopTrack();
    return true;
  }

  async stop() {
    this.queue.clear();
    if (!this.player || !this.currentTrack) {
      this.currentTrack = null;
      return;
    }

    this.stopRequested = true;
    await this.player.stopTrack();
    this.currentTrack = null;
  }

  async destroy() {
    await this.stop();
    if (this.player) {
      this.player.off('start', this.boundEvents.start);
      this.player.off('end', this.boundEvents.end);
      this.player.off('exception', this.boundEvents.exception);
      this.player.off('stuck', this.boundEvents.stuck);
      this.player = null;
    }
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