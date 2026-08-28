const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY; 

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
    const { id } = args; 
    const parts = id.split(":");
    const imdbId = parts[0];

    console.log(`\n--- YENİ İSTEK GELDİ: ${imdbId} ---`);

    try {
        const subtitles = await getSubtitlesFromTurkceAltyazi(imdbId);
        console.log(`Bulunan Altyazı Sayısı: ${subtitles.length}`);
        return { subtitles };
    } catch (err) {
        console.error("Hata:", err.message);
        return { subtitles: [] };
    }
});

async function getSubtitlesFromTurkceAltyazi(imdbId) {
    const subtitles = [];
    const targetUrl = encodeURIComponent(`https://www.turkcealtyazi.org/find.php?cat=sub&find=${imdbId}`);
    const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${targetUrl}`;
    
    console.log("ScraperAPI'ye istek atılıyor...");
    
    const response = await axios.get(scraperUrl, { timeout: 60000 }); 
    const $ = cheerio.load(response.data);
    
    // İŞTE AJAN KODUMUZ: Sayfanın başlığını (Title) loga yazdıracak
    const sayfaBasligi = $('title').text().trim();
    console.log(">>> GELEN SAYFANIN BAŞLIĞI:", sayfaBasligi);

    const results = [];

    // Hem arama hem de direkt film sayfası için daha geniş seçiciler ekledik
    $(".search-results tr, .al-table tr, div.al-row, div.altyazi-list-wrapper div.row").each((i, el) => {
        const titleLink = $(el).find("a[href*='/sub/']").attr("href");
        if (titleLink) {
            results.push({
                url: titleLink.startsWith("http") ? titleLink : `https://www.turkcealtyazi.org${titleLink}`,
            });
        }
    });

    console.log(">>> HTML'den Çıkarılan Link Sayısı:", results.length);

    for (let i = 0; i < Math.min(results.length, 5); i++) {
        subtitles.push({
            id: `ta_${imdbId}_${i}`,
            url: results[i].url,
            lang: "tur",
            label: `[TR] TurkceAltyazi.org - Seçenek ${i + 1}`
        });
    }

    return subtitles;
}

const PORT = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port: PORT });
