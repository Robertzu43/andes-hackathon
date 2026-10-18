# App funcional en teléfonos reales: diseño

Fecha: 2026-10-18. Estado: aprobado por Robert, sección por sección, en brainstorming. Revisión 3: incorpora dos revisiones de la spec. Base: `main` 23e9f33. Planes A, B y C congelados.

## Revisiones de la spec

El cuerpo del PR #96 dice que la spec tuvo tres revisiones aprobadas. Ni el cuerpo ni los comentarios traen enlaces:

1. link pending
2. link pending
3. link pending

## Objetivo y criterio de éxito

Tener una app de Tándem (ANDES) que funcione de punta a punta en dos teléfonos físicos, con alertas reales. La `DEMO_URL` del deck abre **la app del conductor**.

Hay éxito cuando, sobre una URL HTTPS:

1. Un conductor nuevo hace todo esto con un recorrido guiado: se registra, registra su camión y agrega a su contacto de emergencia con el número del contacto.
2. El contacto abre el link en otro teléfono, verifica **su** número con un código SMS y acepta.
3. Solo con el contacto ya aceptado, el conductor crea y confirma el viaje. El contacto queda unido al viaje.
4. El teléfono del conductor comparte la ubicación en vivo, y el contacto la ve.
5. Un silencio abre un check y, sin respuesta, escala, con alertas reales al contacto.
6. Un SOS, que mejora el incidente de check abierto, hace llegar SMS, WhatsApp y llamada reales con la redacción de SOS.
7. El conductor marca **«Ya estoy a salvo»**, que resuelve el incidente, y después «Llegué» corta la ubicación.
8. La corrida queda registrada como evidencia con horas y capturas.

El orden de 5 y 6 lo impone el backend: el sweeper no abre checks mientras el viaje tiene un incidente activo (`src/checks/sweep.ts`, `dueReasons`). Un SOS sí mejora un incidente de check abierto (`src/incidents/routes.ts:15-19`).

## Alcance

**Dentro:**
- servir la app web desde el backend;
- arranque de la app en producción y pantallas del conductor;
- recorrido guiado con spotlight;
- link del contacto, verificación y aceptación;
- números propios verificados por SMS en modo demo;
- túnel HTTPS y prueba con dos teléfonos;
- deploy en AWS con `infra/demo/deploy.sh` corregido;
- `DEMO_URL` en el deck.

**Fuera:**
- viaje por voz (el backend responde 422 `unsupported_audio`);
- aviso a grupos de WhatsApp (sigue `group_support_unverified`);
- matriz completa del issue #9 y Android como plataforma soportada;
- login OIDC de producción, que no cambia;
- detección automática de sueño o robo.

## 1. Arquitectura y cómo corre

**Un solo origen.**
- `src/server.ts` sirve la API `/v1/*` (sin cambios), `/mapa` (ya existe) y la app web compilada `web/dist`.
- Las rutas que no son API ni archivos devuelven `index.html`.
- El hook de autenticación de `src/api/app.ts` (líneas 23-25 en 23e9f33) agrega a sus excepciones los archivos estáticos, el fallback `index.html` y `/`. Las rutas `/v1/*` siguen autenticadas como hoy.
- Se implementa con unas pocas líneas propias (lectura de `web/dist`, tabla de tipos MIME y bloqueo de `..`), **sin dependencia nueva**.
- No hay CORS.
- El `Dockerfile` compila la web y copia `web/dist`. La misma imagen sirve para el túnel y para AWS.

**Procesos.** Con SQS real en todos:
- `server`, la API;
- `worker control`: sweeper de checks, outbox, relay y la purga de mundos demo (sección 4);
- `worker emergency` y `worker ordinary`: los consumidores de entrega.

`src/worker.ts` exige `AWS_REGION`, `SQS_EMERGENCY_URL` y `SQS_ORDINARY_URL`.

**IP del cliente.** Fastify se crea con `trustProxy` igual a **exactamente un salto** (`TRUST_PROXY_HOPS=1`): `cloudflared` local en la etapa 1, y el balanceador de ECS Express en la etapa 2. Los límites por IP usan `request.ip`. Nunca `trustProxy: true`, porque `X-Forwarded-For` sería falsificable.

