const axios = require('axios');
const { createLimiter } = require('./cache');
const { absoluteTurkceAltyaziUrl, parseDownloadInfo, parseSubtitleCandidates } = require('./parsers');
const { validateDownloadInfo } = require('./token');

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

function createTurkceAltyaziClient({
  baseUrl = 'https://turkcealtyazi.org',
  timeoutMs = 60_000,
  maxArchiveBytes = 10 * 1024 * 1024,
  concurrency = 8,
} = {}) {
  const origin = new URL(baseUrl).origin;
  const limit = createLimiter(concurrency);

  async function request(config) {
    return limit(async () => {
      let targetUrl = config.url;
      if (targetUrl.startsWith('/')) {
        targetUrl = `${origin}${targetUrl}`;
      }
      if (config.params) {
        const params = new URLSearchParams(config.params);
        targetUrl += `?${params.toString()}`;
      }

      const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&keep_headers=true&url=${encodeURIComponent(targetUrl)}`;
      
      const axiosConfig = {
        method: config.method || 'GET',
        url: scraperUrl,
        timeout: timeoutMs,
        maxContentLength: maxArchiveBytes,
        maxBodyLength: maxArchiveBytes,
        headers: {
          ...(config.headers || {}),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        },
        responseType: config.responseType || 'text'
      };

      if (config.data) {
        axiosConfig.data = config.data;
      }

      const response = await axios(axiosConfig);
      return response;
    });
  }

  async function getPage(url) {
    const pageUrl = absoluteTurkceAltyaziUrl(url, origin);
    const response = await request({ method: 'GET', url: pageUrl, responseType: 'text' });
    return response.data;
  }

  return {
    proxyEnabled: true,

    async findTitlePage(imdbId) {
      if (!/^tt\d+$/.test(imdbId)) throw new TypeError('Invalid IMDb id');
      const response = await request({
        method: 'GET',
        url: '/things_.php',
        params: { t: 99, term: imdbId.slice(2) },
        responseType: 'json',
      });

      let data = response.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch {}
      }

      const first = Array.isArray(data) ? data[0] : null;
      return first?.url ? absoluteTurkceAltyaziUrl(first.url, origin) : null;
    },

    async listCandidates(pageUrl, query) {
      const html = await getPage(pageUrl);
      return parseSubtitleCandidates(html, { ...query, baseUrl: origin });
    },

    async getDownloadInfo(pageUrl) {
      const html = await getPage(pageUrl);
      return parseDownloadInfo(html, pageUrl);
    },

    async downloadArchive(downloadInfo) {
      const info = validateDownloadInfo(downloadInfo);
      const form = new URLSearchParams({
        idid: info.idid,
        altid: info.altid,
        sidid: info.sidid,
      });

      const response = await request({
        method: 'POST',
        url: '/ind',
        data: form.toString(),
        responseType: 'arraybuffer',
        headers: {
          Accept: 'application/zip,application/octet-stream;q=0.9,*/*;q=0.8',
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: origin,
          Referer: info.referer,
        },
      });

      const archive = Buffer.from(response.data);
      const isZip = archive.length >= 4 && archive[0] === 0x50 && archive[1] === 0x4b;
      if (!isZip) throw new Error('TurkceAltyazi returned a non-ZIP response');
      return archive;
    },
  };
}

module.exports = {
  createTurkceAltyaziClient,
};
