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

const URL_RELATORIO = 'https://erp.olist.com/relatorio_custos_ecommerce';

// O ERP da Olist falha de forma intermitente ao gerar o relatório, devolvendo
// "Ocorreu um erro ao executar a consulta. Tente novamente mais tarde."
// Nesse caso não adianta esperar: é preciso recarregar a página e gerar de novo.
const MAX_TENTATIVAS = 4;
const ESPERA_ENTRE_TENTATIVAS_MS = 15000;

const SELETOR_DOWNLOAD = 'a:has-text("download"), button:has-text("download"), a:has-text("Download"), button:has-text("Download"), a:has-text("Exportar"), button:has-text("Exportar"), .btn-download';
const TEXTO_ERRO_CONSULTA = 'Ocorreu um erro ao executar a consulta';

if (!OLIST_EMAIL || !OLIST_PASSWORD) {
  console.error('[ERRO] Variáveis OLIST_EMAIL e OLIST_PASSWORD são obrigatórias');
  process.exit(1);
}

const SELETOR_USUARIO = 'input[name="username"], #username';
const SELETOR_SENHA = 'input[name="password"], #password';
const TENTATIVAS_LOGIN = 3;

function naTelaDeLogin(url) {
  return url.includes('accounts.tiny.com.br') || url.includes('login');
}

