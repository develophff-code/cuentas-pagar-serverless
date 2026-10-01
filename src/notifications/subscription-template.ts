import type { YCloudTemplateMessage } from './ycloud-client.js';

export const subscriptionTemplateNames = {
  SUBSCRIPTION_RENEWAL_REMINDER: 'subscription_renewal_reminder',
  SUBSCRIPTION_PAYMENT_LINK: 'subscription_payment_link_v2',
  SUBSCRIPTION_PAYMENT_CONFIRMED: 'subscription_payment_confirmed',
} as const;
export type SubscriptionIntentType = keyof typeof subscriptionTemplateNames;
export type TemplateValue = 'businessName' | 'planName' | 'endsAt' | 'amount' | 'expiresAt';
export type TemplateBindings = Record<SubscriptionIntentType, {
  languageCode: string;
  body: TemplateValue[];
  button?: { index: 0; prefix: string };
}>;

/** Configuración pública del contrato de plantillas; no contiene credenciales. */
export function parseTemplateBindings(raw: string | undefined): TemplateBindings {
  if (!raw) throw new Error('YCLOUD_SUBSCRIPTION_TEMPLATE_BINDINGS es obligatoria.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Contrato de plantillas inválido.'); }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Contrato de plantillas inválido.');
  const bindings = parsed as TemplateBindings;
  const allowed = ['businessName', 'planName', 'endsAt', 'amount', 'expiresAt'];
  for (const type of Object.keys(subscriptionTemplateNames) as SubscriptionIntentType[]) {
    const binding = bindings[type];
    if (!binding || typeof binding.languageCode !== 'string' || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(binding.languageCode)
      || !Array.isArray(binding.body) || !binding.body.every((value) => allowed.includes(value))
      || (type === 'SUBSCRIPTION_PAYMENT_LINK'
        ? !binding.button || binding.button.index !== 0 || !['', 'p/'].includes(binding.button.prefix)
        : binding.button !== undefined)) throw new Error('Contrato de plantillas inválido.');
  }
  return bindings;
}

export function buildSubscriptionTemplate(input: {
  type: SubscriptionIntentType;
  senderPhone: string;
  recipientPhone: string;
  externalId: string;
  values: Partial<Record<TemplateValue, string>>;
  paymentLinkToken?: string;
}, bindings: TemplateBindings): YCloudTemplateMessage {
  const binding = bindings[input.type];
  const parameters = binding.body.map((key) => {
    const text = input.values[key];
    if (!text) throw new Error('TEMPLATE_VALUE_MISSING');
    return { type: 'text' as const, text };
  });
  const components: YCloudTemplateMessage['components'] = parameters.length ? [{ type: 'body', parameters }] : [];
  if (binding.button) {
    if (!input.paymentLinkToken || !/^[A-Za-z0-9_-]{43}$/.test(input.paymentLinkToken)) throw new Error('PAYMENT_TOKEN_INVALID');
    components.push({ type: 'button', sub_type: 'url', index: binding.button.index,
      parameters: [{ type: 'text', text: `${binding.button.prefix}${input.paymentLinkToken}` }] });
  }
  return { from: input.senderPhone, to: input.recipientPhone, externalId: input.externalId,
    languageCode: binding.languageCode, templateName: subscriptionTemplateNames[input.type], components };
}
