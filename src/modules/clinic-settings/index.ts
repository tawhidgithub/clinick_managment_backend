import type { AppModule } from '../../shared/module';
import { clinicSettingsRouter } from './clinic-settings.routes';

export const clinicSettingsModule: AppModule = {
  name: 'clinic-settings',
  routes: [{ path: '/clinic-settings', router: clinicSettingsRouter }],
};

// Public API: used by PDF generation (invoices, slips, cards) in later phases
export { getClinicSettings } from './clinic-settings.service';
