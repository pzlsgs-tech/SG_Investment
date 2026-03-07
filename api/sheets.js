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

    // Use A1 notation with ASCII-safe range - append to column B onwards
    // Range must be in format: 'SheetName'!A1:Z1 or just A:Z
    const encodedSheet = encodeURIComponent('\u4ea4\u6613\u8bb0\u5f55'); // 交易记录
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodedSheet}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [['', ...row]] }), // col A empty, data starts at B
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error.message);
    console.log('Sheets sync OK');
    return true;
  } catch (e) {
    console.error('Sheets sync error:', e.message);
    return false;
  }
}

module.exports = { appendTradeToSheet };
