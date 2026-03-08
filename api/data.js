const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();
const KEY = 'sg_investment_data';

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
  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    console.log('Sheets: env vars missing');
    return false;
  }
  try {
    const token = await getAccessToken();
    // Read column B from row 10 to find last row with a date
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
    console.log('Sheets: writing to row', nextRow);
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const data = await redis.get(KEY);
      return res.status(200).json(data || getDefaultData());
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid data' });

      let sheetsSynced = false;
      if (body._syncTrade) {
        const trade = body._syncTrade;
        delete body._syncTrade;
        sheetsSynced = await appendTradeToSheet(trade);
      }

      body.savedAt = new Date().toISOString();
      await redis.set(KEY, body);
      return res.status(200).json({ ok: true, savedAt: body.savedAt, sheetsSynced });
    } catch (e) {
      console.error('Handler error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

function getDefaultData() {
  return {
    goal: 100000, monthlyTarget: 16800, usdSgdRate: 1.2766,
    stocks: [
      { ticker: 'ES3',  name: 'SPDR Straits Times Index ETF',      currency: 'SGD', targetPct: 23, currentPrice: 4.795   },
      { ticker: 'CLR',  name: 'Lion-Phillip S-REIT ETF',           currency: 'SGD', targetPct: 12, currentPrice: 0.826   },
      { ticker: 'VWRA', name: 'Vanguard FTSE All-World UCITS ETF', currency: 'USD', targetPct: 65, currentPrice: 221.819 },
    ],
    trades: [
      { id:1, date:'2026-02-19', ticker:'CLR',  name:'Lion-Phillip S-REIT ETF',           action:'buy', price:0.854,  units:4600, total:3928.40, fee:0, currency:'SGD', note:'' },
      { id:2, date:'2026-02-26', ticker:'ES3',  name:'SPDR Straits Times Index ETF',      action:'buy', price:5.003,  units:300,  total:1500.90, fee:0, currency:'SGD', note:'' },
      { id:3, date:'2026-03-02', ticker:'ES3',  name:'SPDR Straits Times Index ETF',      action:'buy', price:4.900,  units:300,  total:1470.00, fee:0, currency:'SGD', note:'' },
      { id:4, date:'2026-03-03', ticker:'VWRA', name:'Vanguard FTSE All-World UCITS ETF', action:'buy', price:172.00, units:17,   total:2924.00, fee:0, currency:'USD', note:'' },
    ],
    dividends: [],
    monthlyPlan: [
      { ticker:'ES3',  monthlySGD:3800  },
      { ticker:'CLR',  monthlySGD:2000  },
      { ticker:'VWRA', monthlySGD:11000 },
    ],
    savedAt: null,
  };
}
