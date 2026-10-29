import type { Request, Response } from 'express';
import { appointmentParams, boardQuery, nextBody, practitionerParams, skipBody } from './queue.schema';
import * as service from './queue.service';

export async function board(req: Request, res: Response) {
  const query = boardQuery.parse(req.query);
  res.json(await service.getQueueBoard(query));
}

export async function doctor(req: Request, res: Response) {
  const { practitionerId } = practitionerParams.parse(req.params);
  const { date } = boardQuery.parse(req.query);
  const board = await service.getQueueBoard({ date }, practitionerId);
  res.json({ date: board.date, isToday: board.isToday, ...board.doctors[0] });
}

export async function next(req: Request, res: Response) {
  const { practitionerId } = practitionerParams.parse(req.params);
  const body = nextBody.parse(req.body ?? {});
  res.json(
    await service.next(practitionerId, {
      expectedCurrentId: body.expectedCurrentAppointmentId,
      callNext: body.callNext,
    }),
  );
}

export async function skip(req: Request, res: Response) {
  const { appointmentId } = appointmentParams.parse(req.params);
  const { action } = skipBody.parse(req.body);
  res.json(await service.skip(appointmentId, action));
}

export async function requeue(req: Request, res: Response) {
  const { appointmentId } = appointmentParams.parse(req.params);
  res.json(await service.putBack(appointmentId));
}
