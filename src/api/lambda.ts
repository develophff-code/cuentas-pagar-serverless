import { InvoiceService } from '../persistence/invoice-service.js';
import { PaymentBatchService } from '../persistence/payment-batch-service.js';
import { PaymentGridService } from '../persistence/payment-grid-service.js';
import { createPrismaClientFromEnvironment } from '../persistence/prisma-client.js';
import { SupplierService } from '../persistence/supplier-service.js';
import { TenantAuthorizationService } from '../persistence/tenant-authorization-service.js';
import { TenantService } from '../persistence/tenant-service.js';
import { MercadoPagoRuntimeGateway } from '../subscriptions/mercado-pago-runtime-gateway.js';
import { SubscriptionCheckoutService } from '../subscriptions/subscription-checkout-service.js';
import { createHttpHandler } from './http-handler.js';
import type { ApiGatewayRequest, ApiGatewayResponse } from './http-types.js';

const prisma = createPrismaClientFromEnvironment();
const tenantService = new TenantService(prisma);
const authorization = new TenantAuthorizationService(prisma);
const supplierService = new SupplierService(prisma);
const invoiceService = new InvoiceService(prisma);
const paymentBatchService = new PaymentBatchService(prisma);
const paymentGridService = new PaymentGridService(prisma);
const subscriptionCheckoutService = new SubscriptionCheckoutService(prisma, new MercadoPagoRuntimeGateway(), {
  notificationUrl: process.env.MERCADO_PAGO_WEBHOOK_URL ?? '',
  returnBaseUrl: process.env.PUBLIC_APP_BASE_URL ?? '',
});

const handle = createHttpHandler({
  registerWebTenant: (input) => tenantService.registerWebTenant(input),
  authorizeOperational: (cognitoSub, tenantId, allowedRoles) =>
    authorization.authorizeOperational(cognitoSub, tenantId, allowedRoles),
  authorizeBilling: (cognitoSub, tenantId, allowedRoles) =>
    authorization.authorizeBilling(cognitoSub, tenantId, allowedRoles),
  authorizeSubscriptionRenewal: (cognitoSub, tenantId, allowedRoles) =>
    authorization.authorizeSubscriptionRenewal(cognitoSub, tenantId, allowedRoles),
  createSubscriptionCheckout: (actor, planCode, idempotencyKey) =>
    subscriptionCheckoutService.createCheckout(actor, planCode, idempotencyKey),
  createSupplier: (input, actor, idempotencyKey) => supplierService.create(input, actor, { idempotencyKey }),
  createInvoice: (input, actor, options) => invoiceService.create(input, actor, options),
  createPaymentBatch: (input, actorUserId) => paymentBatchService.create(input, actorUserId),
  listPaymentGrid: (actor) => paymentGridService.list(actor),
  updatePaymentGridConfiguration: (actor, input, idempotencyKey) =>
    paymentGridService.updateConfiguration(actor, input, idempotencyKey),
});

export async function handler(event: ApiGatewayRequest): Promise<ApiGatewayResponse> {
  return handle(event);
}
