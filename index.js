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
    version: "1.2.1", // Orijinal Mimari Uyumlu Sürüm
    name: "Türkçe Altyazı (Core)",
    description: "Nuvio için TurkceAltyazi.org altyazı eklentisi.",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);
const app = express(); 

const subPageCache = new Map();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const BROWSER_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "tr,en-US;q=0.9,en;q=0.8"
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
    const origin = 'https://www.turkcealtyazi.org';
    
    // Orijinal repodaki gibi önce /things_.php ile film sayfasını buluyoruz
    const thingsUrl = `https://www.turkcealtyazi.org/things_.php?t=99&term=${imdbId.slice(2)}`;
    console.log("Orijinal yöntemle film sayfası aranıyor...");
    
    const scraperThingsUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(thingsUrl)}`;
    const thingsRes = await axios.get(scraperThingsUrl, { timeout: 60000 });
    
    let titlePageUrl = "";
    if (Array.isArray(thingsRes.data) && thingsRes.data[0]?.url) {
        let u = thingsRes.data[0].url;
        titlePageUrl = u.startsWith("http") ? u : `${origin}${u.startsWith("/") ? "" : "/"}${u}`;
    }

    if (!titlePageUrl) {
        // Yedek olarak standart find.php kullanıyoruz
        titlePageUrl = `https://www.turkcealtyazi.org/find.php?cat=sub&find=${imdbId}`;
    }

    console.log(`Bulunan film/altyazı sayfası: ${titlePageUrl}`);
    const scraperDetailUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(titlePageUrl)}`;
    const response = await axios.get(scraperDetailUrl, { headers: BROWSER_HEADERS, timeout: 60000 }); 
    const $ = cheerio.load(response.data);
    const results = [];

    $("a").each((i, el) => {
        const titleLink = $(el).attr("href");
        if (titleLink && titleLink.includes("/sub/") && titleLink.includes(".html")) {
            const match = titleLink.match(/\/sub\/(\d+)\//);
            if (match) {
                const subId = match[1];
                const fullPageUrl = titleLink.startsWith("http") ? titleLink : `${origin}${titleLink.startsWith("/") ? "" : "/"}${titleLink}`;
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

// PROXY İNDİRİCİ: Orijinal İstemcinin Birebir POST Mantığı
app.get('/download/:subId.srt', async (req, res) => {
    const subId = req.params.subId;
    console.log(`\n>>> Nuvio Altyazı İndiriyor (ID: ${subId})...`);

    try {
        const detailUrl = subPageCache.get(subId) || `https://www.turkcealtyazi.org/sub/${subId}/altyazi.html`;
        const sessionNum = Math.floor(Math.random() * 900000) + 100000;
        
        console.log(`1. AŞAMA: Altyazı detay sayfası alınıyor -> ${detailUrl}`);
        
        const scraperDetailUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&keep_headers=true&url=${encodeURIComponent(detailUrl)}`;
        const detailRes = await axios.get(scraperDetailUrl, { headers: BROWSER_HEADERS, timeout: 60000 });
        
        const cookies = detailRes.headers['set-cookie'] || [];
        const cookieString = cookies.map(c => c.split(';')[0]).join('; ');

        const $ = cheerio.load(detailRes.data);
        const form = $("form:has(input[name='idid'])").first();
        
        const inputs = {};
        if (form.length > 0) {
            form.find("input").each((i, el) => {
                const name = $(el).attr("name");
                if (name) inputs[name] = $(el).attr("value") || "";
            });
        }
        
        // Eğer formdan idid bulunamazsa manuel ekle
        if (!inputs.idid) inputs.idid = subId;

        // Orijinal koddaki gibi eksiksiz form verisi oluşturuluyor
        const formParams = new URLSearchParams({
            idid: inputs.idid || "",
            altid: inputs.altid || subId,
            sidid: inputs.sidid || ""
        });

        console.log(`2. AŞAMA: POST verisi hazır: ${formParams.toString()}`);
        console.log("3. AŞAMA: /ind adresine orijinal başlıklarla POST atılıyor...");

        const formAction = "https://www.turkcealtyazi.org/ind";
        const scraperDownloadUrl = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&session_number=${sessionNum}&keep_headers=true&url=${encodeURIComponent(formAction)}`;

        // Orijinal koddaki başlıkların birebir aynısı
        const zipRes = await axios.post(scraperDownloadUrl, formParams.toString(), {
            headers: {
                ...BROWSER_HEADERS,
                'Accept': 'application/zip,application/octet-stream;q=0.9,*/*;q=0.8',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': 'https://www.turkcealtyazi.org',
                'Referer': detailUrl,
                'Cookie': cookieString
            },
            responseType: 'arraybuffer',
            timeout: 90000 
        });

        const archive = Buffer.from(zipRes.data);
        const isZip = archive.length >= 4 && archive[0] === 0x50 && archive[1] === 0x4b;

        if (!isZip) {
            console.error(">>> HATA: TurkceAltyazi ZIP olmayan bir yanıt döndürdü.");
            return res.status(500).send("Geçersiz dosya formatı.");
        }

        console.log("4. AŞAMA: Geçerli ZIP yakalandı, SRT ayıklanıyor...");
        
        const zip = new AdmZip(archive);
        const zipEntries = zip.getEntries();
        
        let srtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.srt'));

        if (srtEntry) {
            let srtData = srtEntry.getData();
            const utf8Srt = iconv.decode(srtData, 'win1254'); 

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${subId}.srt"`);
            res.send(utf8Srt);
            console.log(">>> GÖREV KUSURSUZ TAMAMLANDI! Altyazı Nuvio'da! 🎉");
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
    console.log(`Core Sunucu Aktif! Port: ${PORT}`);
});
