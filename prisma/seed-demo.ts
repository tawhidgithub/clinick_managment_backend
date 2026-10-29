// Demo data for showing the app: patients, memberships, six weeks of past
// visits with invoices, payments, treatments and prescriptions, today's live
// queue and patient notes. Run after `npm run db:seed`:
//
//   npm run db:seed-demo
//
// Runs only on an empty clinic (no patients yet) and never in production.
// Rows are written directly with backdated timestamps; totals, discounts and
// invoice status use the same rules as the API (invoices.totals).
import 'dotenv/config';
import type { MembershipStatus, PaymentMethod, Service } from '@prisma/client';
import { prisma } from '../src/shared/db/prisma';
import { addDays, addMonths, clinicDateString, clinicDayStart, clinicYear, dateOnly, toDateString } from '../src/shared/lib/dates';
import { computeTotals, invoiceStatus, type DiscountRule, type InvoiceLine } from '../src/modules/invoices/invoices.totals';

const PAST_DAYS = 42;
const taka = (amount: number) => amount * 100;
const pad = (n: number, width: number) => String(n).padStart(width, '0');

// Deterministic random numbers, so every run produces the same clinic.
let seed = 20261029;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const chance = (p: number) => rand() < p;

// ─── Reference data ─────────────────────────────────────────────────────────

const people: Array<[name: string, gender: 'MALE' | 'FEMALE']> = [
  ['Mohammad Rahim Uddin', 'MALE'], ['Fatema Begum', 'FEMALE'], ['Abdul Karim', 'MALE'],
  ['Nusrat Jahan', 'FEMALE'], ['Tanvir Hasan', 'MALE'], ['Sharmin Akter', 'FEMALE'],
  ['Md. Shafiqul Islam', 'MALE'], ['Rokeya Sultana', 'FEMALE'], ['Imran Hossain', 'MALE'],
  ['Farzana Yasmin', 'FEMALE'], ['Kamal Uddin Ahmed', 'MALE'], ['Sabina Yesmin', 'FEMALE'],
  ['Rafiqul Alam', 'MALE'], ['Taslima Khatun', 'FEMALE'], ['Arif Chowdhury', 'MALE'],
  ['Mahmuda Haque', 'FEMALE'], ['Jahangir Alam', 'MALE'], ['Nasrin Sultana', 'FEMALE'],
  ['Sajjad Hossain', 'MALE'], ['Ayesha Siddika', 'FEMALE'], ['Mizanur Rahman', 'MALE'],
  ['Shirin Akhter', 'FEMALE'], ['Habibur Rahman', 'MALE'], ['Moushumi Das', 'FEMALE'],
  ['Shahidul Islam', 'MALE'], ['Lamia Rahman', 'FEMALE'], ['Anwar Hossain', 'MALE'],
  ['Tahmina Chowdhury', 'FEMALE'], ['Rashed Khan', 'MALE'], ['Sumaiya Islam', 'FEMALE'],
  ['Sohel Rana', 'MALE'], ['Jannatul Ferdous', 'FEMALE'], ['Nazmul Huda', 'MALE'],
  ['Rupa Biswas', 'FEMALE'], ['Masud Parvez', 'MALE'], ['Afroza Begum', 'FEMALE'],
];
const areas = ['Dhanmondi', 'Mirpur 10', 'Uttara Sector 7', 'Mohammadpur', 'Gulshan 2', 'Banani', 'Bashundhara R/A', 'Badda', 'Rampura', 'Lalmatia', 'Shyamoli', 'Khilgaon'];
const bloodGroups = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-'];

// Extra doctors next to the seed's sample ones, so the queue board looks busy.
const demoDoctors: Array<{ dept: string; name: string; title: string; phone: string; slotMinutes: number }> = [
  { dept: 'PHY', name: 'Dr. Farhana Rahman', title: 'BPT, MPT (Ortho)', phone: '01711000101', slotMinutes: 30 },
  { dept: 'DEN', name: 'Dr. Tanvir Ahmed', title: 'BDS, FCPS', phone: '01711000102', slotMinutes: 30 },
  { dept: 'DIE', name: 'Nadia Islam', title: 'MSc Food & Nutrition', phone: '01711000103', slotMinutes: 20 },
];

