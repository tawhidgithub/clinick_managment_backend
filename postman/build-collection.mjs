// Builds the Postman collection (v2.1) and local environment for the Chowa API.
//   npm run postman:build
// Edit the requests below, then rebuild; do not hand-edit the generated JSON.
//
// The folders run top to bottom as one walk-in day: sign in, set up a doctor,
// register + book, call in, bill, upload the prescription, sell a membership,
// look at the dashboard and reports, then the admin-only actions.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require('sharp');

// ── Request builder ───────────────────────────────────────────────────────

const lines = (s) => s.trim().split('\n').map((l) => l.replace(/^ {6}/, ''));

function url(pathAndQuery) {
  if (pathAndQuery.startsWith('{{')) return pathAndQuery; // a full URL saved by an earlier request
  const [p, qs] = pathAndQuery.split('?');
  return {
    raw: `{{baseUrl}}${pathAndQuery}`,
    host: ['{{baseUrl}}'],
    path: p.split('/').filter(Boolean),
    ...(qs ? { query: qs.split('&').map((kv) => { const [key, value = ''] = kv.split('='); return { key, value }; }) } : {}),
  };
}

/**
 * @param {string} name
 * @param {string} method
 * @param {string} p      path under {{baseUrl}}, may include ?query
 * @param {object} o      body | form | test | pre | doc | noAuth
 */
function req(name, method, p, o = {}) {
  const events = [];
  if (o.pre) events.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: lines(o.pre) } });
  events.push({ listen: 'test', script: { type: 'text/javascript', exec: lines(o.test ?? 'expectStatus(200);') } });

  const request = { method, header: [], url: url(p), description: o.doc ?? '' };
  if (o.noAuth) request.auth = { type: 'noauth' };
  if (o.body !== undefined) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: typeof o.body === 'string' ? o.body : JSON.stringify(o.body, null, 2), options: { raw: { language: 'json' } } };
  }
  if (o.form) request.body = { mode: 'formdata', formdata: o.form };
  return { name, event: events, request };
}

const folder = (name, description, item) => ({ name, description, item });

// Small helpers prepended to every test script (Postman runs each script in its
// own scope, so functions from a collection-level script are not visible).
const HELPERS = `
      function expectStatus(code) {
        pm.test('HTTP ' + code, function () { pm.response.to.have.status(code); });
      }
      function expectPdf() {
        expectStatus(200);
        pm.test('is a PDF', function () { pm.expect(pm.response.headers.get('Content-Type')).to.eql('application/pdf'); });
      }
      function save(name, value) { pm.collectionVariables.set(name, value); }
`;

// ── Requests ──────────────────────────────────────────────────────────────

const SCHEDULE = { schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '08:00', endTime: '22:00' })) };

const signIn = folder('1. Sign in', 'Health check and login. Login saves the access token used by every other request (collection auth: Bearer {{accessToken}}).', [
  req('Health', 'GET', '/health', {
    noAuth: true,
    test: `
      expectStatus(200);
      pm.test('database is up', function () { pm.expect(pm.response.json().db).to.eql('ok'); });
    `,
  }),
  req('Login', 'POST', '/auth/login', {
    noAuth: true,
    body: { username: '{{username}}', password: '{{password}}' },
    doc: 'Returns `{ user, accessToken }` and sets the httpOnly `chowa_rt` refresh cookie (path `/api/auth`). Access tokens last 15 minutes; 10 failed logins per 15 minutes per IP are allowed.',
    test: `
      expectStatus(200);
      save('accessToken', pm.response.json().accessToken);
    `,
  }),
  req('Who am I', 'GET', '/auth/me', {
    test: `
      expectStatus(200);
      pm.test('signed in', function () { pm.expect(pm.response.json().user.username).to.eql(pm.environment.get('username')); });
    `,
  }),
  req('Refresh access token', 'POST', '/auth/refresh', {
    noAuth: true,
    doc: 'Uses the `chowa_rt` cookie (Postman keeps it from Login). The refresh token rotates on every call.',
    test: `
      expectStatus(200);
      save('accessToken', pm.response.json().accessToken);
    `,
  }),
]);

