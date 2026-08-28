function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeAssetUrl(value, fallback) {
  try {
    const url = new URL(value || fallback);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function landingTemplate(manifest, manifestUrl) {
  const name = escapeHtml(manifest.name);
  const version = escapeHtml(manifest.version || '0.0.0');
  const description = escapeHtml(manifest.description || 'Türkçe altyazıları Stremio ile buluşturur.');
  const contactEmail = escapeHtml(manifest.contactEmail || '');
  const logo = safeAssetUrl(manifest.logo, '/images/logo.png');
  const background = safeAssetUrl(manifest.background, '/images/background.webp');
  const stremioUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');
  const serializedManifestUrl = JSON.stringify(manifestUrl).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111827">
  <meta name="description" content="${description}">
  <title>${name} · Stremio Eklentisi</title>
  <link rel="icon" href="${escapeHtml(logo)}">
  <style>
    :root { color-scheme: dark; --ink: #f8fafc; --muted: #a8b3c7; --panel: rgba(12, 18, 32, .78); --panel-border: rgba(255, 255, 255, .12); --brand: #9b87f5; --brand-strong: #7c5ce7; --accent: #44d7b6; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; color: var(--ink); background: linear-gradient(115deg, rgba(4, 7, 15, .96), rgba(13, 18, 33, .80) 55%, rgba(25, 16, 47, .88)), url("${escapeHtml(background)}") center / cover fixed; font-family: Inter, sans-serif; line-height: 1.6; }
    .shell { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }
    .nav { display: flex; align-items: center; justify-content: space-between; min-height: 84px; }
    .brand { display: flex; align-items: center; gap: 13px; text-decoration: none; font-weight: 750; }
    .brand img { width: 44px; height: 44px; border-radius: 12px; }
    main { padding: 54px 0 72px; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(300px, .75fr); gap: 58px; align-items: center; }
    h1 { max-width: 760px; margin: 12px 0 22px; font-size: clamp(42px, 7vw, 76px); line-height: 1.02; }
    .lead { max-width: 680px; margin: 0; color: #cbd5e1; font-size: clamp(18px, 2.1vw, 22px); }
    .button { display: inline-flex; min-height: 52px; align-items: center; justify-content: center; gap: 9px; border-radius: 14px; padding: 12px 20px; text-decoration: none; font-weight: 760; background: linear-gradient(135deg, var(--brand), var(--brand-strong)); color: white; }
    .install-card { border: 1px solid var(--panel-border); background: var(--panel); padding: 28px; border-radius: 24px; }
    .manifest { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 18px; border: 1px solid var(--panel-border); border-radius: 14px; padding: 12px; background: rgba(0,0,0,.18); }
    .manifest code { color: #cbd5e1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .manifest button { border: 0; border-radius: 9px; padding: 8px 10px; background: rgba(255,255,255,.1); cursor: pointer; color: white; }
  </style>
</head>
<body>
  <header class="shell nav">
    <a class="brand" href="/"><img src="${escapeHtml(logo)}" alt="" width="44" height="44"><span>${name}</span></a>
  </header>
  <main class="shell">
    <section class="hero">
      <div>
        <h1>İzlediğin içeriğe uygun altyazıyı bul.</h1>
        <p class="lead">${description}</p>
        <div style="margin-top: 32px;"><a class="button" href="${escapeHtml(stremioUrl)}">Stremio'ya Ekle →</a></div>
      </div>
      <aside class="install-card">
        <h2>${name}</h2>
        <p>Sürüm ${version}</p>
        <div class="manifest">
          <code>${escapeHtml(manifestUrl)}</code>
          <button id="copyManifest" type="button">Kopyala</button>
        </div>
      </aside>
    </section>
  </main>
  <script>
    const manifestUrl = ${serializedManifestUrl};
    document.getElementById('copyManifest').addEventListener('click', async () => {
      await navigator.clipboard.writeText(manifestUrl);
      alert('Manifest kopyalandı!');
    });
  </script>
</body>
</html>`;
}

module.exports = landingTemplate;
