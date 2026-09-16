# Base de datos local

La migración `migrations/001_initial_schema.sql` crea el esquema inicial de PostgreSQL para Cuentas a Pagar Serverless y carga:

- planes Básico, Profesional y Ultra;
- límites iniciales de facturas, proveedores y usuarios;
- precios mensuales ARS 28.000, ARS 82.000 y ARS 144.000;
- las diez categorías de proveedores;
- las tablas de identidad, tenants, suscripciones, proveedores, documentos, facturas, pagos, alertas, webhooks y auditoría.

## Aplicación local

La migración se aplica una sola vez sobre una base nueva. No contiene contraseñas.

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -p 5432 -U postgres -d cuentas_pagar_serverless -v ON_ERROR_STOP=1 -f database\migrations\001_initial_schema.sql
```

PostgreSQL solicitará la contraseña de forma interactiva. Para una instalación distinta, reemplazar la ruta a `psql.exe` por la correspondiente.

## AWS posterior

En AWS la misma migración debe ejecutarse desde el pipeline de despliegue contra Aurora PostgreSQL, usando un secreto de Secrets Manager y un job controlado. Nunca debe ejecutarse al iniciar una Lambda y nunca se debe almacenar la URL o contraseña de producción en este repositorio.

## Retención

`ACCESS_EXPIRED` revoca el acceso al tenant, pero no elimina datos. La política de retención, exportación y eliminación se implementará después de la revisión legal.

