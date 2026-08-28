const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const AdmZip = require("adm-zip");
const iconv = require("iconv-lite");
const express = require("express");
const qs = require("querystring");

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY; 
const PORT = process.env.PORT || 10000;

const manifest = {
    id: "org.turkcealtyazi.nuvio",
    version: "1.1.2", // NİHAİ SÜRÜM - Bulut Proxy ve Çerez Yönetimi
    name: "Türkçe Altyazı (Bulut Pro)",
    description: "Nuvio için TurkceAltyazi.org sitesinden proxy pelerini ve çerez yönetimiyle altyazı çeker.",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);
const app = express(); 

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

// 1. AŞAMA: ARAMA İŞLEMİ (ScraperAPI ile Cloudflare atlatılır)
async function getSubtitlesFromTurkceAltyazi(imdbId) {
    const subtitles = [];
    const targetUrl = encodeURIComponent(`https://www.turkcealtyazi.org/find.php?cat=sub&find=${imdbId}`);
    
    console.log("ScraperAPI ile arama isteği atılıyor (Render IP engeli aşılıyor)...");
    
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

// 2. AŞAMA: DOSYA İNDİRME (ScraperAPI + Session + Cookie Kopyalama)
app.get('/download/:subId.srt', async (req, res) => {
    const subId = req.params.subId;
    console.log(`\n>>> Nuvio Altyazı İndiriyor (ID: ${subId})...`);

    try {
        // ScraperAPI'nin aynı IP'yi kullanması için sabit bir oturum numarası belirliyoruz
        const sessionNum = Math.floor(Math.random() * 100000); 
        const detailUrl = `https://www.turkcealtyazi.org/sub/${subId}/altyazi.html`;
        
        console.log(`1. AŞAMA: ScraperAPI ile altyazı sayfasına gidilip ÇEREZLER alınıyor (Session: ${sessionNum})...`);
        
        // keep_headers=true ekledik ki bizim gönderdiğimiz ve aldığımız başlıkları silmesin!
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&keep_headers=true&url=${encodeURIComponent(detailUrl)}`;
        
        const detailRes = await axios.get(scraperDetailUrl, { headers: BROWSER_HEADERS, timeout: 60000 });

        // ScraperAPI üzerinden gelen Çerezleri kopyalıyoruz
        const cookies = detailRes.headers['set-cookie'] || [];
        const cookieString = cookies.map(c => c.split(';')[0]).join('; ');

        const $ = cheerio.load(detailRes.data);
        const form = $("form:has(input[name='idid'])").first();

        if (form.length === 0) {
            console.error("Hata: İndirme formu sayfada bulunamadı.");
            return res.status(404).send("Form bulunamadı.");
        }

        const inputs = {};
        form.find("input").each((i, el) => {
            const name = $(el).attr("name");
            if (name) inputs[name] = $(el).attr("value") || "";
        });

        const postData = qs.stringify(inputs);
        console.log(`2. AŞAMA: Çerezler ve Şifreler hazır! Veri: ${postData}`);
        console.log("3. AŞAMA: Aynı ScraperAPI oturumu ile ZIP indiriliyor (POST)...");

        const targetDownloadUrl = encodeURIComponent('https://www.turkcealtyazi.org/ind.php');
        const scraperDownloadUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&keep_headers=true&url=${targetDownloadUrl}`;

        // Hem Çerezleri (Cookie) hem de Referer'i ScraperAPI üzerinden siteye yediriyoruz
        const zipRes = await axios.post(scraperDownloadUrl, postData, {
            headers: {
                ...BROWSER_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': detailUrl,
                'Cookie': cookieString
            },
            responseType: 'arraybuffer',
            timeout: 60000
        });

        const buffer = Buffer.from(zipRes.data);
        const headerText = buffer.toString('utf8', 0, 4);

        if (headerText.startsWith('Rar!')) {
            console.error(">>> HATA: Bu bir RAR dosyası!");
            return res.status(400).send("RAR formatı desteklenmiyor.");
        } else if (!headerText.startsWith('PK')) {
            console.error(">>> HATA: ZIP dosyası gelmedi! Site HTML gönderdi.");
            return res.status(500).send("Geçersiz dosya formatı.");
        }

        console.log("4. AŞAMA: Geçerli ZIP yakalandı, SRT çıkartılıyor...");
        
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        
        let srtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.srt'));

        if (srtEntry) {
            let srtData = srtEntry.getData();
            const utf8Srt = iconv.decode(srtData, 'win1254'); 

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${subId}.srt"`);
            res.send(utf8Srt);
            console.log(">>> GÖREV TAMAMLANDI! Altyazı kusursuzca Nuvio'ya gönderildi! 🚀");
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
    console.log(`Bulut Pro Sunucu Aktif! Port: ${PORT}`);
});
