// Analytikul billing-service — M0 health stub.
// M4 adds: Stripe Checkout + webhooks, managed-credits wallet (metered billing),
// AES-256-GCM BYOK vault (master key from ANALYTIKUL_VAULT_KEY env only).
import http from 'node:http';

const PORT = process.env.BILLING_PORT || 8013;

http
  .createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'billing-service' }));
      return;
    }
    res.writeHead(404).end();
  })
  .listen(PORT, () => console.log(`billing-service stub on :${PORT}`));
