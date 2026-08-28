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
    version: "1.2.0", // HTML Kaynağından Çıkartılan Gerçek Form Mimarisi
    name: "Türkçe Altyazı (Ultimate)",
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

// PROXY İNDİRİCİ: Gerçek Form Parametreleri ve /ind Uç Noktası
app.get('/download/:subId.srt', async (req, res) => {
    const subId = req.params.subId;
    console.log(`\n>>> Nuvio Altyazı İndiriyor (ID: ${subId})...`);

    try {
        const detailUrl = subPageCache.get(subId) || `https://www.turkcealtyazi.org/sub/${subId}/altyazi.html`;
        const sessionNum = Math.floor(Math.random() * 900000) + 100000;
        
        console.log(`1. AŞAMA: Sayfa ziyaret ediliyor -> ${detailUrl} (Session: ${sessionNum})`);
        
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&keep_headers=true&url=${encodeURIComponent(detailUrl)}`;
        const detailRes = await axios.get(scraperDetailUrl, { headers: BROWSER_HEADERS, timeout: 60000 });
        
        const cookies = detailRes.headers['set-cookie'] || [];
        const cookieString = cookies.map(c => c.split(';')[0]).join('; ');

        const $ = cheerio.load(detailRes.data);
        
        // HTML Kaynağındaki gibi input[name='idid'] içeren formu seçiyoruz
        const form = $("form:has(input[name='idid'])").first();
        
        const inputs = {};
        if (form.length > 0) {
            form.find("input").each((i, el) => {
                const name = $(el).attr("name");
                if (name) inputs[name] = $(el).attr("value") || "";
            });
        } else {
            inputs.idid = subId;
        }

        const postData = new URLSearchParams(inputs).toString();
        
        // KRİTİK DÜZELTME: Sitenin gerçek POST adresi /ind (ind.php değil!)
        const formAction = "https://www.turkcealtyazi.org/ind";
        
        console.log(`2. AŞAMA: Hedef URL: ${formAction} | Yakalanan Veri: ${postData}`);
        console.log("3. AŞAMA: ZIP dosyası çekiliyor...");

        const scraperDownloadUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&keep_headers=true&url=${encodeURIComponent(formAction)}`;

        const zipRes = await axios.post(scraperDownloadUrl, postData, {
            headers: {
                ...BROWSER_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': detailUrl,
                'Cookie': cookieString
            },
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
    console.log(`Ultimate Sunucu Aktif! Port: ${PORT}`);
});
