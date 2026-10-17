# ADR-002 — AWS, estado transaccional y envíos independientes

Fecha: 2026-10-17. Estado: **decisión de diseño tomada por delegación de Robert** («resuelve estas preguntas y toma la mejor decisión la más robusta»). Sustituye las alternativas abiertas de ADR-001 y el protocolo de lock/fence global de los planes anteriores. No acredita despliegue, capacidad, entrega real ni cierre de #12. Las pruebas de dispositivo/proveedor y #9–11 siguen pendientes.

## Decisión y fundamento

Seleccionar AWS: API modular TypeScript/Fastify y workers en ECS/Fargate, RDS PostgreSQL como autoridad de estado, outbox transaccional y SQS Standard con colas separadas de emergencia y trabajo ordinario. Un solo repositorio e imagen, con distintos comandos/roles y capacidad de ejecución separada. Zavu sigue siendo el proveedor de comunicaciones a personas.

Esta elección mantiene transacciones para viajes, permisos e incidentes; permite recuperar trabajo tras reinicios y separar fallos/concurrencia de envíos. Es la elección razonada para este alcance, no una afirmación de superioridad universal o capacidad medida. La complejidad adicional de SQS se justifica por aislamiento de carga, reentrega y recuperación, no por necesitar microservicios.

| Opción evaluada | Decisión |
|---|---|
| ECS/Fargate + RDS + SQS | Elegida: mismo runtime para HTTP, plazos, relay y consumidores; pools y concurrencia explícitos; colas administradas y estado SQL inspeccionable |
| API + worker con cola solo en PostgreSQL | Viable y menor infraestructura; descartada como objetivo robusto porque acopla más el transporte/reintentos a la base de estado y exige más operación propia de cola |
| API Gateway + Lambda + SQS + RDS | Viable, especialmente para tráfico intermitente; no elegida inicialmente para evitar además la adaptación de HTTP, publicación de outbox, plazos y pools a distintos ciclos de ejecución. No se afirma que escale peor |
| Cloudflare Workflows o AWS Step Functions/Lambda Durable Functions | No necesarios para el primer flujo: los plazos versionados residen en SQL y un supervisor los procesa. Step Functions ofrece definición visual; Durable Functions mantiene orquestación en código. Ninguno elimina incertidumbre del envío externo |

## Componentes y operación

- **API detrás de ALB HTTPS:** identidad, borradores, confirmación, ubicación, comandos, contactos y callbacks verificados. Separar límites/pools de telemetría de comandos SOS y callbacks dentro del mismo servicio; rechazar o limitar carga ordinaria antes de agotar la capacidad reservada. HTTP no llama a Zavu durante la petición SOS.
- **Worker de control:** procesa plazos persistidos, publica outbox a SQS y reconcilia intentos; bucles con concurrencia/pools reservados, sin llamar proveedores mientras retiene conexiones SQL. Reclamaciones cortas con leases; reinicios no pierden vencimientos. No depende de temporizadores del navegador.
- **Consumidores de entrega:** servicios ECS separados para `emergency` y `ordinary`, misma imagen. Colas con DLQ separadas. Dentro de cada clase, cupos por canal y cuenta; un WhatsApp lento no ocupa todos los slots de voz/SMS. La suma de consumidores respeta presupuesto global de conexiones y cuotas verificadas Zavu. Un límite de cuota compartida puede afectar a todos: reservar margen para emergencia, no prometer aislamiento total del proveedor.
- **RDS PostgreSQL:** transacciones, permisos, última ubicación, historia limitada, incidentes, plazos, trabajos, intentos y outbox. Índices en identidad, pendientes y vencimientos. Pools acotados por rol y máximo de réplicas. RDS Proxy no es requisito inicial; no usar locks de sesión ni mantener una conexión durante HTTP externo.
- **S3 privado:** audio temporal validado, con borrado/lifecycle acordado; no enviar audio ni rutas precisas a SQS. Web del contacto y demo publicada en hosting estático S3/CloudFront si el frontend elegido lo permite.
- **Secrets Manager, IAM por rol y CloudWatch:** secretos fuera de repo/logs; métricas de antigüedad de trabajo, intentos desconocidos, cola/DLQ, espera de pool, latencia SOS, errores por canal y frescura. Registros sin audio, teléfono, coordenadas ni credenciales.

