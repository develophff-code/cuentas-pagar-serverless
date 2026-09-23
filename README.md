# Cuentas a Pagar Serverless

Base de una SaaS multi-tenant de proveedores y cuentas a pagar, diseñada para AWS serverless. La arquitectura completa está en [PLAN_ARQUITECTURA_AWS_SERVERLESS_CUENTAS_A_PAGAR.md](PLAN_ARQUITECTURA_AWS_SERVERLESS_CUENTAS_A_PAGAR.md).

## Producto

La solución permite administrar proveedores, comprobantes, facturas y pagos completos. Tiene tres planes de suscripción mensual: Básico, Profesional y Ultra.

- **Básico** opera totalmente por WhatsApp.
- **Profesional** y **Ultra** usarán una web autenticada; WhatsApp será un canal auxiliar para captura móvil de comprobantes y notificaciones.
- Los roles previstos son `ADMIN`, `OPERATOR_UPLOAD` y `OPERATOR_PAYMENTS`.
- Mercado Pago Checkout Pro será el medio de suscripción y renovación.
- YCloud será el proveedor productivo de WhatsApp.

## Estado actual

La **Fase A está cerrada** y la implementación de la **Fase B está completa en
código y sintetizada**, pendiente de aprobación de costos y despliegue en
`dev`. La **Fase C comenzó** con el contrato seguro de Mercado Pago, todavía
sin credenciales, URL pública ni tráfico real. El repositorio cuenta con:

- Modelo de dominio y reglas para tenants, planes, membresías, proveedores, facturas y pagos.
- Reglas de autorización: el administrador confirma pagos propuestos por `OPERATOR_PAYMENTS`; `OPERATOR_UPLOAD` no puede confirmar facturas ni pagos.
- Prueba gratuita de siete días, avisos desde el día cinco, bloqueo operativo de siete días y expiración posterior sin borrado automático.
- PostgreSQL local con migraciones, catálogo inicial de planes/categorías y restricciones críticas en la base.
- API HTTP versionada para onboarding, proveedores, facturas, pagos, grilla y
  configuración de alertas; tenant y actor se obtienen de la identidad autorizada.
- Idempotencia para pagos, altas HTTP y configuración de alertas; auditoría de
  proveedores, facturas, pagos y cambios de grilla.
- Fundación AWS de `dev` desplegada en `us-east-1`: KMS, Secrets Manager y presupuesto mensual de USD 20.
- Stack de aplicación preparada: API Gateway REST, webhook YCloud firmado,
  DynamoDB con outbox, SQS FIFO, workers, DLQs, alarmas y logs con retención.
- Stack de datos preparada: VPC aislada, Aurora Serverless v2, RDS Proxy y S3
  privado cifrado. No está desplegada.
- Convenciones de aislamiento para `dev`, `staging` y `prod`.
- Cliente server-side de Checkout Pro y validación HMAC de webhooks de Mercado
  Pago, con pruebas unitarias y sin secretos versionados.

Todavía no hay recursos de Fase B desplegados, Cognito, Mercado Pago, frontend,
dominios nuevos ni tráfico real. El webhook existente de YCloud permanece sin
cambios hasta la migración aprobada.

## Documentación clave

- [Handoff de Fase A e inicio de Fase B](docs/HANDOFF_FASE_A.md)
- [Decisiones de producto confirmadas](docs/FASE_A_DECISIONES.md)
- [Modelo de dominio de Fase A](docs/MODELO_DOMINIO_FASE_A.md)
- [Ambientes y estrategia de despliegue](docs/AMBIENTES_Y_DESPLIEGUE.md)
- [Uso de la base de datos local](database/README.md)
- [Contrato HTTP y webhook de Fase B](docs/API_FASE_B.md)
- [Datos persistentes de Fase B](docs/DATOS_FASE_B.md)
- [Operación, DLQs y backups de Fase B](docs/OPERACION_FASE_B.md)
- [Integración segura de Mercado Pago — Fase C](docs/MERCADO_PAGO_FASE_C.md)

## Requisitos locales

- Node.js 22 o posterior.
- npm.
- PostgreSQL local, sólo para migraciones y pruebas de integración.
- AWS CLI v2 y perfil SSO configurado, sólo si se sintetiza o despliega infraestructura.

Instalación y verificaciones generales:

```powershell
npm install
npm run typecheck
npm test
npm run prisma:generate
npm run cdk:synth
```

## Base de datos local

La base de desarrollo local es `cuentas_pagar_serverless`. Aplicar las migraciones en orden sobre una base nueva, como se explica en [database/README.md](database/README.md):

1. `database/migrations/001_initial_schema.sql`
2. `database/migrations/002_http_command_idempotency.sql`
3. `database/migrations/003_payment_batch_idempotency_fingerprint.sql`
4. `database/migrations/004_http_command_receipts.sql`

Para ejecutar la prueba de integración, se debe proporcionar la conexión sólo durante la sesión actual de PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://postgres:TU_CLAVE@localhost:5432/cuentas_pagar_serverless"
npm run test:integration
Remove-Item Env:DATABASE_URL
```

No guardar contraseñas, URLs de bases de datos, credenciales AWS, secretos de YCloud ni secretos de Mercado Pago en archivos ni en Git. `.env.example` e `infra/deployment.env.example` son únicamente plantillas sin valores reales.

## Ambientes y despliegue

La cuenta AWS actual se usa exclusivamente como `dev` y está en `us-east-1`. `staging` y `prod` deberán utilizar cuentas independientes antes de recibir datos o tráfico reales.

- La rama `develop` se despliega sólo a `dev`.
- La rama `main` se promueve primero a `staging` y luego a `prod` usando el mismo artefacto validado.
- Antes de cualquier despliegue se revisan identidad AWS, `cdk diff`, costos e impacto externo.

Los dominios productivos previstos son `apagar.averiqsj.app` para la web y `apagar.averiqsj.com` para el webhook de YCloud. No deben configurarse aún: no son necesarios para iniciar Fase B.

## Próximo paso

Antes de desplegar Fase B en `dev`, revisar el costo de Aurora, RDS Proxy,
almacenamiento, logs y endpoints privados; ajustar el presupuesto y aprobar el
despliegue. Para completar Fase C faltan las órdenes locales de suscripción, el
webhook idempotente, la configuración de URLs públicas y las pruebas con
credenciales de prueba de Mercado Pago.
