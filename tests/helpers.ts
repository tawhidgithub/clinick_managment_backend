import { randomInt } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../src/app';

export const app = createApp();
export const PASSWORD = process.env.SEED_ADMIN_PASSWORD!;

/** Requests to /api with an optional Bearer token. */
export function client(token?: string) {
  const auth = (t: request.Test) => (token ? t.set('Authorization', `Bearer ${token}`) : t);
  return {
    get: (url: string) => auth(request(app).get(`/api${url}`)),
    post: (url: string, body: object = {}) => auth(request(app).post(`/api${url}`)).send(body),
    put: (url: string, body: object = {}) => auth(request(app).put(`/api${url}`)).send(body),
    patch: (url: string, body: object = {}) => auth(request(app).patch(`/api${url}`)).send(body),
    delete: (url: string) => auth(request(app).delete(`/api${url}`)),
    /** multipart/form-data with image files in the "images" field */
    upload: (url: string, fields: Record<string, string>, files: Array<{ name: string; data: Buffer; type: string }>) => {
      let t = auth(request(app).post(`/api${url}`));
      for (const [k, v] of Object.entries(fields)) t = t.field(k, v);
      for (const f of files) t = t.attach('images', f.data, { filename: f.name, contentType: f.type });
      return t;
    },
  };
}
export type Client = ReturnType<typeof client>;

export async function login(username: string, password = PASSWORD): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

/** A random valid Bangladeshi mobile number. */
export function phone(): string {
  return `01${randomInt(3, 10)}${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

let seq = 0;
/** Short unique text for names (unique within the run). */
export function uid(): string {
  return `${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`;
}

/** Collects a binary response body (PDFs, images) as a Buffer. */
export function binary(res: request.Response): Buffer {
  return res.body as Buffer;
}
export const asBinary = (t: request.Test) =>
  t.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

export function expectPdf(res: request.Response) {
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  expect(binary(res).subarray(0, 5).toString()).toBe('%PDF-');
}
