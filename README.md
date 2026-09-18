# Cuentas a Pagar Serverless

Base de implementación de la arquitectura AWS serverless definida en `PLAN_ARQUITECTURA_AWS_SERVERLESS_CUENTAS_A_PAGAR.md`.

## Estado actual

Se completó la base de la Fase A:

- Modelo de dominio para tenants, planes, suscripciones, proveedores, comprobantes, facturas y pagos.
- Reglas de roles: `ADMIN`, `OPERATOR_UPLOAD` y `OPERATOR_PAYMENTS`.
- Prueba gratuita de siete días, aviso desde el día cinco, bloqueo operativo por siete días y expiración posterior sin borrado automático de datos.
- Esquema PostgreSQL local con las invariantes críticas en la base, incluida la idempotencia de pagos y el pago total de cada factura.
- Catálogo inicial editable de planes, precios ARS y categorías.
- Fundación `dev` desplegada en `us-east-1`: bootstrap CDK, KMS, Secrets Manager y presupuesto mensual de USD 20.
- Convenciones de aislamiento para `dev`, `staging` y `prod` documentadas antes de crear recursos de negocio.

Los precios y límites se cargan como versiones iniciales en PostgreSQL y deberán administrarse desde la aplicación, no modificando el código.

## Comandos

```powershell
npm install
npm run typecheck
npm test
npm run prisma:generate
npm run cdk:synth
```

La migración local inicial está documentada en [database/README.md](database/README.md).
La estrategia de ambientes y despliegue está en [docs/AMBIENTES_Y_DESPLIEGUE.md](docs/AMBIENTES_Y_DESPLIEGUE.md).

Para regenerar el acceso tipado a la base, sin guardar contraseñas ni código generado en Git:

```powershell
$env:DATABASE_URL = "postgresql://postgres:TU_CLAVE@localhost:5432/cuentas_pagar_serverless"
npm run prisma:generate
Remove-Item Env:DATABASE_URL
```

Las restricciones críticas permanecen en PostgreSQL, incluido el importe total de cada factura al pagarla; el ORM no reemplaza las migraciones SQL.

## Seguridad de configuración

No subir `.env`, claves de PostgreSQL, credenciales AWS, credenciales de YCloud ni secretos de Mercado Pago. Usar `.env.example` sólo como plantilla local; en AWS los secretos se inyectarán desde AWS Secrets Manager.
