const http = require('http');

const PORT = process.env.WEBHOOK_PORT || 4000;

const server = http.createServer((req, res) => {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] Incoming Webhook Request:`);
    console.log(`Method: ${req.method} ${req.url}`);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));

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
});
