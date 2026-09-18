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

La **Fase A está cerrada**. El repositorio ya cuenta con:

- Modelo de dominio y reglas para tenants, planes, membresías, proveedores, facturas y pagos.
- Reglas de autorización: el administrador confirma pagos propuestos por `OPERATOR_PAYMENTS`; `OPERATOR_UPLOAD` no puede confirmar facturas ni pagos.
- Prueba gratuita de siete días, avisos desde el día cinco, bloqueo operativo de siete días y expiración posterior sin borrado automático.
- PostgreSQL local con migraciones, catálogo inicial de planes/categorías y restricciones críticas en la base.
- Idempotencia para pagos y para altas HTTP de proveedores y facturas.
- Fundación AWS de `dev` desplegada en `us-east-1`: KMS, Secrets Manager y presupuesto mensual de USD 20.
- Convenciones de aislamiento para `dev`, `staging` y `prod`.

Todavía no hay API pública, Lambdas de negocio, Cognito, Aurora, colas, integración con YCloud/Mercado Pago ni frontend desplegados. Ése es el trabajo de las fases posteriores.

## Documentación clave

- [Handoff de Fase A e inicio de Fase B](docs/HANDOFF_FASE_A.md)
- [Decisiones de producto confirmadas](docs/FASE_A_DECISIONES.md)
- [Modelo de dominio de Fase A](docs/MODELO_DOMINIO_FASE_A.md)
- [Ambientes y estrategia de despliegue](docs/AMBIENTES_Y_DESPLIEGUE.md)
- [Uso de la base de datos local](database/README.md)

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

Fase B comienza por el primer vertical seguro de backend para `dev`: contrato HTTP, autenticación y autorización por tenant, infraestructura mínima de API/Lambda e implementación de endpoints de onboarding, proveedores, facturas y pagos. El detalle y los límites de ese arranque están en el [handoff de Fase A](docs/HANDOFF_FASE_A.md).
