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
    version: "1.1.9", // Nokta Atışı Link Filtreleme
    name: "Türkçe Altyazı (Direct v2)",
    description: "Nuvio için TurkceAltyazi.org altyazı eklentisi.",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);
const app = express(); 

const subPageCache = new Map();

const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
};

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
    
    console.log("ScraperAPI ile arama yapılıyor...");
    const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${targetUrl}`;
    const response = await axios.get(scraperUrl, { timeout: 60000 }); 
    const $ = cheerio.load(response.data);
    const results = [];

    $("a").each((i, el) => {
        const titleLink = $(el).attr("href");
        if (titleLink && titleLink.includes("/sub/") && titleLink.includes(".html")) {
            const match = titleLink.match(/\/sub\/(\d+)\//);
            if (match) {
                const subId = match[1];
                const fullPageUrl = titleLink.startsWith("http") ? titleLink : `https://www.turkcealtyazi.org${titleLink.startsWith("/") ? "" : "/"}${titleLink}`;
                subPageCache.set(subId, fullPageUrl);

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
            label: `[TR] TurkceAltyazi - Çeviri ${i + 1}`
        });
    }

    return subtitles;
}

// PROXY İNDİRİCİ: Filtrelenmiş ve Güvenli GET İsteği
app.get('/download/:subId.srt', async (req, res) => {
    const subId = req.params.subId;
    console.log(`\n>>> Nuvio Altyazı İndiriyor (ID: ${subId})...`);

    try {
        const detailUrl = subPageCache.get(subId) || `https://www.turkcealtyazi.org/sub/${subId}/altyazi.html`;
        
        console.log(`1. AŞAMA: Sayfa analiz ediliyor -> ${detailUrl}`);
        
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(detailUrl)}`;
        const detailRes = await axios.get(scraperDetailUrl, { headers: BROWSER_HEADERS, timeout: 60000 });
        
        const $ = cheerio.load(detailRes.data);
        
        let directDownloadLink = "";
        $("a").each((i, el) => {
            const href = $(el).attr("href") || "";
            // KİRİTİK FİLTRE: find.php gibi tuzak linkleri ele, sadece indirme veya zip linklerini al!
            if ((href.includes("ind.php") || href.includes("download") || href.endsWith(".zip")) && !href.includes("find.php")) {
                directDownloadLink = href;
            }
        });

        // Kesin çözüm: Doğrudan ind.php?id= formatını kullanmak her zaman en garantisidir
        const downloadTarget = `https://www.turkcealtyazi.org/ind.php?id=${subId}`;

        console.log(`2. AŞAMA: Kesin indirme adresi: ${downloadTarget}`);
        console.log("3. AŞAMA: ZIP dosyası ScraperAPI üzerinden çekiliyor...");

        const scraperDownloadUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(downloadTarget)}`;

        const zipRes = await axios.get(scraperDownloadUrl, {
            headers: BROWSER_HEADERS,
            responseType: 'arraybuffer',
            timeout: 90000 
        });

        const buffer = Buffer.from(zipRes.data);
        const headerText = buffer.toString('utf8', 0, 4);

        if (headerText.startsWith('Rar!')) {
            console.error(">>> HATA: RAR formatı desteklenmiyor.");
            return res.status(400).send("RAR formatı desteklenmiyor.");
        } else if (!headerText.startsWith('PK')) {
            console.error(">>> HATA: Geçersiz dosya (HTML/Cloudflare engeli).");
            return res.status(500).send("Geçersiz dosya formatı.");
        }

        console.log("4. AŞAMA: ZIP başarıyla alındı, SRT ayıklanıyor...");
        
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        
        let srtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.srt'));

        if (srtEntry) {
            let srtData = srtEntry.getData();
            const utf8Srt = iconv.decode(srtData, 'win1254'); 

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${subId}.srt"`);
            res.send(utf8Srt);
            console.log(">>> GÖREV BAŞARIYLA TAMAMLANDI! Altyazı Nuvio'da! 🎉");
        } else {
            console.error("Hata: ZIP içinde .srt dosyası bulunamadı.");
            res.status(404).send("Altyazı dosyası bulunamadı.");
        }
    } catch (error) {
        console.error("İndirme Hatası:", error.message);
        res.status(500).send("Dosya indirilemedi.");
    }
});

const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

app.listen(PORT, () => {
    console.log(`Direct v2 Sunucu Aktif! Port: ${PORT}`);
});