const reasons: Record<string, string[]> = {
  PHY: ['Lower back pain', 'Neck stiffness', 'Knee pain after a fall', 'Frozen shoulder', 'Post-surgery rehab', 'Sciatica'],
  DEN: ['Toothache', 'Bleeding gums', 'Routine check-up', 'Broken tooth', 'Sensitivity to cold', 'Bad breath'],
  DIE: ['Weight loss plan', 'Diabetes diet', 'PCOS diet', 'High cholesterol', 'Weight gain plan'],
};
const diagnoses: Record<string, Array<[diagnosis: string, advice: string]>> = {
  PHY: [
    ['Mechanical low back pain', 'Hot pack 15 min twice daily. Avoid lifting heavy weight. Continue home exercises.'],
    ['Cervical spondylosis', 'Use a low pillow. Neck isometric exercises 10 reps x 3 daily.'],
    ['Adhesive capsulitis (left shoulder)', 'Pendulum and wall-climb exercises twice daily.'],
    ['Patellofemoral pain syndrome', 'Quadriceps strengthening. Avoid squatting and stairs where possible.'],
  ],
  DEN: [
    ['Dental caries (36)', 'Brush twice daily with fluoride paste. Avoid sticky sweets.'],
    ['Chronic gingivitis', 'Warm salt-water gargle twice daily. Use a soft brush.'],
    ['Irreversible pulpitis (46)', 'Root canal advised. Take medicine after meals.'],
    ['Dentine hypersensitivity', 'Use desensitising toothpaste. Avoid very cold drinks.'],
  ],
  DIE: [
    ['Obesity (BMI 31)', '1500 kcal chart. Walk 30 minutes daily. No sugary drinks.'],
    ['Type 2 diabetes, diet control', 'Small meals every 3 hours. Brown rice instead of white rice.'],
    ['PCOS', 'Low-GI diet. Reduce refined carbs. Regular exercise.'],
    ['Dyslipidaemia', 'Less red meat and fried food. More vegetables and fish.'],
  ],
};
const physioAreas = ['Lumbar spine', 'Cervical spine', 'Right knee', 'Left shoulder', 'Right shoulder'];
const teeth = ['11', '16', '26', '36', '37', '46', '47'];
const cancelReasons = ['Patient left before being called', 'Booked under the wrong doctor', 'Patient asked to come another day'];
const noteTexts = [
  'Allergic to penicillin.',
  'Diabetic, check blood sugar before any procedure.',
  'Prefers evening appointments after 6 pm.',
  'Usually pays by bKash.',
  'Hard of hearing, please speak clearly and call twice.',
  'Usually comes with a family member, who is the contact person.',
  'Asked for a printed copy of every prescription.',
  'Corporate employee, may need invoices with the company name.',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const todayStr = clinicDateString();
const today = dateOnly(todayStr);
const dayStr = (daysAgo: number) => toDateString(addDays(today, -daysAgo));
/** A clinic-local wall-clock time on a given day, as a UTC instant. */
const at = (day: string, hour: number, minute = 0) => new Date(clinicDayStart(day).getTime() + (hour * 60 + minute) * 60_000);
const minutes = (date: Date, n: number) => new Date(date.getTime() + n * 60_000);

const methods: PaymentMethod[] = ['CASH', 'CASH', 'CASH', 'CASH', 'CASH', 'BKASH', 'BKASH', 'BKASH', 'NAGAD', 'CARD'];
const reference = (method: PaymentMethod) =>
  method === 'BKASH' || method === 'NAGAD'
    ? Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[int(0, 33)]).join('')
    : method === 'CARD' ? `POS-${int(100000, 999999)}` : null;

/** Numbers that restart each year (invoices, prescriptions), handed out in time order. */
const yearly = new Map<string, number>();
function nextYearly(prefix: 'invoice' | 'rx', when: Date): string {
  const year = clinicYear(when);
  const key = `${prefix}:${year}`;
  const value = (yearly.get(key) ?? 0) + 1;
  yearly.set(key, value);
  return `${prefix === 'invoice' ? 'INV' : 'RX'}-${year}-${pad(value, 6)}`;
}

