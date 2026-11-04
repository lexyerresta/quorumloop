import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceClient } from '../src/http/service-client';

interface RecordedCall {
  url: string;
  init: RequestInit;
}

const client = (): ServiceClient =>
  new ServiceClient({ caller: 'api-gateway', secret: 'test-secret' });

/** Captures the transport call so the headers can be asserted after the fact. */
const captureFetch = (): RecordedCall[] => {
  const calls: RecordedCall[] = [];
  const fake = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };
  vi.stubGlobal('fetch', fake as unknown as typeof fetch);
  return calls;
};

const headersOf = (call: RecordedCall): Record<string, string> =>
  call.init.headers as Record<string, string>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServiceClient transport', () => {
  it('omits content-type when there is no body', async () => {
    const calls = captureFetch();

    await client().command({
      method: 'DELETE',
      target: 'project-service',
      path: '/v1/projects/abc',
      baseUrl: 'http://127.0.0.1:7003',
    });

    expect(calls).toHaveLength(1);
    const headers = headersOf(calls[0]!);
    // A bodyless DELETE that declares json is rejected by Fastify with a 400 before routing.
    expect(headers['content-type']).toBeUndefined();
    expect(headers.accept).toBe('application/json');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('declares json and sends the encoded body when there is one', async () => {
    const calls = captureFetch();

    await client().command({
      method: 'POST',
      target: 'project-service',
      path: '/v1/projects',
      body: { name: 'smoke' },
      baseUrl: 'http://127.0.0.1:7003',
    });

    const headers = headersOf(calls[0]!);
    expect(headers['content-type']).toBe('application/json');
    expect(calls[0]!.init.body).toBe('{"name":"smoke"}');
  });

  it('keeps an explicit raw body when a webhook has to be relayed byte for byte', async () => {
    const calls = captureFetch();
    const raw = '{"action":"opened"}';

    await client().command({
      method: 'POST',
      target: 'webhook-service',
      path: '/v1/forge/github',
      rawBody: raw,
      baseUrl: 'http://127.0.0.1:7007',
    });

    expect(headersOf(calls[0]!)['content-type']).toBe('application/json');
    expect(calls[0]!.init.body).toBe(raw);
  });
});
