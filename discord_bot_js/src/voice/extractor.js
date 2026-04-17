const prism = require('prism-media');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const { createAudioResource, StreamType } = require('@discordjs/voice');

async function resolveTrack(query, requestedBy) {
  if (ytdl.validateURL(query)) {
    const info = await ytdl.getBasicInfo(query);
    return {
      title: info.videoDetails.title,
      url: query,
      durationSec: Number.parseInt(info.videoDetails.lengthSeconds || '0', 10),
      requestedBy: requestedBy || 'unknown'
    };
  }

  const searchResult = await ytSearch(query);
  const video = searchResult && searchResult.videos && searchResult.videos.length > 0
    ? searchResult.videos[0]
    : null;

  if (!video) {
    throw new Error('No tracks found for query');
  }

  return {
    title: video.title,
    url: video.url,
    durationSec: video.seconds || 0,
    requestedBy: requestedBy || 'unknown'
  };
}

function createTrackResource(track, options) {
  const logger = options.logger;
  const volume = options.defaultVolume;

  const source = ytdl(track.url, {
    quality: 'highestaudio',
    filter: 'audioonly',
    highWaterMark: 1 << 25,
    dlChunkSize: 0
  });

  source.on('error', (err) => {
    logger.error({ err, url: track.url }, 'Source stream error');
  });

  const ffmpeg = new prism.FFmpeg({
    args: [
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-i', 'pipe:0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1'
    ]
  });

  ffmpeg.on('error', (err) => {
    logger.error({ err, url: track.url }, 'FFmpeg pipeline error');
  });

  source.pipe(ffmpeg);

  const resource = createAudioResource(ffmpeg, {
    inputType: StreamType.Raw,
    inlineVolume: true,
    metadata: {
      title: track.title,
      url: track.url,
      requestedBy: track.requestedBy
    }
  });

  if (resource.volume) {
    resource.volume.setVolume(volume);
  }

  return resource;
}

module.exports = {
  resolveTrack,
  createTrackResource
};