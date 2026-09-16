import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { MembershipRole, SupplierInput } from '../../packages/domain/src/model.js';
import { DomainRuleViolation, validateSupplier } from '../../packages/domain/src/payment-policy.js';

export interface BankAccountProtector {
  encrypt(plainText: string): Promise<Uint8Array<ArrayBuffer>>;
}

export interface SupplierActor {
  tenantId: string;
  userId: string;
  role: MembershipRole;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function canManageSuppliers(role: MembershipRole): boolean {
  return role === 'ADMIN' || role === 'OPERATOR_UPLOAD';
}

export class SupplierService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly bankAccountProtector?: BankAccountProtector,
  ) {}

  async create(input: SupplierInput, actor: SupplierActor): Promise<{ id: string }> {
    validateSupplier(input);
    if (!canManageSuppliers(actor.role)) {
      throw new DomainRuleViolation('El rol no puede crear proveedores.');
    }

    const categoryCode = optionalTrimmed(input.categoryCode);
    if (categoryCode !== undefined) {
      const category = await this.prisma.categories.findUnique({ where: { code: categoryCode } });
      if (category === null || !category.is_active) {
        throw new DomainRuleViolation('La categoría indicada no está disponible.');
      }
    }

    const accountValue = optionalTrimmed(input.cbuCvuOrAlias);
    if (accountValue !== undefined && this.bankAccountProtector === undefined) {
      throw new DomainRuleViolation(
        'No se puede guardar CBU/CVU/alias sin un protector de datos configurado.',
      );
    }

    const encryptedAccountValue = accountValue === undefined
      ? undefined
      : await this.bankAccountProtector!.encrypt(accountValue);
    const data: Prisma.suppliersUncheckedCreateInput = {
      tenant_id: actor.tenantId,
      business_name: input.businessName.trim(),
      mobile_phone: input.mobilePhone.trim(),
      created_by_user_id: actor.userId,
    };
    const cuit = optionalTrimmed(input.cuit);
    const address = optionalTrimmed(input.address);
    if (cuit !== undefined) data.cuit = cuit;
    if (address !== undefined) data.address = address;
    if (categoryCode !== undefined) data.category_code = categoryCode;
    if (encryptedAccountValue !== undefined) {
      data.supplier_bank_accounts = {
        create: {
          encrypted_account_value: encryptedAccountValue,
          account_value_last4: accountValue!.slice(-4),
        },
      };
    }

    const supplier = await this.prisma.suppliers.create({ data });

    return { id: supplier.id };
  }
}
