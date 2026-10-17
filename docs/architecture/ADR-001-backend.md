# ADR-001 — Arquitectura del viaje y respuesta de ANDES

Estado: **histórico, sustituido por [ADR-002](ADR-002-aws-durable-dispatch.md)** tras la delegación de decisión de Robert. Conserva la comparación inicial; no ejecutar su protocolo ni tratar sus alternativas como la decisión vigente.

Revisión independiente solicitada por Robert: [preguntas de profundidad para la demo y escalabilidad](reviews/2026-10-17-scalability-review.md). La recomendación A sigue provisional: no hay base para excluir AWS, donde la misma topología puede ejecutarse en ECS/Fargate + RDS. Comparar también Lambda + SQS con publicación transaccional mediante outbox. Antes de congelar contratos, corregir el acoplamiento entre el lock de envío, las operaciones del mapa y el fence único que puede impedir otros canales y el cierre tras un resultado ambiguo. Esta observación no autoriza a eliminar las garantías de orden/cancelación; requiere una semántica explícita y pruebas de carrera.

## Producto confirmado

El cliente principal es el transportista de carga independiente de Latinoamérica, incluyendo Brasil, con uno o dos camiones. Registra un viaje por voz o texto, revisa el borrador y confirma explícitamente. Comparte ubicación del teléfono con contactos aceptados. Las acciones posteriores usan botones muy grandes; sus etiquetas y el uso en movimiento necesitan definición y evaluación.

Los chequeos dependen del contexto: diferir en curvas o maniobras exigentes, pausar durante paradas declaradas y reevaluar antes de cada intento. Se requieren varios intentos válidos antes de una alarma por falta de respuesta. No hay intervalo, número de intentos o umbral de fatiga aprobado. Una respuesta no demuestra alerta sostenida; una falta de respuesta conserva estado desconocido.

El requisito existente de #11 prohíbe exigir interacción de pantalla en movimiento para evitar una alarma. Los botones grandes se conservan como decisión de interfaz; su presencia no convierte una oportunidad en válida. Debemos acordar cómo se difiere o declara no disponible el chequeo cuando responder requiere interacción no permitida, y cómo se trata la incapacidad prolongada de comprobar el estado sin inventar intentos fallidos.

La señal explícita de robo/secuestro abre un incidente sin esperar chequeos. El familiar/pareja y la persona adicional seleccionada requieren SMS, WhatsApp y llamada mediante Zavu. El grupo de conductores requiere una alerta al grupo de WhatsApp; el soporte real de ese canal aún debe verificarse. No sustituirlo silenciosamente por mensajes individuales.

