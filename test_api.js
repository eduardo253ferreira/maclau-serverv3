const http = require('http');

const data = JSON.stringify({
  estado_faturacao: 'Faturado',
  numero_fatura: 'NODE_TEST_123'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/avarias/6/faturacao',
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (e) => {
  console.error(e);
});

req.write(data);
req.end();
