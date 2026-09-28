const express = require('express');
const request = require('supertest');

jest.mock('../server/middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 1, role: 'SUPER_ADMIN' }; next(); },
  authorize: () => (req, res, next) => next(),
}));
jest.mock('../server/utils/orderUploads', () => ({
  uploadMiddleware: jest.fn((req, res, next) => next()),
  removeStoredFile: jest.fn(), sendStoredFile: jest.fn(),
}));
jest.mock('../server/controllers/orderController', () => {
  const ok = (req, res) => res.json({ ok: true });
  return { plans: ok, paymentQr: ok, list: ok, create: ok, submitProof: ok, cancel: ok, downloadProof: ok };
});
jest.mock('../server/controllers/orderAdminController', () => {
  const ok = (req, res) => res.json({ ok: true });
  return { getPrices: ok, savePrices: ok, getInstructions: ok, saveInstructions: ok, listOrders: ok, approve: ok, reject: ok };
});

const { uploadMiddleware } = require('../server/utils/orderUploads');
const router = require('../server/routes/orders');
const app = express().use(express.json()).use('/api/orders', router);

beforeEach(() => uploadMiddleware.mockClear());

describe('order id validation', () => {
  test.each([
    ['post', '/api/orders/abc/proof'],
    ['post', '/api/orders/abc/cancel'],
    ['get', '/api/orders/1x/proof'],
    ['post', '/api/orders/admin/orders/abc/approve'],
    ['post', '/api/orders/admin/orders/abc/reject'],
  ])('%s %s is a 400 and never reaches the upload middleware', async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid order id' });
    expect(uploadMiddleware).not.toHaveBeenCalled();
  });

  test('a numeric id passes through', async () => {
    const res = await request(app).post('/api/orders/12/proof');
    expect(res.status).toBe(200);
    expect(uploadMiddleware).toHaveBeenCalled();
  });
});
