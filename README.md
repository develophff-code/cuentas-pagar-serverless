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

La **Fase A está cerrada**, la Fase B tiene su backend implementado en código
y la **Fase C está en desarrollo**. El primer despliegue se orienta a un MVP
con **dos tenants testigos** y un presupuesto objetivo de **USD 20/mes en AWS**,
incluidos los recursos existentes y con YCloud/WhatsApp por separado.
El acceso por Data API, la pausa automática de Aurora y el despacho por SQS
están preparados en código; falta validarlos contra AWS y el backend de negocio
todavía no está desplegado. El repositorio cuenta con:

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
- Infraestructura expandida preparada: Aurora Serverless v2, RDS Proxy, S3
  privado y salida por NAT opcional. No está desplegada ni aprobada para el MVP.
- Perfil MVP optativo: Aurora de 0 a 1 ACU, pausa tras cinco minutos, Data API,
  Lambdas fuera de VPC y SQS para avisos y reintentos, sin polling cada minuto.
- Adaptador Prisma/Data API con parámetros SQL, decimales, fechas UTC y
  transacciones; pruebas locales con transporte simulado y cliente Prisma real.
- Convenciones de aislamiento para `dev`, `staging` y `prod`.
- Cliente server-side de Checkout Pro y validación HMAC de webhooks de Mercado
  Pago, con pruebas unitarias y sin secretos versionados.
- Órdenes de suscripción idempotentes, conciliación de pagos aprobados, gracia
  de 48 horas, mora y retención de datos por 90 días sin borrado automático.
- Tokens opacos para `/p/{token}`, Checkout de 48 horas y retornos de pago que
  informan al usuario sin activar la suscripción.
- Dispatcher persistente de `notification_intents` para las tres plantillas
  de suscripción de YCloud: reserva concurrente de envíos, reintentos acotados
  y revisión manual de resultados ambiguos.
- Entradas Lambda y stack optativa de negocio con API autenticada por Cognito,
  webhook Mercado Pago, redirección pública y jobs desactivados por defecto.

Las plantillas Utility `subscription_renewal_reminder`,
`subscription_payment_link_v2` y `subscription_payment_confirmed` ya están
activas en YCloud, en Spanish (ARG), código `es_AR`. Falta confirmar sus cuerpos,
variables y botón antes de configurar y activar el dispatcher. El emisor es
`+5492646276709`; la API key se guarda exclusivamente en Secrets Manager.

Todavía faltan el despliegue del backend de negocio, el frontend, la publicación
de los dominios nuevos y las pruebas de compra de Mercado Pago. El webhook
existente de YCloud permanece sin cambios hasta la migración aprobada.

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
- [Backend y condiciones de despliegue de Fase C](docs/DESPLIEGUE_FASE_C.md)
- [MVP de dos tenants y presupuesto AWS de USD 20/mes](docs/MVP_DOS_TENANTS.md)

## Requisitos locales

- Node.js 22 o posterior.
- npm.
- PostgreSQL local, sólo para migraciones y pruebas de integración.
- AWS CLI v2 y perfil SSO configurado para consultar o desplegar recursos AWS.
  La síntesis local no requiere consultar secretos ni crear recursos.

Instalación y verificaciones generales:

```powershell
npm install
npm run prisma:generate
npm run typecheck
npm test
npm run cdk:synth
```

`npm run lambda:package` genera el artefacto Lambda con código compilado y
dependencias de producción. `npm run cdk:synth` lo prepara antes de sintetizar;
ninguno de esos comandos despliega infraestructura.

## Base de datos local

La base de desarrollo local es `cuentas_pagar_serverless`. Aplicar las migraciones en orden sobre una base nueva, como se explica en [database/README.md](database/README.md):

1. `database/migrations/001_initial_schema.sql`
2. `database/migrations/002_http_command_idempotency.sql`
3. `database/migrations/003_payment_batch_idempotency_fingerprint.sql`
4. `database/migrations/004_http_command_receipts.sql`
5. `database/migrations/005_subscription_checkout_idempotency.sql`
6. `database/migrations/006_subscription_lifecycle_policy.sql`
7. `database/migrations/007_subscription_payment_link_tokens.sql`
8. `database/migrations/008_notification_dispatch.sql`

Para ejecutar las pruebas de integración, se debe proporcionar la conexión sólo durante la sesión actual de PowerShell:

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

CDK usa por defecto `infrastructureProfile=mvp`: sin opciones sólo sintetiza
fundación e ingress YCloud, sin la stack de datos expandida ni Proxy/NAT.
Solicitar `enableBusiness=true` prepara las stacks MVP de datos y negocio;
los jobs y el consumidor SQS quedan desactivados. Esto permite revisar la
infraestructura localmente y no confirma un MVP operativo en AWS.
La infraestructura expandida exige selección explícita y conserva pendiente
su aprobación de costos. No usar `cdk deploy --all`.

El presupuesto de USD 20 es un objetivo con alertas, no un límite automático
de consumo. Acordarlo no autoriza a crear recursos: el despliegue requiere
revisar el costo concreto y obtener confirmación del dueño.

Los dominios productivos previstos son `apagar.averiqsj.app` para la web y
`apagar.averiqsj.com` para los webhooks. No se apuntan a una IP de EC2: al
publicarlos usarán CloudFront y API Gateway con certificados ACM. El servicio
legado de `averiq.cloud` conserva su configuración actual hasta la migración
validada.

## Próximo paso

Preparar el runner de migraciones para Data API y completar la validación
de aislamiento, idempotencia y transacciones contra Aurora. Revisar el costo
total de los dos tenants testigos y pedir aprobación antes de desplegar.

Después de aprobar el despliegue, publicar `/p/{token}` bajo
`apagar.averiqsj.app`, configurar el webhook Mercado Pago, completar el contrato
de las plantillas YCloud y ejecutar las pruebas de compra y notificaciones.
