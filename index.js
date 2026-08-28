const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

// Manifest (Nuvio'nun okuduğu eklenti kimlik kartı)
const manifest = {
    id: "org.turkcealtyazi.nuvio",
    version: "1.0.0",
    name: "Türkçe Altyazı (TurkceAltyazi.org)",
    description: "Nuvio için TurkceAltyazi.org sitesinden otomatik Türkçe altyazı çeker.",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
    catalogs: []
};

const builder = new addonBuilder(manifest);

// HTTP istekleri için Standart User-Agent
const HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
};

// Nuvio'dan gelen altyazı isteklerini karşılayan fonksiyon
builder.defineSubtitlesHandler(async (args) => {
    const { type, id } = args; // Örn id: "tt0111161" veya diziler için "tt0944947:1:1"
    const parts = id.split(":");
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1], 10) : null;
    const episode = parts[2] ? parseInt(parts[2], 10) : null;

    console.log(`[Altyazı İsteği] Tip: ${type}, IMDB: ${imdbId}${season ? `, Sezon: ${season}, Bölüm: ${episode}` : ""}`);

    try {
        const subtitles = await getSubtitlesFromTurkceAltyazi(imdbId, season, episode);
        return { subtitles };
    } catch (err) {
        console.error("Altyazı getirme hatası:", err.message);
        return { subtitles: [] };
    }
});

/**
 * TurkceAltyazi.org üzerinden IMDB ID ile arama yapıp altyazı bağlantılarını toplayan fonksiyon
 */
async function getSubtitlesFromTurkceAltyazi(imdbId, season, episode) {
    const subtitles = [];
    const searchUrl = `https://www.turkcealtyazi.org/find.php?cat=sub&find=${imdbId}`;
    
    const response = await axios.get(searchUrl, {
        headers: HTTP_HEADERS,
        timeout: 8000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // Arama sonuçları listesindeki altyazı sayfalarını topla
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

    // İlk 5 altyazı sonucunu Nuvio formatına dönüştür
    for (let i = 0; i < Math.min(results.length, 5); i++) {
        const res = results[i];
        
        // Eğer dizi ise sezon ve bölüm kontrolü
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

// Sunucuyu başlat (Render PORT ortam değişkenini otomatik verir)
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Eklenti sunucusu aktif! Port: ${PORT}`);
