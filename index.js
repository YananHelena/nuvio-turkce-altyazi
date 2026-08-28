const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const AdmZip = require("adm-zip");
const iconv = require("iconv-lite");
const express = require("express");
const qs = require("querystring");

const PORT = process.env.PORT || 10000;
// ScraperAPI'yi tamamen devreden çıkardık, doğrudan bağlantı kullanıyoruz!

const manifest = {
    id: "org.turkcealtyazi.nuvio",
    version: "1.1.0", // YENİ DÖNEM!
    name: "Türkçe Altyazı (Doğrudan)",
    description: "Nuvio için TurkceAltyazi.org sitesinden aracısız (ScraperAPI olmadan) hızlı Türkçe altyazı çeker.",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);
const app = express(); 

// Standart bir tarayıcı (Chrome) kimliği
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
    
    console.log("Siteye doğrudan arama isteği atılıyor (ScraperAPI Yok)...");
    
    // Doğrudan axios ile bağlanıyoruz
    const response = await axios.get(targetUrl, { headers: HEADERS, timeout: 15000 }); 
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

// 2. AŞAMA: PROXY İNDİRİCİ (ÇEREZ YÖNETİMLİ DOĞRUDAN BAĞLANTI)
app.get('/download/:subId.srt', async (req, res) => {
    const subId = req.params.subId;
    console.log(`\n>>> Nuvio Altyazı İndiriyor (ID: ${subId})...`);

    try {
        const detailUrl = `https://www.turkcealtyazi.org/sub/${subId}/altyazi.html`;
        
        console.log("1. AŞAMA: Altyazı sayfasına gidilip ÇEREZLER (Cookies) alınıyor...");
        const detailRes = await axios.get(detailUrl, { headers: HEADERS, timeout: 15000 });
        
        // Sitenin bize verdiği özel kimliği (Çerezleri) alıp cüzdanımıza koyuyoruz
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
        console.log(`2. AŞAMA: Form ve Şifreler hazır! Veri: ${postData}`);
        console.log("3. AŞAMA: Çerezler (Cookies) kullanılarak ZIP indiriliyor...");

        // Sitenin kalbine (ind.php) Formu ve ÇEREZİ aynı anda gönderiyoruz
        const zipRes = await axios.post('https://www.turkcealtyazi.org/ind.php', postData, {
            headers: {
                ...HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': detailUrl,
                'Cookie': cookieString // İŞTE BİZİ 404'TEN KURTARAN SİHİRLİ SATIR
            },
            responseType: 'arraybuffer',
            timeout: 15000
        });

        // DOSYA DEDEKTİFİ
        const buffer = Buffer.from(zipRes.data);
        const headerText = buffer.toString('utf8', 0, 4);

        if (headerText.startsWith('Rar!')) {
            console.error(">>> HATA: Bu bir RAR dosyası!");
            return res.status(400).send("RAR formatı desteklenmiyor.");
        } else if (!headerText.startsWith('PK')) {
            console.error(">>> HATA: ZIP dosyası gelmedi! Site reddetti.");
            return res.status(500).send("Geçersiz dosya formatı.");
        }

        console.log("4. AŞAMA: Geçerli ZIP yakalandı, SRT çıkartılıyor...");
        
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        
        let srtEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.srt'));

        if (srtEntry) {
            let srtData = srtEntry.getData();
            const utf8Srt = iconv.decode(srtData, 'win1254'); // Türkçe karakter düzeltmesi

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${subId}.srt"`);
            res.send(utf8Srt);
            console.log(">>> MUHTEŞEM BAŞARI! Altyazı Nuvio'ya gönderildi! 🚀");
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
    console.log(`Doğrudan Bağlantılı Sunucu Aktif! Port: ${PORT}`);
});
