# Fase A — Decisiones confirmadas

## Confirmadas

- El repositorio de la implementación es esta carpeta.
- Hay tres planes: Básico, Profesional y Ultra.
- Cada tenant recibe una prueba gratuita de siete días desde su alta.
- La renovación es mensual y manual mediante Mercado Pago Checkout Pro.
- Precios iniciales mensuales: Básico ARS 28.000, Profesional ARS 82.000 y Ultra ARS 144.000.
- Desde el día cinco se envían avisos de finalización de prueba.
- Al terminar la prueba, el tenant queda bloqueado para operatoria durante siete días, pero puede acceder a facturación y renovación.
- Transcurridos esos siete días de bloqueo, se revoca todo acceso y una nueva utilización requiere registro nuevo. No se borra información automáticamente hasta definir la política legal de retención.
- `OPERATOR_PAYMENTS` puede proponer o cargar un pago; sólo `ADMIN` lo confirma. Un pago iniciado y confirmado por `ADMIN` no requiere otra aprobación.
- La región objetivo inicial es `us-east-1` (Norte de Virginia).
- Los precios, límites de facturas, usuarios, almacenamiento y capacidades no se codifican: se administran como datos de plan con vigencia.
- Básico opera por WhatsApp; Profesional y Ultra incorporan aplicación web autenticada con Cognito.
- YCloud es el proveedor de WhatsApp de producción.
- `apagar.averiq.cloud` es el endpoint actual de webhook de YCloud y queda reservado hasta completar su migración.
- La URL destino del webhook de YCloud será `https://apagar.averiqsj.com`; su cambio se hará sólo después de verificar el nuevo endpoint y conservará el anterior como rollback temporal.
- La aplicación de Cuentas a Pagar se publicará en `https://apagar.averiqsj.app`. El dominio `averiqsj.app` se reserva para las SaaS del portfolio y `averiqsj.com` para la presencia institucional y servicios complementarios.
- Hostinger administra actualmente el DNS. Para CloudFront/API Gateway se configurarán CNAMEs, no direcciones IP fijas mediante registros A.
- No se admiten pagos parciales: una factura se paga completa o permanece impaga.
- Límites cuantitativos iniciales tomados de `saas_planes.pdf`:
  - Básico: 100 facturas, 25 proveedores y 1 celular.
  - Profesional: 300 facturas, 80 proveedores y 3 celulares.
  - Ultra: 500 facturas, 150 proveedores y 5 celulares.
- La definición actual de producto prevalece sobre las funciones de la grilla histórica:
  - Básico opera sólo mediante WhatsApp.
  - Profesional y Ultra operan principalmente desde una web autenticada y tienen roles de administrador y operador de carga.
  - WhatsApp es canal de ingesta móvil y de notificaciones, no la interfaz principal de Profesional/Ultra.
  - Ultra agrega Chat IA y controles/analítica avanzados.

## Pendientes de definición

- Límite de almacenamiento y de consultas IA de Ultra.
- Frecuencia, texto y canales exactos de los avisos desde el día cinco de prueba.
- Política definitiva de conservación, exportación o eliminación de datos luego de `ACCESS_EXPIRED`, sujeta a asesoramiento legal.

## Decisión técnica derivada

La tabla de precios tendrá período de vigencia. Una renovación conserva el precio aceptado en su orden de suscripción, aunque el precio actual del plan cambie después.
