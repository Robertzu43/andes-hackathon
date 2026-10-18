# ANDES

**Si te asaltan y no puedes avisar, ANDES avisa por ti.**

Equipo GOAT · Hack the Andes 2026 · Track Seguridad

- Demo: [[PENDIENTE: URL de despliegue]]
- Presentación: [[PENDIENTE: URL de la presentación]]
- Código: https://github.com/Bimbi-Dev/andes-hackathon [[PENDIENTE: el repositorio debe ser público]]

## Problema

En carretera asaltan camiones de carga, y en ese momento el conductor a menudo no puede pedir ayuda: le quitan el celular o lo amenazan. Las grandes flotas tienen telemetría y una central de monitoreo. El transportista independiente, con uno o dos camiones, cuenta con WhatsApp y su familia. Nadie se entera hasta horas después.

## Para quién

Transportistas de carga independientes en Latinoamérica, incluido Brasil, que tienen u operan uno o dos camiones, y las personas de confianza que ellos eligen. La demo usa el corredor Panamericana Sur (Perú); los datos de un corredor no validan toda la región.

## Cómo funciona

1. Con el camión detenido, el conductor registra su viaje: origen, destino, hora estimada de llegada y camión. Luego elige a sus contactos, revisa y confirma. Nada se activa sin su confirmación.
2. Sus contactos (familia y colegas) aceptan compartir. Ven la ubicación actual del teléfono con su antigüedad y precisión. Si deja de llegar, la app dice «antigua» o «no disponible»; no la inventa.
3. Si el teléfono deja de dar señales, si se deja de compartir la ubicación o si la llegada se atrasa, el servidor (no el celular) abre un control y le pregunta al conductor una sola vez, con un botón grande: «Estoy bien».
4. Si no responde a tiempo, avisa a todos a la vez: a la familia por SMS, WhatsApp y llamada, y a los colegas por SMS y WhatsApp. El mensaje es honesto: dice qué no se confirmó, desde qué hora no hay señal y la última ubicación con su antigüedad, y cierra con «No sabemos qué pasó. Llámalo; si no responde, llama al 105».
5. El botón SOS dispara la alerta al instante. Llegar a destino apaga el mapa, pero no cierra un SOS abierto.
6. Los contactos registran que recibieron la alerta y qué hicieron. Entregado no es leído, y leído no es ayuda.
7. El conductor etiqueta cada incidente (robo, intento, falsa alarma, sin señal). Los robos alimentan un mapa público y anónimo (celdas de unos 5 km, día y noche) y un consejo por zona. **Un solo usuario no puede inventar un punto peligroso:** una zona aparece recién con 3 personas distintas.

## Qué funciona hoy y qué no

- **Funciona (backend con pruebas automáticas sobre PostgreSQL real):**
  - viajes con confirmación explícita, consentimiento de contactos y ubicación con frescura honesta;
  - SOS con envío multicanal durable;
  - controles «Estoy bien» con escalamiento;
  - endpoint de estado para las pantallas;
  - etiquetas de incidentes, reportes y mapa agregado;
  - acceso de demostración sin cuenta.
  [[PENDIENTE: confirmar al entregar qué partes ya están integradas y desplegadas]]
- **Pantallas del conductor y del contacto:** [[PENDIENTE: estado de la web de Sebastian]]
- **Entrega real por Zavu (SMS, WhatsApp, llamada):** [[PENDIENTE: sin confirmar; en la demo, los intentos por canal se muestran como no habilitados]].
- **No implementado:** dictar el viaje por voz y extraer los datos de un texto libre. Hoy el conductor llena los campos.
- **Idea, no producto:** que aseguradoras, gremios o autoridades usen el mapa; un modelo de riesgo. Hoy el consejo es una regla de conteo.

## Decisiones técnicas

- **La alerta vive en la base de datos, no en el celular ni en la memoria.** El incidente, los trabajos de envío y la intención de publicar se guardan en una sola transacción (outbox). Si un proceso cae después de guardar un SOS, la alerta sale al reiniciar.
- **Canales independientes.** Un WhatsApp lento no frena el SMS ni la llamada.
- **Nunca una alarma doble a ciegas.** Un envío con resultado perdido queda «desconocido» y se verifica con el proveedor antes de cualquier otra acción.
- **Los controles corren en el servidor.** Cada viaje se procesa en su propia transacción corta: un reinicio no pierde ni duplica un escalamiento.
- **Arquitectura objetivo:** AWS ECS/Fargate, RDS PostgreSQL Multi-AZ y SQS (ver `docs/architecture/ADR-002-aws-durable-dispatch.md` y `docs/architecture/justificacion-arquitectura.md`). La demo corre en una versión reducida: una tarea y una zona de disponibilidad.

## Limitaciones honestas

- No evitamos robos ni detectamos armas, sueño o fatiga.
- Sin respuesta es «estado sin confirmar», nunca «robo confirmado».
- Si el ladrón presiona «Estoy bien», hoy no lo podemos distinguir.
- Los tiempos de la demo (2 min sin señal, 1 min para responder) son valores para el escenario, no umbrales de seguridad validados.
- La alerta al grupo de WhatsApp de choferes está pendiente: el proveedor aún no confirma que la soporte.
- El mapa de la demo «incluye datos de demostración».
- Los mensajes de alerta están solo en español por ahora.
- Entrevistas con transportistas: [[PENDIENTE: número y hallazgos, o decir que aún no las hay]].

## Próximos pasos

Entrevistar a transportistas y a sus familias; enviar mensajes reales con Zavu a contactos que acepten; dictado por voz; y probar en teléfonos reales con la pantalla bloqueada.
