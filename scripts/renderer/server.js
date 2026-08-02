const express = require('express');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(express.json({ limit: '50mb' }));

let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
  }
  return browser;
}

// POST /render - receives HTML, returns PNG buffer as base64
app.post('/render', async (req, res) => {
  try {
    const { html, width = 1080, height = 1080 } = req.body;
    if (!html) return res.status(400).json({ error: 'html is required' });

    const b = await getBrowser();
    const page = await b.newPage();
    await page.setViewport({ width, height });

    // Inject Tailwind CSS CDN
    const fullHtml = html.includes('<html') ? html : `
      <!DOCTYPE html>
      <html>
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
        <style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Inter', sans-serif; }</style>
      </head>
      <body>${html}</body>
      </html>
    `;

    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 15000 });
    const screenshot = await page.screenshot({ type: 'png' });
    await page.close();

    res.json({
      success: true,
      image: screenshot.toString('base64'),
      width,
      height,
    });
  } catch (err) {
    console.error('Render error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /pdf - recebe HTML e devolve um PDF em base64.
//
// Usado pelo relatorio mensal por marca. Reaproveita o mesmo Chromium do
// /render, entao nao ha dependencia nova nem container novo.
app.post('/pdf', async (req, res) => {
  try {
    const { html, format = 'A4', landscape = false } = req.body;
    if (!html) return res.status(400).json({ error: 'html is required' });

    const b = await getBrowser();
    const page = await b.newPage();

    const fullHtml = html.includes('<html') ? html : `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
        <style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Inter', sans-serif; }</style>
      </head>
      <body>${html}</body>
      </html>
    `;

    // domcontentloaded em vez de networkidle0: se a fonte do Google nao
    // carregar, networkidle0 fica esperando ate o timeout e o relatorio
    // inteiro falha por causa de uma fonte.
    await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Sem esta linha o Chromium ignora cor de fundo na impressao, e o
    // relatorio sai branco — perdendo a identidade visual da marca.
    await page.emulateMediaType('screen');

    const pdf = await page.pdf({
      format,
      landscape,
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
    await page.close();

    res.json({ success: true, pdf: Buffer.from(pdf).toString('base64') });
  } catch (err) {
    console.error('PDF error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3003;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Renderer service running on port ${PORT}`);
});
