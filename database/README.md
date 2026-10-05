# Base de datos local

La migración `migrations/001_initial_schema.sql` crea el esquema inicial de PostgreSQL para Cuentas a Pagar Serverless y carga:

- planes Básico, Profesional y Ultra;
- límites iniciales de facturas, proveedores y usuarios;
- precios mensuales ARS 28.000, ARS 82.000 y ARS 144.000;
- las diez categorías de proveedores;
- las tablas de identidad, tenants, suscripciones, proveedores, documentos, facturas, pagos, alertas, webhooks y auditoría.

Las migraciones posteriores se aplican en orden: `002` agrega las claves y
huellas de idempotencia de proveedores y facturas; `003` agrega la huella para
los lotes de pago. Nunca se salta ni se reaplica una migración ya registrada.

La Fase C también requiere `004` (recibos HTTP), `005` (idempotencia Checkout),
`006` (mora/retención), `007` (tokens de enlace) y `008` (dispatcher de avisos).
Aplicarlas en ese orden después de `003`. La migración `008` agrega reservas y
estados de despacho a `outbound_messages`; no envía mensajes ni lee secretos.

## Aplicación local

La migración se aplica una sola vez sobre una base nueva. No contiene contraseñas.

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -p 5432 -U postgres -d cuentas_pagar_serverless -v ON_ERROR_STOP=1 -f database\migrations\001_initial_schema.sql
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -p 5432 -U postgres -d cuentas_pagar_serverless -v ON_ERROR_STOP=1 -f database\migrations\002_http_command_idempotency.sql
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -p 5432 -U postgres -d cuentas_pagar_serverless -v ON_ERROR_STOP=1 -f database\migrations\003_payment_batch_idempotency_fingerprint.sql
```

PostgreSQL solicitará la contraseña de forma interactiva. Para una instalación distinta, reemplazar la ruta a `psql.exe` por la correspondiente.

## AWS posterior

El MVP tiene un runner manual por Data API. `npm run db:migrations:plan` valida
los archivos localmente sin conectarse. La aplicación posterior, con destino
dev explícito y recursos/costos aprobados, usa ARNs y recibos transaccionales;
ver [MIGRACIONES_DATA_API.md](../docs/MIGRACIONES_DATA_API.md).
Nunca debe ejecutarse al iniciar una Lambda ni almacenar la URL o contraseña
de producción en este repositorio. No usarlo para reaplicar a la base local
migrada con psql: no inventa recibos para esquemas existentes.

## Retención

`ACCESS_EXPIRED` revoca el acceso al tenant, pero no elimina datos. La política de retención, exportación y eliminación se implementará después de la revisión legal.