const setup = folder('2. Clinic setup', 'Reads departments, services and plans, and creates a fresh doctor so the queue starts at serial 1. Admin only for the writes.', [
  req('Clinic settings', 'GET', '/clinic-settings'),
  req('Departments', 'GET', '/departments', {
    test: `
      expectStatus(200);
      var physio = pm.response.json().find(function (d) { return d.code === 'PHY'; });
      pm.test('Physiotherapy exists', function () { pm.expect(physio).to.be.ok; });
      save('departmentId', physio.id);
    `,
  }),
  req('Services in department', 'GET', '/services?departmentId={{departmentId}}', {
    test: `
      expectStatus(200);
      var services = pm.response.json();
      pm.test('at least two services', function () { pm.expect(services.length).to.be.at.least(2); });
      save('serviceId', services[0].id);
      save('secondServiceId', services[1].id);
    `,
  }),
  req('Membership plans', 'GET', '/membership-plans', {
    test: `
      expectStatus(200);
      var plans = pm.response.json().filter(function (p) { return p.isActive && !p.departmentId; });
      plans.sort(function (a, b) { return b.discountPercent - a.discountPercent; });
      pm.test('an all-department plan exists', function () { pm.expect(plans.length).to.be.above(0); });
      save('planId', plans[0].id);
      save('planPrice', plans[0].price);
    `,
  }),
  req('Create doctor', 'POST', '/practitioners', {
    body: { name: 'Dr. Postman {{$timestamp}}', title: 'BPT', departmentId: '{{departmentId}}', slotMinutes: 30 },
    test: `
      expectStatus(201);
      save('doctorId', pm.response.json().id);
    `,
  }),
  req('Set weekly schedule', 'PUT', '/practitioners/{{doctorId}}/schedules', {
    body: SCHEDULE,
    doc: 'Replaces the whole week. `dayOfWeek`: 0 = Sunday ... 6 = Saturday. Overlapping blocks on one day are rejected.',
  }),
  req('Doctors in department', 'GET', '/practitioners?departmentId={{departmentId}}'),
]);