Objetivo de disponibilidad: servicios críticos con al menos dos tareas distribuidas entre dos AZ y RDS Multi-AZ; copias y restauración probada. Multi-AZ mejora disponibilidad, no multiplica automáticamente capacidad de escritura ni elimina cortes de failover. Cuenta, región, versiones compatibles, IAM, presupuesto y conectividad/egreso a Zavu se verifican antes de desplegar. No se han elegido precios ni supuestos créditos AWS. Una demo reducida a una tarea/Single-AZ debe etiquetarse como tal y no demostrar alta disponibilidad. No desplegar ni gastar como consecuencia de este ADR.

## Contrato de consistencia: resolver el problema del fence

**Nueva garantía:** después de confirmar cierre/revocación/resolución, no se autoriza un nuevo intento afectado por esa acción. Un intento autorizado antes puede empezar o terminar su llamada externa después. No se promete detener físicamente esa llamada mediante un lock SQL. Se informa como en curso o desconocido hasta conciliarlo.

Esto sustituye explícitamente «ninguna iniciación HTTP posterior al cierre confirmado». Esa garantía anterior no podía mantenerse a la vez que un cierre independiente de un emisor pausado y un proveedor que no participa en fencing. El usuario ve: «Viaje terminado; ubicación desactivada. Hay un aviso previamente autorizado en curso» cuando corresponda. No decir «todos los avisos cancelados».

El límite de autorización se decide mediante una transacción corta que serializa con cierre y revocación; no basta con leer estado fuera de transacción. No existe `trips.dispatch_fence` global. El bloqueo transaccional por viaje coordina únicamente decisiones SQL; se libera antes de SQS, Zavu o cualquier otro I/O externo. Ubicación y mapas solo participan en transacciones cortas de estado/autorización.

### Intentos, duplicados y caídas

1. Un SOS autenticado persiste incidente, trabajos por destinatario/canal e intención de publicación en una transacción. Las claves idempotentes con contenido distinto dan conflicto. Una restricción de incidente SOS activo por viaje une taps simultáneos del mismo episodio aunque traigan claves distintas; mantiene los reportes/auditoría. Otro incidente tras resolución es un episodio nuevo. El cliente conserva la clave al reintentar.
2. El relay reclama outbox con lease breve, libera SQL, publica **solo IDs/versiones** en SQS y marca publicación después de aceptación. Si se pierde la respuesta, repite la publicación con el mismo job ID. La repetición de SQS no es otro intento al proveedor.
3. El consumidor reclama el job en una transacción corta. Vuelve a comprobar actor de origen, incidente, permisos y canal, versión vigente, cancelación, vencimiento y límites. Crea un intento único en `authorized`, con identidad de worker/claim y clave de proveedor estable cuando esté soportada. Lee el payload mínimo autorizado en esa transacción, registra su hash y devuelve la conexión al pool. Retener datos de envío solo lo necesario, nunca en logs ni en la cola.
4. Solo el consumidor que ganó esa autorización puede efectuar **una invocación de envío** del intento. Sin reintentos HTTP automáticos ocultos. Si decide no iniciar y puede acreditar que no llamó, guarda `not_sent`; cualquier caída tras autorización se trata conservadoramente como `unknown`, aunque quizá no salió ninguna llamada. Un timeout no prueba no-entrega.
5. Tras la llamada, registra `accepted`, `rejected` o `unknown` en otra transacción. Un callback autenticado que llegó antes puede completar el estado; el resultado HTTP tardío no lo degrada. Entrega/lectura/acuse/acción quedan separados. Nunca revivir un job cancelado ni convertir un intento desconocido en pendiente por el mero paso de un lease.
6. Una redelivery que encuentra intento autorizado/desconocido no llama de nuevo. Persiste/asegura el trabajo de reconciliación y puede retirar el mensaje de transporte; PostgreSQL conserva el estado pendiente y un scanner recupera ese trabajo. Un crash antes de autorización permite reclamar de nuevo con token vigente; un token vencido no puede autorizar.
7. En esta primera versión, reconciliar ambigüedad mediante consulta/callback oficial, sin repetir la operación de envío. El canal permanece pendiente de intervención si no hay evidencia concluyente; los otros canales y destinatarios siguen disponibles. Una futura repetición idempotente necesitaría otro contrato cualificado: misma operación/clave y payload autorizado inmutable recuperable, límites de vigencia y ausencia de efectos duplicados. No está habilitada por este ADR.
8. No basta con que una consulta devuelva «no encontrado» para probar que un emisor pausado nunca enviará. Para crear un nuevo intento del mismo job tras ambigüedad se necesita resultado definitivo aplicable y quiescencia del emisor anterior, y una nueva comprobación de vigencia/permisos. No usar redrive/DLQ como mecanismo para saltar esta condición.

