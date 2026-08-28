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
    
    console.log(">>> GELEN SAYFANIN BAŞLIĞI:", $('title').text().trim());

    const results = [];

    // YENİ TAKTİK: Sayfadaki tüm linkleri (a etiketlerini) tara ve ID'yi yakala
    $("a").each((i, el) => {
        const titleLink = $(el).attr("href");
        
        // Eğer link "/sub/" içeriyorsa ve html ise
        if (titleLink && titleLink.includes("/sub/") && titleLink.includes(".html")) {
            
            // Linkin içindeki ID numarasını (Örn: 478159) buluyoruz
            const match = titleLink.match(/\/sub\/(\d+)\//);
            
            if (match) {
                const subId = match[1];
                // Nuvio'nun anlayacağı GERÇEK indirme linkini oluşturuyoruz
                const downloadUrl = `https://www.turkcealtyazi.org/ind.php?id=${subId}`;
                
                // Aynı linki mükerrer olarak listeye eklememek için kontrol
                if (!results.some(r => r.url === downloadUrl)) {
                    results.push({ url: downloadUrl });
                }
            }
        }
    });

    console.log(">>> HTML'den Çıkarılan Link Sayısı:", results.length);

    // Nuvio'ya en fazla ilk 5 sonucu gönderiyoruz
    for (let i = 0; i < Math.min(results.length, 5); i++) {
        subtitles.push({
            id: `ta_${imdbId}_${i}`,
            url: results[i].url, // Nuvio için tıklanabilir altyazı linki
            lang: "tur",
            label: `[TR] TurkceAltyazi.org - Çeviri ${i + 1}`
        });
    }

    return subtitles;
}

const PORT = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port: PORT });
