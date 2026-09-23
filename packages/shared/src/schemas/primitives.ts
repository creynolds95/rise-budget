import { z } from 'zod';

/** Integer cents. Never floats (SPEC §0). */
export const Cents = z.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export type Cents = z.infer<typeof Cents>;

export const PeriodId = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM');
export type PeriodId = z.infer<typeof PeriodId>;

export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const Id = z.string().min(1).max(64);
export type Id = z.infer<typeof Id>;

/** SQLite stores booleans as 0/1. */
export const SqlBool = z.union([z.literal(0), z.literal(1)]).transform((v) => v === 1);
