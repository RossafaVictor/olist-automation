const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const MESES = {
  '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
  '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
  '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
};

const OLIST_EMAIL = process.env.OLIST_EMAIL;
const OLIST_PASSWORD = process.env.OLIST_PASSWORD;

if (!OLIST_EMAIL || !OLIST_PASSWORD) {
  console.error('[ERRO] Variáveis OLIST_EMAIL e OLIST_PASSWORD são obrigatórias');
  process.exit(1);
}

async function run() {
  const argMes = process.argv[2];
  let mes, ano;
  if (argMes && /^\d{2}\/\d{4}$/.test(argMes)) {
    [mes, ano] = argMes.split('/');
    ano = parseInt(ano);
  } else {
    const hoje = new Date();
    mes = String(hoje.getMonth() + 1).padStart(2, '0');
    ano = hoje.getFullYear();
  }
  const mesAno = `${mes}/${ano}`;
  const mesNome = `${MESES[mes]} ${ano}`;
  const destDir = path.join(process.cwd(), 'downloads');
  const destFile = path.join(destDir, `custos de ecommerce ${mesNome}.xls`);

  console.log(`[INFO] Mês: ${mesAno} → ${mesNome}`);
  console.log(`[INFO] Destino: ${destFile}`);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    console.log('[INFO] Pasta criada:', destDir);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('[INFO] Acessando Olist ERP...');
    await page.goto('https://erp.olist.com/relatorio_custos_ecommerce', { waitUntil: 'networkidle', timeout: 30000 });

    if (page.url().includes('accounts.tiny.com.br') || page.url().includes('login')) {
      console.log('[INFO] Tela de login detectada. Fazendo login...');
      await page.fill('input[name="username"], #username', OLIST_EMAIL);
      await page.fill('input[name="password"], #password', OLIST_PASSWORD);
      await page.click('input[type="submit"], button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
      console.log('[INFO] Login realizado. URL atual:', page.url());
    }

    const bodyText = await page.textContent('body').catch(() => '');
    if (bodyText.includes('outro dispositivo') || bodyText.includes('sessão expirou')) {
      console.log('[INFO] Conflito de sessão detectado. Clicando em "login" para continuar...');
      await page.click('button:has-text("login"), a:has-text("login")');
      await page.waitForTimeout(4000);
    }

    if (!page.url().includes('relatorio_custos_ecommerce')) {
      await page.goto('https://erp.olist.com/relatorio_custos_ecommerce', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
    }

    console.log('[INFO] URL do relatório:', page.url());
    await page.screenshot({ path: '/tmp/olist_relatorio.png' });
    await page.waitForTimeout(3000);

    const inputMesSeletores = [
      'input[placeholder*="mês"], input[placeholder*="mes"], input[placeholder*="Mês"]',
      'input[name*="mes"], input[name*="month"], input[name*="periodo"]',
      'input[type="month"]',
      'input.datepicker, input.mes, input[class*="mes"]',
      'input[type="text"]'
    ];

    let inputMes = null;
    for (const sel of inputMesSeletores) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        console.log(`[INFO] Campo de mês encontrado com: ${sel}`);
        inputMes = page.locator(sel).first();
        break;
      }
    }

    if (!inputMes) throw new Error('Campo de mês não encontrado na página');

    await inputMes.click({ clickCount: 3 });
    await inputMes.fill(mesAno);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);

    console.log('[INFO] Clicando em Gerar...');
    await page.click('button:has-text("Gerar"), input[value="Gerar"]');
    console.log('[INFO] Aguardando relatório carregar (10s)...');
    await page.waitForTimeout(10000);

    console.log('[INFO] Iniciando download...');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.click('a:has-text("download"), button:has-text("download"), a[href*="download"], .btn-download').catch(() =>
        page.click('a:has-text("Download"), button:has-text("Download")')
      )
    ]);

    console.log('[INFO] Download iniciado:', download.suggestedFilename());
    await download.saveAs(destFile);

    const stats = fs.statSync(destFile);
    console.log(`[OK] Arquivo salvo: ${destFile}`);
    console.log(`[OK] Tamanho: ${(stats.size / 1024).toFixed(1)} KB`);

    // Exporta variáveis para outros steps do GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      const fs2 = require('fs');
      fs2.appendFileSync(process.env.GITHUB_OUTPUT, `arquivo=${destFile}\nmesNome=${mesNome}\n`);
    }

  } catch (err) {
    console.error('[ERRO]', err.message);
    await page.screenshot({ path: '/tmp/olist_erro.png' }).catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
