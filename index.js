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
    version: "1.0.9", // Önbelleği kırmak için
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
                // Şifreli linkten vazgeçtik, tekrar temiz ID'li linke döndük
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

// 2. AŞAMA: PROXY İNDİRİCİ (TAM İNSAN SİMÜLASYONU - HATASIZ)
app.get('/download/:subId.srt', async (req, res) => {
    const subId = req.params.subId;
    console.log(`\n>>> Nuvio Altyazı İndiriyor (ID: ${subId})...`);

    try {
        const sessionNum = Math.floor(Math.random() * 1000000); 
        // ID'yi kullanarak sahte bir detay sayfası linki oluşturuyoruz (Site için bu yeterli)
        const detailUrl = `https://www.turkcealtyazi.org/sub/${subId}/altyazi.html`;
        
        console.log(`>>> 1. AŞAMA: Oturum açılıyor (Session: ${sessionNum})`);
        
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&url=${encodeURIComponent(detailUrl)}`;
        const detailResponse = await axios.get(scraperDetailUrl, { timeout: 60000 });
        const $ = cheerio.load(detailResponse.data);

        // MUHTEŞEM ÇÖZÜM: Find.php karışıklığını önlemek için, SADECE içinde "idid" olan formu bul!
        const form = $("form:has(input[name='idid'])").first();

        let finalPostData = `idid=${subId}`; // Her ihtimale karşı varsayılan yedek

        if (form.length > 0) {
            const inputs = {};
            form.find("input").each((i, el) => {
                const name = $(el).attr("name");
                const val = $(el).attr("value");
                if (name) inputs[name] = val || "";
            });
            finalPostData = qs.stringify(inputs);
            console.log(`>>> 2. AŞAMA: Gerçek indirme formu bulundu! Veri: ${finalPostData}`);
        } else {
            console.log(">>> 2. AŞAMA: Form bulunamadı, varsayılan ID ile zorlanıyor...");
        }

        console.log(">>> 3. AŞAMA: Aynı oturum ile ZIP dosyası çekiliyor...");
        
        const targetDownloadUrl = `https://www.turkcealtyazi.org/ind.php`;
        const scraperDownloadUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&url=${encodeURIComponent(targetDownloadUrl)}`;
        
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
            res.setHeader('Content-Disposition', `attachment; filename="${subId}.srt"`);
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
