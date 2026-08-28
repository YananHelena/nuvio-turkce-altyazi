const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

// === BURAYA KENDİ API ANAHTARINI YAPIŞTIR ===
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

// Manifest (Nuvio'nun okuduğu eklenti kimlik kartı)
const manifest = {
    id: "org.turkcealtyazi.nuvio",
    version: "1.0.0",
    name: "Türkçe Altyazı (TurkceAltyazi.org)",
    description: "Nuvio için TurkceAltyazi.org sitesinden otomatik Türkçe altyazı çeker.",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { type, id } = args; 
    const parts = id.split(":");
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1], 10) : null;
    const episode = parts[2] ? parseInt(parts[2], 10) : null;

    console.log(`[İstek] ${imdbId}`);

    try {
        const subtitles = await getSubtitlesFromTurkceAltyazi(imdbId, season, episode);
        return { subtitles };
    } catch (err) {
        console.error("Hata:", err.message);
        return { subtitles: [] };
    }
});

async function getSubtitlesFromTurkceAltyazi(imdbId, season, episode) {
    const subtitles = [];
    const targetUrl = encodeURIComponent(`https://www.turkcealtyazi.org/find.php?cat=sub&find=${imdbId}`);
    
    // ScraperAPI üzerinden Cloudflare'i aşarak istek atıyoruz (render=true diyerek JS'nin çalışmasını bekliyoruz)
    // render=true kısmını sildik, sadece API ile bağlanıyoruz
    const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${targetUrl}`;
    
    console.log("ScraperAPI üzerinden siteye bağlanılıyor...");
    
    // Süreyi 20 saniyeden 60 saniyeye çıkardık
    const response = await axios.get(scraperUrl, { timeout: 60000 });
    const $ = cheerio.load(response.data);
    const results = [];

    // Arama sonuçlarını ayıklama
    $(".search-results tr, .al-table tr, div.al-row").each((i, el) => {
        const titleLink = $(el).find("a[href*='/sub/']").attr("href");
        const titleText = $(el).text().trim();

        if (titleLink) {
            results.push({
                url: titleLink.startsWith("http") ? titleLink : `https://www.turkcealtyazi.org${titleLink}`,
                info: titleText
            });
        }
    });

    for (let i = 0; i < Math.min(results.length, 5); i++) {
        const res = results[i];
        
        if (season && episode) {
            const seasonEpRegex = new RegExp(`S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`, 'i');
            const simpleRegex = new RegExp(`${season}x${episode}`, 'i');
            
            if (!seasonEpRegex.test(res.info) && !simpleRegex.test(res.info) && !res.info.includes(`${season}. Sezon`)) {
                continue;
            }
        }

        subtitles.push({
            id: `ta_${imdbId}_${i}`,
            url: res.url,
            lang: "tur",
            label: `[TR] TurkceAltyazi.org - Seçenek ${i + 1}`
        });
    }

    return subtitles;
}

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Sunucu aktif! Port: ${PORT}`);
