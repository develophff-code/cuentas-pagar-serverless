# Datos persistentes — Fase B

El CDK define la stack `CuentasPagarData-dev`, pero no debe desplegarse aún.
No depende de `apagar.averiqsj.app`, DNS, CloudFront ni de un cambio en YCloud.

## Recursos preparados

- VPC de dos zonas con subredes aisladas y sin NAT Gateway.
- Aurora PostgreSQL 16.6 Serverless v2, una instancia escritora, rango de 0.5
  a 2 ACU, copias automáticas por siete días, logs de PostgreSQL, cifrado KMS,
  TLS obligatorio y retención ante una eliminación de stack.
- RDS Proxy privado, con TLS obligatorio y acceso limitado al grupo de
  seguridad reservado para Lambdas de aplicación.
- Secreto de credenciales de base generado por Secrets Manager y cifrado con la
  misma clave de datos; no hay URL ni contraseña en el repositorio.
- Bucket privado de documentos con bloqueo público, TLS, versionado, SSE-KMS y
  archivado a 30/90 días. No borra documentos automáticamente mientras la
  política legal de retención siga pendiente.

Aurora no se configura con pausa automática a cero ACU: RDS Proxy mantiene
conexiones abiertas y evita dicha pausa. Por eso el mínimo explícito es 0.5
ACU. Antes del despliegue se debe revisar el costo con AWS Pricing Calculator,
ajustar el presupuesto de `dev` y autorizar expresamente Aurora, RDS Proxy y
los cargos asociados a almacenamiento, copias y logs.

Las Lambdas actuales no ingresan a la VPC ni requieren la base. Al incorporar
la Lambda de API de negocio se le asignará `ApplicationSecurityGroup`, acceso
al endpoint del proxy y la conectividad privada necesaria hacia Secrets
Manager; esa decisión se revisará junto con el costo de endpoints de interfaz.