// ─── Plan everything in memory first, so numbers follow time order ──────────

interface MembershipDraft {
  patient: number;
  plan: string;
  startDaysAgo: number;
  status: MembershipStatus;
  cancelledDaysAgo?: number;
  renewsIndex?: number; // index in `membershipDrafts` of the membership it renews
}
// Patient indexes refer to `people`.
const membershipDrafts: MembershipDraft[] = [
  { patient: 0, plan: 'Gold', startDaysAgo: 110, status: 'ACTIVE' },
  { patient: 1, plan: 'Silver', startDaysAgo: 64, status: 'ACTIVE' },
  { patient: 2, plan: 'Physio Care', startDaysAgo: 24, status: 'ACTIVE' },
  { patient: 3, plan: 'Gold', startDaysAgo: 352, status: 'ACTIVE' }, // expires within 30 days
  { patient: 4, plan: 'Silver', startDaysAgo: 400, status: 'EXPIRED' },
  { patient: 4, plan: 'Silver', startDaysAgo: 34, status: 'ACTIVE', renewsIndex: 4 },
  { patient: 5, plan: 'Physio Care', startDaysAgo: 200, status: 'EXPIRED' },
  { patient: 6, plan: 'Silver', startDaysAgo: 50, status: 'CANCELLED', cancelledDaysAgo: 12 },
  { patient: 7, plan: 'Gold', startDaysAgo: 6, status: 'ACTIVE' },
  { patient: 8, plan: 'Physio Care', startDaysAgo: 160, status: 'ACTIVE' }, // expires within 30 days
];
const MEMBERS = new Set(membershipDrafts.map((m) => m.patient));

interface VisitDraft {
  day: string;
  patient: number;
  doctor: number; // index into the practitioner list loaded below
  status: 'WAITING' | 'IN_ROOM' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  arrivedAt: Date;
  calledAt?: Date;
  completedAt?: Date;
  serviceIds: string[];
  reason: string;
  cancelReason?: string;
  serialNo: number;
  invoice?: { at: Date; no: string; pay: 'full' | 'partial' | 'none'; manualDiscount: number; voidedNo?: string };
  rx?: { at: Date; no: string };
  treatments: boolean;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo data is not for production');
  if ((await prisma.patient.count()) > 0) {
    console.log('Patients already exist, demo data skipped (it only runs on an empty clinic)');
    return;
  }

