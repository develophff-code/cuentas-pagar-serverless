# Modelo de dominio — Fase A

## Límites del dominio

La identidad (`ApplicationUser`) no es la pertenencia a una empresa (`TenantMembership`). Una misma persona puede participar en más de un tenant con roles diferentes.

```text
ApplicationUser ──< TenantMembership >── Tenant
Tenant ──< Supplier ──< Invoice
Tenant ──< PaymentBatch ──< PaymentItem >── Invoice
Tenant ──< SubscriptionOrder ──< Subscription
```

## Estados iniciales

| Entidad | Estados |
|---|---|
| Tenant | `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELED` |
| Factura | `DRAFT`, `PENDING_REVIEW`, `IN_GRID`, `PAYMENT_PROPOSED`, `PAID`, `CANCELED` |
| Pago | `DRAFT`, `PENDING_APPROVAL`, `RECORDED`, `REVERSED` |
| Orden de suscripción | `PENDING`, `PAID`, `FAILED`, `EXPIRED` |

## Invariantes

1. Razón social y celular son obligatorios para un proveedor; CUIT, domicilio y CBU/CVU no.
2. Toda factura y pago pertenece a un único tenant.
3. Sólo una operación de pago registrada puede contener una factura activa.
4. La suma de un pago por factura es siempre el importe completo de la factura.
5. Una factura cancelada no puede pagarse.
6. Un `OPERADOR_CARGA` no puede confirmar facturas, registrar pagos ni administrar el tenant.
7. El estado de prueba termina a los siete días; una orden de Checkout Pro confirmada habilita el período mensual correspondiente.
8. Precios y capacidades vigentes se consultan desde datos administrables, no constantes de código. La grilla recibida aporta límites iniciales, pero no define las capacidades del producto actual.
9. Básico es WhatsApp-only. Profesional y Ultra requieren identidad web y membresías con rol; Ultra agrega IA y controles avanzados.
