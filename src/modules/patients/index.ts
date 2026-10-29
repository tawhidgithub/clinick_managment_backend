import type { AppModule } from '../../shared/module';
import { patientsRouter } from './patients.routes';

export const patientsModule: AppModule = {
  name: 'patients',
  routes: [{ path: '/patients', router: patientsRouter }],
};

// Public API for other modules (search now; visits in Phase B3)
export {
  assertPatientExists,
  createPatient,
  findPatientsByPhone,
  patientAge,
  searchPatients,
} from './patients.service';
export { createPatientBody, type CreatePatientBody } from './patients.schema';