**Etapa 1, túnel:**
1. `docker compose` levanta Postgres.
2. Los cuatro procesos corren locales con `DEMO_MODE=true` y Zavu real. El servidor escucha en **`127.0.0.1`**, con la variable nueva `HOST` (por defecto `0.0.0.0`, que es lo que necesita el contenedor en AWS). Así nadie en la misma red se conecta directo y falsifica `X-Forwarded-For`.
3. `cloudflared tunnel --url http://127.0.0.1:3000` da una URL `https://…trycloudflare.com`. HTTPS es obligatorio para la geolocalización.

**Etapa 2, AWS:** `deploy.sh` con la misma imagen. Es una "demo reducida": una tarea, una zona de disponibilidad. En 23e9f33, `deploy.sh` **no alcanza** y hay que corregirlo:
- La tarea hoy corre solo `worker control & server`. Tiene que correr también `worker emergency` y `worker ordinary`.
- El rol de la tarea hoy solo tiene `sqs:SendMessage`. Necesita también `ReceiveMessage`, `DeleteMessage` y `ChangeMessageVisibility` sobre las dos colas.
- El entorno hoy fija `ZAVU_LIVE_SEND=false` y no tiene secretos. Necesita, desde Secrets Manager: la API key de Zavu, el secreto de callbacks, `ZAVU_QUALIFICATION_JSON`, las variables `DEMO_*` y `DEMO_PHONE_PEPPER`. También necesita `ZAVU_PROJECT_ID` y `ZAVU_SENDER_ID`, iguales al `accountId` y al `senderId` de la configuración, porque sin ellos `configuredProvider` falla al arrancar. El rol de ejecución necesita `GetSecretValue` sobre cada secreto nuevo, no solo sobre `andes-demo/app-db`.
- **Migraciones:** las tablas nuevas se migran **antes** de `deploy.sh lock`, porque después la laptop ya no llega a RDS.
- **Interruptor sin caída:** con `ZAVU_LIVE_SEND=false`, el script **no lanza** los consumidores. `startWorker` los rechaza sin proveedor, y con `wait -n; exit 1` tumbarían la tarea entera, API incluida. Con los envíos apagados, los jobs quedan registrados como no disponibles y la app sigue arriba.

## 2. App web

### Arranque en producción (`web/src/main.tsx`)

