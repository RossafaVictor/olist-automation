/**
 * Backfill: baixa e envia para o Sheets todos os meses de Jan/2026 até o mês atual.
 * Usado no workflow inicial ou para reprocessar meses.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { uploadToSheets } = require('./upload-sheets');

const MESES_INICIO = { mes: '01', ano: 2026 };

function getMesesAte(hoje) {
  const meses = [];
  let { mes, ano } = MESES_INICIO;
  mes = parseInt(mes);

  while (ano < hoje.ano || (ano === hoje.ano && mes <= hoje.mes)) {
    meses.push({ mes: String(mes).padStart(2, '0'), ano });
    mes++;
    if (mes > 12) { mes = 1; ano++; }
  }
  return meses;
}

async function run() {
  const hoje = new Date();
  const meses = getMesesAte({ mes: hoje.getMonth() + 1, ano: hoje.getFullYear() });

  console.log(`[INFO] Processando ${meses.length} meses: ${meses[0].mes}/${meses[0].ano} → ${meses[meses.length-1].mes}/${meses[meses.length-1].ano}`);

  for (const { mes, ano } of meses) {
    const mesAno = `${mes}/${ano}`;
    console.log(`\n[INFO] ===== ${mesAno} =====`);

    // Baixar XLS
    try {
      execSync(`node baixar-custos.js ${mesAno}`, {
        stdio: 'inherit',
        env: { ...process.env }
      });
    } catch (err) {
      console.error(`[ERRO] Falha ao baixar ${mesAno}:`, err.message);
      continue;
    }

    // Encontrar arquivo baixado
    const downloadsDir = path.join(__dirname, 'downloads');
    const MESES_NOMES = {
      '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
      '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
      '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
    };
    const fileName = `custos de ecommerce ${MESES_NOMES[mes]} ${ano}.xls`;
    const filePath = path.join(downloadsDir, fileName);

    if (!fs.existsSync(filePath)) {
      console.error(`[ERRO] Arquivo não encontrado: ${filePath}`);
      continue;
    }

    // Upload para Sheets
    try {
      await uploadToSheets(filePath, mesAno);
    } catch (err) {
      console.error(`[ERRO] Falha ao fazer upload ${mesAno}:`, err.message);
    }

    // Remover arquivo após upload (não guardar XLS no runner)
    fs.unlinkSync(filePath);
    console.log(`[INFO] Arquivo removido após upload`);
  }

  console.log('\n[OK] Backfill concluído!');
}

run().catch(err => { console.error('[ERRO FATAL]', err.message); process.exit(1); });
