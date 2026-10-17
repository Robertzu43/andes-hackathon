# Infraestructura y operación

[Imagen PNG](andes-infrastructure.png) · [Fuente SVG editable](andes-infrastructure.svg)

![Infraestructura de ANDES y flujo de emergencia](andes-infrastructure.png)

El primer panel muestra acceso, permisos y persistencia. El segundo amplía el flujo del mismo outbox y proceso de control hacia las dos colas y los procesos de entrega. No representa dos bases de datos ni dos procesos de control adicionales. El cliente móvil aparece como consumidor del contrato; su captura física sigue pendiente de validación.

La fuente de verdad es [la plantilla CloudFormation](../../../infra/template.json), junto con [el contrato ejecutable](../../contracts/runtime.md) y [ADR-002](../ADR-002-aws-durable-dispatch.md). La imagen describe los artefactos implementados, **no un despliegue ejecutado**. La VPC, sus rutas, el acceso externo a OIDC/Zavu y los recursos específicos de cuenta requieren la verificación del runbook.

El SVG contiene texto y figuras editables, sin recursos externos. Para regenerar el PNG después de editarlo, en macOS:

```sh
sips -s format png docs/architecture/diagrams/andes-infrastructure.svg \
  --out docs/architecture/diagrams/andes-infrastructure.png
```

Los servicios se crean detenidos para bootstrap. Después de migrar correctamente, API/control tienen dos tareas cada uno; emergency/ordinary solo tienen dos tareas cuando se habilita el envío real cualificado. La imagen no acredita entrega a grupos de WhatsApp, transcripción, continuidad del GPS en el teléfono ni capacidad medida bajo carga.
