import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const roadco = await prisma.organization.upsert({
    where: { slug: 'roadco' },
    update: {},
    create: { slug: 'roadco', name: 'RoadCo Contracting' },
  });
  const pavecorp = await prisma.organization.upsert({
    where: { slug: 'pavecorp' },
    update: {},
    create: { slug: 'pavecorp', name: 'PaveCorp Civil' },
  });

  const base = [
    'claims.create',
    'projects.read',
    'equipment.read',
    'dockets.read',
    'dockets.create',
    'reports.read',
  ];
  const lead = [...base, 'claims.approve', 'dockets.confirm', 'projects.manage', 'equipment.manage'];
  const userDefs = [
    { email: 'alice@roadco.test', name: 'Alice Nguyen', orgId: roadco.id, permissions: base },
    { email: 'bob@roadco.test', name: 'Bob Carter', orgId: roadco.id, permissions: base },
    { email: 'carol@roadco.test', name: 'Carol Diaz', orgId: roadco.id, permissions: lead },
    { email: 'dan@roadco.test', name: 'Dan Okafor', orgId: roadco.id, permissions: [...base, 'claims.approve', 'dockets.confirm'] },
    { email: 'eve@pavecorp.test', name: 'Eve Walsh', orgId: pavecorp.id, permissions: lead },
  ];
  const users: Record<string, { id: string }> = {};
  for (const u of userDefs) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { permissions: u.permissions },
      create: u,
    });
    users[u.name.split(' ')[0].toLowerCase()] = user;
    console.log(`${u.name}: id=${user.id} org=${u.orgId}`);
  }

  const projectDefs = [
    { orgId: roadco.id, code: 'M7-RESURF', name: 'M7 Northbound Resurfacing' },
    { orgId: roadco.id, code: 'GLENN-RD', name: 'Glenfield Road Upgrade' },
    { orgId: roadco.id, code: 'BARRIER-22', name: 'Guardrail Program 2022', status: 'ARCHIVED' },
    { orgId: pavecorp.id, code: 'PAC-HWY', name: 'Pacific Hwy Shoulder Widening' },
    { orgId: pavecorp.id, code: 'CARPARK-3', name: 'Westfield Carpark Deck 3' },
  ];
  const projects: Record<string, { id: string }> = {};
  for (const p of projectDefs) {
    const project = await prisma.project.upsert({
      where: { orgId_code: { orgId: p.orgId, code: p.code } },
      update: {},
      create: p,
    });
    projects[p.code] = project;
  }

  for (const org of [roadco, pavecorp]) {
    await prisma.surchargeRate.deleteMany({ where: { orgId: org.id } });
    await prisma.surchargeRate.createMany({
      data: [
        { orgId: org.id, ratePercent: 10, effectiveFrom: new Date('2024-07-01') },
        { orgId: org.id, ratePercent: 12.5, effectiveFrom: new Date('2026-01-01') },
      ],
    });
  }

  const equipmentDefs = [
    { orgId: roadco.id, assetCode: 'PAV-01', name: 'Vögele Super 1800 paver', category: 'PAVER', hireRatePerDay: '2450.00' },
    { orgId: roadco.id, assetCode: 'ROL-03', name: 'Hamm HD+ 90 tandem roller', category: 'ROLLER', hireRatePerDay: '980.00' },
    { orgId: roadco.id, assetCode: 'TRK-07', name: 'Isuzu FVZ tipper', category: 'TRUCK', hireRatePerDay: '760.00' },
    { orgId: roadco.id, assetCode: 'TMA-02', name: 'Scorpion TMA attenuator truck', category: 'TRAFFIC', hireRatePerDay: '1120.00' },
    { orgId: pavecorp.id, assetCode: 'EXC-11', name: 'Cat 320 excavator', category: 'EXCAVATOR', hireRatePerDay: '1540.00' },
  ];
  const equipment: Record<string, { id: string }> = {};
  for (const e of equipmentDefs) {
    const item = await prisma.equipment.upsert({
      where: { orgId_assetCode: { orgId: e.orgId, assetCode: e.assetCode } },
      update: {},
      create: e,
    });
    equipment[e.assetCode] = item;
  }

  await prisma.docket.deleteMany({});
  await prisma.numberSequence.deleteMany({});
  const docketDefs = [
    {
      orgId: roadco.id, projectId: projects['M7-RESURF'].id, equipmentId: equipment['PAV-01'].id,
      docketNumber: 'PD-00001', workDate: new Date('2026-02-09'), hours: '8.00', status: 'CONFIRMED',
      submittedById: users['alice'].id, confirmedById: users['carol'].id, confirmedAt: new Date('2026-02-10'),
      notes: 'Night shift, northbound lanes 1-2',
    },
    {
      orgId: roadco.id, projectId: projects['M7-RESURF'].id, equipmentId: equipment['ROL-03'].id,
      docketNumber: 'PD-00002', workDate: new Date('2026-02-09'), hours: '6.50', status: 'CONFIRMED',
      submittedById: users['alice'].id, confirmedById: users['dan'].id, confirmedAt: new Date('2026-02-10'),
    },
    {
      orgId: roadco.id, projectId: projects['GLENN-RD'].id, equipmentId: equipment['TRK-07'].id,
      docketNumber: 'PD-00003', workDate: new Date('2026-03-01'), hours: '4.00', status: 'DRAFT',
      submittedById: users['bob'].id,
    },
    {
      orgId: roadco.id, projectId: projects['M7-RESURF'].id, equipmentId: equipment['TMA-02'].id,
      docketNumber: 'PD-00004', workDate: new Date('2026-03-08'), hours: '10.00', status: 'DRAFT',
      submittedById: users['bob'].id, notes: 'Lane closure cover for line marking',
    },
    {
      orgId: pavecorp.id, projectId: projects['PAC-HWY'].id, equipmentId: equipment['EXC-11'].id,
      docketNumber: 'PD-00001', workDate: new Date('2026-04-02'), hours: '8.00', status: 'CONFIRMED',
      submittedById: users['eve'].id, confirmedById: users['eve'].id, confirmedAt: new Date('2026-04-03'),
    },
  ];
  for (const d of docketDefs) {
    await prisma.docket.create({ data: d });
  }
  await prisma.numberSequence.createMany({
    data: [
      { orgId: roadco.id, key: 'docket', nextValue: 5 },
      { orgId: pavecorp.id, key: 'docket', nextValue: 2 },
    ],
  });

  await prisma.note.deleteMany({});
  await prisma.note.createMany({
    data: [
      {
        orgId: roadco.id, entityType: 'project', entityId: projects['M7-RESURF'].id,
        authorId: users['carol'].id, body: 'RMS inspector on site Tuesdays — keep dockets current.',
      },
      {
        orgId: roadco.id, entityType: 'project', entityId: projects['GLENN-RD'].id,
        authorId: users['alice'].id, body: 'Fuel dockets from the depot bowser go against this job, not M7.',
      },
    ],
  });

  await prisma.claim.deleteMany({});
  const claimDefs = [
    {
      orgId: roadco.id, projectId: projects['M7-RESURF'].id, submitterId: users['alice'].id,
      reference: 'EXP 26-0001', status: 'SUBMITTED', expenseDate: new Date('2026-02-10'), total: 457.35,
      lines: [
        { description: 'Diesel for pavers', quantity: 3, unitPrice: 88.4, isFuel: true },
        { description: 'Line-marking paint', quantity: 6, unitPrice: 26.5, isFuel: false },
      ],
    },
    {
      orgId: roadco.id, projectId: projects['GLENN-RD'].id, submitterId: users['bob'].id,
      reference: 'EXP 26-0002', status: 'DRAFT', expenseDate: new Date('2026-03-02'), total: 187.0,
      lines: [{ description: 'Traffic cones (pack of 10)', quantity: 2, unitPrice: 93.5, isFuel: false }],
    },
    {
      orgId: roadco.id, projectId: projects['M7-RESURF'].id, submitterId: users['bob'].id,
      reference: 'EXP 26-0003', status: 'APPROVED', expenseDate: new Date('2026-01-18'), total: 67.47,
      approvedBy: users['carol'].id, approvedAt: new Date('2026-01-20'),
      lines: [{ description: 'Unleaded for gen-set', quantity: 3, unitPrice: 19.99, isFuel: true }],
    },
    {
      orgId: pavecorp.id, projectId: projects['PAC-HWY'].id, submitterId: users['eve'].id,
      reference: 'EXP 26-0101', status: 'SUBMITTED', expenseDate: new Date('2026-04-05'), total: 315.0,
      lines: [{ description: 'Formply sheets', quantity: 7, unitPrice: 45.0, isFuel: false }],
    },
  ];
  for (const c of claimDefs) {
    const { lines, ...claim } = c;
    await prisma.claim.create({ data: { ...claim, lines: { create: lines } } });
  }

  console.log('Seed complete: 2 orgs, 5 users, 5 projects, 5 equipment, 5 dockets, 4 claims, 2 notes.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
