# Handoff — cierre de Fase A

Fecha de cierre: 2026-09-18.

Este documento es el punto de partida para continuar el proyecto en un chat nuevo. Describe el estado real del repositorio y de `dev`; no autoriza a tratarlo como una aplicación productiva.

## Resultado de la Fase A

La Fase A dejó definidas y verificadas las fundaciones del producto: modelo de negocio, reglas de dominio, esquema PostgreSQL local, servicios de persistencia iniciales y una base segura de infraestructura en AWS para `dev`.

| Área | Estado | Evidencia principal |
|---|---|---|
| Reglas de planes, roles, facturas y pagos | Implementada y probada | `packages/domain/src/` |
| Ciclo de prueba, bloqueo y expiración | Implementado y probado | `packages/domain/src/tenant-access-policy.ts` |
| Esquema PostgreSQL y catálogos iniciales | Aplicado localmente | `database/migrations/001_initial_schema.sql` |
| Idempotencia de pagos y de altas HTTP | Implementada y probada contra PostgreSQL local | migración `002` y `tests/integration/postgres-idempotency.test.ts` |
| Fundación AWS de desarrollo | Desplegada en `us-east-1` | stack `CuentasPagarFoundation-dev` |
| Ambientes y promoción | Definidos; sólo `dev` existe | `docs/AMBIENTES_Y_DESPLIEGUE.md` |

## Estado de AWS

- La cuenta AWS configurada mediante IAM Identity Center (SSO) se usa exclusivamente para `dev`.
- La región objetivo es `us-east-1`.
- La stack `CuentasPagarFoundation-dev` está desplegada. Incluye una clave KMS con rotación, un secreto de runtime en Secrets Manager y un presupuesto mensual de desarrollo de USD 20.
- El presupuesto alerta al 80 % de gasto real y al 100 % de gasto proyectado; no corta automáticamente los recursos.
- `staging` y `prod` no existen todavía y deberán tener cuentas AWS independientes antes de recibir datos o tráfico reales.

No hay aún Lambdas de negocio, API Gateway, Cognito, Aurora/RDS, S3, SQS, EventBridge, CloudFront ni una aplicación web desplegados.

## Decisiones funcionales vigentes

- Hay tres planes: Básico, Profesional y Ultra. Los valores iniciales mensuales son ARS 28.000, ARS 82.000 y ARS 144.000.
- Básico opera sólo por WhatsApp. Profesional y Ultra operan principalmente desde web autenticada; WhatsApp queda para ingesta móvil y notificaciones.
- La prueba es de siete días. Desde el día cinco se avisa; al finalizar hay siete días de bloqueo operativo con acceso a renovación. Luego el acceso expira, sin borrado automático de datos hasta resolver la política legal.
- Roles para Profesional y Ultra: `ADMIN`, `OPERATOR_UPLOAD` y `OPERATOR_PAYMENTS`. Sólo el administrador confirma pagos propuestos por operador.
- No existen pagos parciales: una factura se cancela íntegramente en una operación de pago.
- Mercado Pago Checkout Pro será la vía de suscripción y renovación mensual.
- YCloud es el proveedor de WhatsApp de producción. WAHA corresponde a la versión anterior y no debe reincorporarse.

El detalle completo y las decisiones pendientes están en [FASE_A_DECISIONES.md](FASE_A_DECISIONES.md).

## Datos, seguridad e idempotencia

- La base local se llama `cuentas_pagar_serverless`; sus credenciales no se versionan ni deben incluirse en mensajes, documentación o código.
- La migración `001` crea el modelo relacional y carga el catálogo inicial. La migración `002` agrega claves y huellas de idempotencia para proveedores y facturas.
- Los servicios de altas y pagos están en `src/persistence/`. Las invariantes relevantes también viven en PostgreSQL; Prisma no las reemplaza.
- Las claves de idempotencia se asocian al tenant, se guardan como una huella SHA-256 y rechazan reutilización del mismo identificador con un payload distinto.
- Las pruebas de integración crean datos temporales y los eliminan al terminar.

Para ejecutar la integración se provee temporalmente `DATABASE_URL` en PowerShell, se corre `npm run test:integration` y se elimina la variable al final. Nunca se escribe una contraseña real en archivos del repositorio.

## Dominios previstos

- Web de producción: `https://apagar.averiqsj.app`.
- Webhook YCloud de producción: `https://apagar.averiqsj.com`.
- El webhook actual `https://apagar.averiq.cloud` se conserva hasta validar la migración y se usa como rollback temporal.
- Hostinger administra DNS. Cuando llegue el momento, CloudFront/API Gateway requerirán CNAME y la validación ACM también se hará con CNAME; no se usarán IP fijas con registros A.

Los dominios no son un prerrequisito de la siguiente fase y no se debe crear DNS ni cambiar YCloud todavía.

## Verificación local conocida

Desde la raíz del repositorio:

```powershell
npm install
npm run typecheck
npm test
npm run prisma:generate
npm run cdk:synth
```

El cierre de Fase A verificó `npm test` correctamente: 16 pruebas aprobadas. La integración PostgreSQL se ejecutó correctamente de forma separada mediante `npm run test:integration` con una conexión local efímera.

## Trabajo inicial de Fase B

La prioridad recomendada es construir el primer vertical operativo de backend, antes de interfaz web o integración de WhatsApp:

1. Definir las APIs HTTP versionadas y su contrato de autenticación/autorización por tenant.
2. Crear infraestructura de aplicación para `dev`: API Gateway, Lambdas y permisos IAM mínimos, conectados de forma segura a PostgreSQL/Aurora cuando se defina su provisión.
3. Implementar endpoints de onboarding, proveedores, facturas y propuesta/confirmación de pagos, reutilizando servicios de dominio y persistencia existentes.
4. Propagar `tenant_id`, actor y `idempotency_key` obligatoriamente en los comandos mutables; registrar auditoría y respuestas repetibles.
5. Incorporar pruebas de integración HTTP y autorización antes de integrar Cognito, WhatsApp, Mercado Pago o frontend.

Antes de provisionar Aurora, NAT Gateway, RDS Proxy, WAF u otros recursos de costo significativo, revisar el estimado y confirmar el cambio de presupuesto de `dev` con el dueño del proyecto.

## Pendientes que requieren definición del dueño

- Límite de almacenamiento por plan y límites de consultas IA para Ultra.
- Frecuencia, texto y canales definitivos de los avisos del período de prueba.
- Política legal de conservación, exportación y eliminación de datos tras `ACCESS_EXPIRED`.

## Cómo retomar en un chat nuevo

Usar este mensaje inicial:

> Continuemos el proyecto Cuentas a Pagar Serverless desde Fase B. Lee `docs/HANDOFF_FASE_A.md`, trabaja en la rama `develop` y no hagas commits ni push: yo los haré manualmente. Empecemos por el primer vertical de API seguro para `dev`.

Antes de modificar archivos, comprobar que se está en la copia de trabajo de `develop` dentro de OneDrive; no trabajar en `C:\Dev\cuentas-pagar-serverless-main`, que sólo se usa para consultar `main` y evitar bloqueos de OneDrive al alternar ramas.