const visitAndQueue = folder('3. Walk-in visit & queue', 'Register + book in one request, then run the doctor\'s queue. `Next` always sends the appointment the screen shows in the room; a stale screen gets 409 instead of skipping a patient.', [
  req('Find patient by phone', 'GET', '/patients/lookup?phone={{newPhone}}', {
    pre: `
      // A random new mobile number for this run
      pm.collectionVariables.set('newPhone', '017' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'));
    `,
    test: `
      expectStatus(200);
      pm.test('no patient with this phone yet', function () { pm.expect(pm.response.json().patients).to.have.length(0); });
    `,
  }),
  req('New visit (new patient)', 'POST', '/visits', {
    body: {
      newPatient: { name: 'Postman Patient {{$timestamp}}', phone: '{{newPhone}}', gender: 'FEMALE', ageYears: 32 },
      departmentId: '{{departmentId}}',
      practitionerId: '{{doctorId}}',
      services: [{ serviceId: '{{serviceId}}' }, { serviceId: '{{secondServiceId}}', quantity: 2 }],
    },
    doc: 'Send `patientId` instead of `newPatient` for an existing patient. Returns the patient ID (CPD-000123), the serial number and `warnings` (e.g. doctor not scheduled today).',
    test: `
      expectStatus(201);
      var body = pm.response.json();
      pm.test('serial 1 for a fresh doctor', function () { pm.expect(body.appointment.serialNo).to.eql(1); });
      pm.test('patient ID generated', function () { pm.expect(body.patient.patientCode).to.match(/^CPD-\\d{6}$/); });
      save('patientId', body.patient.id);
      save('appointmentId', body.appointment.id);
    `,
  }),
  req('Serial slip (80 mm PDF)', 'GET', '/appointments/{{appointmentId}}/slip', { test: 'expectPdf();' }),
  req('Queue board (all doctors)', 'GET', '/queue', {
    doc: 'Poll every few seconds for the "Now serving" strip. Filters: `date`, `departmentId`.',
    test: `
      expectStatus(200);
      var mine = pm.response.json().doctors.find(function (d) { return d.practitioner.id === pm.collectionVariables.get('doctorId'); });
      pm.test('our doctor has 1 waiting', function () { pm.expect(mine.waitingCount).to.eql(1); });
    `,
  }),
  req('One doctor\'s queue', 'GET', '/queue/{{doctorId}}', {
    test: `
      expectStatus(200);
      pm.test('doctor is free', function () { pm.expect(pm.response.json().status).to.eql('FREE'); });
    `,
  }),
  req('Next: call the first patient', 'POST', '/queue/{{doctorId}}/next', {
    body: { expectedCurrentAppointmentId: null },
    test: `
      expectStatus(200);
      pm.test('our patient is in the room', function () { pm.expect(pm.response.json().calledId).to.eql(pm.collectionVariables.get('appointmentId')); });
    `,
  }),
  req('Next from a stale screen (409)', 'POST', '/queue/{{doctorId}}/next', {
    body: { expectedCurrentAppointmentId: null },
    doc: 'The screen still thinks the doctor is free, but a patient is in the room: refused so nobody is skipped.',
    test: 'expectStatus(409);',
  }),
  req('Add treatment record', 'POST', '/appointments/{{appointmentId}}/treatments', {
    body: { description: 'Lower back mobilisation', toothOrArea: 'L4-L5', serviceId: '{{secondServiceId}}' },
    test: 'expectStatus(201);',
  }),
  req('Next: finish without calling anyone', 'POST', '/queue/{{doctorId}}/next', {
    body: { expectedCurrentAppointmentId: '{{appointmentId}}', callNext: false },
    test: `
      expectStatus(200);
      pm.test('visit completed', function () { pm.expect(pm.response.json().completedId).to.eql(pm.collectionVariables.get('appointmentId')); });
    `,
  }),
  req('Appointment detail', 'GET', '/appointments/{{appointmentId}}', {
    test: `
      expectStatus(200);
      pm.test('COMPLETED', function () { pm.expect(pm.response.json().status).to.eql('COMPLETED'); });
    `,
  }),
  req('Completed but not billed', 'GET', '/appointments?unbilled=true'),
]);

const billing = folder('4. Billing', 'Invoice the visit with a part payment, then collect the rest. Amounts are in poisha (৳1 = 100).', [
  req('Preview invoice', 'POST', '/invoices/preview', {
    body: { appointmentId: '{{appointmentId}}' },
    test: `
      expectStatus(200);
      pm.test('services pre-filled from the visit', function () { pm.expect(pm.response.json().items).to.have.length(2); });
    `,
  }),
  req('Create invoice with part payment', 'POST', '/invoices', {
    body: { appointmentId: '{{appointmentId}}', manualDiscount: 0, payment: { amount: 30000, method: 'CASH' } },
    doc: 'Leave out `items` to bill the visit\'s services. Member discount is applied automatically (`applyMemberDiscount: false` to skip).',
    test: `
      expectStatus(201);
      var inv = pm.response.json();
      pm.test('PARTIAL', function () { pm.expect(inv.status).to.eql('PARTIAL'); });
      save('invoiceId', inv.id);
      save('invoiceDue', inv.due);
      save('overAmount', inv.due + 1);
    `,
  }),
  req('Overpayment is refused (400)', 'POST', '/invoices/{{invoiceId}}/payments', {
    body: '{\n  "amount": {{overAmount}}\n}',
    test: `
      expectStatus(400);
      pm.test('tells the amount due', function () { pm.expect(pm.response.json().error.details.due).to.eql(pm.collectionVariables.get('invoiceDue')); });
    `,
  }),
  req('Pay the rest by bKash', 'POST', '/invoices/{{invoiceId}}/payments', {
    body: '{\n  "amount": {{invoiceDue}},\n  "method": "BKASH",\n  "reference": "8N7A6B5C4D"\n}',
    test: `
      expectStatus(201);
      pm.test('PAID', function () { pm.expect(pm.response.json().status).to.eql('PAID'); });
    `,
  }),
  req('Invoice detail', 'GET', '/invoices/{{invoiceId}}'),
  req('Invoice PDF (A5)', 'GET', '/invoices/{{invoiceId}}/pdf', { test: 'expectPdf();' }),
  req('Invoice PDF (A4, download)', 'GET', '/invoices/{{invoiceId}}/pdf?paper=a4&download=true', { test: 'expectPdf();' }),
  req('Due invoices', 'GET', '/invoices?status=DUE,PARTIAL', {
    test: `
      expectStatus(200);
      pm.test('totals row', function () { pm.expect(pm.response.json().totals).to.have.property('due'); });
    `,
  }),
]);

