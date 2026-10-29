// Seeds the minimum data to run the clinic: departments, an admin login,
// sample doctors with schedules, services, membership plans and clinic
// settings. Safe to run more than once (upserts by unique keys).
import 'dotenv/config';
import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const taka = (amount: number) => amount * 100; // seed prices are written in taka

const departments = [
  { code: 'PHY', name: 'Physiotherapy', color: '#2563EB' },
  { code: 'DEN', name: 'Dental', color: '#0D9488' },
  { code: 'DIE', name: 'Diet', color: '#EA580C' },
];

const services: Record<string, Array<[name: string, priceTaka: number]>> = {
  PHY: [
    ['Physio Consultation', 500],
    ['Physiotherapy Session', 800],
    ['Electrotherapy (TENS/IFT)', 600],
    ['Manual Therapy', 1000],
  ],
  DEN: [
    ['Dental Consultation', 500],
    ['Scaling & Polishing', 2500],
    ['Tooth Filling', 2000],
    ['Tooth Extraction', 1500],
    ['Root Canal Treatment', 8000],
    ['Dental X-ray', 500],
  ],
  DIE: [
    ['Diet Consultation', 1000],
    ['Personalised Diet Chart', 1500],
    ['Diet Follow-up', 500],
  ],
};

// Sample doctors: rename or deactivate them from Settings once real ones are added.
const practitioners: Array<{ dept: string; name: string; title: string; slotMinutes: number }> = [
  { dept: 'PHY', name: 'Dr. Sample Physio', title: 'BPT, MPT', slotMinutes: 30 },
  { dept: 'DEN', name: 'Dr. Sample Dentist', title: 'BDS', slotMinutes: 30 },
  { dept: 'DIE', name: 'Sample Dietitian', title: 'MSc Food & Nutrition', slotMinutes: 20 },
];

// Saturday-Thursday, 10:00-14:00 and 17:00-21:00 (Friday off)
const workingDays = [6, 0, 1, 2, 3, 4];
const shifts: Array<[string, string]> = [
  ['10:00', '14:00'],
  ['17:00', '21:00'],
];

async function upsertUser(username: string, name: string, role: Role, password: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return { user: existing, created: false };
  const user = await prisma.user.create({
    data: { username, name, role, passwordHash: await bcrypt.hash(password, 12) },
  });
  return { user, created: true };
}

async function main() {
  await prisma.clinicSettings.upsert({
    where: { id: 1 },
    create: { id: 1, name: 'Chowa Physio & Dental Care' },
    update: {},
  });

  const deptIds: Record<string, string> = {};
  for (const d of departments) {
    const dept = await prisma.department.upsert({ where: { code: d.code }, create: d, update: {} });
    deptIds[d.code] = dept.id;
  }

  for (const [code, list] of Object.entries(services)) {
    const departmentId = deptIds[code]!;
    for (const [name, price] of list) {
      await prisma.service.upsert({
        where: { departmentId_name: { departmentId, name } },
        create: { departmentId, name, price: taka(price) },
        update: {},
      });
    }
  }

  for (const p of practitioners) {
    const departmentId = deptIds[p.dept]!;
    const existing = await prisma.practitioner.findFirst({ where: { name: p.name, departmentId } });
    if (existing) continue;
    await prisma.practitioner.create({
      data: {
        name: p.name,
        title: p.title,
        departmentId,
        slotMinutes: p.slotMinutes,
        schedules: {
          create: workingDays.flatMap((dayOfWeek) =>
            shifts.map(([startTime, endTime]) => ({ dayOfWeek, startTime, endTime })),
          ),
        },
      },
    });
  }

  const plans = [
    { name: 'Silver', price: taka(1000), durationMonths: 12, discountPercent: 10, departmentId: null, benefits: '10% off all services for 1 year' },
    { name: 'Gold', price: taka(2500), durationMonths: 12, discountPercent: 20, departmentId: null, benefits: '20% off all services for 1 year' },
    { name: 'Physio Care', price: taka(1500), durationMonths: 6, discountPercent: 15, departmentId: deptIds.PHY!, benefits: '15% off physiotherapy for 6 months' },
  ];
  for (const plan of plans) {
    await prisma.membershipPlan.upsert({ where: { name: plan.name }, create: plan, update: {} });
  }

  const adminUsername = (process.env.SEED_ADMIN_USERNAME ?? 'admin').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 8) {
    throw new Error('Set SEED_ADMIN_PASSWORD (at least 8 characters) in .env before seeding');
  }
  const admin = await upsertUser(adminUsername, 'Administrator', 'ADMIN', adminPassword);
  console.log(admin.created ? `Created admin "${adminUsername}"` : `Admin "${adminUsername}" already exists`);

  if (process.env.NODE_ENV !== 'production') {
    const desk = await upsertUser('frontdesk', 'Front Desk (demo)', 'FRONT_DESK', adminPassword);
    if (desk.created) console.log('Created demo user "frontdesk" (same password as admin)');
  }

  console.log('Seed complete');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
