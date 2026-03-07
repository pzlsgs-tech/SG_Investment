const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

module.exports = async function handler(req, res) {
  const debug = {
    hasSheetId: !!SHEET_ID,
    sheetId: SHEET_ID ? SHEET_ID.substring(0, 10) + '...' : 'MISSING',
    hasEmail: !!CLIENT_EMAIL,
    email: CLIENT_EMAIL || 'MISSING',
    hasPrivateKey: !!PRIVATE_KEY,
    privateKeyStart: PRIVATE_KEY ? PRIVATE_KEY.substring(0, 40) : 'MISSING',
    privateKeyHasNewlines: PRIVATE_KEY.includes('\n'),
    privateKeyLength: PRIVATE_KEY.length,
  };

  try {
    const crypto = require('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const claim = Buffer.from(JSON.stringify({
      iss: CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600, iat: now,
    })).toString('base64url');

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${header}.${claim}`);
    const sig = sign.sign(PRIVATE_KEY, 'base64url');
    const jwt = `${header}.${claim}.${sig}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.status(200).json({ ...debug, step: 'GET_TOKEN', error: tokenData });
    }

    // Try reading the sheet
    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`,
      { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } }
    );
    const sheetData = await sheetRes.json();

    return res.status(200).json({
      ...debug,
      step: 'SUCCESS',
      sheets: sheetData.sheets?.map(s => s.properties.title) || sheetData,
    });
  } catch(e) {
    return res.status(200).json({ ...debug, step: 'EXCEPTION', error: e.message });
  }
};