const prescriptions = folder('5. Prescription', 'Upload a photo of the paper prescription. In the Postman app, choose any image for the "images" field if the sample file is not found.', [
  req('Upload prescription photo', 'POST', '/prescriptions', {
    form: [
      { key: 'appointmentId', value: '{{appointmentId}}', type: 'text' },
      { key: 'diagnosis', value: 'Lumbar strain', type: 'text' },
      { key: 'images', type: 'file', src: 'sample-prescription.jpg' },
    ],
    doc: 'multipart/form-data: up to 10 images (15 MB each) in `images`, plus `appointmentId`, `diagnosis?`, `advice?`, `nextVisitDate?` (YYYY-MM-DD).',
    test: `
      expectStatus(201);
      var rx = pm.response.json();
      pm.test('Rx number', function () { pm.expect(rx.rxNo).to.match(/^RX-\\d{4}-\\d{6}$/); });
      save('prescriptionId', rx.id);
      save('imageUrl', rx.images[0].url);
    `,
  }),
  req('Prescription detail', 'GET', '/prescriptions/{{prescriptionId}}'),
  req('Open image (signed link, no login)', 'GET', '{{imageUrl}}', {
    noAuth: true,
    doc: 'Image links expire after FILE_URL_TTL_SECONDS.',
    test: `
      expectStatus(200);
      pm.test('JPEG', function () { pm.expect(pm.response.headers.get('Content-Type')).to.eql('image/jpeg'); });
    `,
  }),
  req('Prescription PDF', 'GET', '/prescriptions/{{prescriptionId}}/pdf', { test: 'expectPdf();' }),
]);

const memberships = folder('6. Memberships', 'Sell a plan (creates its invoice), print the card, renew.', [
  req('Issue membership', 'POST', '/memberships', {
    body: '{\n  "patientId": "{{patientId}}",\n  "planId": "{{planId}}",\n  "payment": { "amount": {{planPrice}}, "method": "CASH" }\n}',
    test: `
      expectStatus(201);
      var m = pm.response.json();
      pm.test('card number', function () { pm.expect(m.cardNo).to.match(/^CPD-M-\\d{5}$/); });
      save('membershipId', m.id);
    `,
  }),
  req('Discount lookup for billing', 'GET', '/memberships/lookup?patientId={{patientId}}', {
    test: `
      expectStatus(200);
      pm.test('best discount found', function () { pm.expect(pm.response.json().best).to.be.ok; });
    `,
  }),
  req('Membership card PDF', 'GET', '/memberships/{{membershipId}}/card', { test: 'expectPdf();' }),
  req('Renew', 'POST', '/memberships/{{membershipId}}/renew', {
    body: {},
    test: `
      expectStatus(201);
      pm.test('starts after the current one', function () { pm.expect(pm.response.json().displayStatus).to.eql('UPCOMING'); });
      save('renewalId', pm.response.json().id);
    `,
  }),
  req('Expiring in 30 days', 'GET', '/memberships?tab=expiring'),
]);

