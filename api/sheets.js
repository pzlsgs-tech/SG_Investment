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

    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Trades!B10:B200?valueRenderOption=UNFORMATTED_VALUE`;
    const getRes = await fetch(getUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    const getData = await getRes.json();
    const bValues = getData.values || [];

    let lastDataRow = 9;
    for (let i = 0; i < bValues.length; i++) {
      const v = bValues[i] && bValues[i][0];
      if (v && typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}$/)) {
        lastDataRow = 10 + i;
      }
    }
    const nextRow = lastDataRow + 1;
    console.log('Last data row:', lastDataRow, '-> writing to row:', nextRow);

    const row = [
      trade.date,
      trade.ticker,
      trade.name || '',
      trade.action === 'buy' ? '买入' : '卖出',
      trade.price,
      trade.units,
      trade.total,
      trade.fee || '',
      '',
      trade.note || '',
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
