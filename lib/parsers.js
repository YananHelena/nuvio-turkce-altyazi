const cheerio = require('cheerio');

function absoluteTurkceAltyaziUrl(href, baseUrl = 'https://turkcealtyazi.org') {
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseSubtitleCandidates(html, { baseUrl = 'https://turkcealtyazi.org' } = {}) {
  const $ = cheerio.load(html);
  const candidates = [];

  // Sitedeki olası tüm altyazı satır/tablo yapılarını taranır hale getiriyoruz
  $('tr, div, li').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a').filter((_, a) => {
      const h = $(a).attr('href') || '';
      return h.includes('mov') || h.includes('detay') || h.includes('alt') || h.includes('id=');
    }).first();

    const href = $link.attr('href');
    if (!href) return;

    const text = $el.text();
    const seasonEpisodeMatch = text.match(/s0?(\d+)e0?(\d+)/i) || text.match(/(\d+)x(\d+)/);
    const season = seasonEpisodeMatch ? Number(seasonEpisodeMatch[1]) : null;
    const episode = seasonEpisodeMatch ? Number(seasonEpisodeMatch[2]) : null;
    const isPackage = /sezon|pack|boxset|tümü|komple/i.test(text);

    const fullUrl = absoluteTurkceAltyaziUrl(href, baseUrl);
    if (fullUrl && !candidates.some(c => c.pageUrl === fullUrl)) {
      candidates.push({
        pageUrl: fullUrl,
        season,
        episode,
        isPackage,
        rawText: text.trim().slice(0, 100),
      });
    }
  });

  return candidates;
}

function parseDownloadInfo(html, pageUrl) {
  const $ = cheerio.load(html);
  let altid = null;
  let idid = null;
  let sidid = null;

  $('input').each((_, el) => {
    const name = $(el).attr('name');
    const val = $(el).attr('value');
    if (name === 'altid') altid = val;
    if (name === 'idid') idid = val;
    if (name === 'sidid') sidid = val;
  });

  if (!altid) {
    const matchAlt = html.match(/altid['"]?\s*[:=]\s*['"]?(\d+)/i) || pageUrl.match(/detay\.php\?id=(\d+)/);
    if (matchAlt) altid = matchAlt[1];
  }

  return {
    altid: altid || '0',
    idid: idid || '0',
    sidid: sidid || '0',
    referer: pageUrl,
  };
}

module.exports = {
  absoluteTurkceAltyaziUrl,
  parseSubtitleCandidates,
  parseDownloadInfo,
};
