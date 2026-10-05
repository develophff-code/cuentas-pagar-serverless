# Migraciones del MVP por Data API

Estado al 2026-10-05: runner implementado y probado localmente con transporte
simulado. No se ejecutó contra AWS ni se creó Aurora; la autorización de costos
sigue pendiente.

## Plan local

Desde la raíz del repositorio:

```powershell
npm run db:migrations:plan
```

Valida y muestra `001`–`008`, cantidad de sentencias y SHA-256. No consulta AWS,
no requiere credenciales y no determina qué archivos están aplicados en una
base. Normaliza BOM y saltos de línea para conservar la huella entre Windows
y Linux. Mantiene los cuerpos PL/pgSQL completos. Sin opciones también muestra
el plan; nunca aplica por defecto.

## Aplicación después de aprobar recursos y costos

Ejecutar manualmente desde una sesión controlada con AWS SSO, una vez
desplegada la base MVP autorizada. No es una Lambda, no corre al inicializar
la aplicación ni durante la síntesis o despliegue CDK.

Usar los outputs `DatabaseClusterArn` y `DatabaseCredentialsSecretArn` de
`CuentasPagarMvpData-dev`. Las variables temporales contienen ARNs, no claves:

```powershell
# Sólo después de la aprobación y de verificar la identidad AWS:
$env:DEPLOYMENT_STAGE = 'dev'
$env:DATABASE_NAME = 'cuentas_pagar'
$env:DATABASE_CLUSTER_ARN = '<ARN-del-cluster-MVP-autorizado>'
$env:DATABASE_CREDENTIALS_SECRET_ARN = '<ARN-de-mvp-database-credentials>'
try {
  npm run db:migrations:apply
  if ($LASTEXITCODE -ne 0) { throw 'La migración se detuvo; revisar el código de error.' }
} finally {
  Remove-Item Env:DEPLOYMENT_STAGE, Env:DATABASE_NAME, Env:DATABASE_CLUSTER_ARN, Env:DATABASE_CREDENTIALS_SECRET_ARN -ErrorAction SilentlyContinue
}
```

Sólo admite `dev`, región `us-east-1`, base `cuentas_pagar` y el secreto
`cuentas-pagar/dev/mvp-database-credentials` de la misma cuenta que el cluster.
Rechaza `runtime-config` y no lee la API key YCloud. El SDK envía los ARNs a
Data API; no trae la contraseña a este proceso.

El operador necesita `rds-data:ExecuteStatement`, `BeginTransaction`,
`CommitTransaction` y `RollbackTransaction` sobre el cluster, y
`secretsmanager:GetSecretValue` sobre el secreto de la base. No usar permisos
sobre runtime-config para migrar. Con claves KMS propias puede necesitarse
`kms:Decrypt`; el secreto de base MVP usa cifrado administrado.

## Transacciones y recuperación

- Una transacción remota por archivo; el SDK reemplaza sus `BEGIN` y `COMMIT`.
  Cada sentencia lleva el mismo ID de transacción.
- Un advisory lock de transacción impide aplicar simultáneamente. Si está
  ocupado, falla sin esperar ni reintentar automáticamente el lote.
- `public.cuentas_pagar_schema_migrations` registra ID, nombre, SHA-256 y fecha.
  DDL y recibo se confirman juntos. Otro run omite los archivos registrados.
- El historial debe ser un prefijo consecutivo de los archivos locales.
  Huellas/nombres distintos, huecos o recibos desconocidos detienen el runner
  antes del DDL de dominio. No editar archivos aplicados: agregar otro consecutivo.
- Si existen tablas del producto sin recibos, devuelve
  `MIGRATION_UNMANAGED_SCHEMA`. No inventa una línea base ni reaplica a ciegas.
  La base local migrada con psql no necesita pasar por este runner.
- Ante un fallo previo al commit intenta rollback y detiene el lote. Las
  migraciones anteriores confirmadas conservan sus recibos.
- `MIGRATION_COMMIT_UNKNOWN`: puede haberse aplicado DDL y recibo aunque se
  perdiera la respuesta. No repite SQL en ese run. La próxima ejecución verifica
  los recibos bajo lock; si la transacción sigue abierta, el lock puede continuar
  ocupado. Esperar su resolución antes de retomar.
- `MIGRATION_ROLLBACK_UNKNOWN`: resolver la transacción o esperar su expiración
  antes de retomar. No borrar recibos para forzar una reaplicación.

Cada sentencia tiene un límite de 40 segundos y la espera de locks de 5
segundos. No continúa DDL después del timeout ni reintenta escrituras ambiguas.
El transporte sólo reintenta la excepción explícita de base en reanudación.
Los errores muestran código, migración y posición, sin SQL, valores, mensajes
del proveedor ni stacks.

Admite las migraciones transaccionales actuales. Rechaza instrucciones psql,
COPY, controles de transacción internos e índices concurrentes. No es un parser
general de SQL ni una herramienta para cambios no transaccionales.

Referencias: [ExecuteStatement](https://docs.aws.amazon.com/rdsdataservice/latest/APIReference/API_ExecuteStatement.html),
[BeginTransaction](https://docs.aws.amazon.com/rdsdataservice/latest/APIReference/API_BeginTransaction.html)
y [CommitTransaction](https://docs.aws.amazon.com/rdsdataservice/latest/APIReference/API_CommitTransaction.html).

## Validación pendiente

Las pruebas locales cubren archivos reales, rollback, recuperación por recibos,
bloqueo concurrente y cambios de historial. Falta validar contra Aurora los
permisos, pgcrypto, triggers, restricciones, aislamiento por tenant y reanudación.
Estas pruebas no son evidencia de una migración efectuada en AWS.
