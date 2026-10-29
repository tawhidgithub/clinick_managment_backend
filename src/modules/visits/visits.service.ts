import { LOCKING_TX_OPTIONS, prisma } from '../../shared/db/prisma';
import { badRequest, conflict } from '../../shared/errors/AppError';
import { clinicToday } from '../../shared/lib/dates';
import { createWalkInAppointment, lockPractitionerQueue, servicesTotal } from '../appointments';
import { assertActiveDepartment } from '../departments';
import { assertPatientExists, createPatient } from '../patients';
import { assertActivePractitioner } from '../practitioners';
import { getActiveServicesForDepartment } from '../services';
import type { CreateVisitBody } from './visits.schema';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Register (if new) + book in one transaction: find or create the patient,
 * add them to the chosen doctor's queue with the next serial number, and
 * snapshot the chosen services with today's prices.
 */
export async function createVisit(body: CreateVisitBody, createdById: string) {
  const result = await prisma.$transaction(async (tx) => {
    const department = await assertActiveDepartment(tx, body.departmentId);
    const practitioner = await assertActivePractitioner(tx, body.practitionerId);
    if (practitioner.departmentId !== department.id) {
      throw badRequest(`${practitioner.name} is not in the ${department.name} department`);
    }

    // Lock the doctor's queue before creating anything, so a double-clicked
    // Save runs one request after the other and the duplicate checks see the first.
    await lockPractitionerQueue(tx, practitioner.id);

    const services = await getActiveServicesForDepartment(
      tx,
      body.services.map((s) => s.serviceId),
      department.id,
    );
    const priceOf = new Map(services.map((s) => [s.id, s.price]));

    let patient: { id: string; patientCode: string; name: string; phone: string };
    let isNewPatient = false;

    if (body.patientId) {
      patient = await assertPatientExists(tx, body.patientId);
    } else {
      const np = body.newPatient!;
      const justRegistered = await tx.appointment.findFirst({
        where: {
          practitionerId: practitioner.id,
          visitDate: clinicToday(),
          status: { in: ['WAITING', 'IN_ROOM'] },
          patient: { phone: np.phone, name: { equals: np.name, mode: 'insensitive' }, deletedAt: null },
        },
        select: { id: true, serialNo: true, patient: { select: { id: true, patientCode: true } } },
      });
      if (justRegistered) {
        throw conflict(
          `${np.name} (${justRegistered.patient.patientCode}) is already in this doctor's queue with serial ${justRegistered.serialNo}`,
          { appointmentId: justRegistered.id, patientId: justRegistered.patient.id, serialNo: justRegistered.serialNo },
        );
      }
      patient = await createPatient(tx, np);
      isNewPatient = true;
    }

    const appointment = await createWalkInAppointment(tx, {
      patientId: patient.id,
      departmentId: department.id,
      practitionerId: practitioner.id,
      services: body.services.map((s) => ({ serviceId: s.serviceId, quantity: s.quantity, price: priceOf.get(s.serviceId)! })),
      reason: body.reason,
      createdById,
    });

    const [waitingAhead, inRoom] = await Promise.all([
      tx.appointment.count({
        where: {
          practitionerId: practitioner.id,
          visitDate: appointment.visitDate,
          status: 'WAITING',
          queuePosition: { lt: appointment.queuePosition! },
        },
      }),
      tx.appointment.count({
        where: { practitionerId: practitioner.id, visitDate: appointment.visitDate, status: 'IN_ROOM' },
      }),
    ]);

    return { patient, isNewPatient, appointment, waitingAhead, doctorBusy: inRoom > 0 };
  }, LOCKING_TX_OPTIONS);

  const { patient, isNewPatient, appointment } = result;

  const warnings: string[] = [];
  const weekday = appointment.visitDate.getUTCDay();
  const scheduled = await prisma.practitionerSchedule.count({
    where: { practitionerId: appointment.practitionerId, dayOfWeek: weekday },
  });
  if (scheduled === 0) {
    warnings.push(`${appointment.practitioner.name} is not scheduled to work on ${WEEKDAYS[weekday]}`);
  }

  return {
    patient: {
      id: patient.id,
      patientCode: patient.patientCode,
      name: patient.name,
      phone: patient.phone,
      isNew: isNewPatient,
    },
    appointment: {
      id: appointment.id,
      serialNo: appointment.serialNo,
      status: appointment.status,
      visitDate: appointment.visitDate,
      department: appointment.department,
      practitioner: appointment.practitioner,
      services: appointment.services.map((s) => ({
        serviceId: s.serviceId,
        name: s.service.name,
        price: s.price,
        quantity: s.quantity,
      })),
      servicesTotal: servicesTotal(appointment.services),
      createdAt: appointment.createdAt,
    },
    queue: { waitingAhead: result.waitingAhead, doctorBusy: result.doctorBusy },
    warnings,
  };
}
