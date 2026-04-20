const dotenv = require('dotenv');

dotenv.config();

function parseIntOrDefault(value, defaultValue) {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error('Missing required environment variable: ' + name);
  }

  return value;
}

function parseBoolOrDefault(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return defaultValue;
}

const config = {
  discordToken: requireEnv('DISCORD_TOKEN'),
  prefix: process.env.DISCORD_PREFIX || '!',
  logLevel: process.env.LOG_LEVEL || 'info',
  httpHost: process.env.HTTP_HOST || '127.0.0.1',
  httpPort: parseIntOrDefault(process.env.HTTP_PORT, 3000),
  apiToken: requireEnv('API_TOKEN'),
  lavalinkHost: requireEnv('LAVALINK_HOST'),
  lavalinkPort: parseIntOrDefault(requireEnv('LAVALINK_PORT'), 2333),
  lavalinkPassword: requireEnv('LAVALINK_PASSWORD'),
  lavalinkSecure: parseBoolOrDefault(process.env.LAVALINK_SECURE, false),
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || '',
  n8nTimeoutMs: parseIntOrDefault(process.env.N8N_TIMEOUT_MS, 10000),
  defaultVolume: Number.parseFloat(process.env.DEFAULT_VOLUME || '0.5')
};

if (Number.isNaN(config.defaultVolume) || config.defaultVolume <= 0 || config.defaultVolume > 2) {
  throw new Error('DEFAULT_VOLUME must be a number > 0 and <= 2');
}

module.exports = {
  config
};