const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const AdmZip = require("adm-zip");
const iconv = require("iconv-lite");
const express = require("express");

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY; 
const PORT = process.env.PORT || 10000;

const manifest = {
    id: "org.turkcealtyazi.nuvio",
    version: "1.0.3", // Önbelleği kırmak için sürümü yükselttik
    name: "Türkçe Altyazı (TurkceAltyazi.org)",
    description: "Nuvio için TurkceAltyazi.org sitesinden otomatik Türkçe altyazı çeker ve çıkarır.",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);
const app = express(); 

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args; 
    const imdbId = id.split(":")[0];

    console.log(`\n--- YENİ İSTEK GELDİ: ${imdbId} ---`);

    try {
        const subtitles = await getSubtitlesFromTurkceAltyazi(imdbId);
        console.log(`Nuvio'ya Gönderilen Altyazı Sayısı: ${subtitles.length}`);
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
    
    console.log("ScraperAPI'ye liste için istek atılıyor...");
    
    const response = await axios.get(scraperUrl, { timeout: 60000 }); 
    const $ = cheerio.load(response.data);
    const results = [];

    $("a").each((i, el) => {
        const titleLink = $(el).attr("href");
        if (titleLink && titleLink.includes("/sub/") && titleLink.includes(".html")) {
            const match = titleLink.match(/\/sub\/(\d+)\//);
            if (match) {
                const subId = match[1];
                const renderUrl = "https://nuvio-turkce-altyazi.onrender.com";
                const proxyUrl = `${renderUrl}/download/${subId}.srt`;
                
                if (!results.some(r => r.url === proxyUrl)) {
                    results.push({ url: proxyUrl });
                }
            }
        }
    });

    for (let i = 0; i < Math.min(results.length, 5); i++) {
        subtitles.push({
            id: `ta_${imdbId}_${i}`,
            url: results[i].url, 
            lang: "tur",
            label: `[TR] TurkceAltyazi.org - Çeviri ${i + 1}`
        });
    }

    return subtitles;
}

// 2. AŞAMA: PROXY İNDİRİCİ (POST İŞLEMİ)
app.get('/download/:subId.srt', async (req, res) => {
    const subId = req.params.subId;
    console.log(`\n>>> Nuvio Altyazı İndiriyor (ID: ${subId})...`);

    try {
        const downloadUrl = encodeURIComponent(`https://www.turkcealtyazi.org/ind.php`);
        const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${downloadUrl}`;

        console.log("ScraperAPI üzerinden form (POST) gönderilerek ZIP dosyası indiriliyor...");
        
        // Sitenin beklediği gizli form verisini hazırlıyoruz
        const postData = `idid=${subId}`;

        // GET yerine POST isteği atıyoruz
        const response = await axios.post(scraperUrl, postData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            responseType: 'arraybuffer', 
            timeout: 60000 
        });
        
        const zip = new AdmZip(response.data);
        const zipEntries = zip.getEntries();
        
        let srtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.srt'));

        if (srtEntry) {
            console.log(`ZIP içinden SRT bulundu: ${srtEntry.entryName}`);
            let srtData = srtEntry.getData();
            
            const utf8Srt = iconv.decode(srtData, 'win1254');

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${subId}.srt"`);
            res.send(utf8Srt);
            console.log("Altyazı başarıyla Nuvio'ya gönderildi!");
        } else {
            console.error("Hata: ZIP içinde .srt dosyası bulunamadı.");
            res.status(404).send("Altyazı dosyası bulunamadı.");
        }
    } catch (error) {
        console.error("Proxy İndirme Hatası:", error.message);
        res.status(500).send("Sunucu zip dosyasını indiremedi veya açamadı.");
    }
});

const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

app.listen(PORT, () => {
    console.log(`Gelişmiş Proxy Sunucu Aktif! Port: ${PORT}`);
});
