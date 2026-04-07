const { google } = require('googleapis');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1v0vio1Na3EdeGmoL-sUo0eRfDI2_B5ytOGNIri7u3jY';

const MESES = {
  '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
  '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
  '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
};

async function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

async function uploadToSheets(xlsPath, mesAno) {
  const [mes, ano] = mesAno.split('/');
  const tabName = `${MESES[mes]} ${ano}`;

  console.log(`[INFO] Lendo XLS: ${xlsPath}`);
  const workbook = XLSX.readFile(xlsPath);
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });

  if (rows.length === 0) throw new Error('XLS vazio ou sem dados');
  console.log(`[INFO] ${rows.length} linhas lidas do XLS`);

  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Verificar se a aba já existe
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const abaExistente = spreadsheet.data.sheets.find(s => s.properties.title === tabName);

  if (abaExistente) {
    // Limpar aba existente
    console.log(`[INFO] Aba "${tabName}" já existe — limpando...`);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${tabName}!A:ZZ`,
    });
  } else {
    // Criar nova aba
    console.log(`[INFO] Criando aba "${tabName}"...`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: tabName }
          }
        }]
      }
    });
  }

  // Escrever dados
  console.log(`[INFO] Escrevendo ${rows.length} linhas na aba "${tabName}"...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  console.log(`[OK] Dados enviados para a aba "${tabName}" com sucesso!`);
  return tabName;
}

// Execução direta
const xlsPath = process.argv[2];
const mesAno = process.argv[3];

if (!xlsPath || !mesAno) {
  console.error('[ERRO] Uso: node upload-sheets.js <caminho.xls> <MM/AAAA>');
  process.exit(1);
}

uploadToSheets(xlsPath, mesAno)
  .then(tab => console.log(`[OK] Concluído: ${tab}`))
  .catch(err => { console.error('[ERRO]', err.message); process.exit(1); });

module.exports = { uploadToSheets };
