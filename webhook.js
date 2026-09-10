const http = require('http');
const crypto = require('crypto');

const PORT = process.env.WEBHOOK_PORT || 4000;
const SECRET_KEY = process.env.WEBHOOK_SECRET_KEY || process.env.WEBHOOK_SECRET || '';

function verifySignature(body, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    const timestamp = new Date().toISOString();
    const signatureHeader = req.headers['x-webhook-signature'];
    const eventHeader = req.headers['x-webhook-event'];

    console.log(`\n[${timestamp}] Incoming Webhook Request:`);
    console.log(`Method: ${req.method} ${req.url}`);
    console.log(`Event: ${eventHeader || 'none'}`);
    console.log(`Signature Header: ${signatureHeader || 'none'}`);

    if (SECRET_KEY) {
      const isValid = verifySignature(body, signatureHeader, SECRET_KEY);
      console.log(`Signature Verified: ${isValid ? 'VALID (MATCH)' : 'INVALID (MISMATCH)'}`);
    }

    if (body) {
      try {
        const parsed = JSON.parse(body);
        console.log('Payload:', JSON.stringify(parsed, null, 2));
      } catch {
        console.log('Body:', body);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Webhook received' }));
  });
});

server.listen(PORT, () => {
  console.log(`Webhook test server listening on http://localhost:${PORT}`);
  if (SECRET_KEY) {
    console.log(`Signature verification active using WEBHOOK_SECRET_KEY`);
  }
});
