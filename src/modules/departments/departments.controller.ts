import type { Request, Response } from 'express';
import { idParams } from '../../shared/lib/validation';
import { createDepartmentBody, listDepartmentsQuery, updateDepartmentBody } from './departments.schema';
import * as service from './departments.service';

export async function list(req: Request, res: Response) {
  const { includeInactive } = listDepartmentsQuery.parse(req.query);
  res.json(await service.listDepartments(includeInactive));
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getDepartment(id));
}

export async function create(req: Request, res: Response) {
  const body = createDepartmentBody.parse(req.body);
  res.status(201).json(await service.createDepartment(body));
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = updateDepartmentBody.parse(req.body);
  res.json(await service.updateDepartment(id, body));
}