const patients = folder('7. Patients', 'Search, profile, history timeline, notes.', [
  req('Global search', 'GET', '/search?q={{newPhone}}', {
    test: `
      expectStatus(200);
      pm.test('finds our patient', function () { pm.expect(pm.response.json().patients[0].id).to.eql(pm.collectionVariables.get('patientId')); });
    `,
  }),
  req('Patient list', 'GET', '/patients?q=Postman&page=1&pageSize=20'),
  req('Patient profile', 'GET', '/patients/{{patientId}}'),
  req('Patient history', 'GET', '/patients/{{patientId}}/history', {
    test: `
      expectStatus(200);
      var types = pm.response.json().events.map(function (e) { return e.type; });
      pm.test('visit, invoice and prescription in the timeline', function () {
        pm.expect(types).to.include.members(['visit', 'invoice', 'prescription']);
      });
    `,
  }),
  req('Add note', 'POST', '/patients/{{patientId}}/notes', { body: { body: 'Prefers evening appointments.' }, test: 'expectStatus(201);' }),
  req('Update patient', 'PATCH', '/patients/{{patientId}}', { body: { address: 'Mirpur 10, Dhaka', bloodGroup: 'B+' } }),
  req('Register patient only', 'POST', '/patients', {
    body: { name: 'Postman Walk-in {{$timestamp}}', phone: '{{newPhone}}', gender: 'MALE', ageYears: 45 },
    doc: 'Families share phones, so an existing phone is allowed. Call `GET /patients/lookup?phone=` first to show the duplicate-phone warning.',
    test: 'expectStatus(201);',
  }),
]);

const reports = folder('8. Dashboard & reports', 'Dashboard for everyone (money hidden from practitioners); reports and audit log for Admin.', [
  req('Dashboard', 'GET', '/dashboard', {
    doc: 'Today\'s counts, queue, visits, collection, dues, unbilled visits and expiring memberships. Refresh every 30-60 s; poll /queue for the live strip.',
    test: `
      expectStatus(200);
      pm.test('money section for Admin / Front Desk', function () { pm.expect(pm.response.json().money).to.have.property('collectedToday'); });
    `,
  }),
  req('Report: this month', 'GET', '/reports', {
    doc: 'Default range: the 1st of this month to today. `from`, `to` (YYYY-MM-DD, clinic days), `groupBy=day|month`.',
    test: `
      expectStatus(200);
      var r = pm.response.json();
      pm.test('departments add up to the summary', function () {
        var billed = r.revenueByDepartment.reduce(function (s, d) { return s + d.billed; }, 0);
        pm.expect(billed).to.eql(r.summary.billed);
      });
    `,
  }),
  req('Report: whole year by month', 'GET', '/reports?from={{yearStart}}&to={{yearEnd}}&groupBy=month', {
    pre: `
      var year = new Date().getFullYear();
      pm.collectionVariables.set('yearStart', year + '-01-01');
      pm.collectionVariables.set('yearEnd', year + '-12-31');
    `,
    test: `
      expectStatus(200);
      pm.test('12 monthly buckets', function () { pm.expect(pm.response.json().series).to.have.length(12); });
    `,
  }),
  req('Audit log for the invoice', 'GET', '/audit-log?entityType=invoices&entityId={{invoiceId}}', {
    test: `
      expectStatus(200);
      pm.test('payments were recorded', function () { pm.expect(pm.response.json().total).to.be.at.least(1); });
    `,
  }),
]);

