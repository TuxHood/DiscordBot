const prism = require('prism-media');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
const { createAudioResource, StreamType } = require('@discordjs/voice');

function hasUsableFormatUrl(format) {
  return Boolean(format && typeof format.url === 'string' && format.url.length > 0);
}

function choosePlayableFormat(info) {
  if (!info || !Array.isArray(info.formats) || info.formats.length === 0) {
    return null;
  }

  const audioOnly = info.formats.find((format) => {
    return Boolean(format && format.hasAudio && !format.hasVideo && hasUsableFormatUrl(format));
  });

  if (audioOnly) {
    return audioOnly;
  }

  const audioCapable = info.formats.find((format) => {
    return Boolean(format && format.hasAudio && hasUsableFormatUrl(format));
  });

  return audioCapable || null;
}

function logSkippedCandidate(logger, candidate, reason) {
  if (!logger) {
    return;
  }

  const details = {
    title: candidate && candidate.title ? candidate.title : 'unknown',
    url: candidate && candidate.url ? candidate.url : 'unknown',
    reason
  };

  if (typeof logger.debug === 'function') {
    logger.debug(details, 'Skipping unplayable search candidate');
  }
}

function mapTrackFromInfo(info, format, fallbackUrl, requestedBy) {
  return {
    title: info.videoDetails.title,
    url: info.videoDetails.video_url || fallbackUrl,
    durationSec: Number.parseInt(info.videoDetails.lengthSeconds || '0', 10),
    requestedBy: requestedBy || 'unknown',
    info,
    format
  };
}

async function resolveTrack(query, requestedBy, logger) {
  if (ytdl.validateURL(query)) {
    const info = await ytdl.getInfo(query);
    const format = choosePlayableFormat(info);
    if (!format) {
      throw new Error('Track has no playable audio formats');
    }

    return mapTrackFromInfo(info, format, query, requestedBy);
  }

  const searchResult = await ytSearch(query);
  const videos = searchResult && Array.isArray(searchResult.videos)
    ? searchResult.videos.slice(0, 8)
    : [];

  if (videos.length === 0) {
    throw new Error('No tracks found for query');
  }

  for (const video of videos) {
    try {
      const info = await ytdl.getInfo(video.url);
      const format = choosePlayableFormat(info);
      if (!format) {
        logSkippedCandidate(logger, video, 'No playable audio formats');
        continue;
      }

      return mapTrackFromInfo(info, format, video.url, requestedBy);
    } catch (err) {
      logSkippedCandidate(logger, video, err && err.message ? err.message : 'Failed to load video info');
    }
  }

  throw new Error('No playable tracks found for query');
}

function createTrackResource(track, options) {
  const logger = options.logger;
  const volume = options.defaultVolume;

  if (!track.info || !track.format) {
    throw new Error('Track is missing resolved stream format');
  }

  const source = ytdl.downloadFromInfo(track.info, {
    format: track.format,
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
  choosePlayableFormat,
  resolveTrack,
  createTrackResource
};