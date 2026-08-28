require('dotenv').config({ quiet: true });

const config = require('./config');
const { createSubtitleService } = require('./lib/subtitleService');
const { createTurkceAltyaziClient } = require('./lib/turkcealtyaziClient');

function createDefaultSubtitleService(overrides = {}) {
  const client =
    overrides.client ||
    createTurkceAltyaziClient({
      baseUrl: overrides.upstreamBaseUrl || config.upstreamBaseUrl,
      timeoutMs: overrides.requestTimeoutMs || config.requestTimeoutMs,
      maxArchiveBytes: overrides.maxArchiveBytes || config.maxArchiveBytes,
      concurrency: overrides.upstreamConcurrency || config.upstreamConcurrency,
    });

  return createSubtitleService({
    client,
    logger: overrides.logger,
    detailConcurrency: overrides.detailConcurrency || 4,
  });
}

module.exports = {
  createDefaultSubtitleService,
};
