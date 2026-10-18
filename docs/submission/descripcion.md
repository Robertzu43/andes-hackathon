# Tándem

**Tu gente, contigo en ruta.**

Equipo GOAT · Hack the Andes 2026 · Track Seguridad. ANDES es el nombre del repositorio; Tándem es la app.

- Demo: [[PENDIENTE: URL de despliegue]]
- Presentación: [[PENDIENTE: URL de la presentación]]
- Código: https://github.com/Bimbi-Dev/andes-hackathon [[PENDIENTE: el repositorio debe ser público]]

## Problema

En carretera hay dos riesgos: el robo o intento de robo al camión de carga, y el cansancio o el sueño al manejar. Durante un asalto, puede que el conductor no logre pedir ayuda: le quitan el celular o lo amenazan. Las grandes flotas tienen telemetría y una central de monitoreo. El hombre-camión, el dueño que maneja su propio camión, no tiene una central que siga su viaje: tiene a sus personas cercanas y sus grupos de WhatsApp de choferes.

Nuestra hipótesis es que entre el momento en que algo sale mal y el momento en que alguien actúa pasa un tiempo evitable. Todavía no la hemos comprobado con entrevistas.

## Para quién

Transportistas de carga independientes en Latinoamérica, incluido Brasil, que tienen u operan uno o dos camiones, y las personas de confianza que ellos eligen: familia y colegas. El cliente es el conductor; no hace falta una cuenta de flota ni una central. La demo usa el corredor Panamericana Sur (Perú); los datos de un corredor no validan toda la región.

## Cómo funciona

1. Con el camión detenido, el conductor registra su viaje: origen, destino, hora estimada de llegada (en el futuro) y camión. Elige a sus contactos ya aceptados, revisa y confirma. Nada se activa sin su confirmación.
2. Cada contacto acepta por su cuenta, con su número verificado. Ve la ubicación actual del teléfono con su antigüedad y precisión. Si deja de llegar, la app dice «antigua» o «no disponible»; no la inventa. Revocar o llegar niega de inmediato las lecturas nuevas.
3. Al descansar, el conductor pone Pausa: se suspenden los checks, pero el SOS sigue disponible.
4. Si el teléfono deja de dar señales, si se deja de compartir la ubicación o si la llegada se atrasa, el servidor (no el celular) abre un check y le pregunta al conductor una sola vez, con un botón grande: «Estoy bien».
5. Si no responde a tiempo, avisa a todos a la vez: a la familia por SMS, WhatsApp y llamada, y a los colegas por SMS y WhatsApp. El mensaje dice qué no se confirmó y da la última ubicación con su antigüedad, y cierra con «No sabemos qué pasó. Llámalo; si no responde, llama al 105».
6. El botón SOS avisa al instante por los mismos canales, todos en paralelo. Tocarlo varias veces no duplica avisos. Llegar a destino apaga el mapa, pero no cierra un SOS abierto.
7. Los contactos registran que recibieron la alerta y qué hicieron. Entregado no es leído, y leído no es ayuda.
8. El conductor etiqueta cada incidente (robo, intento, falsa alarma, sin señal u otro). Los robos y los intentos alimentan un mapa público y anónimo (celdas de unos 5 km, día y noche, últimos 90 días) y un consejo por zona. Cada número cuenta personas distintas, no reportes. **Un solo usuario no puede inventar un punto peligroso:** una zona aparece recién con 3 personas distintas con teléfono verificado.

El aviso al grupo de WhatsApp de choferes está diseñado como un trabajo aparte, pero hoy siempre queda «no disponible» (`group_support_unverified`): no hemos verificado que el proveedor entregue a grupos.

## Qué funciona hoy y qué no

- **Funciona en `main`, con pruebas automáticas sobre PostgreSQL real** (176 pruebas del backend en la última corrida de CI):
  - viajes con confirmación explícita, consentimiento de contactos y ubicación con frescura honesta;
  - SOS con envío multicanal durable;
  - Pausa y checks «Estoy bien» con escalamiento;
  - endpoint de estado para las pantallas;
  - etiquetas de incidentes, reportes y mapa agregado;
  - acceso de demostración sin cuenta.
- **También en `main`:** el cliente tipado de la API, el controlador del recorrido del conductor, las pantallas del contacto y de privacidad, y el adaptador de GPS con su cola de subida (sin conectar a ninguna pantalla).
- **En construcción:** la app web de producción es todavía un cascarón. Las pantallas del conductor y el recorrido guiado se están construyendo.
- **No desplegado:** el script de la demo reducida en AWS existe, pero no se ha ejecutado.
- **Entrega real por Zavu (SMS, WhatsApp, llamada):** sin confirmar; los envíos están apagados por defecto, así que cada trabajo de envío queda en estado `unavailable` y la pantalla del contacto lo muestra como «No disponible». [[PENDIENTE: confirmar la entrega real antes de entregar]]
- **No implementado:** dictar el viaje por voz y extraer los datos de un texto libre. Hoy el conductor llena los campos.
- **Idea, no producto:** que aseguradoras, gremios o autoridades usen el mapa; un modelo de riesgo. Hoy el consejo es una regla de conteo.

## Decisiones técnicas

- **La alerta vive en la base de datos, no en el celular ni en la memoria.** El incidente, los trabajos de envío y la intención de publicar se guardan en una sola transacción (outbox). Si un proceso cae después de guardar un SOS, la alerta sale al reiniciar.
- **Canales independientes.** Un WhatsApp lento no frena el SMS ni la llamada.
- **Nunca una alarma doble a ciegas.** Un envío con resultado perdido queda «desconocido» y se verifica con el proveedor antes de cualquier otra acción.
- **Los checks corren en el servidor.** Cada viaje se procesa en su propia transacción corta: un reinicio no pierde ni duplica un escalamiento.
- **Arquitectura objetivo:** AWS ECS/Fargate, RDS PostgreSQL Multi-AZ y SQS con colas separadas de emergencia y ordinaria (ver `docs/architecture/ADR-002-aws-durable-dispatch.md` y `docs/architecture/justificacion-arquitectura.md`). La demo correrá en una versión reducida: una tarea y una zona de disponibilidad.

## Limitaciones honestas

- No evitamos robos ni detectamos armas, sueño o fatiga.
- Sin respuesta es «estado sin confirmar», nunca «robo confirmado».
- Si el ladrón presiona «Estoy bien», hoy no lo podemos distinguir.
- Los tiempos de la demo (2 min sin señal, 1 min para responder) son valores para el escenario, no umbrales de seguridad validados.
- La alerta al grupo de WhatsApp de choferes no está verificada con el proveedor.
- El mapa de la demo «incluye datos de demostración». Tres cuentas verificadas que se coordinan podrían publicar una celda con el reporte de otra persona; antes de usar datos reales hay que subir ese mínimo o agregar ruido.
- La demo reducida no tiene alta disponibilidad ni prueba de carga, y el backend tiene nueve límites aceptados y documentados (`docs/contracts/runtime.md`).
- Los mensajes de alerta están solo en español por ahora.
- No hemos probado la app en teléfonos físicos; Android sigue sin probar.
- Entrevistas con transportistas: [[PENDIENTE: número y hallazgos, o decir que aún no las hay]]. Las guías de entrevista en español y portugués están listas.

## Próximos pasos

Entrevistar a transportistas y a sus familias; terminar las pantallas del conductor y desplegar la demo; enviar mensajes reales con Zavu a contactos que acepten; probar en teléfonos reales con la pantalla bloqueada; y dictado por voz.
