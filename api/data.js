import { Redis } from '@upstash/redis';
import { appendTradeToSheet } from './sheets.js';

const redis = Redis.fromEnv();
const KEY = 'sg_investment_data';

export default async function handler(req, res) {
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
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Invalid data' });
      }

      // If a new trade is flagged for Sheets sync
      if (body._syncTrade) {
        const trade = body._syncTrade;
        delete body._syncTrade;
        // Fire and forget - don't block save if Sheets fails
        appendTradeToSheet(trade).catch(e => console.error('Sheets async error:', e));
      }

      body.savedAt = new Date().toISOString();
      await redis.set(KEY, body);
      return res.status(200).json({ ok: true, savedAt: body.savedAt });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function getDefaultData() {
  return {
    goal: 100000,
    monthlyTarget: 16800,
    usdSgdRate: 1.2766,
    stocks: [
      { ticker: 'ES3',  name: 'SPDR Straits Times Index ETF',       currency: 'SGD', targetPct: 23, currentPrice: 4.795  },
      { ticker: 'CLR',  name: 'Lion-Phillip S-REIT ETF',            currency: 'SGD', targetPct: 12, currentPrice: 0.826  },
      { ticker: 'VWRA', name: 'Vanguard FTSE All-World UCITS ETF',  currency: 'USD', targetPct: 65, currentPrice: 221.819 },
    ],
    trades: [
      { id: 1, date: '2026-02-19', ticker: 'CLR',  name: 'Lion-Phillip S-REIT ETF',           action: 'buy', price: 0.8540,   units: 4600, total: 3928.40, fee: 0, currency: 'SGD', note: '' },
      { id: 2, date: '2026-02-26', ticker: 'ES3',  name: 'SPDR Straits Times Index ETF',      action: 'buy', price: 5.0030,   units: 300,  total: 1500.90, fee: 0, currency: 'SGD', note: '' },
      { id: 3, date: '2026-03-02', ticker: 'ES3',  name: 'SPDR Straits Times Index ETF',      action: 'buy', price: 4.9000,   units: 300,  total: 1470.00, fee: 0, currency: 'SGD', note: '' },
      { id: 4, date: '2026-03-03', ticker: 'VWRA', name: 'Vanguard FTSE All-World UCITS ETF', action: 'buy', price: 172.0000, units: 17,   total: 2924.00, fee: 0, currency: 'USD', note: '' },
    ],
    dividends: [],
    monthlyPlan: [
      { ticker: 'ES3',  monthlySGD: 3800 },
      { ticker: 'CLR',  monthlySGD: 2000 },
      { ticker: 'VWRA', monthlySGD: 11000 },
    ],
    savedAt: null,
  };
}
