import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';
import type { MembershipRole, PlanCode } from '../../packages/domain/src/model.js';
import type { InvoiceActor } from '../persistence/invoice-service.js';
import type { PaymentBatchResult } from '../persistence/payment-batch-service.js';
import type { SupplierActor } from '../persistence/supplier-service.js';
import type { ApiGatewayRequest, ApiGatewayResponse } from './http-types.js';

export interface AuthenticatedActor {
  tenantId: string;
  userId: string;
  role: MembershipRole;
}

export interface ApiDependencies {
  registerWebTenant(input: {
    businessName: string;
    cuit?: string;
    planCode: Exclude<PlanCode, 'BASIC'>;
    administrator: { cognitoSub: string; email: string; fullName?: string };
  }): Promise<{ tenantId: string; adminUserId: string }>;
  authorizeOperational(
    cognitoSub: string,
    tenantId: string,
    allowedRoles: readonly MembershipRole[],
  ): Promise<AuthenticatedActor>;
  createSupplier(input: {
    businessName: string;
    mobilePhone: string;
    cuit?: string;
    address?: string;
    cbuCvuOrAlias?: string;
    categoryCode?: string;
  }, actor: SupplierActor, idempotencyKey: string): Promise<{ id: string; idempotent: boolean }>;
  createInvoice(input: {
    tenantId: string;
    supplierId: string;
    invoiceType: 'A' | 'C' | 'INFORMAL';
    invoiceNumber?: string;
    description?: string;
    amountInCents: bigint;
    issueDate?: Date;
    dueDate: Date;
    scheduledPaymentDate?: Date;
  }, actor: InvoiceActor, options: { confirmImmediately: boolean; idempotencyKey: string }): Promise<{
    id: string;
    status: 'PENDING_REVIEW' | 'IN_GRID';
    idempotent: boolean;
  }>;
  createPaymentBatch(input: {
    tenantId: string;
    invoiceIds: readonly string[];
    requestedByRole: MembershipRole;
    idempotencyKey: string;
  }, actorUserId: string): Promise<PaymentBatchResult>;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

function response(statusCode: number, payload: object): ApiGatewayResponse {
  return { statusCode, headers: jsonHeaders, body: JSON.stringify(payload) };
}

function header(request: ApiGatewayRequest, name: string): string | undefined {
  const expected = name.toLowerCase();
  return Object.entries(request.headers ?? {}).find(([key]) => key.toLowerCase() === expected)?.[1];
}

function requiredIdempotencyKey(request: ApiGatewayRequest): string {
  const key = header(request, 'idempotency-key')?.trim();
  if (!key) throw new DomainRuleViolation('Idempotency-Key es obligatoria para operaciones mutables.');
  return key;
}

function authenticatedIdentity(request: ApiGatewayRequest): { sub: string; email: string; fullName?: string } {
  const claims = request.requestContext?.authorizer?.claims;
  const sub = claims?.sub?.trim();
  const email = claims?.email?.trim();
  if (!sub || !email) throw new DomainRuleViolation('La solicitud requiere un JWT Cognito válido con sub y email.');
  const fullName = claims?.name?.trim();
  return { sub, email, ...(fullName ? { fullName } : {}) };
}

function tenantId(request: ApiGatewayRequest): string {
  const id = request.pathParameters?.tenantId?.trim();
  if (!id) throw new DomainRuleViolation('El tenant de la ruta es obligatorio.');
  return id;
}

function body(request: ApiGatewayRequest): Record<string, unknown> {
  if (!request.body) throw new DomainRuleViolation('El cuerpo JSON es obligatorio.');
  try {
    const parsed: unknown = JSON.parse(request.body);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new DomainRuleViolation('El cuerpo debe ser JSON válido.');
  }
}

function stringValue(payload: Record<string, unknown>, name: string, required = false): string | undefined {
  const value = payload[name];
  if (value === undefined || value === null) {
    if (required) throw new DomainRuleViolation(`${name} es obligatorio.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new DomainRuleViolation(`${name} debe ser texto.`);
  return value;
}

function dateValue(payload: Record<string, unknown>, name: string, required = false): Date | undefined {
  const value = stringValue(payload, name, required);
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new DomainRuleViolation(`${name} debe ser una fecha ISO válida.`);
  return parsed;
}

function centsValue(payload: Record<string, unknown>): bigint {
  const value = payload.amountInCents;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new DomainRuleViolation('amountInCents es obligatorio y debe ser un entero.');
  }
  try {
    return BigInt(value);
  } catch {
    throw new DomainRuleViolation('amountInCents debe ser un entero válido.');
  }
}

export function createHttpHandler(dependencies: ApiDependencies) {
  return async (request: ApiGatewayRequest): Promise<ApiGatewayResponse> => {
    try {
      const payload = body(request);
      if (request.httpMethod === 'POST' && request.path === '/v1/onboarding/web') {
        const identity = authenticatedIdentity(request);
        const planCode = stringValue(payload, 'planCode', true);
        if (planCode !== 'PROFESSIONAL' && planCode !== 'ULTRA') {
          throw new DomainRuleViolation('El onboarding web sólo admite los planes PROFESSIONAL o ULTRA.');
        }
        const result = await dependencies.registerWebTenant({
          businessName: stringValue(payload, 'businessName', true)!,
          planCode,
          ...optionalFields({ cuit: stringValue(payload, 'cuit') }),
          administrator: {
            cognitoSub: identity.sub,
            email: identity.email,
            ...(identity.fullName === undefined ? {} : { fullName: identity.fullName }),
          },
        });
        return response(201, result);
      }

      const requestTenantId = tenantId(request);
      const identity = authenticatedIdentity(request);
      const idempotencyKey = requiredIdempotencyKey(request);

      if (request.httpMethod === 'POST' && request.path.endsWith('/suppliers')) {
        const actor = await dependencies.authorizeOperational(identity.sub, requestTenantId, ['ADMIN', 'OPERATOR_UPLOAD']);
        const result = await dependencies.createSupplier({
          businessName: stringValue(payload, 'businessName', true)!,
          mobilePhone: stringValue(payload, 'mobilePhone', true)!,
          ...optionalFields({
            cuit: stringValue(payload, 'cuit'), address: stringValue(payload, 'address'),
            cbuCvuOrAlias: stringValue(payload, 'cbuCvuOrAlias'), categoryCode: stringValue(payload, 'categoryCode'),
          }),
        }, actor, idempotencyKey);
        return response(result.idempotent ? 200 : 201, result);
      }

      if (request.httpMethod === 'POST' && request.path.endsWith('/invoices')) {
        const actor = await dependencies.authorizeOperational(identity.sub, requestTenantId, ['ADMIN', 'OPERATOR_UPLOAD']);
        const invoiceType = stringValue(payload, 'invoiceType', true);
        if (invoiceType !== 'A' && invoiceType !== 'C' && invoiceType !== 'INFORMAL') {
          throw new DomainRuleViolation('invoiceType debe ser A, C o INFORMAL.');
        }
        const confirmImmediately = payload.confirmImmediately === true;
        const result = await dependencies.createInvoice({
          tenantId: requestTenantId, supplierId: stringValue(payload, 'supplierId', true)!, invoiceType,
          amountInCents: centsValue(payload), dueDate: dateValue(payload, 'dueDate', true)!,
          ...optionalFields({
            invoiceNumber: stringValue(payload, 'invoiceNumber'), description: stringValue(payload, 'description'),
            issueDate: dateValue(payload, 'issueDate'), scheduledPaymentDate: dateValue(payload, 'scheduledPaymentDate'),
          }),
        }, actor, { confirmImmediately, idempotencyKey });
        return response(result.idempotent ? 200 : 201, result);
      }

      if (request.httpMethod === 'POST' && request.path.endsWith('/payment-batches')) {
        const actor = await dependencies.authorizeOperational(identity.sub, requestTenantId, ['ADMIN', 'OPERATOR_PAYMENTS']);
        if (!Array.isArray(payload.invoiceIds) || !payload.invoiceIds.every((id) => typeof id === 'string')) {
          throw new DomainRuleViolation('invoiceIds debe ser un arreglo de identificadores.');
        }
        const result = await dependencies.createPaymentBatch({
          tenantId: requestTenantId, invoiceIds: payload.invoiceIds, requestedByRole: actor.role, idempotencyKey,
        }, actor.userId);
        return response(result.idempotent ? 200 : 201, { ...result, totalInCents: result.totalInCents.toString() });
      }

      return response(404, { error: 'NOT_FOUND', message: 'Ruta no encontrada.' });
    } catch (error) {
      if (error instanceof DomainRuleViolation) return response(400, { error: 'DOMAIN_RULE_VIOLATION', message: error.message });
      return response(500, { error: 'INTERNAL_ERROR', message: 'Error interno inesperado.' });
    }
  };
}

function optionalFields<T extends Record<string, unknown>>(fields: T): {
  [K in keyof T]?: Exclude<T[K], undefined>;
} {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
