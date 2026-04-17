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

function normalizeText(value) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text.trim();
    }

    if (typeof value.label === 'string') {
      return value.label.trim();
    }

    if (typeof value.title === 'string') {
      return value.title.trim();
    }
  }

  return '';
}

function getVideoId(candidate) {
  if (!candidate) {
    return '';
  }

  if (typeof candidate === 'string') {
    const match = candidate.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
    return match ? match[1] : '';
  }

  return candidate.id || candidate.video_id || candidate.videoId || '';
}

function getCanonicalUrl(videoId) {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : '';
}

function isUsableUrl(value) {
  return typeof value === 'string' && value.length > 0;
}

function getTrackDurationSeconds(info) {
  const candidates = [
    info && info.duration,
    info && info.basic_info && info.basic_info.duration,
    info && info.basic_info && info.basic_info.duration,
    info && info.basic_info && info.basic_info.duration_seconds,
    info && info.video_details && info.video_details.length_seconds,
    info && info.videoDetails && info.videoDetails.lengthSeconds
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
    (info && info.videoDetails && info.videoDetails.title) ||
    'Unknown'
  );
}

async function resolveFormatUrl(format, ib) {
  if (!format) {
    return null;
  }

  if (isUsableUrl(format.url)) {
    return format.url;
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

async function getPlayableFormatAndUrl(ib, info, videoId) {
  let format = null;

  if (typeof info.chooseFormat === 'function') {
    try {
      format = info.chooseFormat({ type: 'audio', quality: 'best' });
    } catch (err) {
      format = null;
    }
  }

  if (!format) {
    try {
      const streamingData = typeof ib.getStreamingData === 'function'
        ? await ib.getStreamingData(videoId, { type: 'audio', quality: 'best', client: 'TV' })
        : null;

      if (streamingData) {
        format = streamingData;
      }
    } catch (err) {
      format = null;
    }
  }

  if (!format && info && Array.isArray(info.formats)) {
    const audioOnly = info.formats.find((candidate) => {
      const mimeType = candidate && candidate.mime_type ? candidate.mime_type : '';
      return Boolean(candidate && candidate.url && mimeType.includes('audio') && !mimeType.includes('video'));
    });

    if (audioOnly) {
      format = audioOnly;
    }
  }

  if (!format) {
    return { format: null, streamUrl: null };
  }

  const streamUrl = await resolveFormatUrl(format, ib);
  return { format, streamUrl };
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

  const title = normalizeText(candidate && candidate.title) || 'unknown';
  const videoId = getVideoId(candidate);
  const url = getCanonicalUrl(videoId) || 'unknown';

  logger.debug(
    { title, url, reason },
    'Skipping unplayable search candidate'
  );
}

async function resolveTrack(query, requestedBy, logger) {
  const ib = await getInnertube();
  const text = normalizeText(query);
  const directVideoId = getVideoId(text);

  // Check if it's a direct YouTube URL
  if (directVideoId && (text.includes('youtube.com') || text.includes('youtu.be'))) {
    try {
      const info = await ib.getBasicInfo(directVideoId, { client: 'TV' });
      const resolved = await getPlayableFormatAndUrl(ib, info, directVideoId);
      const format = resolved.format;
      const streamUrl = resolved.streamUrl;

      if (!format) {
        throw new Error('Track has no playable audio formats');
      }
      if (!streamUrl) {
        throw new Error('No valid URL to decipher');
      }

      return buildTrack(info, format, streamUrl, requestedBy, getCanonicalUrl(directVideoId));
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
        const videoId = getVideoId(video);
        const videoUrl = getCanonicalUrl(videoId);
        if (!videoId) {
          logSkippedCandidate(logger, video, 'No video ID');
          continue;
        }

        const info = await ib.getBasicInfo(videoId, { client: 'TV' });
        const resolved = await getPlayableFormatAndUrl(ib, info, videoId);
        const format = resolved.format;
        const streamUrl = resolved.streamUrl;

        if (!format) {
          logSkippedCandidate(logger, { title: normalizeText(video.title), url: videoUrl }, 'No playable audio formats');
          continue;
        }

        if (!streamUrl) {
          logSkippedCandidate(logger, { title: normalizeText(video.title), url: videoUrl }, 'No valid URL to decipher');
          continue;
        }

        return buildTrack(info, format, streamUrl, requestedBy, videoUrl);
      } catch (err) {
        logSkippedCandidate(
          logger,
          { title: normalizeText(video.title), url: getCanonicalUrl(getVideoId(video)) },
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