// Abre o ERP e, se cair na tela de login, autentica.
// - A página de login às vezes carrega em branco (SPA que não renderiza):
//   recarrega e tenta de novo em vez de desistir no primeiro timeout.
// - Se a Olist exigir troca de senha ("Escolha sua nova senha"), não há o que
//   o robô possa fazer: falha na hora com uma mensagem clara.
async function fazerLogin(page) {
  for (let tentativa = 1; tentativa <= TENTATIVAS_LOGIN; tentativa++) {
    console.log(`[INFO] Acessando Olist ERP... (tentativa ${tentativa}/${TENTATIVAS_LOGIN})`);
    await page.goto(URL_RELATORIO, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => {
      console.log('[AVISO] goto:', e.message.split('\n')[0]);
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    if (!naTelaDeLogin(page.url())) {
      console.log('[INFO] Sessão já autenticada. URL:', page.url());
      return;
    }

    const campoUsuario = page.locator(SELETOR_USUARIO).first();
    const apareceu = await campoUsuario.waitFor({ state: 'visible', timeout: 30000 }).then(() => true, () => false);
    if (!apareceu) {
      console.log('[AVISO] Tela de login não renderizou o formulário (página em branco). Recarregando...');
      await page.screenshot({ path: `/tmp/olist_login_vazio_${tentativa}.png` }).catch(() => {});
      continue;
    }

    console.log('[INFO] Tela de login detectada. Fazendo login...');
    await campoUsuario.fill(OLIST_EMAIL);
    await page.locator(SELETOR_SENHA).first().fill(OLIST_PASSWORD);
    await page.click('input[type="submit"], button[type="submit"]');

    // Espera o que vier primeiro: sair da tela de login ou a Olist pedir troca de senha
    const resultado = await Promise.race([
      page.waitForURL(url => !naTelaDeLogin(url.toString()), { timeout: 45000 }).then(() => 'ok'),
      page.getByText(/Escolha sua nova senha|Redefinir senha/i).first()
        .waitFor({ state: 'visible', timeout: 45000 }).then(() => 'trocar_senha'),
    ]).catch(() => 'timeout');

    if (resultado === 'trocar_senha') {
      throw new Error(
        'A Olist está exigindo TROCA DE SENHA para esta conta ("Escolha sua nova senha"). ' +
        'Entre no ERP manualmente com OLIST_EMAIL, defina a nova senha e atualize o secret ' +
        'OLIST_PASSWORD no GitHub. O robô não troca a senha sozinho.'
      );
    }
    if (resultado === 'timeout') {
      await page.screenshot({ path: `/tmp/olist_login_timeout_${tentativa}.png` }).catch(() => {});
      console.log('[AVISO] Login não concluiu em 45s. URL:', page.url());
      continue;
    }

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    console.log('[INFO] Login realizado. URL atual:', page.url());
    return;
  }
  throw new Error(`Não foi possível fazer login na Olist após ${TENTATIVAS_LOGIN} tentativas (veja os screenshots).`);
}

// O menu lateral do ERP está com "Fixar menu" ligado na conta: fica
// permanentemente aberto e sobrepõe a coluna esquerda do formulário — onde
// estão o campo de período e o botão Gerar. Como está *fixado*, afastar o
// mouse ou apertar Escape não fecha. Afasta o mouse (fecha flyout de hover,
// se houver) e some com o overlay via CSS, sem alterar a preferência da conta.
async function neutralizarMenuLateral(page) {
  const { width, height } = page.viewportSize() || { width: 1920, height: 1080 };
  await page.mouse.move(Math.floor(width * 0.75), Math.floor(height * 0.5));
  await page.keyboard.press('Escape').catch(() => {});

  // Esconde qualquer elemento fixo/absoluto que esteja cobrindo a área do
  // formulário. Identifica pelo hit-test em vez de chutar nomes de classe.
  const escondidos = await page.evaluate(() => {
    const alvos = new Set();
    // Pontos da faixa esquerda do conteúdo, onde o menu se sobrepõe
    for (let y = 150; y <= 600; y += 50) {
      for (let x = 80; x <= 400; x += 40) {
        let el = document.elementFromPoint(x, y);
        while (el && el !== document.body) {
          const pos = getComputedStyle(el).position;
          if (pos === 'fixed' || pos === 'absolute') {
            const r = el.getBoundingClientRect();
            // Só o que é alto e estreito (cara de menu lateral)
            if (r.height > 400 && r.width < 600 && r.left < 400) {
              alvos.add(el);
              break;
            }
          }
          el = el.parentElement;
        }
      }
    }
    alvos.forEach(el => { el.style.display = 'none'; });
    return alvos.size;
  }).catch(() => 0);

  if (escondidos > 0) {
    console.log(`[INFO] Menu lateral neutralizado (${escondidos} elemento(s) sobrepostos ocultados)`);
  }
  await page.waitForTimeout(500);
}

// Clica sem depender de coordenadas: se o elemento estiver coberto por um
// overlay, o click normal expira — aí dispara o evento direto no elemento.
async function clicarRobusto(page, locator, descricao) {
  try {
    await locator.click({ timeout: 10000 });
  } catch (e) {
    console.log(`[AVISO] Click normal em "${descricao}" falhou (elemento coberto). Usando dispatchEvent...`);
    await locator.dispatchEvent('click');
  }
}

// Preenche o mês e clica em Gerar. Retorna 'pronto' (botão de download visível),
// 'erro-consulta' (falha intermitente do ERP) ou 'timeout'.
async function gerarRelatorio(page, mesAno) {
  await neutralizarMenuLateral(page);

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

  // fill() não faz hit-test, então funciona mesmo se algo estiver por cima —
  // e já limpa o campo sozinho, dispensando o clique triplo de seleção.
  await inputMes.fill(mesAno);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1000);

  console.log('[INFO] Clicando em Gerar...');
  const btnGerar = page.locator('button:has-text("Gerar"), input[value="Gerar"]').first();
  await clicarRobusto(page, btnGerar, 'Gerar');

  // Corre o botão de download contra a mensagem de erro do ERP — o que vier primeiro
  console.log('[INFO] Aguardando relatório ficar pronto (máx 90s)...');
  return Promise.race([
    page.waitForSelector(SELETOR_DOWNLOAD, { timeout: 90000 }).then(() => 'pronto'),
    page.getByText(TEXTO_ERRO_CONSULTA).first()
      .waitFor({ state: 'visible', timeout: 90000 }).then(() => 'erro-consulta')
  ]).catch(() => 'timeout');
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
    // Viewport largo: com 1280px o menu lateral expandido cobre a coluna
    // esquerda do formulário (onde fica o campo de período).
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    await fazerLogin(page);

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

    let resultado = null;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      console.log(`[INFO] Tentativa ${tentativa}/${MAX_TENTATIVAS} de gerar o relatório`);

      if (tentativa > 1) {
        await page.goto(URL_RELATORIO, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);
      }

      resultado = await gerarRelatorio(page, mesAno);

      if (resultado === 'pronto') {
        console.log('[INFO] Botão de download visível — relatório pronto');
        break;
      }

      if (resultado === 'erro-consulta') {
        console.log('[AVISO] ERP retornou "erro ao executar a consulta" (falha intermitente da Olist)');
      } else {
        console.log('[AVISO] Nem botão de download nem mensagem de erro apareceram em 90s');
      }

      if (tentativa < MAX_TENTATIVAS) {
        console.log(`[INFO] Aguardando ${ESPERA_ENTRE_TENTATIVAS_MS / 1000}s antes de tentar de novo...`);
        await page.waitForTimeout(ESPERA_ENTRE_TENTATIVAS_MS);
      }
    }

    // Screenshot antes do download para debug
    await page.screenshot({ path: '/tmp/olist_pre_download.png' });
    console.log('[INFO] Screenshot pré-download salvo');

    if (resultado !== 'pronto') {
      throw new Error(
        `Relatório não ficou pronto após ${MAX_TENTATIVAS} tentativas (último estado: ${resultado}). ` +
        'O ERP da Olist está instável — tente novamente mais tarde.'
      );
    }

    console.log('[INFO] Iniciando download...');
    await neutralizarMenuLateral(page);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      clicarRobusto(
        page,
        page.locator('a:has-text("download"), button:has-text("download"), a[href*="download"], .btn-download, a:has-text("Download"), button:has-text("Download"), a:has-text("Exportar"), button:has-text("Exportar"), a:has-text("XLS"), a:has-text("Excel")').first(),
        'download'
      ).catch(async () => {
        // Última tentativa: clicar em qualquer link que pareça download
        const allLinks = await page.locator('a[href]').all();
        for (const link of allLinks) {
          const href = await link.getAttribute('href').catch(() => '');
          if (href && (href.includes('xls') || href.includes('download') || href.includes('export'))) {
            console.log('[INFO] Link de download encontrado via href:', href);
            await link.click();
            return;
          }
        }
      })
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
