require('dotenv').config({ quiet: true });

const express = require('express');
const landingTemplate = require('./landingTemplate');
const manifest = require('./manifest');
const { createDefaultSubtitleService } = require('./scraper');

const PORT = process.env.PORT || 10000;
const SEARCH_CACHE_SECONDS = 15 * 60;
const EMPTY_CACHE_SECONDS = 2 * 60;
const SUBTITLE_CACHE_SECONDS = 24 * 60 * 60;

function requestBaseUrl(req) {
  try {
    return new URL(`${req.protocol}://${req.get('host')}`).origin;
  } catch {
    return `http://127.0.0.1:${PORT}`;
  }
}

function parseMediaId(type, rawId) {
  if (!['movie', 'series'].includes(type)) throw new TypeError('Unsupported media type');
  const parts = rawId.split(':');
  const imdbId = parts[0];
  if (!/^tt\d+$/.test(imdbId)) throw new TypeError('Invalid IMDb id');

  if (type === 'movie') return { imdbId, type, season: null, episode: null };

  const season = Number(parts[1]);
  const episode = Number(parts[2]);
  if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) {
    throw new TypeError('Series ids must include a valid season and episode');
  }
  return { imdbId, type, season, episode };
}

function subtitleUrl(baseUrl, subtitle, media) {
  const season = media.season ?? 0;
  const episode = media.episode ?? 0;
  return `${baseUrl}/subtitle/${encodeURIComponent(subtitle.token)}/${season}/${episode}.vtt`;
}

function publicManifest(addonManifest, baseUrl) {
  return {
    ...addonManifest,
    logo: `${baseUrl}/images/logo.png`,
    background: `${baseUrl}/images/background.webp`,
  };
}

function cacheControl({ maxAge, staleRevalidate = 4 * 60 * 60, staleError = 7 * 24 * 60 * 60 }) {
  return `public, max-age=${maxAge}, stale-while-revalidate=${staleRevalidate}, stale-if-error=${staleError}`;
}

function createApp({
  service = createDefaultSubtitleService(),
  addonManifest = manifest,
  logger = console,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/', (req, res) => {
    const baseUrl = requestBaseUrl(req);
    res.type('html').send(landingTemplate(addonManifest, `${baseUrl}/manifest.json`));
  });

  app.get(['/manifest.json', '/addon/manifest.json'], (req, res) => {
    const baseUrl = requestBaseUrl(req);
    res.set('Cache-Control', cacheControl({ maxAge: 60 * 60 }));
    res.json(publicManifest(addonManifest, baseUrl));
  });

  // Stremio altyazı isteklerini tüm varyasyonlarıyla (ekstra query parametreleri dahil) yakala
  app.get(['/subtitles/:type/:imdbId.json', '/subtitles/:type/:imdbId/:query.json'], async (req, res) => {
    let media;
    try {
      const fullId = req.params.imdbId + (req.params[0] || '');
      media = parseMediaId(req.params.type, fullId);
    } catch (error) {
      return res.status(400).json({ subtitles: [], error: error.message });
    }

    try {
      const results = await service.findSubtitles(media);
      const baseUrl = requestBaseUrl(req);
      const subtitles = results.map((subtitle) => ({
        id: subtitle.id,
        lang: subtitle.lang,
        url: subtitleUrl(baseUrl, subtitle, media),
      }));

      res.set('Cache-Control', cacheControl({ maxAge: subtitles.length > 0 ? SEARCH_CACHE_SECONDS : EMPTY_CACHE_SECONDS }));
      return res.json({ subtitles });
    } catch (error) {
      logger.error?.('Subtitle lookup failed', { error: error.message, imdbId: media.imdbId });
      return res.status(502).json({ subtitles: [] });
    }
  });

  app.get('/subtitle/:token/:season/:episode.vtt', async (req, res) => {
    const season = Number(req.params.season);
    const episode = Number(req.params.episode);
    try {
      const subtitle = await service.getSubtitle({ token: req.params.token, season, episode });
      res.set({
        'Cache-Control': cacheControl({ maxAge: SUBTITLE_CACHE_SECONDS }),
        'Content-Type': 'text/vtt; charset=utf-8',
      });
      return res.send(subtitle.body);
    } catch (error) {
      return res.status(404).type('text').send('Subtitle unavailable');
    }
  });

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', proxy: service.proxyEnabled ? 'enabled' : 'disabled' });
  });

  return app;
}

if (require.main === module) {
  createApp().listen(PORT, () => {
    console.log(`Addon listening on port ${PORT}`);
  });
}

module.exports = createApp();