Los reintentos técnicos tienen presupuesto persistido y backoff acotado por el contrato del canal; errores permanentes no se reintentan. Los plazos de seguridad no se inventan aquí. Las colas son transporte, SQL es autoridad; el reconciliador repone publicaciones confirmadas que no avanzan sin crear nuevas autorizaciones. Ningún componente ofrece exactamente una vez de extremo a extremo.

## Decisiones de producto que afectan al despacho

- **SOS explícito:** los tres canales individuales se vuelven elegibles inmediatamente en paralelo, sujetos a capacidad y cuotas reales. WhatsApp no es requisito previo de SMS/voz. Deduplicar personas que tienen más de un rol. La señal al grupo es un trabajo separado, condicionado a soporte verificado. Su ausencia se expone como capacidad faltante.
- **Acuse:** recibir/leer o pulsar «recibido» no cancela los otros canales requeridos. Una resolución explícita del incidente por el actor autorizado cancela trabajos aún no autorizados; los intentos en curso conservan su estado. No permitir al contacto cerrar un incidente solo por recibir el aviso.
- **Llegada/cancelación de viaje:** detener publicación de ubicación, revocar acceso al mapa y cancelar chequeos/trabajos ordinarios aún no autorizados en una transacción. Una emergencia de seguridad abierta no se resuelve automáticamente con «llegué» o «estoy bien»; el cierre del incidente es una acción separada del conductor autenticado. Registrar atribución; esto no demuestra ausencia de coacción. La interacción discreta/coacción requiere validación propia.
- **SOS que continúa tras terminar viaje:** puede seguir notificando a destinatarios con consentimiento de incidente vigente, sin nuevas coordenadas procedentes de un permiso de mapa revocado. Los payloads ya autorizados antes del cierre pueden contener la última ubicación que entonces estaba permitida; esto se comunica como límite de revocación.
- **Revocación de contacto:** independiente de Zavu; revoca grants y cancela trabajos aún no autorizados de ese contacto. Lecturas nuevas quedan denegadas tras el commit. Una respuesta HTTP del mapa que ya estaba autorizada o un mensaje ya preparado puede llegar después; no se promete recuperar copias divulgadas.
- **Chequeos:** no usar un timer vencido como evidencia de varias oportunidades. Curva, parada o interacción no permitida difiere/pausa/no disponible. SOS no depende de la política de chequeos. La escalada automática por no-respuesta permanece deshabilitada hasta fijar y probar audiencia/límites conforme a #11/#24; los tests usan escenarios sintéticos explícitos, no números de producción.

## Teléfono y mapa: decisiones iniciales

Elegir Android instalado como primera plataforma de validación de captura, con web para el contacto y demo desde enlaces. Esta es la decisión de alcance inicial, no una afirmación de teléfono disponible ni un cambio del dueño frontend. Sebastian debe confirmar el dispositivo y framework antes de implementar #9/#13; iPhone queda sin soporte validado. No apostar la promesa de captura continua a una PWA en segundo plano.

GPS, velocidad disponible y precisión ayudan a contextualizar, junto con mapa y sensores cualificados. No detectan por sí solos sueño, presencia del conductor o combustible. Permisos mínimos por función, estados explícitos tras denegación y revocación. Las acciones grandes se conservan; no exigir tocar pantalla conduciendo para evitar una alarma.

Captura, recepción y lectura tienen horas diferentes. El teléfono mantiene una cola offline acotada; un SOS offline aparece «pendiente de enviar», nunca «enviado». El mapa muestra la última muestra con antigüedad/precisión y se vuelve antiguo/no disponible sin muestras nuevas. Batches atrasados no sustituyen una muestra posterior ni generan una ráfaga de chequeos. Polling autenticado inicialmente, con nueva comprobación de permisos en cada lectura, sin caché compartida de ubicación. Cadencias, retención y límites finales se fijan con evidencia del teléfono y presupuesto, no se presentan como constantes universales.

## Respuestas demostrables a las siete preguntas

