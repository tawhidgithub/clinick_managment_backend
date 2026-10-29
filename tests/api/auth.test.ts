import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, client, login, PASSWORD } from '../helpers';

const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('chowa_rt='));

describe('platform', () => {
  it('health reports the database and sets security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('echoes a sane incoming request id and replaces a bad one', async () => {
    expect((await request(app).get('/api/health').set('X-Request-Id', 'desk-1-abc123')).headers['x-request-id']).toBe('desk-1-abc123');
    expect((await request(app).get('/api/health').set('X-Request-Id', 'bad id with spaces')).headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('unknown routes, bad JSON and oversized bodies get JSON errors', async () => {
    const notFound = await request(app).get('/api/nope');
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('NOT_FOUND');

    const badJson = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"username":');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe('BAD_JSON');

    const big = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'x'.repeat(1_100_000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('TOO_LARGE');
  });
});

describe('auth', () => {
  it('rejects a wrong password with 401 and a validation error with 400', async () => {
    expect((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong-password' })).status).toBe(401);
    const invalid = await request(app).post('/api/auth/login').send({ username: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('login returns an access token and an httpOnly refresh cookie scoped to /api/auth', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'ADMIN' });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = cookieOf(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);

    const me = await client(res.body.accessToken).get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('admin');
  });

  it('protected routes need a valid token', async () => {
    expect((await request(app).get('/api/patients')).status).toBe(401);
    expect((await client('not-a-jwt').get('/patients')).status).toBe(401);
  });

  it('refresh rotates the cookie; a replayed old cookie is refused', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'frontdesk', password: PASSWORD }).expect(200);
    const first = await agent.post('/api/auth/refresh').expect(200);
    const oldCookie = cookieOf(first)!.split(';')[0]!;
    const second = await agent.post('/api/auth/refresh').expect(200);
    expect(second.body.accessToken).toBeTruthy();

    const replay = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(replay.status).toBe(401);
    // Within the grace window the newest session keeps working (a slow second tab is not a theft).
    await agent.post('/api/auth/refresh').expect(200);

    await agent.post('/api/auth/logout').expect(204);
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
  });

  it('cookie endpoints refuse other origins', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ username: 'admin', password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('roles', () => {
  it('front desk cannot manage staff, settings or reports', async () => {
    const desk = client(await login('frontdesk'));
    expect((await desk.get('/staff')).status).toBe(403);
    expect((await desk.put('/clinic-settings', { name: 'X' })).status).toBe(403);
    expect((await desk.get('/reports')).status).toBe(403);
    expect((await desk.get('/audit-log')).status).toBe(403);
  });
});
