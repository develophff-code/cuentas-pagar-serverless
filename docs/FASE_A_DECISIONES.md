# Fase A — Decisiones confirmadas

## Confirmadas

- El repositorio de la implementación es esta carpeta.
- Hay tres planes: Básico, Profesional y Ultra.
- Cada tenant recibe una prueba gratuita de siete días desde su alta.
- La renovación es mensual y manual mediante Mercado Pago Checkout Pro.
- Los precios, límites de facturas, usuarios, almacenamiento y capacidades no se codifican: se administran como datos de plan con vigencia.
- Básico opera por WhatsApp; Profesional y Ultra incorporan aplicación web autenticada con Cognito.
- YCloud es el proveedor de WhatsApp de producción.
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

## Pendientes de la grilla comercial

- Precio y moneda por plan.
- El PDF no contiene precios ni moneda.
- Límite de almacenamiento y de consultas IA de Ultra.
- Límite de almacenamiento y de consultas IA de Ultra.
- Período de gracia y comportamiento de un tenant vencido.

## Decisión técnica derivada

La tabla de precios tendrá período de vigencia. Una renovación conserva el precio aceptado en su orden de suscripción, aunque el precio actual del plan cambie después.