`FoundationRoot` recibe:
- `session`: la sesión de demo de #81, con un solo mundo compartido entre personas;
- `routes`: las pantallas del conductor, las del contacto (#62) y la de privacidad, contra el cliente tipado de #59 con el mismo origen.

La ganchera de tests (`__ANDES_TEST_HOOKS__`) queda solo para builds de prueba. El idioma por defecto es español, con `pt-BR` disponible.

### Recorrido del conductor, en este orden

El orden lo impone el backend: un contacto se une a un viaje **solo al confirmarlo**. `POST /v1/trip-drafts/:id/confirm` rechaza grants pendientes con 409 `contact_not_accepted` (`src/trips/routes.ts:52`) e inserta `trip_grants` únicamente en ese momento (`:57`).

| Paso y ruta | Pantalla |
|---|---|
| 1 · `/` | Bienvenida: qué es Tándem («tu gente, contigo en ruta; sin central») y botón **Empezar**, que crea el mundo de demo. Si ya hay sesión, salta al paso que corresponde. |
| 2 · `/trucks` | Registrar el camión (placa o apodo) con `POST /v1/trucks`. |
| 3 · `/contacts` | Agregar al contacto de emergencia (sección 3). La pantalla **espera** con polling de `GET /v1/contacts` hasta que el grant está **aceptado**, mostrando «Esperando que tu contacto acepte…» y el link para compartir. También ofrece «Empezar de nuevo» por si el número estaba mal (sección 3). |
| 4 · `/trips/new` | Viaje por texto: descripción, origen y destino, hora de llegada futura, **país** (selector limitado a `DEMO_ALLOWED_COUNTRIES`, por defecto PE), **locale** (el idioma de la interfaz, canónico `es` o `pt-BR`) y **zona horaria** (la del dispositivo, `Intl.DateTimeFormat().resolvedOptions().timeZone`). Envía el **grant family aceptado** y el grant del colega, para que aparezca la fila *no permitido*. Revisar el borrador y confirmar. |
| 5 · `/trips/:tripId` | **Viaje activo** (ver abajo). |
| `/trips/:tripId/check-in` | Banner de check a pantalla completa con **Estoy bien** y el tiempo restante (`askUntil`). |
| `/trips/:tripId/alerts` | Estado de cada envío por destinatario y canal, sin teléfonos. |
| `/trips/:tripId/summary` | Resumen al llegar. |
| `/privacy` | La página de privacidad que ya existe. |

Los campos que exige el borrador (`requiredFields` en `src/trips/routes.ts`) se completan todos. La configuración de Zavu tiene una entrada por cada combinación país + locale + canal habilitada, porque los canales solo funcionan cuando `trip.country` y el locale canónico coinciden con una entrada.

**Viaje activo:**
- **Ubicación:** botón **Compartir ubicación**, que requiere un gesto por el permiso del navegador. Muestra el estado *compartiendo / vieja / sin datos* y la hora de la última lectura, que vienen de `/v1/trips/:id/status`. Pide un *wake lock* de pantalla si el navegador lo permite.
- **Botones grandes:** **SOS** (rojo y dominante, un toque, como `requestHelp()`), **Estoy bien**, **Hacer una pausa / Continuar** y **Llegué**.
- **«Ya estoy a salvo»:** aparece solo con un incidente activo. Llama a `resolveIncident` (ya existe en `web/src/lib/api/client.ts:196`; el backend exige que sea el dueño). Se agrega como operación al controlador de #63. Eso supera el límite documentado de «a lo sumo 5 escrituras» de `web/src/features/driver/README.md`, así que el plan B lo sube a propósito, con sus tests, en vez de reusar el lugar de `sos`. «Llegué» **no** resuelve un SOS abierto, igual que en el backend.
- **Polling** de `/status` cada 5 s. Si hay un check abierto, abre el banner.

**GPS:**
- El adaptador de #52 (`src/phone-observations/`, en el árbol del backend) alimenta la cola de #66, que sube a `/v1/trips/:id/locations`. El GPS sigue apagado hasta el paquete de calificación de dispositivo físico de Plan C.
- La web lo importa con un alias de Vite. El plan decide si moverlo a un paquete compartido.
- `ownerSubject` es igual al `sub` del token del conductor.
- Si se niega el permiso o se detiene el envío, se ve en la pantalla y se notifica a `POST /v1/trips/:id/sharing`.
- En iOS, con la pantalla bloqueada la ubicación se detiene, y la app lo muestra como *sin datos*. El check del servidor solo cubre ese hueco si alguien del mundo sigue presente (sección 3).

### Recorrido guiado con spotlight

Es un componente propio, sin librerías. Oscurece la pantalla con una sombra (`box-shadow` alrededor del rectángulo del elemento) y explica una parte a la vez, con **Siguiente**, **Atrás** y **Saltar**.

- Se maneja con teclado, tiene foco visible y respeta `prefers-reduced-motion`.
- Se puede volver a ver desde **¿Cómo funciona?**.
- Recuerda que ya se vio en `localStorage`, con `try/catch`; si falla, simplemente se muestra.
- Nunca hace escrituras y nunca tapa el botón SOS.

**Pasos para el conductor:**
1. Bienvenida.
2. Camión.
3. Contacto de emergencia: por qué tiene que aceptar antes del viaje.
4. Primer viaje.
5. Compartir ubicación: quién la ve, y qué significan *vieja* y *sin datos*.
6. Estoy bien: el silencio no es una alarma inmediata.
7. Pausa: suspende los checks, pero el SOS sigue activo.
8. SOS: un toque avisa al instante a la familia (SMS, WhatsApp y llamada) y a los colegas (SMS y WhatsApp).
9. El check automático: si no hay señales pregunta; si no respondes, avisa.
10. Alertas: qué se envió y por qué canal.
11. Llegué: termina el viaje y deja de compartir.

**Pasos para el contacto** (recorrido corto): qué ve, qué significa cada estado, y qué hacer ante una alerta: llamar y, si no responde, llamar al número de emergencia.

## 3. Contacto de emergencia, link y número verificado

**`/contacts`** adapta la pantalla `Management` de #62. El formulario de invitación con UUID y casillas de alcance se reemplaza en modo demo por **número del contacto + nombre visible + rol**:
- El nombre visible («Mamá») solo vive en el cliente.
- La app llama al endpoint real `POST /v1/contacts` con `{contactId: <persona family del mundo>, phone, map: true, incident: true, role}`.
- El grant queda **pendiente**.

**Link del contacto:**
- La forma es `/contact/invitations/:grantId#t=<token de la persona family>`.
- La app lee el token del fragmento, lo borra de la URL con `history.replaceState`, y nunca lo guarda en storage.
- El token vale 2 horas y solo sirve en ese mundo de demo.

**En el teléfono del contacto:**
1. Verifica su número con un código SMS (sección 4).
2. Acepta con `POST /v1/contacts/:id/accept`. Desde #91, la aceptación exige que la identidad tenga el teléfono verificado e igual al de la invitación.
3. Hace polling de `GET /v1/contact/trips` hasta que aparece el viaje confirmado, y abre `/contact/trips/:tripId`.
4. **La pantalla del contacto pide un wake lock y consulta `/v1/trips/:id/status` cada 5 s.** Así se actualiza, y además **mantiene la presencia** que el sweeper exige en modo demo (`src/checks/sweep.ts:16-30`, `:46-47`): un check solo se abre y escala si alguien del mundo hizo una petición autenticada dentro de `ASK_GRACE_MS`.

Si hay un solo teléfono, el mismo usuario abre el link en otra pestaña e ingresa su propio número.

**Número mal escrito:** `UNIQUE(driver_id, contact_id)` impide reinvitar a la misma persona family (409 `contact_already_invited`). La pantalla ofrece **«Empezar de nuevo»**, que crea un mundo nuevo.

## 4. Backend: modo demo con números verificados por OTP

**Cambios en `src/demo.ts` y en la respuesta de la sesión:**
- La sesión **ya no pre-crea** el camión `ABC-123 (demo)` ni el grant family, porque los dos se crean en el recorrido. `driver.truckId` y `family.grantId` salen de la respuesta.
- La respuesta suma **`tripCountries`**: los países con una entrada de canales en la configuración de Zavu. Son los únicos que ofrece el selector del viaje. Es un dato distinto de `DEMO_ALLOWED_COUNTRIES`, que solo decide qué teléfonos pueden recibir un código. Esta respuesta es el contrato entre el plan A y el plan B.
- El decodificador web (`web/src/lib/api/responses.ts:105`, `types.ts:73`) se actualiza en el mismo PR.
- La identidad family nace con `phone` nulo y `phone_verified=false`.
- El colega conserva su número ficticio sembrado. **No** tiene verificación OTP, así que el dispatch lo rechaza y aparece como *no permitido*.

**Verificación OTP con su propia marca.** Tabla nueva `demo_phone_verifications(identity_id, phone, verified_at)`, distinta de `identities.phone_verified`. La siembra marca esa columna como `true`, así que no sirve para distinguir. Solo el flujo OTP escribe en la tabla nueva.

**Endpoints nuevos (solo con `DEMO_MODE=true`):**

`POST /v1/demo/phone/start` con `{phone}`:
- El actor es la persona del token.
- Valida E.164 y que el país esté en `DEMO_ALLOWED_COUNTRIES` (por ejemplo `PE,BR,CL,CO,MX,AR`; Robert puede agregar el suyo).
- Envía por Zavu SMS un código de 6 dígitos con el texto «Demo de Tándem: tu código es …».
- Guarda en `demo_phone_challenges(identity_id, phone_hmac, ip_hmac, code_hash, created_at, expires_at, attempts)` el hash del código y los HMAC del número y de la IP, con `DEMO_PHONE_PEPPER` y un vencimiento de 10 minutos. `created_at` alimenta los topes por hora.
- Con `ZAVU_LIVE_SEND=false` responde 503 `demo_sms_disabled` y no cuenta contra los topes.

`POST /v1/demo/phone/verify` con `{phone, code}`:
- Verifica que el HMAC de `phone` coincida con el reto, y compara el código en tiempo constante.
- Si coincide, escribe `demo_phone_verifications` y actualiza `identities.phone` y `phone_verified=true` de **esa** identidad, para que la aceptación de #91 funcione.

**Límites configurables**, para poder ensayar:
- `DEMO_OTP_PER_NUMBER_HOURLY` (por defecto 3);
- `DEMO_OTP_PER_IP_HOURLY` (por defecto 5, con IP de un salto de proxy);
- 5 intentos por código;
- `DEMO_SMS_DAILY_CAP`: tope global diario **de SMS de código**. Al alcanzarlo, `start` responde 429 `demo_budget_exhausted`.

**Allowlist dinámico, que reemplaza el guard de #74 por decisión explícita de Robert:**
- En modo demo con envíos reales, el chequeo estático `allowedDestinations` (`src/notifications/dispatch.ts:90`) se **reemplaza** por uno obligatorio y que falla cerrado: tiene que existir una fila en `demo_phone_verifications` con `identity_id = grant.contact_id` **y** `phone = grant.phone`. El chequeo queda atado al destinatario mismo.
- No hay excepción para `DEMO_LIVE_PHONE`. Robert verifica su número como cualquier usuario, y esa variable se elimina.
- `authorizeJob` recibe la configuración demo de forma explícita, `{enabled, alertsPerNumberDaily}`, construida al arrancar el worker desde el entorno.
- `src/worker.ts:16` deja de exigir `allowedDestinations == [DEMO_LIVE_PHONE]`. Con `DEMO_MODE` y envíos reales, exige `demoLimits`, `DEMO_ALERTS_PER_NUMBER_DAILY`, `DEMO_SMS_DAILY_CAP` y `DEMO_PHONE_PEPPER`. Si falta alguno, el arranque falla.
- Se agrega un tope de alertas por número verificado por día (`DEMO_ALERTS_PER_NUMBER_DAILY`), además de `demoLimits`.

**SMS de una vía (cuenta real de Zavu).** La cuenta solo tiene un remitente con el canal `sms_oneway`. La configuración de Zavu admite `smsMode: "oneway"`:
- Los SMS de código y las alertas por SMS salen como `sms_oneway`.
- La respuesta del envío (`accepted()`, `src/notifications/zavu.ts:~56`), la relectura (`read()`, `:~98`, que compara contra el canal guardado `sms`) y los callbacks (`verifyCallback`, `:~123`) aceptan `sms_oneway` y lo mapean al canal interno `sms`.

**Sin links en los SMS.** Zavu exige verificar cada URL exacta, y cada alerta trae un link de mapa distinto. En SMS, la ubicación va como texto: «Última ubicación hace {edad} (±{precisión} m): {lat}, {lon}». La llamada no lee identificadores ni UUIDs.

**Textos:**
- Los SMS de código los genera el código con el prefijo.
- Los textos de alerta vienen de la configuración de Zavu. En `DEMO_MODE`, el arranque **rechaza** entradas cuyo texto no empiece con «Demo de Tándem».
- La plantilla de WhatsApp aprobada tiene que contener ese prefijo.

**Purga de mundos demo.** El `worker control` corre cada 10 minutos una purga de los mundos cuya actividad más reciente, el `last_seen_at` máximo de sus identidades, tiene más de **24 h**:
- borra sus filas de `demo_phone_challenges` y `demo_phone_verifications`;
- deja `identities.phone` en nulo;
- borra o anonimiza los `contact_grants` de esas identidades. `contact_grants.phone` es `NOT NULL`: el plan elige borrar la fila, respetando las FKs con `trip_grants`, o sobrescribir el valor.

Un test verifica que después de la purga no queda el número en ninguna tabla. Los logs nunca guardan números: solo el HMAC.

**Producción no cambia:** sin `DEMO_MODE=true`, las rutas de demo no existen y el allowlist sigue igual.

**Tests de punta a punta:** el código de prueba y el proveedor falso solo se inyectan como opción en proceso de `createApp`. **Nunca** con una variable de entorno que acepte un código fijo, porque eso abriría un atajo al OTP en la URL pública.

## 5. Envíos reales y configuración

| Variable | Valor de la demo |
|---|---|
| `DEMO_MODE` | `true` |
| `ZAVU_LIVE_SEND` | `true` (en `false`, sin consumidores y sin caída) |
| `ZAVU_QUALIFICATION_JSON` | canales por país + locale, `demoLimits`, textos con el prefijo |
| `DEMO_ALLOWED_COUNTRIES` | por ejemplo `PE,BR,CL,CO,MX,AR` |
| `DEMO_OTP_PER_NUMBER_HOURLY` | 3 |
| `DEMO_OTP_PER_IP_HOURLY` | 5 |
| Topes de SMS | la tabla de abajo (una sola) |
| `DEMO_PHONE_PEPPER` | secreto aleatorio |
| `TRUST_PROXY_HOPS` | 1 |
| `SILENCE_MS` | 120000 (valor de demo, no un umbral de seguridad) |
| `ASK_GRACE_MS` | 60000 |
| `ARRIVAL_GRACE_MS` | 120000 |
| `CHECK_SWEEP_MS` | 5000 |
| `EMERGENCY_NUMBERS` | por ejemplo `{"PE":"105","BR":"190"}` |

La API key de Zavu y el secreto de callbacks van en el entorno local, o en Secrets Manager en AWS. Los callbacks entran por la misma URL. Si WhatsApp no tiene plantillas aprobadas en Zavu, el canal aparece como *no disponible*: no se simula.

En la URL de los jueces (AWS), los envíos reales quedan **activados con tope**. Se apagan con `ZAVU_LIVE_SEND=false`. La app sigue arriba, pero sin SMS no hay códigos: el contacto no puede verificarse y las alertas quedan como no disponibles.

### Topes de SMS

**Decided by Robert 2026-10-18.** Una sola tabla. `scripts/demo-local.sh` y la calificación usan estos números: 8 códigos/día y 6 alertas por número/día (`dailyLimit` 8, `channelDailyLimit` 6).

| Tope | Valor |
|---|---|
| `DEMO_SMS_DAILY_CAP` | 8 códigos/día |
| `DEMO_ALERTS_PER_NUMBER_DAILY` | 6 alertas por número/día |
| Calificación `dailyLimit` / `channelDailyLimit` | 8 / 6 |
| Techo de Zavu (plan gratis, no verificado) | 25 SMS/día |

Un ensayo manda dos olas a la familia, así que `demoLimits.perIncident` y `perSession` siguen en al menos 6.

## 6. Privacidad y abuso

- Ningún teléfono en pantallas, respuestas ni logs (#65, #91).
- Solo se envía a números verificados por OTP del mismo mundo, y el chequeo falla cerrado.
- Topes en tres capas: código (por número, por IP y global), alertas por número, y por sesión e incidente.
- Los mundos demo y sus números se purgan a las 24 h.
- El link del contacto es una credencial: va en el fragmento, se borra al abrirlo y vence en 2 h.
- Se mantiene el límite de 30 sesiones demo por minuto.

## 7. Pruebas automáticas

La misma puerta de siempre: el agente arregla, el revisor verifica con mutaciones y Robert mergea.

**Backend:**
- `/`, `/trips/<uuid>` y los assets devuelven la app sin autenticación; `/v1/*` sigue autenticado y en JSON.
- Pruebas de abuso del OTP: número no verificado, código vencido o equivocado, más de 5 intentos, topes por número e IP, país no permitido, otro mundo y presupuesto global agotado.
- IP: con un salto de proxy, un `X-Forwarded-For` falsificado no evade el límite.
- El dispatch envía solo a números OTP del mismo mundo. El colega sembrado queda *no permitido*. Si falta la configuración demo, falla cerrado.
- La sesión demo no pre-crea camión ni grant family.
- La purga no deja números.
- Producción sin `DEMO_MODE`: las rutas de demo no existen.

**Web:**
- Recorrido en orden: camión → contacto (espera la aceptación) → viaje con el grant aceptado → viaje activo → Estoy bien, Pausa, SOS y Llegué.
- Recorrido guiado: teclado, saltar, volver a verlo, reducir movimiento y que falle `localStorage`.
- Link del contacto: el token se lee del fragmento, se borra y no se guarda. El contacto hace polling de `/status`.

**De punta a punta en CI** (seam de #73, navegador contra el backend real): demo → camión → invitación → OTP con proveedor falso en proceso → aceptación → viaje → SOS → el status muestra las alertas.

## 8. Prueba en teléfonos reales

Con dos teléfonos físicos, sobre la URL del túnel y después sobre la de AWS. Para cada paso se anotan hora y captura:

1. Llega el código SMS al contacto, y el contacto acepta.
2. Se crea el viaje y el contacto lo ve.
3. La ubicación se actualiza; se anota la frecuencia y qué pasa con la pantalla bloqueada.
4. Funcionan Estoy bien y Pausa.
5. **Silencio:** con la pantalla del contacto abierta y sin bloqueo automático, para mantener la presencia, se **pone en modo avión el teléfono del conductor**. Así dejan de llegar la ubicación y las peticiones. Se prefiere a bloquearlo porque iOS puede descargar una pestaña bloqueada, y la recarga crearía un mundo nuevo que impide el SOS del paso 6. Se anota el check, su escalamiento y la llegada de las alertas al contacto.
6. **SOS** con el incidente de check todavía activo: llegan SMS, WhatsApp y llamada con la redacción de SOS, y se anota el tiempo desde el toque hasta cada recepción.
7. **«Ya estoy a salvo»** resuelve el incidente, y después **Llegué** corta la ubicación.

Se registra en `docs/evidence/phone-run-2026-10-18.md` con modelos, sistema operativo, navegador y red. Una corrida no completa la matriz del #9, y se dice así.

## 9. Orden de entrega y planes

Cada grupo tiene su propio plan de implementación y sus PRs. El revisor verifica y Robert mergea.

**Plan A, backend:**
1. Servir `web/dist`, excepciones del hook de autenticación, `Dockerfile`, `TRUST_PROXY_HOPS`.
2. OTP, `demo_phone_verifications`, allowlist dinámico que falla cerrado, sesión demo sin camión ni grant family, validación de prefijos y purga.

**Plan B, web:**
3. Arranque de producción y pantallas del conductor, en el orden de la sección 2. `web/src/main.tsx` monta las rutas del conductor y del contacto con un `SessionGateway` real (hoy renderiza `<FoundationRoot />` sin `routes` ni `session`).
4. Recorrido guiado.
5. Contacto: link, OTP, aceptación, polling de viajes y de status. E2E de navegador en CI: conductor → alerta → contacto, contra el backend real. El GPS sigue apagado hasta el paquete de Plan C.

**Plan C, operaciones:**
6. Túnel y prueba en dos teléfonos, con evidencia.
7. Corregir `deploy.sh` (consumidores, IAM, secretos, interruptor sin caída), desplegar en AWS y repetir la prueba corta.
8. `DEMO_URL` en el deck.

Los planes A y B avanzan en paralelo. El contrato que los une es la respuesta de la sesión demo y los endpoints OTP de la sección 4.

## Riesgos y pendientes

- **Zavu:** API key, canales habilitados y plantillas de WhatsApp. Sin plantillas, WhatsApp aparece como no disponible.
- **AWS:** perfil, cuenta y presupuesto de Robert. La etapa del túnel también los necesita por SQS.
- **iOS:** la ubicación se detiene con la pantalla bloqueada. Se muestra honestamente. El check del servidor solo cubre el hueco si la pantalla del contacto sigue abierta.
- **Recarga:** recargar la página crea un mundo nuevo, porque los tokens viven en memoria por diseño (#81). Cada ensayo pide un código nuevo, y por eso los topes son configurables.
- **Costo:** los SMS de código y las alertas gastan saldo; los topes lo limitan.
