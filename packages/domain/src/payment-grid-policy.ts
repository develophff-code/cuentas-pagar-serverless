import { DomainRuleViolation } from './payment-policy.js';

export interface PaymentGridConfigurationInput {
  timezone: string;
  notificationTime: string;
  lookAheadHours: number;
  enabled: boolean;
  recipientMembershipIds: readonly string[];
}

export function validatePaymentGridConfiguration(input: PaymentGridConfigurationInput): void {
  if (!input.timezone.trim()) throw new DomainRuleViolation('La zona horaria es obligatoria.');
  try {
    Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
  } catch {
    throw new DomainRuleViolation('La zona horaria no es válida.');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.notificationTime)) {
    throw new DomainRuleViolation('notificationTime debe tener formato HH:mm.');
  }
  if (!Number.isInteger(input.lookAheadHours) || input.lookAheadHours < 1 || input.lookAheadHours > 168) {
    throw new DomainRuleViolation('lookAheadHours debe ser un entero entre 1 y 168.');
  }
  const recipients = new Set(input.recipientMembershipIds);
  if (recipients.size !== input.recipientMembershipIds.length || [...recipients].some((id) => !id.trim())) {
    throw new DomainRuleViolation('Los destinatarios deben ser identificadores únicos y válidos.');
  }
}
