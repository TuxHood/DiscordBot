async function resolveTrack() {
  throw new Error('Local source resolution is disabled. Lavalink handles track loading.');
}

function createTrackResource() {
  throw new Error('Local audio resource creation is disabled. Lavalink handles playback.');
}

module.exports = {
  resolveTrack,
  createTrackResource
};