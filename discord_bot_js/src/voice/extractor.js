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

function isUsableUrl(value) {
  return typeof value === 'string' && value.length > 0;
}

function hasAudio(format) {
  return Boolean(
    format && (
      format.has_audio === true ||
      format.hasAudio === true ||
      (typeof format.mime_type === 'string' && format.mime_type.includes('audio'))
    )
  );
}

function hasVideo(format) {
  return Boolean(
    format && (
      format.has_video === true ||
      format.hasVideo === true ||
      (typeof format.mime_type === 'string' && format.mime_type.includes('video'))
    )
  );
}

function hasUsableStreamUrl(format) {
  return Boolean(format && isUsableUrl(format.url));
}

function getFormatUrl(format) {
  if (!format) {
    return null;
  }

  if (hasUsableStreamUrl(format)) {
    return format.url;
  }

  return null;
}

function getTrackDurationSeconds(info) {
  const candidates = [
    info && info.duration,
    info && info.basic_info && info.basic_info.duration,
    info && info.basic_info && info.basic_info.duration_seconds,
    info && info.video_details && info.video_details.length_seconds
  ];

  for (const value of candidates) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) {
      return numberValue;
    }
  }

  return 0;
}

function getTrackTitle(info) {
  return (
    (info && info.title) ||
    (info && info.basic_info && info.basic_info.title) ||
    (info && info.video_details && info.video_details.title) ||
    'Unknown'
  );
}

function choosePlayableFormat(info) {
  if (!info) {
    return null;
  }

  if (typeof info.chooseFormat === 'function') {
    try {
      const preferred = info.chooseFormat({ type: 'audio', quality: 'best' });
      if (preferred) {
        return preferred;
      }
    } catch (err) {
      // Fall back to manual scanning below.
    }
  }

  const streamingData = info.streaming_data || info.streamingData || {};
  const candidates = [
    ...(streamingData.adaptive_formats || streamingData.adaptiveFormats || []),
    ...(streamingData.formats || []),
    ...(info.formats || [])
  ];

  const audioOnly = candidates.find((format) => hasAudio(format) && !hasVideo(format));
  if (audioOnly) {
    return audioOnly;
  }

  const audioCapable = candidates.find((format) => hasAudio(format));
  return audioCapable || null;
}

async function resolveFormatUrl(format, ib) {
  if (!format) {
    return null;
  }

  const directUrl = getFormatUrl(format);
  if (directUrl) {
    return directUrl;
  }

  if (typeof format.decipher === 'function') {
    const player = ib && ib.session ? ib.session.player : null;
    const deciphered = await format.decipher(player);
    if (isUsableUrl(deciphered)) {
      return deciphered;
    }
  }

  return null;
}

function buildTrack(info, format, streamUrl, requestedBy, fallbackUrl) {
  return {
    title: getTrackTitle(info),
    url: fallbackUrl,
    durationSec: getTrackDurationSeconds(info),
    requestedBy: requestedBy || 'unknown',
    info,
    format,
    streamUrl
  };
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
    try {
      const info = await ib.getInfo(query);
      const format = choosePlayableFormat(info);
      if (!format) {
        throw new Error('Track has no playable audio formats');
      }

      const streamUrl = await resolveFormatUrl(format, ib);
      if (!streamUrl) {
        throw new Error('Track has no resolved stream URL');
      }

      return buildTrack(info, format, streamUrl, requestedBy, query);
    } catch (err) {
      throw new Error(
        `Failed to resolve direct URL: ${err && err.message ? err.message : 'Unknown error'}`
      );
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
        const videoId = video.id || video.videoId;
        const videoUrl = video.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
        if (!videoId && !videoUrl) {
          logSkippedCandidate(logger, video, 'No video ID');
          continue;
        }

        const info = await ib.getInfo(videoId || videoUrl);
        const format = choosePlayableFormat(info);

        if (!format) {
          logSkippedCandidate(logger, video, 'No playable audio formats');
          continue;
        }

        const streamUrl = await resolveFormatUrl(format, ib);
        if (!streamUrl) {
          logSkippedCandidate(logger, video, 'No resolved stream URL');
          continue;
        }

        return buildTrack(info, format, streamUrl, requestedBy, videoUrl || `https://youtube.com/watch?v=${videoId}`);
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

  if (!track.streamUrl) {
    throw new Error('Track is missing resolved stream URL');
  }

  const proto = track.streamUrl.startsWith('https') ? https : http;

  // Stream directly from the resolved format URL
  const source = proto.get(track.streamUrl, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      logger.error({ statusCode: res.statusCode, url: track.streamUrl }, 'Source response error');
      res.resume();
      return;
    }

    res.on('error', (err) => {
      logger.error({ err, url: track.url }, 'Source stream error');
    });

    res.pipe(ffmpeg);
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