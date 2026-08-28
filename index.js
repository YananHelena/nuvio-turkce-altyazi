const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const AdmZip = require("adm-zip");
const iconv = require("iconv-lite");
const express = require("express");
const qs = require('querystring');

const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY; 
const PORT = process.env.PORT || 10000;

const manifest = {
    id: "org.turkcealtyazi.nuvio",
    version: "1.0.8", // Önbelleği kırmak için
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
            
            // YENİ TAKTİK: Nuvio'ya sadece ID'yi değil, sayfanın TAM LİNKİNİ şifreleyerek veriyoruz.
            const fullUrl = titleLink.startsWith("http") ? titleLink : `https://www.turkcealtyazi.org${titleLink.startsWith("/") ? "" : "/"}${titleLink}`;
            const encodedUrl = Buffer.from(fullUrl).toString('base64url'); // Linki güvenli hale getiriyoruz
            
            const renderUrl = "https://nuvio-turkce-altyazi.onrender.com";
            const proxyUrl = `${renderUrl}/download/${encodedUrl}.srt`;
            
            if (!results.some(r => r.url === proxyUrl)) {
                results.push({ url: proxyUrl });
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

// 2. AŞAMA: PROXY İNDİRİCİ (TAM İNSAN SİMÜLASYONU)
app.get('/download/:encodedUrl.srt', async (req, res) => {
    try {
        // Nuvio'nun gönderdiği şifreli linki çözüyoruz
        const encodedUrl = req.params.encodedUrl;
        const decodedUrl = Buffer.from(encodedUrl, 'base64url').toString('utf8');
        
        // Site bizi robot sanmasın diye tüm işlemleri AYNI oturum (IP) üzerinden yapacağız
        const sessionNum = Math.floor(Math.random() * 1000000); 

        console.log(`\n>>> 1. AŞAMA: Altyazı detay sayfası ziyaret ediliyor: ${decodedUrl}`);
        
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&url=${encodeURIComponent(decodedUrl)}`;
        const detailResponse = await axios.get(scraperDetailUrl, { timeout: 60000 });
        const $ = cheerio.load(detailResponse.data);

        // Sayfadaki formlardan "ind.php" veya "download" içeren "İndir" butonunun formunu bul
        const form = $("form").filter((i, el) => {
            const action = $(el).attr("action") || "";
            return action.includes("ind.php") || action.includes("download");
        }).first();

        let finalDownloadUrl = "";
        let finalPostData = "";

        if (form.length > 0) {
            const action = form.attr("action");
            finalDownloadUrl = action.startsWith("http") ? action : `https://www.turkcealtyazi.org${action.startsWith("/") ? "" : "/"}${action}`;
            
            // Formun içindeki gizli şifreleri (tokenleri) ve ID'leri topluyoruz
            const inputs = {};
            form.find("input").each((i, el) => {
                const name = $(el).attr("name");
                const val = $(el).attr("value");
                if (name) inputs[name] = val || "";
            });
            finalPostData = qs.stringify(inputs);
            
            console.log(`>>> 2. AŞAMA: İndir butonu ve gizli şifreler yakalandı! Veri: ${finalPostData}`);
        } else {
            console.error(">>> DEDEKTİF: İndirme formu bulunamadı. Sitenin tasarımı değişmiş.");
            return res.status(404).send("İndirme linki bulunamadı.");
        }

        console.log(">>> 3. AŞAMA: Aynı oturum ile ZIP dosyası çekiliyor...");
        
        // Aynı session_number ile form verilerini (POST) siteye gönderiyoruz
        const scraperDownloadUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&url=${encodeURIComponent(finalDownloadUrl)}`;
        
        const zipResponse = await axios.post(scraperDownloadUrl, finalPostData, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            responseType: 'arraybuffer',
            timeout: 60000
        });

        // DOSYA DEDEKTİFİ
        const buffer = Buffer.from(zipResponse.data);
        const headerText = buffer.toString('utf8', 0, 4);

        if (headerText.startsWith('Rar!')) {
            console.error(">>> DEDEKTİF RAPORU: Bu bir RAR dosyası!");
            return res.status(400).send("RAR formatı desteklenmiyor.");
        } else if (!headerText.startsWith('PK')) {
            console.error(">>> DEDEKTİF RAPORU: Bu bir ZIP dosyası değil! Siteden HTML sayfası geldi.");
            return res.status(500).send("Geçersiz dosya formatı.");
        }

        console.log(">>> 4. AŞAMA: Geçerli ZIP dosyası yakalandı. Çıkartılıyor...");
        
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        
        let srtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.srt'));

        if (srtEntry) {
            console.log(`>>> BAŞARI! SRT bulundu: ${srtEntry.entryName}`);
            let srtData = srtEntry.getData();
            
            const utf8Srt = iconv.decode(srtData, 'win1254');

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="altyazi.srt"`);
            res.send(utf8Srt);
            console.log("Altyazı başarıyla Nuvio'ya gönderildi! 🚀");
        } else {
            console.error("Hata: ZIP içinde .srt dosyası bulunamadı.");
            res.status(404).send("Altyazı dosyası bulunamadı.");
        }
    } catch (error) {
        console.error("Proxy İndirme Hatası:", error.message);
        res.status(500).send("Sunucu zip dosyasını indiremedi.");
    }
});

const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

app.listen(PORT, () => {
    console.log(`Gelişmiş Proxy Sunucu Aktif! Port: ${PORT}`);
});