  const [admin, desk] = await Promise.all([
    prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } }),
    prisma.user.findUnique({ where: { username: 'frontdesk' } }),
  ]);
  if (!admin) throw new Error('Run `npm run db:seed` first (no admin found)');
  const staff = desk ? [desk.id, desk.id, desk.id, admin.id] : [admin.id];

  const departments = await prisma.department.findMany();
  const deptByCode = Object.fromEntries(departments.map((d) => [d.code, d]));
  const codeByDept = Object.fromEntries(departments.map((d) => [d.id, d.code]));

  for (const d of demoDoctors) {
    const departmentId = deptByCode[d.dept]!.id;
    if (await prisma.practitioner.findFirst({ where: { name: d.name, departmentId } })) continue;
    await prisma.practitioner.create({
      data: {
        name: d.name, title: d.title, phone: d.phone, departmentId, slotMinutes: d.slotMinutes,
        schedules: {
          create: [6, 0, 1, 2, 3, 4].flatMap((dayOfWeek) => [
            { dayOfWeek, startTime: '10:00', endTime: '14:00' },
            { dayOfWeek, startTime: '17:00', endTime: '21:00' },
          ]),
        },
      },
    });
  }
  const doctors = await prisma.practitioner.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  const services = await prisma.service.findMany({ where: { isActive: true } });
  const servicesByDept = new Map<string, Service[]>();
  for (const s of services) servicesByDept.set(s.departmentId, [...(servicesByDept.get(s.departmentId) ?? []), s]);
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const plans = Object.fromEntries((await prisma.membershipPlan.findMany()).map((p) => [p.name, p]));

  /** Consultation first, sometimes one more treatment from the same department. */
  function pickServices(departmentId: string): string[] {
    const list = servicesByDept.get(departmentId) ?? [];
    const consult = list.find((s) => /consultation/i.test(s.name)) ?? list[0]!;
    const others = list.filter((s) => s.id !== consult.id);
    if (others.length && chance(0.55)) return [consult.id, pick(others).id];
    if (others.length && chance(0.3)) return [pick(others).id];
    return [consult.id];
  }
  /** Members visit more often, so their discounts show up on invoices. */
  function pickPatient(exclude: Set<number>): number {
    for (;;) {
      const p = chance(0.35) ? pick([...MEMBERS]) : int(0, people.length - 1);
      if (!exclude.has(p)) return p;
    }
  }

  // Past visits: Saturday-Thursday, morning and evening shift.
  const visits: VisitDraft[] = [];
  for (let daysAgo = PAST_DAYS; daysAgo >= 1; daysAgo--) {
    const day = dayStr(daysAgo);
    if (dateOnly(day).getUTCDay() === 5) continue; // Friday off
    doctors.forEach((doctor, doctorIndex) => {
      const count = int(0, 3);
      const busy = new Set<number>();
      let clock = at(day, chance(0.5) ? 10 : 17, int(0, 30));
      for (let serialNo = 1; serialNo <= count; serialNo++) {
        const patient = pickPatient(busy);
        busy.add(patient);
        const code = codeByDept[doctor.departmentId]!;
        const roll = rand();
        const status = roll < 0.86 ? 'COMPLETED' : roll < 0.94 ? 'NO_SHOW' : 'CANCELLED';
        const arrivedAt = clock;
        const calledAt = status === 'COMPLETED' ? minutes(arrivedAt, int(5, 40)) : undefined;
        const completedAt = calledAt ? minutes(calledAt, int(15, 45)) : undefined;
        clock = minutes(arrivedAt, int(20, 50));
        const draft: VisitDraft = {
          day, patient, doctor: doctorIndex, status, arrivedAt, calledAt, completedAt,
          serviceIds: pickServices(doctor.departmentId),
          reason: pick(reasons[code]!),
          cancelReason: status === 'CANCELLED' ? pick(cancelReasons) : undefined,
          serialNo,
          treatments: status === 'COMPLETED' && chance(0.6),
        };
        if (completedAt) {
          const payRoll = rand();
          draft.invoice = {
            at: minutes(completedAt, 3),
            no: '',
            pay: payRoll < 0.84 ? 'full' : payRoll < 0.93 ? 'partial' : 'none',
            manualDiscount: chance(0.06) ? taka(100) : 0,
          };
          if (chance(0.5)) draft.rx = { at: minutes(completedAt, -2), no: '' };
        }
        visits.push(draft);
      }
    });
  }

  // Today's live queue: for each doctor a few done, one in the room, the rest waiting.
  // The queue ends now, or at 13:00 when seeding before then, so it sits in clinic hours.
  const now = new Date();
  const anchor = now > at(todayStr, 13) ? now : at(todayStr, 13);
  const notBefore = (date: Date) => (date < at(todayStr, 10) ? at(todayStr, 10) : date);
  doctors.forEach((doctor, doctorIndex) => {
    const code = codeByDept[doctor.departmentId]!;
    const todayBusy = new Set<number>(); // once per doctor per day
    const plan = [
      ...Array<VisitDraft['status']>(int(1, 3)).fill('COMPLETED'),
      'IN_ROOM' as const,
      ...Array<VisitDraft['status']>(int(1, 3)).fill('WAITING'),
    ];
    let clock = minutes(anchor, -plan.length * 25 - 20);
    plan.forEach((status, i) => {
      const patient = pickPatient(todayBusy);
      todayBusy.add(patient);
      const arrivedAt = notBefore(clock);
      clock = minutes(clock, 25);
      const calledAt = status === 'COMPLETED' || status === 'IN_ROOM' ? notBefore(minutes(arrivedAt, 10)) : undefined;
      const completedAt = status === 'COMPLETED' ? notBefore(minutes(arrivedAt, 30)) : undefined;
      const billed = status === 'COMPLETED' || chance(0.5); // many pay at the counter on arrival
      visits.push({
        day: todayStr, patient, doctor: doctorIndex, status, arrivedAt, calledAt, completedAt,
        serviceIds: pickServices(doctor.departmentId),
        reason: pick(reasons[code]!),
        serialNo: i + 1,
        treatments: status === 'COMPLETED' && chance(0.5),
        invoice: billed
          ? { at: minutes(completedAt ?? arrivedAt, 2), no: '', pay: status === 'COMPLETED' ? 'full' : pick(['full', 'full', 'none'] as const), manualDiscount: 0 }
          : undefined,
        rx: status === 'COMPLETED' && chance(0.5) ? { at: minutes(completedAt!, -2), no: '' } : undefined,
      });
    });
  });

  // One past invoice charged the wrong service: voided with a refund and billed again.
  const voidCase = visits.find((v) => v.day !== todayStr && v.invoice?.pay === 'full' && v.serviceIds.length === 2)!;
  if (voidCase) voidCase.invoice!.voidedNo = '';

  // Hand out card, invoice and prescription numbers in time order.
  const membershipStart = (m: MembershipDraft) => at(dayStr(m.startDaysAgo), 11, 15);
  type NumberEvent = { when: Date; assign: () => void };
  const events: NumberEvent[] = [];
  const membershipNumbers: Array<{ cardNo: string; invoiceNo: string }> = membershipDrafts.map(() => ({ cardNo: '', invoiceNo: '' }));
  let card = 0;
  membershipDrafts.forEach((m, i) =>
    events.push({
      when: membershipStart(m),
      assign: () => {
        membershipNumbers[i] = { cardNo: `CPD-M-${pad(++card, 5)}`, invoiceNo: nextYearly('invoice', membershipStart(m)) };
      },
    }),
  );
  for (const v of visits) {
    if (v.rx) events.push({ when: v.rx.at, assign: () => (v.rx!.no = nextYearly('rx', v.rx!.at)) });
    if (v.invoice?.voidedNo !== undefined) {
      const firstBilledAt = v.invoice.at;
      events.push({ when: firstBilledAt, assign: () => (v.invoice!.voidedNo = nextYearly('invoice', firstBilledAt)) });
      v.invoice.at = minutes(firstBilledAt, 90);
    }
    if (v.invoice) events.push({ when: v.invoice.at, assign: () => (v.invoice!.no = nextYearly('invoice', v.invoice!.at)) });
  }
  events.sort((a, b) => a.when.getTime() - b.when.getTime()).forEach((e) => e.assign());

  // ─── Write ────────────────────────────────────────────────────────────────

  // Patients get codes in the order they first came to the clinic.
  const firstSeen = people.map((_, i) => {
    const times = [
      ...visits.filter((v) => v.patient === i).map((v) => v.arrivedAt.getTime()),
      ...membershipDrafts.filter((m) => m.patient === i).map((m) => membershipStart(m).getTime() - 30 * 60_000),
    ];
    return times.length ? Math.min(...times) : at(dayStr(int(1, PAST_DAYS)), 12).getTime();
  });
  const order = people.map((_, i) => i).sort((a, b) => firstSeen[a]! - firstSeen[b]!);
  const sharedPhone = '01712345678'; // a mother and daughter share one phone
  const patientIds: string[] = [];
  let code = 0;
  for (const i of order) {
    const [name, gender] = people[i]!;
    const useDob = chance(0.6);
    const age = int(8, 72);
    const patient = await prisma.patient.create({
      data: {
        patientCode: `CPD-${pad(++code, 6)}`,
        name,
        gender,
        phone: i === 9 || i === 19 ? sharedPhone : `01${pick(['3', '5', '6', '7', '8', '9'])}${pad(int(0, 99_999_999), 8)}`,
        altPhone: chance(0.2) ? `01${pick(['7', '8', '9'])}${pad(int(0, 99_999_999), 8)}` : null,
        dateOfBirth: useDob ? dateOnly(`${clinicYear() - age}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`) : null,
        ageYears: useDob ? null : age,
        address: `House ${int(1, 120)}, Road ${int(1, 27)}, ${pick(areas)}, Dhaka`,
        bloodGroup: chance(0.7) ? pick(bloodGroups) : null,
        createdAt: new Date(firstSeen[i]!),
      },
    });
    patientIds[i] = patient.id;
  }

  // Memberships, each billed and paid when issued.
  const membershipIds: string[] = [];
  const discountRules: Array<DiscountRule & { patient: number; startDate: Date; status: MembershipStatus }> = [];
  for (const [i, m] of membershipDrafts.entries()) {
    const plan = plans[m.plan]!;
    const startDate = dateOnly(dayStr(m.startDaysAgo));
    const endDate = addDays(addMonths(startDate, plan.durationMonths), -1);
    const issuedAt = membershipStart(m);
    const method = pick(methods);
    const createdById = pick(staff);
    const { cardNo, invoiceNo } = membershipNumbers[i]!;
    const membership = await prisma.membership.create({
      data: {
        cardNo, patientId: patientIds[m.patient]!, planId: plan.id, startDate, endDate, status: m.status,
        cancelReason: m.status === 'CANCELLED' ? 'Patient moved to Chattogram' : null,
        cancelledAt: m.cancelledDaysAgo ? at(dayStr(m.cancelledDaysAgo), 12) : null,
        renewedFromId: m.renewsIndex !== undefined ? membershipIds[m.renewsIndex] : null,
        createdById, createdAt: issuedAt,
        invoices: {
          create: {
            invoiceNo, patientId: patientIds[m.patient]!, subtotal: plan.price, total: plan.price,
            paidAmount: plan.price, status: 'PAID', createdById, createdAt: issuedAt,
            items: {
              create: {
                description: `${plan.name} membership · ${plan.durationMonths} month${plan.durationMonths > 1 ? 's' : ''} (${cardNo})`,
                quantity: 1, unitPrice: plan.price, lineTotal: plan.price,
              },
            },
            payments: { create: { amount: plan.price, method, reference: reference(method), receivedById: createdById, paidAt: issuedAt } },
          },
        },
      },
    });
    membershipIds[i] = membership.id;
    discountRules.push({
      membershipId: membership.id, cardNo, planName: plan.name, discountPercent: plan.discountPercent,
      departmentId: plan.departmentId, endDate, patient: m.patient, startDate, status: m.status,
    });
  }
  // A membership that was cancelled stops giving discounts from the day it was cancelled.
  const cancelledOn = new Map(membershipDrafts.map((m, i) => [membershipIds[i], m.cancelledDaysAgo ? dateOnly(dayStr(m.cancelledDaysAgo)) : null]));
  const rulesFor = (patient: number, day: string) => {
    const date = dateOnly(day);
    return discountRules.filter((r) => {
      const cancelled = cancelledOn.get(r.membershipId);
      return r.patient === patient && r.startDate <= date && r.endDate >= date && (!cancelled || date < cancelled);
    });
  };

  // Visits with their services, treatments, invoice, payments and prescription.
  let written = 0;
  for (const v of visits) {
    const doctor = doctors[v.doctor]!;
    const createdById = pick(staff);
    const patientId = patientIds[v.patient]!;
    const lines: InvoiceLine[] = v.serviceIds.map((id) => {
      const s = serviceById.get(id)!;
      return { serviceId: id, description: s.name, quantity: 1, unitPrice: s.price, lineTotal: s.price, departmentId: s.departmentId };
    });
    const code = codeByDept[doctor.departmentId]!;

    const invoices = [];
    if (v.invoice) {
      const totals = computeTotals(lines, rulesFor(v.patient, v.day), v.invoice.manualDiscount);
      const paid = v.invoice.pay === 'full' ? totals.total : v.invoice.pay === 'partial' ? Math.floor(totals.total / 200) * 100 : 0;
      const method = pick(methods);
      const items = lines.map(({ departmentId: _d, ...line }) => line);
      if (v.invoice.voidedNo) {
        // The first bill charged the treatment twice; refunded in cash when voided.
        const wrongLines = [...lines, lines[1]!];
        const wrong = computeTotals(wrongLines, rulesFor(v.patient, v.day), 0);
        const billedAt = minutes(v.invoice.at, -90);
        invoices.push({
          invoiceNo: v.invoice.voidedNo, patientId, ...wrong, paidAmount: 0, status: 'VOID' as const,
          voidReason: 'Treatment was added twice by mistake', voidedAt: minutes(billedAt, 60), voidedById: admin.id,
          createdById, createdAt: billedAt,
          items: { create: wrongLines.map(({ departmentId: _d, ...line }) => line) },
          payments: {
            create: [
              { amount: wrong.total, method: 'CASH' as const, receivedById: createdById, paidAt: billedAt },
              { amount: -wrong.total, method: 'CASH' as const, note: 'Refund: Treatment was added twice by mistake', receivedById: admin.id, paidAt: minutes(billedAt, 60) },
            ],
          },
        });
      }
      invoices.push({
        invoiceNo: v.invoice.no, patientId, ...totals, paidAmount: paid, status: invoiceStatus(totals.total, paid),
        createdById, createdAt: v.invoice.at,
        items: { create: items },
        payments: paid > 0 ? { create: { amount: paid, method, reference: reference(method), receivedById: createdById, paidAt: v.invoice.at } } : undefined,
      });
    }

    const [diagnosis, advice] = pick(diagnoses[code]!);
    await prisma.appointment.create({
      data: {
        patientId, departmentId: doctor.departmentId, practitionerId: doctor.id, status: v.status,
        visitDate: dateOnly(v.day), serialNo: v.serialNo, queuePosition: v.serialNo,
        calledAt: v.calledAt, completedAt: v.completedAt, reason: v.reason, cancelReason: v.cancelReason,
        createdById, createdAt: v.arrivedAt, updatedAt: v.completedAt ?? v.calledAt ?? v.arrivedAt,
        services: { create: v.serviceIds.map((id) => ({ serviceId: id, price: serviceById.get(id)!.price, quantity: 1 })) },
        treatments: v.treatments
          ? {
              create: v.serviceIds.map((id) => ({
                serviceId: id,
                description: `${serviceById.get(id)!.name} done`,
                toothOrArea: code === 'DEN' ? pick(teeth) : code === 'PHY' ? pick(physioAreas) : null,
                createdAt: v.completedAt,
              })),
            }
          : undefined,
        invoices: invoices.length ? { create: invoices } : undefined,
        prescription: v.rx
          ? {
              create: {
                rxNo: v.rx.no, patientId, practitionerId: doctor.id, diagnosis, advice,
                nextVisitDate: chance(0.6) ? addDays(dateOnly(v.day), pick([7, 14, 30])) : null,
                createdById, createdAt: v.rx.at,
              },
            }
          : undefined,
      },
    });
    if (++written % 25 === 0) console.log(`  ${written}/${visits.length} visits`);
  }

  // Notes on a few patients.
  for (const [n, body] of noteTexts.entries()) {
    const patient = order[n * 3]!;
    await prisma.note.create({
      data: { patientId: patientIds[patient]!, authorId: pick(staff), body, createdAt: new Date(firstSeen[patient]! + 3_600_000) },
    });
  }

  // Counters, so the next patient, invoice, card and walk-in continue the sequences.
  const counters = new Map<string, number>([['patient', code], ['card', card], ...yearly]);
  for (const v of visits.filter((x) => x.day === todayStr)) {
    const id = doctors[v.doctor]!.id;
    for (const key of [`serial:${id}:${todayStr}`, `queuepos:${id}:${todayStr}`]) {
      counters.set(key, Math.max(counters.get(key) ?? 0, v.serialNo));
    }
  }
  for (const [key, value] of counters) {
    await prisma.counter.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  const todays = visits.filter((v) => v.day === todayStr).length;
  console.log(
    `Demo data: ${people.length} patients, ${membershipDrafts.length} memberships, ` +
      `${visits.length - todays} past visits, ${todays} in today's queue, ${noteTexts.length} notes`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
