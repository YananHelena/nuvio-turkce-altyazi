const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const cheerio = require("cheerio");
const AdmZip = require("adm-zip");
const iconv = require("iconv-lite");
const express = require("express");

const PORT = process.env.PORT || 10000;

const manifest = {
    id: "org.turkcealtyazi.nuvio",
    version: "1.1.1", // NİHAİ SÜRÜM - Native Fetch
    name: "Türkçe Altyazı (Pro)",
    description: "Nuvio için TurkceAltyazi.org sitesinden Cloudflare korumasını aşarak doğrudan altyazı çeker.",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);
const app = express(); 

// Cloudflare'i atlatacak kusursuz "Gerçek Tarayıcı" başlıklarımız
const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0"
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
    const targetUrl = `https://www.turkcealtyazi.org/find.php?cat=sub&find=${imdbId}`;
    
    console.log("Siteye Native Fetch ile (Axios olmadan) arama isteği atılıyor...");
    
    // YENİ: Native Fetch kullanımı
    const response = await fetch(targetUrl, { headers: BROWSER_HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const htmlData = await response.text();
    const $ = cheerio.load(htmlData);
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

// 2. AŞAMA: PROXY İNDİRİCİ (NATIVE FETCH + COOKIE + URLSearchParams)
app.get('/download/:subId.srt', async (req, res) => {
    const subId = req.params.subId;
    console.log(`\n>>> Nuvio Altyazı İndiriyor (ID: ${subId})...`);

    try {
        const detailUrl = `https://www.turkcealtyazi.org/sub/${subId}/altyazi.html`;
        
        console.log("1. AŞAMA: Altyazı sayfasına gidilip ÇEREZLER alınıyor...");
        const detailRes = await fetch(detailUrl, { headers: BROWSER_HEADERS });
        
        if (!detailRes.ok) {
            throw new Error(`Detay Sayfası Hatası: HTTP ${detailRes.status}`);
        }

        // Fetch API ile çerezleri (Cookies) profesyonelce ayıklıyoruz
        let cookieString = "";
        if (detailRes.headers.getSetCookie) {
            cookieString = detailRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
        } else {
            const rawCookies = detailRes.headers.get('set-cookie');
            if (rawCookies) cookieString = rawCookies.split(',').map(c => c.split(';')[0]).join('; ');
        }

        const htmlData = await detailRes.text();
        const $ = cheerio.load(htmlData);
        const form = $("form:has(input[name='idid'])").first();

        if (form.length === 0) {
            console.error("Hata: İndirme formu sayfada bulunamadı.");
            return res.status(404).send("Form bulunamadı.");
        }

        // Form verilerini native URLSearchParams ile kodluyoruz
        const postData = new URLSearchParams();
        form.find("input").each((i, el) => {
            const name = $(el).attr("name");
            const val = $(el).attr("value");
            if (name && val) postData.append(name, val);
        });

        console.log(`2. AŞAMA: Şifreler hazır! ${postData.toString()}`);
        console.log("3. AŞAMA: Çerezler ile ZIP indiriliyor (POST)...");

        const zipRes = await fetch('https://www.turkcealtyazi.org/ind.php', {
            method: 'POST',
            headers: {
                ...BROWSER_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': detailUrl,
                'Cookie': cookieString
            },
            body: postData
        });

        if (!zipRes.ok) {
            throw new Error(`ZIP İndirme Hatası: HTTP ${zipRes.status}`);
        }

        // Gelen veriyi Buffer'a çeviriyoruz
        const arrayBuffer = await zipRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
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
            console.log(">>> GÖREV TAMAMLANDI! Altyazı Nuvio'da! 🚀");
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
    console.log(`Native Fetch Sunucu Aktif! Port: ${PORT}`);
});
