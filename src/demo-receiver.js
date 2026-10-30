const http = require('node:http');

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404).end('Not found');
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    console.log('Webhook received:', body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  });
});

server.listen(4000, '127.0.0.1', () => {
  console.log('Local demo webhook listening at http://127.0.0.1:4000/webhook');
});
