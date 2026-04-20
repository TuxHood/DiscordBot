const express = require('express');

const { createMusicRouter } = require('./routes/music');
const { createMessageRouter } = require('./routes/message');

function authMiddleware(apiToken) {
  return (req, res, next) => {
    const token = req.headers['x-api-token'];
    if (!token || token !== apiToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };
}

async function startApiServer(options) {
  const app = express();
  const logger = options.logger;
  const config = options.config;

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'discord-bot-js' });
  });

  app.use('/api/music', authMiddleware(config.apiToken), createMusicRouter({
    client: options.client,
    voiceManager: options.voiceManager,
    logger: logger.child({ scope: 'api.music' })
  }));

  app.use('/api/message', authMiddleware(config.apiToken), createMessageRouter({
    client: options.client,
    logger: logger.child({ scope: 'api.message' })
  }));

  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled API error');
    res.status(500).json({ error: 'Internal server error' });
  });

  await new Promise((resolve, reject) => {
    const server = app.listen(config.httpPort, config.httpHost, () => {
      logger.info({ host: config.httpHost, port: config.httpPort }, 'HTTP API listening');
      resolve();
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

module.exports = {
  startApiServer
};