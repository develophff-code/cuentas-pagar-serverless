import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../../packages/web/src/api-client.js';
import { escapeHtml } from '../../packages/web/src/utils.js';
import { CognitoSession } from '../../packages/web/src/auth.js';
import { InvoiceService } from '../../src/persistence/invoice-service.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

test('cliente real consume items, mantiene centavos exactos y envía JWT e idempotencia', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    return new Response(JSON.stringify(init.method === 'POST' ? { id: 'i' } : { items: [{ id: 's' }] }));
  };
  try {
    const client = new HttpApiClient('', async () => 'jwt', 'tenant-1');
    assert.deepEqual(await client.listSuppliers(), [{ id: 's' }]);
    assert.deepEqual(await client.listPaymentGrid(), [{ id: 's' }]);
    await client.createInvoice({ supplierId: 's', invoiceType: 'INFORMAL', description: 'Factura', amountInCents: 9007199254740993n, dueDate: '2026-11-02' });
    assert.equal(calls[1]!.url, '/v1/tenants/tenant-1/invoices');
    assert.equal((calls[2]!.init.headers as Record<string, string>).authorization, 'Bearer jwt');
    assert.ok((calls[2]!.init.headers as Record<string, string>)['idempotency-key']);
    assert.equal(JSON.parse(calls[2]!.init.body as string).amountInCents, '9007199254740993');
    await assert.rejects(() => new HttpApiClient('', async () => null, 't').listSuppliers(), /sesión venció/);
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = original; }
});

test('datos externos se escapan antes de entrar al HTML', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">&'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;');
});

test('servidor rechaza confirmar un proveedor sin clasificar antes de escribir la factura', async () => {
  let written = false;
  const tx = {
    tenants: { findUnique: async () => ({ current_plan_code: 'PROFESSIONAL' }) },
    plan_capability_versions: { findFirst: async () => ({ max_invoices_per_month: 100 }) },
    suppliers: { findFirst: async () => ({ id: 'supplier', category_code: null }) },
    invoices: { count: async () => 0, create: async () => { written = true; } },
  };
  const prisma = { $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } as unknown as PrismaClient;
  await assert.rejects(() => new InvoiceService(prisma).create({ tenantId: 't', supplierId: 'supplier',
    invoiceType: 'INFORMAL', description: 'Servicio', amountInCents: 1000n, dueDate: new Date('2026-11-02') },
  { tenantId: 't', userId: 'u', role: 'ADMIN' }, { confirmImmediately: true }), /Clasificá/);
  assert.equal(written, false);
});

test('login genera PKCE y rechaza callback con estado ajeno antes de canjear código', async () => {
  const originals = { window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    sessionStorage: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), history: Object.getOwnPropertyDescriptor(globalThis, 'history') };
  const values = new Map<string, string>();
  let assigned = '';
  const location = { origin: 'https://apagar.averiqsj.app', search: '', assign: (url: string) => { assigned = url; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  } });
  Object.defineProperty(globalThis, 'history', { configurable: true, value: { replaceState: () => {} } });
  try {
    const session = new CognitoSession({ mode: 'live', apiBaseUrl: '', region: 'us-east-1', userPoolId: 'pool', clientId: 'client', authDomain: 'https://fixture.auth.us-east-1.amazoncognito.com' });
    await session.login();
    const url = new URL(assigned);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge')?.length, 43);
    const pending = JSON.parse(values.get('cuentas-pagar-login')!);
    assert.equal(pending.state, url.searchParams.get('state'));
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.verifier))).toString('base64url');
    assert.equal(digest, url.searchParams.get('code_challenge'));
    location.search = '?code=stolen&state=other';
    await assert.rejects(() => session.completeLogin(), /no es válido/);
    assert.equal(values.size, 0);
    assert.equal(await session.getIdToken(), null);
    // A valid callback exchanges its verifier and keeps refresh tokens out of storage.
    await session.login();
    const valid = JSON.parse(values.get('cuentas-pagar-login')!);
    location.search = `?code=valid&state=${valid.state}`;
    const originalFetch = globalThis.fetch;
    const now = Date.now;
    let exchanges = 0;
    globalThis.fetch = async (_input, init) => {
      exchanges++;
      const fields = new URLSearchParams(init!.body as URLSearchParams);
      if (exchanges === 1) {
        assert.equal(fields.get('code_verifier'), valid.verifier);
        assert.equal(fields.get('redirect_uri'), 'https://apagar.averiqsj.app/');
        const claims = { nonce: valid.nonce, aud: 'client', token_use: 'id',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/pool', exp: Math.floor(now() / 1000) + 3600 };
        return new Response(JSON.stringify({ id_token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`,
          refresh_token: 'refresh', expires_in: 3600 }));
      }
      assert.equal(fields.get('grant_type'), 'refresh_token');
      assert.equal(fields.get('refresh_token'), 'refresh');
      return new Response(JSON.stringify({ id_token: 'refreshed-id-token', expires_in: 3600 }));
    };
    try {
      assert.equal(await session.completeLogin(), true);
      assert.equal(values.size, 0);
      assert.ok(await session.getIdToken());
      Date.now = () => now() + 3600_000;
      assert.deepEqual(await Promise.all([session.getIdToken(), session.getIdToken()]), ['refreshed-id-token', 'refreshed-id-token']);
      assert.equal(exchanges, 2);
      session.logout();
      assert.equal(new URL(assigned).pathname, '/logout');
      assert.equal(await session.getIdToken(), null);
    } finally { globalThis.fetch = originalFetch; Date.now = now; }
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
