import type { AppModule } from '../shared/module';
import { appointmentsModule } from './appointments';
import { auditModule } from './audit';
import { authModule } from './auth';
import { clinicSettingsModule } from './clinic-settings';
import { dashboardModule } from './dashboard';
import { departmentsModule } from './departments';
import { filesModule } from './files';
import { healthModule } from './health';
import { invoicesModule } from './invoices';
import { membershipsModule } from './memberships';
import { patientsModule } from './patients';
import { practitionersModule } from './practitioners';
import { prescriptionsModule } from './prescriptions';
import { queueModule } from './queue';
import { reportsModule } from './reports';
import { searchModule } from './search';
import { servicesModule } from './services';
import { staffModule } from './staff';
import { visitsModule } from './visits';

/**
 * Every feature module the API serves. To add a feature, create its folder
 * under src/modules, export an AppModule from its index.ts, and list it here.
 */
export const modules: AppModule[] = [
  healthModule,
  authModule,
  staffModule,
  clinicSettingsModule,
  departmentsModule,
  practitionersModule,
  servicesModule,
  membershipsModule,
  patientsModule,
  searchModule,
  appointmentsModule,
  queueModule,
  visitsModule,
  invoicesModule,
  prescriptionsModule,
  filesModule,
  dashboardModule,
  reportsModule,
  auditModule,
];