Decisiones y escenarios detallados: [baseline](../superpowers/specs/2026-10-17-robert-backend-contracts.md) e [inventario](../superpowers/specs/2026-10-17-contextual-checkin-scenarios.md). Evidencia y estado de avance: [registro #12](../evidence/issue-12.md).

## Primera decisión pendiente: plataforma del conductor

Recomendación para discutir: app instalada, con Android como primera plataforma de evaluación si el equipo dispone de un teléfono y capacidad de desarrollo Android. El contacto usaría una web con acceso limitado al viaje. Esto no selecciona Kotlin, React Native, Expo u otro framework y no presupone funcionamiento en segundo plano.

| Alternativa de cliente | Qué permite evaluar | Coste o límite |
|---|---|---|
| Android primero + web del contacto | Ciclo de vida, permisos, ubicación y sensores en un dispositivo concreto | Requiere build instalable y pruebas con pantalla bloqueada; iPhone queda sin validar |
| Android e iPhone + web del contacto | Ambos sistemas desde el inicio | Dos matrices de permisos, ciclo de vida, distribución y evidencia |
| Web/PWA del conductor + web del contacto | Recorrido accesible por enlaces y captura cuando el navegador la permite | No ofrece por sí sola la continuidad de captura requerida; hay que limitar explícitamente los modos demostrados |

La [especificación W3C de geolocalización](https://www.w3.org/TR/geolocation/) condiciona adquisición/actualizaciones al documento activo y visible. [Android](https://developer.android.com/develop/sensors-and-location/location/background) también impone límites de ejecución y ubicación en segundo plano. Un servidor o permiso concedido no elimina estas restricciones. #9 debe aportar las observaciones del modo concreto elegido.

## Alternativas de backend

Recomendación inicial: A, condicionada a contar con alojamiento que mantenga el worker ejecutándose y PostgreSQL disponible. Es una decisión de menor superficie operativa para este alcance, no un resultado de benchmark.

| Alternativa | Organización | Ventaja para este producto | Trabajo y riesgo |
|---|---|---|---|
| A. API y worker en un código modular, PostgreSQL | La API registra cambios y trabajos en una transacción; el worker reclama trabajos pendientes y habla con Zavu | Estado y notificaciones pendientes se pueden inspeccionar juntos; pruebas de reinicio y concurrencia reproducibles | El equipo debe implementar reclamación, recuperación, reintentos acotados y observabilidad; un host que duerme procesos no cumple |
| B. API, base de datos y flujos durables administrados | Por ejemplo, Cloudflare Workflows conserva ejecución/esperas; la base mantiene viajes y permisos | Reduce parte de la supervisión de esperas y reintentos | Exige reconciliar transacciones con el inicio del workflow, cancelación y efectos externos; verificar acceso, límites y coste |
| C. API con temporizadores en memoria o en el navegador | Menos componentes al principio | Sirve para una maqueta desechable | Un reinicio o cierre pierde la programación; se descarta para las alertas del producto |

[Cloudflare Workflows](https://developers.cloudflare.com/workflows/) documenta ejecución durable y [esperas/reintentos](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/). No garantiza por ello entrega exactamente una vez a un proveedor externo. [PostgreSQL](https://www.postgresql.org/docs/current/sql-select.html) permite bloqueo y `SKIP LOCKED` para consumidores de colas; tampoco resuelve por sí solo un envío aceptado cuyo resultado se pierde.

## Distribución propuesta de responsabilidades

| Componente | Responsabilidad | Issues y dueño |
|---|---|---|
| Cliente del conductor | Voz/texto inicial, revisión, botones, permisos, observaciones locales y cola offline acotada | Sebastian #9/#13/#19/#24; contrato con Robert |
| Identidad y viajes | Autorizar conductor/camión, borradores, contactos aceptados, confirmación y ciclo del viaje | Robert #14/#16/#17 |
| Observaciones y contexto | Validar procedencia, hora, precisión y orden; conservar desconocidos; calificar contexto | Robert #18/#20/#21 |
| Chequeos | Separar diferido, pausa, interacción no disponible, espera y falta de respuesta repetida | Robert #23/#25–28; restricciones de #24 |
| Incidentes y notificaciones | SOS, destinatarios, trabajos persistentes, resultados por canal y reconciliación | Robert #29–34 |
| Web del contacto | Ubicación vigente/antigua/no disponible, recepción y acción atribuida | Sebastian #22/#35; backend de Robert |

El teléfono observa y facilita decisiones locales; el backend autoriza, persiste y coordina. No se debe esperar un viaje de ida y vuelta al servidor para diferir un chequeo ante contexto local adverso. El protocolo concreto para combinar decisiones locales y servidor requiere #9/#19/#24. En ausencia de conectividad, un SOS local pendiente no puede mostrarse como entregado.

## Recorrido de datos propuesto

1. Voz/texto genera un borrador validable. La interpretación no activa el viaje ni selecciona contactos sin confirmación.
2. La confirmación autenticada registra el viaje y los permisos de contactos aceptados; repeticiones no crean viajes duplicados.
3. El teléfono envía observaciones con identidad de evento y hora de captura. El backend conserva también la hora de recepción y evita que una muestra antigua sustituya a una nueva.
4. La web del contacto lee únicamente datos autorizados e indica su antigüedad. Revocación y cierre se aplican a futuras lecturas/publicaciones.
5. Los chequeos registran oportunidades y respuestas por separado. Las supresiones y problemas técnicos no se convierten en intentos fallidos.
6. Un SOS registra incidente y trabajos de notificación de forma atómica. Los tres canales individuales mantienen estados separados; los tiempos de envío y reglas tras acuse aún deben acordarse.
7. El contacto puede reconocer el aviso y registrar una acción. Entrega, lectura, responsabilidad y ayuda efectiva son hechos distintos.

## Fallos que deben guiar los contratos

| Caso | Resultado requerido | Verificación futura |
|---|---|---|
| Confirmación duplicada o payload diferente con la misma clave | Un viaje; conflicto si cambia la petición | #16, prueba de idempotencia |
| Permiso revocado, teléfono sin señal o muestras antiguas | Estado de ubicación honesto; ninguna prueba de sueño | #9/#21/#22, trazas de dispositivo y servidor |
| Curva, parada o control inaccesible | Diferir/pausar/no disponible, sin consumir un intento válido | #20/#23–27, escenarios y evaluación de interacción |
| Worker reinicia después del commit | Trabajo pendiente recuperable | #30, prueba con reinicio real |
| Zavu acepta pero se pierde la respuesta | Intento ambiguo, reconciliación antes de un reenvío injustificado | #31–33, contrato verificado del proveedor |
| Llegada/resolución compite con envío | Orden explícito y resultado conocido o ambiguo; no afirmar cancelación de un envío aceptado | #17/#30/#33, trazas de concurrencia |
| OK tardío después de SOS | No cierra el incidente | #26/#29, causalidad y repetición |
| Nadie puede ayudar | Acción pendiente visible, sin confundir acuse con resolución | #29/#35, observación independiente |

## Hackathon y criterio de éxito

La [guía oficial](https://hacktheandes.com/guide), consultada 2026-10-17, asigna 40% al esfuerzo técnico, 30% a tracción y 30% al pitch. Nuestra aplicación: mostrar el recorrido principal funcionando, decisiones justificadas y un fallo recuperado; conservar aprendizaje verificable de conductores/contactos; presentar una historia breve y clara. Esta asignación de trabajo es nuestra interpretación, no una promesa de puntuación.

La organización abre los enlaces desde su equipo y pide funcionamiento en ventana privada. Diseñar una web de demostración accesible desde esos enlaces; distinguir una reproducción sintética de una captura física y de un envío real. Confirmar con la organización cualquier participación de un teléfono externo antes de depender de ella en el pitch. Una app Android instalada no sustituye el enlace de entrega.

## Decisiones que aún impiden congelar el diseño

- Plataforma y dispositivo disponibles; viabilidad de captura fuera de la pantalla activa (#9).
- Cuenta de alojamiento, worker persistente, base de datos, secretos, costes y recuperación.
- Proveedores de identidad, transcripción y mapas; elegibilidad real de los canales Zavu y grupo (#10).
- Límites y contrato de evidencia (#11); política de oportunidades y falta de respuesta, distinta de SOS.
- Activación/cancelación de SOS, pausa/reanudación, envío simultáneo o escalonado y efecto del acuse.
- Revisión del diseño escrito por Robert y acuerdo de interfaces con Sebastian.

Siguiente paso: resolver la plataforma y discutir A frente a B. Después completar y revisar el diseño elegido, actualizar los planes afectados y ejecutar una sola issue con implementación y revisiones separadas. No se han congelado rutas, esquemas, números de política ni versiones de dependencias.
