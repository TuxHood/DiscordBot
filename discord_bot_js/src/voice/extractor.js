const prism = require('prism-media');
const { Innertube, UniversalCache } = require('youtubei.js');
const { createAudioResource, StreamType } = require('@discordjs/voice');
const https = require('https');
const http = require('http');

let innertube = null;

async function getInnertube() {
  if (!innertube) {
    innertube = await Innertube.create({
      cache: new UniversalCache(false)
    });
  }
  return innertube;
}

function extractVideoId(url) {
  if (!url) return null;

  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

function getPlayableFormat(info) {
  if (!info || !info.streaming_data) {
    return null;
  }

  // Prefer audio-only adaptive formats (smallest, fastest)
  const adaptiveFormats = info.streaming_data.adaptive_formats || [];
  for (const format of adaptiveFormats) {
    if (format.mime_type && format.mime_type.startsWith('audio/')) {
      return format;
    }
  }

  // Fallback to regular formats with audio
  const formats = info.streaming_data.formats || [];
  for (const format of formats) {
    if (format.mime_type && format.mime_type.includes('audio')) {
      return format;
    }
  }

  return null;
}

function logSkippedCandidate(logger, candidate, reason) {
  if (!logger || typeof logger.debug !== 'function') {
    return;
  }

  const title = candidate && candidate.title ? candidate.title : 'unknown';
  const url = candidate && candidate.url ? candidate.url : 'unknown';

  logger.debug(
    { title, url, reason },
    'Skipping unplayable search candidate'
  );
}

async function resolveTrack(query, requestedBy, logger) {
  const ib = await getInnertube();

  // Check if it's a direct YouTube URL
  if (query.includes('youtube.com') || query.includes('youtu.be')) {
    const videoId = extractVideoId(query);
    if (videoId) {
      try {
        const info = await ib.getInfo(videoId);
        const format = getPlayableFormat(info);

        if (!format) {
          throw new Error('Track has no playable audio formats');
        }

        return {
          title: info.title || 'Unknown',
          url: query,
          durationSec: info.duration || 0,
          requestedBy: requestedBy || 'unknown',
          info,
          format
        };
      } catch (err) {
        throw new Error(
          `Failed to resolve direct URL: ${err && err.message ? err.message : 'Unknown error'}`
        );
      }
    }
  }

  // Search for the query
  try {
    const searchResult = await ib.search(query, { type: 'video' });
    const videos = searchResult.videos || [];

    if (videos.length === 0) {
      throw new Error('No tracks found for query');
    }

    // Try up to 8 search results
    for (const video of videos.slice(0, 8)) {
      try {
        const videoId = video.id;
        if (!videoId) {
          logSkippedCandidate(logger, video, 'No video ID');
          continue;
        }

        const info = await ib.getInfo(videoId);
        const format = getPlayableFormat(info);

        if (!format) {
          logSkippedCandidate(logger, video, 'No playable audio formats');
          continue;
        }

        return {
          title: info.title || 'Unknown',
          url: `https://youtube.com/watch?v=${videoId}`,
          durationSec: info.duration || 0,
          requestedBy: requestedBy || 'unknown',
          info,
          format
        };
      } catch (err) {
        logSkippedCandidate(
          logger,
          video,
          err && err.message ? err.message : 'Failed to load video info'
        );
      }
    }

    throw new Error('No playable tracks found for query');
  } catch (err) {
    if (
      err.message === 'No playable tracks found for query' ||
      err.message === 'No tracks found for query'
    ) {
      throw err;
    }
    throw new Error(
      `Search failed: ${err && err.message ? err.message : 'Unknown error'}`
    );
  }
}

function createTrackResource(track, options) {
  const logger = options.logger;
  const volume = options.defaultVolume;

  if (!track.format || !track.format.url) {
    throw new Error('Track is missing resolved stream URL');
  }

  const formatUrl = track.format.url;
  const proto = formatUrl.startsWith('https') ? https : http;

  // Stream directly from the resolved format URL
  const source = proto.get(formatUrl, (res) => {
    res.on('error', (err) => {
      logger.error({ err, url: track.url }, 'Source stream error');
    });
  });

  source.on('error', (err) => {
    logger.error({ err, url: track.url }, 'Source request error');
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