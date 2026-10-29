import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { clinic, type Clinic, type Doctor } from '../fixtures';
import { app, asBinary, binary, client, expectPdf, login, uid } from '../helpers';

let c: Clinic;
let physio: Doctor;
let dentist: Doctor;
let bigPhoto: Buffer;
let smallPhoto: Buffer;

beforeAll(async () => {
  c = await clinic();
  physio = await c.newDoctor('PHY', 'Dr. Rx Physio');
  dentist = await c.newDoctor('DEN', 'Dr. Rx Dental');
  bigPhoto = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: { r: 250, g: 248, b: 240 } } }).png().toBuffer();
  smallPhoto = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 200, g: 220, b: 255 } } }).jpeg().toBuffer();
});

const jpg = (data: Buffer, name = 'page.jpg') => ({ name, data, type: 'image/jpeg' });
/** Signed file links are absolute (PUBLIC_API_URL); fetch the path from the test app. */
const fetchLink = (url: string) => asBinary(request(app).get(new URL(url).pathname));

describe('prescriptions', () => {
  it('uploads photos, compresses them and serves them through signed links', async () => {
    const v = await c.visit({ doctor: physio, services: [{ serviceId: c.service('Physio Consultation').id }] });
    const id = v.appointment.id;

    expect((await c.desk.upload('/prescriptions', { appointmentId: id }, [])).status).toBe(400);
    expect((await c.desk.upload('/prescriptions', { appointmentId: id }, [{ name: 'notes.txt', data: Buffer.from('hi'), type: 'text/plain' }])).status).toBe(400);
    const corrupt = await c.desk.upload('/prescriptions', { appointmentId: id }, [jpg(Buffer.from('not a jpeg'))]);
    expect(corrupt.status).toBe(400);
    expect(corrupt.body.error.message).toContain('not a readable image');

    const created = await c.desk.upload('/prescriptions', { appointmentId: id, nextVisitDate: '2026-11-05' }, [
      { name: 'page1.png', data: bigPhoto, type: 'image/png' },
      jpg(smallPhoto, 'page2.jpg'),
    ]);
    expect(created.status).toBe(201);
    const rx = created.body;
    expect(rx.rxNo).toMatch(/^RX-\d{4}-\d{6}$/);
    expect(rx.images).toHaveLength(2);
    expect(rx.images.every((i: { mimeType: string }) => i.mimeType === 'image/jpeg')).toBe(true);

    const img = await fetchLink(rx.images[0].url);
    expect(img.status).toBe(200);
    const meta = await sharp(binary(img)).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2000);
    const tampered = rx.images[0].url.replace(/.$/, (ch: string) => (ch === 'A' ? 'B' : 'A'));
    expect((await fetchLink(tampered)).status).toBe(404);

    expect((await c.desk.upload('/prescriptions', { appointmentId: id }, [jpg(smallPhoto)])).status).toBe(409);

    const added = await c.desk.upload(`/prescriptions/${rx.id}/images`, {}, [jpg(smallPhoto, 'page3.jpg')]);
    expect(added.body.images.map((i: { pageNo: number }) => i.pageNo)).toEqual([1, 2, 3]);
    const removed = await c.desk.delete(`/prescriptions/${rx.id}/images/${added.body.images[1].id}`);
    expect(removed.body.images).toHaveLength(2);
    expect((await fetchLink(added.body.images[1].url)).status).toBe(404);

    expectPdf(await asBinary(c.desk.get(`/prescriptions/${rx.id}/pdf`)));
    expectPdf(await asBinary(c.desk.get(`/appointments/${id}/slip`)));
  });

  it('a practitioner can upload only for their own patients and cannot see invoices', async () => {
    const username = `dr${uid()}`;
    const staff = await c.admin.post('/staff', { name: 'Dr Rx', username, password: 'password123', role: 'PRACTITIONER', practitionerId: physio.id });
    expect(staff.status).toBe(201);
    const doctor = client(await login(username, 'password123'));

    const own = await c.visit({ doctor: physio, services: [{ serviceId: c.service('Physio Consultation').id }] });
    expect((await doctor.upload('/prescriptions', { appointmentId: own.appointment.id }, [jpg(smallPhoto)])).status).toBe(201);

    const other = await c.visit({ doctor: dentist, services: [{ serviceId: c.service('Dental Consultation').id }] });
    expect((await doctor.upload('/prescriptions', { appointmentId: other.appointment.id }, [jpg(smallPhoto)])).status).toBe(403);
    expect((await doctor.get('/invoices')).status).toBe(403);
    expect((await doctor.post('/visits', {})).status).toBe(403);
  });
});
