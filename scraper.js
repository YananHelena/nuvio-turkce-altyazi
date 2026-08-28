require('dotenv').config({ quiet: true });

const { createSubtitleService } = require('./lib/subtitleService');
const { createTurkceAltyaziClient } = require('./lib/turkcealtyaziClient');

function createDefaultSubtitleService(overrides = {}) {
  const proxyUrl = overrides.proxyUrl !== undefined ? overrides.proxyUrl : (process.env.PROXY_LINK || null);
  const client =
    overrides.client ||
    createTurkceAltyaziClient({
      baseUrl: overrides.upstreamBaseUrl || 'https://turkcealtyazi.org',
      proxyUrl,
      timeoutMs: overrides.requestTimeoutMs || Number(process.env.REQUEST_TIMEOUT_MS) || 12_000,
      maxArchiveBytes: overrides.maxArchiveBytes || Number(process.env.MAX_ARCHIVE_BYTES) || 10 * 1024 * 1024,
      concurrency: overrides.upstreamConcurrency || Number(process.env.UPSTREAM_CONCURRENCY) || 8,
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
