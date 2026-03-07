// Google Sheets sync helper
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// Create JWT token for Google API auth
async function getAccessToken() {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerB64  = encode(header);
  const claimB64   = encode(claim);
  const sigInput   = `${headerB64}.${claimB64}`;

  // Sign with RS256
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(sigInput);
  const signature = sign.sign(PRIVATE_KEY, 'base64url');

  const jwt = `${sigInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get token: ' + JSON.stringify(data));
  return data.access_token;
}

// Append a trade row to the 交易记录 sheet
export async function appendTradeToSheet(trade) {
  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    console.warn('Google Sheets env vars not set, skipping sync');
    return false;
  }

  try {
    const token = await getAccessToken();

    // Map trade to sheet columns:
    // 日期 | 代码 | 股票名称 | 操作 | 单价 | 单位数 | 总金额 | 手续费 | 现价 | 备注
    const row = [
      trade.date,
      trade.ticker,
      trade.name || '',
      trade.action === 'buy' ? '买入' : '卖出',
      trade.price,
      trade.units,
      trade.total,
      trade.fee || '',
      '',   // 现价留空
      trade.note || '',
    ];

    const range = encodeURIComponent('交易记录!B9:K9'); // append after header rows
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    });

    const result = await res.json();
    if (result.error) throw new Error(result.error.message);
    console.log('Sheets sync OK:', result.updates?.updatedRange);
    return true;
  } catch (e) {
    console.error('Sheets sync error:', e.message);
    return false;
  }
}
