import { describe, expect, it } from 'vitest';
import { computeTotals, invoiceStatus, type DiscountRule, type InvoiceLine } from '../../src/modules/invoices/invoices.totals';
import { addMonths, ageFromDateOfBirth, clinicDayRange, clinicDayStart, clinicToday, dateOnly } from '../../src/shared/lib/dates';
import { formatTaka, percentOf, takaToPoisha } from '../../src/shared/lib/money';
import { bdPhone } from '../../src/shared/lib/validation';

const line = (lineTotal: number, departmentId: string | null): InvoiceLine => ({
  serviceId: null,
  description: 'x',
  quantity: 1,
  unitPrice: lineTotal,
  lineTotal,
  departmentId,
});
const rule = (planName: string, discountPercent: number, departmentId: string | null): DiscountRule => ({
  membershipId: planName,
  cardNo: `CPD-M-${planName}`,
  planName,
  discountPercent,
  departmentId,
  endDate: new Date(),
});

describe('invoice totals (business rule 3)', () => {
  it('adds lines and applies no discount without a membership', () => {
    expect(computeTotals([line(50000, 'PHY'), line(80000, 'PHY')], [], 0)).toEqual({
      subtotal: 130000,
      memberDiscount: 0,
      memberDiscountNote: null,
      manualDiscount: 0,
      total: 130000,
    });
  });

  it('takes the best plan per line; a department plan only covers its department', () => {
    const t = computeTotals([line(100000, 'PHY'), line(200000, 'DEN')], [rule('Physio Care', 15, 'PHY'), rule('Silver', 10, null)], 0);
    // PHY line: 15% (Physio Care beats Silver), DEN line: 10% (only Silver covers it)
    expect(t.memberDiscount).toBe(15000 + 20000);
    expect(t.memberDiscountNote).toBe('Physio Care 15% · CPD-M-Physio Care, Silver 10% · CPD-M-Silver');
    expect(t.total).toBe(300000 - 35000);
  });

  it('never stacks plans on one line', () => {
    expect(computeTotals([line(100000, 'PHY')], [rule('Gold', 20, null), rule('Silver', 10, null)], 0).memberDiscount).toBe(20000);
  });

  it('rounds the discount down to whole poisha', () => {
    expect(computeTotals([line(333, 'PHY')], [rule('Gold', 20, null)], 0).memberDiscount).toBe(66);
  });

  it('applies the manual discount after the member discount and rejects more than what is left', () => {
    expect(computeTotals([line(10000, 'PHY')], [rule('Gold', 20, null)], 8000).total).toBe(0);
    expect(() => computeTotals([line(10000, 'PHY')], [rule('Gold', 20, null)], 8001)).toThrow(/cannot be more than ৳80/);
  });
});

describe('invoice status (business rule 4)', () => {
  it.each([
    [1000, 0, 'DUE'],
    [1000, 1, 'PARTIAL'],
    [1000, 999, 'PARTIAL'],
    [1000, 1000, 'PAID'],
    [0, 0, 'PAID'],
  ] as const)('total %i, paid %i -> %s', (total, paid, status) => {
    expect(invoiceStatus(total, paid)).toBe(status);
  });
});

describe('money', () => {
  it('converts and formats poisha', () => {
    expect(takaToPoisha(12.34)).toBe(1234); // 12.34 * 100 is 1233.999... in floating point
    expect(takaToPoisha(0.1 + 0.2)).toBe(30);
    expect(formatTaka(125050)).toBe('৳1,250.50');
    expect(formatTaka(1000000000)).toBe('৳1,00,00,000');
    expect(percentOf(999, 10)).toBe(99);
  });
});

describe('clinic dates (Asia/Dhaka, UTC+6)', () => {
  it('a clinic day starts at 18:00 UTC the day before', () => {
    expect(clinicDayStart('2026-10-22').toISOString()).toBe('2026-10-21T18:00:00.000Z');
    expect(clinicDayRange('2026-10-01', '2026-10-31')).toEqual({
      gte: new Date('2026-09-30T18:00:00.000Z'),
      lt: new Date('2026-10-31T18:00:00.000Z'),
    });
  });

  it('"today" rolls over at midnight Dhaka time, not UTC', () => {
    expect(clinicToday(new Date('2026-10-21T17:59:00Z')).toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(clinicToday(new Date('2026-10-21T18:00:00Z')).toISOString()).toBe('2026-10-22T00:00:00.000Z');
  });

  it('adding months clamps to the end of shorter months', () => {
    expect(addMonths(dateOnly('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(dateOnly('2028-01-31'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(addMonths(dateOnly('2026-10-22'), 12).toISOString().slice(0, 10)).toBe('2027-10-22');
  });

  it('age counts whole years', () => {
    expect(ageFromDateOfBirth(dateOnly('1990-10-23'), dateOnly('2026-10-22'))).toBe(35);
    expect(ageFromDateOfBirth(dateOnly('1990-10-22'), dateOnly('2026-10-22'))).toBe(36);
  });
});

describe('phone numbers', () => {
  it.each(['01711000000', '+8801711000000', '8801711000000', '0171-100 0000'])('accepts %s', (input) => {
    expect(bdPhone.parse(input)).toBe('01711000000');
  });
  it.each(['0171100000', '01211000000', '12345678901', 'abc'])('rejects %s', (input) => {
    expect(bdPhone.safeParse(input).success).toBe(false);
  });
});
