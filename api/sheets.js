const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

async function getAccessToken() {
  const crypto = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const sig = sign.sign(PRIVATE_KEY, 'base64url');
  const jwt = `${header}.${claim}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function appendTradeToSheet(trade) {
  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) return false;
  try {
    const token = await getAccessToken();

    // Read column B rows 10-200 to find first truly empty cell (no date value)
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Trades!B10:B200?valueRenderOption=UNFORMATTED_VALUE`;
    const getRes = await fetch(getUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const getData = await getRes.json();
    const bValues = getData.values || [];

    // Find first row where B is empty (no date)
    let nextRow = 10;
    for (let i = 0; i < bValues.length; i++) {
      const cellVal = bValues[i] && bValues[i][0];
      if (cellVal && String(cellVal).match(/^\d{4}-\d{2}-\d{2}$/)) {
        nextRow = 10 + i + 1; // this row has a date, move to next
      }
    }

    console.log('Writing trade to row:', nextRow);

    const row = [
      trade.date,        // B - 日期
      trade.ticker,      // C - 代码
      trade.name || '',  // D - 股票名称
      trade.action === 'buy' ? '买入' : '卖出', // E - 操作
      trade.price,       // F - 单价
      trade.units,       // G - 单位数
      trade.total,       // H - 总金额
      trade.fee || '',   // I - 手续费
      '',                // J - 现价
      trade.note || '',  // K - 备注
    ];

    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Trades!B${nextRow}:K${nextRow}?valueInputOption=USER_ENTERED`;
    const writeRes = await fetch(writeUrl, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    });
    const result = await writeRes.json();
    if (result.error) throw new Error(result.error.message);
    console.log('Sheets sync OK: row', nextRow);
    return true;
  } catch (e) {
    console.error('Sheets sync error:', e.message);
    return false;
  }
}

module.exports = { appendTradeToSheet };