| Pregunta | Decisión | Prueba de aceptación de ingeniería |
|---|---|---|
| ¿Por qué AWS? | Servicios administrados para ejecución, datos y transporte; conservar modelo modular y SQL | Despliegue reproducible, salud, recuperación y costes observables; comparar con alternativa Lambda antes de cambiar por una necesidad medida |
| ¿Reinicio después de SOS? | Incident/job/outbox atómicos y recuperación de relay/consumidor | Commit y matar proceso; trabajo reaparece. Rollback no publica. Fallo tras aceptación deja un intento ambiguo, no otro envío |
| ¿WhatsApp lento bloquea llamada? | Intentos y slots separados por canal; sin fence global | Bloquear WhatsApp sintético y observar SMS/voz, otro viaje, mapa y revocación progresar |
| ¿Teléfono sin señal? | Frescura explícita y SOS local pendiente | Modo avión/pantalla bloqueada en equipo físico; no confundir replay con captura observada |
| ¿Doble tap/callback? | Clave de petición, incidente activo único, jobs/attempts únicos y callbacks idempotentes | Misma clave igual/distinta, dos claves concurrentes, redelivery, callbacks antes/después del resultado HTTP |
| ¿Cierre mientras sale alerta? | Cierre cancela autorizaciones futuras pertinentes; intento anterior puede completar | Forzar cierre-primero/autorizar-primero; revocación independiente; conservar SOS activo y omitir nueva ubicación tras revocar |
| ¿Miles de conductores? | Telemetría separada de despacho, pools/cupos limitados y expansión por evidencia | Carga mixta de muestras, polling, reconexión, SOS, proveedor lento y reinicio; medir colas, DB y latencia |

Pruebas adicionales obligatorias del protocolo:

- Claim vencido antes de autorizar: el worker antiguo no obtiene autorización.
- Emisor pausado después de autorizar, vencimiento, redelivery y cierre/revocación: ningún segundo worker envía; el original puede enviar después conforme al contrato declarado.
- Consulta «no encontrado» con emisor pausado: no permite otro intento; el paso del tiempo no acredita quiescencia.
- Mensaje retirado/agotado y reinicio: el scanner recupera reconciliación y repone transporte sin duplicar autorización/envío.
- Mapa autorizado antes de revocar puede responder después; autorización posterior falla. SOS abierto continúa sin nuevas coordenadas revocadas; contacto revocado no recibe nuevas autorizaciones.

Estas pruebas no se han ejecutado. Preparar demo de un recorrido completo y un fallo recuperado, con vistas diferenciadas de datos sintéticos y dispositivos/proveedor reales. Entrega del hackathon por URL accesible en ventana privada; no depender de permisos o sesiones locales del organizador.

## Escala, coste y límites

Modelo: `N/u` muestras por segundo y `N*c/p` lecturas por segundo, con N viajes activos, u intervalo de muestra, c contactos observando y p intervalo de polling. Ejemplo ilustrativo: 10.000 viajes, u=15 s, c=2, p=10 s → unas 667 muestras/s y 2.000 lecturas/s. No es una cadencia seleccionada ni capacidad demostrada. La historia, índices, WAL y copias pesan más que la última posición; limitar conservación y batches desde el inicio.

Autoscaling por latencia/carga y edad de cola, con máximo que respete conexiones/cuotas. Aumentar tareas no aumenta indefinidamente PostgreSQL. Mantener lectura de permisos en la autoridad consistente; no pasar autorización/revocación a una réplica atrasada. Separar historia o añadir streaming/transportes push solo si métricas identifican ese cuello de botella. No introducir Kubernetes, Kafka, Redis ni multi-región en esta demo.

Pérdida de SQL: no confirmar SOS/acciones que no pudieron persistirse. Pérdida de SQS: intención pendiente en outbox, con demora visible. Pérdida de Zavu: estados por canal y límites de reintento, sin afirmar entrega. Una caída regional y una indisponibilidad completa del proveedor siguen fuera de la tolerancia del primer despliegue. Robustez no equivale a disponibilidad absoluta.

La configuración HA cuesta más que una demo mínima. Estimar Fargate, ALB, RDS Multi-AZ, SQS, S3, logs y egreso/NAT con la región/cuenta reales antes del despliegue. Créditos Andes autorizados no prueban créditos AWS. Sin cotización ni prueba de restauración no se afirma preparación operativa.

## Fuentes y alcance de esta decisión

- [AWS transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html): commit y publicación separados, duplicados que requieren consumidores idempotentes.
- [Lambda/SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html): procesamiento repetido; no convierte el envío externo en exactamente una vez.
- [ECS autoscaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html): aumentar/reducir tareas según métricas, sujeto a dependencias.
- [RDS Multi-AZ](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html): disponibilidad y failover; standby distinto de escalado de lectura.
- [RDS Proxy y pinning](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html): no solucionar locks de sesión agregando un proxy.
- [Revisión independiente previa](reviews/2026-10-17-scalability-review.md): problemas que motivan esta decisión.

Robert delegó la decisión, por lo que no se vuelve a pedir elegir AWS frente a otra opción. Aún hay que validar infraestructura disponible, contratos de proveedores y evidencia de campo. Las decisiones anteriores incompatibles se retiran; los planes afectados deben citar este ADR antes de ejecutarse.
