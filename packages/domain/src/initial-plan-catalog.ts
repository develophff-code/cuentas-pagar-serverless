import type { EditablePlanCapabilities, PlanCode, PlanPriceVersion } from './model.js';

/**
 * Valores de carga inicial. La aplicación debe persistirlos en PostgreSQL y
 * administrarlos desde UI/API; no se deben leer como reglas rígidas en runtime.
 */
export const INITIAL_PLAN_CAPABILITIES: Readonly<Record<PlanCode, EditablePlanCapabilities>> = {
  BASIC: {
    maxInvoicesPerMonth: 100,
    maxSuppliers: 25,
    maxActiveUsers: 1,
    maxStorageBytes: 0n,
    monthlyAiQueries: 0,
    dashboardEnabled: false,
    supplierNotificationsEnabled: false,
    webOperationsEnabled: false,
    webAdministrationEnabled: false,
    aiChatEnabled: false,
  },
  PROFESSIONAL: {
    maxInvoicesPerMonth: 300,
    maxSuppliers: 80,
    maxActiveUsers: 3,
    maxStorageBytes: 0n,
    monthlyAiQueries: 0,
    dashboardEnabled: true,
    supplierNotificationsEnabled: true,
    webOperationsEnabled: true,
    webAdministrationEnabled: true,
    aiChatEnabled: false,
  },
  ULTRA: {
    maxInvoicesPerMonth: 500,
    maxSuppliers: 150,
    maxActiveUsers: 5,
    maxStorageBytes: 0n,
    monthlyAiQueries: 0,
    dashboardEnabled: true,
    supplierNotificationsEnabled: true,
    webOperationsEnabled: true,
    webAdministrationEnabled: true,
    aiChatEnabled: true,
  },
};

/** Valores iniciales ARS. La base conserva la versión aceptada en cada orden. */
export const INITIAL_PLAN_PRICES: readonly PlanPriceVersion[] = [
  {
    planCode: 'BASIC',
    amountInCents: 2_800_000n,
    currency: 'ARS',
    validFrom: new Date('2026-09-16T00:00:00.000Z'),
  },
  {
    planCode: 'PROFESSIONAL',
    amountInCents: 8_200_000n,
    currency: 'ARS',
    validFrom: new Date('2026-09-16T00:00:00.000Z'),
  },
  {
    planCode: 'ULTRA',
    amountInCents: 14_400_000n,
    currency: 'ARS',
    validFrom: new Date('2026-09-16T00:00:00.000Z'),
  },
];
