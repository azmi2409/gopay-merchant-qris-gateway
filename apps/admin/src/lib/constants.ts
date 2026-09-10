export const endpoints = [
  {
    method: 'POST',
    path: '/api/v1/qris',
    auth: 'x-api-key or Bearer JWT',
    summary: 'Create dynamic QRIS',
    body: {
      amount: 50000,
      reference: 'INV-001',
      callback_url: 'https://merchant.example/payment',
      attributes: { customer_id: 'CUST-99' }
    },
    response: {
      success: true,
      data: {
        id: 'qris_example',
        trx_id: 'TRX-EXAMPLE',
        status: 'PENDING',
        amount: 50000,
        qris_url: 'https://gateway.example/qr/qris_example',
        verification_mode: 'auto'
      }
    }
  },
  {
    method: 'GET',
    path: '/api/v1/qris/:id',
    auth: 'Public',
    summary: 'Read QRIS metadata',
    params: [['id', 'path', 'string', 'QRIS ID returned during creation']],
    response: {
      success: true,
      data: {
        id: 'qris_example',
        trx_id: 'TRX-EXAMPLE',
        amount: 50000,
        status: 'PENDING',
        reference: 'INV-001',
        verification_mode: 'auto'
      }
    }
  },
  {
    method: 'GET',
    path: '/api/v1/qris/:id/status',
    auth: 'Public',
    summary: 'Poll payment status',
    params: [['id', 'path', 'string', 'QRIS ID']],
    response: { success: true, paid: false, status: 'PENDING' }
  },
  {
    method: 'GET',
    path: '/qr/:id',
    auth: 'Public',
    summary: 'Open customer payment page',
    params: [
      ['id', 'path', 'string', 'QRIS ID'],
      ['download', 'query', '0 | 1', 'Download a PNG when set to 1']
    ],
    response: 'HTML payment page or PNG download'
  },
  {
    method: 'POST',
    path: '/api/v1/payments/verify',
    auth: 'x-api-key or Bearer JWT',
    summary: 'Verify settlement manually',
    body: { qris_id: 'qris_example' },
    response: { success: true, paid: true, trx_id: 'TRX-EXAMPLE' }
  },
  {
    method: 'GET',
    path: '/api/v1/transactions',
    auth: 'x-api-key or Bearer JWT',
    summary: 'List GoPay transactions',
    params: [
      ['startTime', 'query', 'ISO 8601', 'Range start'],
      ['endTime', 'query', 'ISO 8601', 'Range end'],
      ['limit', 'query', 'number', 'Maximum records']
    ],
    response: {
      success: true,
      data: [{ transaction_id: 'synthetic-transaction', amount: 50000, status: 'SUCCESS' }]
    }
  },
  {
    method: 'GET',
    path: '/api/v1/session/status',
    auth: 'x-api-key or Bearer JWT',
    summary: 'Check GoBiz session',
    response: { success: true, data: { configured: true, status: 'valid' } }
  },
  {
    method: 'POST',
    path: '/api/v1/webhooks',
    auth: 'x-api-key or Bearer JWT',
    summary: 'Register webhook',
    body: {
      url: 'https://merchant.example/webhooks/gopay',
      events: ['payment.success'],
      secret: 'use-a-unique-webhook-secret'
    },
    response: {
      success: true,
      data: {
        id: 'whk_example',
        url: 'https://merchant.example/webhooks/gopay',
        events: ['payment.success'],
        has_secret: true
      }
    }
  },
  {
    method: 'GET',
    path: '/api/v1/webhooks',
    auth: 'x-api-key or Bearer JWT',
    summary: 'List webhooks',
    response: { success: true, data: [] }
  },
  {
    method: 'DELETE',
    path: '/api/v1/webhooks/:id',
    auth: 'x-api-key or Bearer JWT',
    summary: 'Delete webhook',
    params: [['id', 'path', 'string', 'Webhook ID']],
    response: { success: true, message: 'Webhook deleted' }
  },
  {
    method: 'POST',
    path: '/api/v1/webhooks/test',
    auth: 'x-api-key or Bearer JWT',
    summary: 'Send test event',
    body: { event: 'payment.success' },
    response: { success: true, delivered: 1 }
  },
  {
    method: 'GET',
    path: '/api/v1/healthz',
    auth: 'Public',
    summary: 'Liveness and readiness probe',
    response: { status: 'healthy' }
  }
];
