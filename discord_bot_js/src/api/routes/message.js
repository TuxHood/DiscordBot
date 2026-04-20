const express = require('express');

function createMessageRouter(options) {
  const router = express.Router();
  const client = options.client;
  const logger = options.logger;

  router.post('/', async (req, res) => {
    try {
      const { channel_id, content, reply_to } = req.body;

      if (!channel_id || !content) {
        return res.status(400).json({ error: 'channel_id and content are required' });
      }

      const channel = await client.channels.fetch(channel_id);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ error: 'Text channel not found' });
      }

      const messageOptions = { content };
      if (reply_to) {
        messageOptions.reply = { messageReference: reply_to, failIfNotExists: false };
      }

      const sentMessage = await channel.send(messageOptions);

      res.json({
        ok: true,
        message_id: sentMessage.id
      });
    } catch (err) {
      logger.error({ err }, 'API message send failed');
      res.status(500).json({ error: err.message || 'message send failed' });
    }
  });

  return router;
}

module.exports = {
  createMessageRouter
};