const admin = folder('9. Admin', 'Staff logins and corrections that only an Admin may make.', [
  req('Staff list', 'GET', '/staff'),
  req('Create front desk login', 'POST', '/staff', {
    body: { name: 'Postman Desk', username: 'desk{{$timestamp}}', password: 'Desk-pass-123', role: 'FRONT_DESK' },
    test: `
      expectStatus(201);
      save('staffId', pm.response.json().id);
    `,
  }),
  req('Reset password', 'POST', '/staff/{{staffId}}/reset-password', { body: { newPassword: 'Desk-pass-456' }, test: 'expectStatus(204);' }),
  req('Deactivate login', 'PATCH', '/staff/{{staffId}}', { body: { isActive: false } }),
  req('Void invoice', 'POST', '/invoices/{{invoiceId}}/void', {
    body: { reason: 'Demo: billed by mistake', refundMethod: 'CASH' },
    doc: 'Records a refund of everything paid as a negative payment. Invoices are never deleted.',
    test: `
      expectStatus(200);
      pm.test('VOID', function () { pm.expect(pm.response.json().status).to.eql('VOID'); });
    `,
  }),
  req('Cancel the renewal', 'POST', '/memberships/{{renewalId}}/cancel', { body: { reason: 'Demo cancellation' } }),
]);

const signOut = folder('10. Sign out', '', [
  req('Logout', 'POST', '/auth/logout', { noAuth: true, test: 'expectStatus(204);' }),
]);

// ── Collection + environment ──────────────────────────────────────────────

const VARIABLES = [
  'accessToken', 'departmentId', 'serviceId', 'secondServiceId', 'planId', 'planPrice', 'doctorId', 'newPhone',
  'patientId', 'appointmentId', 'invoiceId', 'invoiceDue', 'overAmount', 'prescriptionId', 'imageUrl',
  'membershipId', 'renewalId', 'staffId', 'yearStart', 'yearEnd',
];

const collection = {
  info: {
    name: 'Chowa Clinic API',
    description: [
      'Front desk API for Chowa Physio & Dental Care.',
      '',
      '1. Import this collection and the "Chowa local" environment, select the environment.',
      '2. Set `password` in the environment (the admin password from the seed).',
      '3. Run the folders in order (Runner > Run collection), or send requests one by one.',
      '',
      'Run it against a development or test database: it creates a doctor, a patient, invoices and a staff login.',
      'Money is in poisha (৳1 = 100). Dates are YYYY-MM-DD clinic days (Asia/Dhaka).',
      'Errors look like `{ "error": { "code", "message", "details" } }`.',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
  variable: VARIABLES.map((key) => ({ key, value: '' })),
  item: [signIn, setup, visitAndQueue, billing, prescriptions, memberships, patients, reports, admin, signOut],
};

for (const f of collection.item) {
  for (const r of f.item) {
    const test = r.event.find((e) => e.listen === 'test');
    test.script.exec = [...lines(HELPERS), ...test.script.exec];
  }
}

const environment = {
  name: 'Chowa local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:4000/api', type: 'default', enabled: true },
    { key: 'username', value: 'admin', type: 'default', enabled: true },
    { key: 'password', value: '', type: 'secret', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

const out = (name, data) => writeFileSync(path.join(here, name), `${JSON.stringify(data, null, 2)}\n`);
out('chowa-clinic.postman_collection.json', collection);
out('chowa-local.postman_environment.json', environment);

// A small "photo" for the prescription upload request
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="100%" height="100%" fill="#fbf8f1"/>' +
    '<text x="60" y="120" font-size="48" font-family="sans-serif">Rx</text>' +
    '<text x="60" y="220" font-size="32" font-family="sans-serif">Paracetamol 500 mg, 1+0+1</text>' +
    '<text x="60" y="280" font-size="32" font-family="sans-serif">Hot compress twice daily</text></svg>',
);
await sharp(svg).jpeg({ quality: 70 }).toFile(path.join(here, 'sample-prescription.jpg'));

const count = collection.item.reduce((s, f) => s + f.item.length, 0);
console.log(`Wrote ${count} requests in ${collection.item.length} folders to postman/`);
