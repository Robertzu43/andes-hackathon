<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/design/assets/tandem-logo-white.svg">
    <img src="docs/design/assets/tandem-logo-ink.svg" alt="Tándem" width="320">
  </picture>
</p>

<h1 align="center">Tándem · Hack the Andes 2026</h1>

<p align="center"><strong>Tu gente, contigo en ruta.</strong></p>

<p align="center">Track Seguridad · Equipo GOAT</p>

<p align="center">
  <a href="https://an-1dc2ae9cdfee46e6bfe399ec607092d5.ecs.us-east-1.on.aws"><code>Demo ↗</code></a>
  <a href="https://an-1dc2ae9cdfee46e6bfe399ec607092d5.ecs.us-east-1.on.aws/deck.html"><code>Pitch deck ↗</code></a>
  <a href="https://github.com/Robertzu43/andes-hackathon/actions/workflows/ci.yml?query=branch%3Amain"><code>CI · main ↗</code></a>
</p>

Tándem es una app para el transportista que maneja su propio camión. Las personas que él elige (su familia, sus colegas) ven su viaje y si pidió ayuda. Si toca SOS, o si deja de dar señales y no responde «Estoy bien», el servidor les avisa por SMS, WhatsApp y llamada. No hay central de monitoreo: la red de apoyo es la gente que el conductor ya tiene.

ANDES es el nombre del repositorio; Tándem es la app; GOAT es el equipo.

## Demo visual

https://github.com/user-attachments/assets/e61305c9-1cba-4d34-8cfa-dabb34a9266d

## Para el jurado

**Demo:** https://an-1dc2ae9cdfee46e6bfe399ec607092d5.ecs.us-east-1.on.aws · **Deck:** [/deck.html](https://an-1dc2ae9cdfee46e6bfe399ec607092d5.ecs.us-east-1.on.aws/deck.html)

Ábrela en una ventana privada: no pide cuenta, código ni permisos. **Empezar** crea una sesión de demostración aislada ([`POST /v1/demo/session`](docs/contracts/runtime.md#demo-mode)) con un camión y dos contactos (familia y colega) que ya aceptaron.

1. **Registrar el viaje:** marcas «Estoy detenido», escribes origen y destino y confirmas. Nada se activa sin esa confirmación.
2. **Control y pedido de ayuda:** «Estoy bien» responde un control abierto por el servidor; **SOS** avisa al instante.
3. **Estado de los avisos:** cada destinatario y canal con su estado real (pendiente, aceptado por el proveedor, no disponible…). Registrar no es entregar, y entregar no es que alguien actuó.
4. **Ver el aviso como contacto:** la misma ventana abre la vista de la familia, con el incidente y sus acciones.

> [!IMPORTANT]
> La demo corre en AWS con envío real activado: el SMS sale por Zavu y la llamada por Twilio, **solo al número autorizado para la prueba**. Cualquier otro destino se rechaza antes de llamar al proveedor.

Sin la URL se puede verificar el [CI de `main`](https://github.com/Robertzu43/andes-hackathon/actions/workflows/ci.yml?query=branch%3Amain) o, con un PostgreSQL desechable, `npm run demo` ([comandos](#estructura-y-comandos)). El problema, el usuario y las cifras con fuente están en la [descripción de la entrega](docs/submission/descripcion.md) y en el deck.

## El problema y para quién

Durante un asalto, el conductor puede no lograr pedir ayuda: le quitan el celular o lo amenazan. Las grandes flotas tienen telemetría y una central. El **hombre-camión**, el dueño que maneja uno o dos camiones, solo tiene a su gente y sus grupos de WhatsApp. En Perú, 96 de cada 100 vehículos de carga formales están en empresas con menos de 250 unidades, y 3 de cada 4 de esas empresas son hombre-camión (MTC, citado en el deck). Nuestra hipótesis, todavía sin comprobar, es que entre «algo salió mal» y «alguien actúa» se pierde un tiempo evitable.

- **El conductor:** transportista independiente en Latinoamérica, incluido Brasil. No hace falta cuenta de flota ni central.
- **Su gente:** contactos de confianza en dos roles, **familia** y **colegas**. Cada uno acepta por su cuenta con su número verificado, y cualquiera de los dos puede revocar.

Un teléfono en silencio no prueba un robo ni que el conductor se durmió, y Tándem no lo trata como si lo probara. La interfaz está en español y portugués de Brasil; la demo usa Perú (emergencias 105).

## Cómo funciona

- **Viaje confirmado.** Origen, destino, llegada prevista (en el futuro), camión, país, idioma y zona horaria, y hasta diez contactos ya aceptados. El viaje por voz no está implementado (`422 unsupported_audio`).
- **Ubicación con frescura honesta.** El contacto con permiso de mapa ve la última ubicación con hora de captura, antigüedad y precisión: «reciente» hasta 120 s, después «antigua», y sin muestras «no disponible». El permiso se revisa en cada lectura.
- **Pausa.** Suspende los controles y avisos ordinarios; el SOS sigue disponible.
- **Control «Estoy bien».** Lo abre el servidor, no el celular: cuando se deja de compartir ubicación, cuando no hay señales de vida o cuando la llegada se atrasa. Los tiempos de la demo (2 min sin señal, 1 min para responder, 2 min de gracia) son de escenario, no umbrales validados ([#11](https://github.com/Robertzu43/andes-hackathon/issues/11)).
- **Escalamiento.** Sin respuesta, el servidor abre un incidente y avisa como un SOS: qué no se confirmó, la última ubicación con su antigüedad y «No sabemos qué pasó. Llámalo; si no responde, llama al 105». Un «Estoy bien» tardío no cancela la alerta: solo el conductor la cierra, porque un OK bajo amenaza no debe silenciar al resto.
- **SOS.** Un toque guarda en una sola transacción el incidente y un trabajo por destinatario y canal: familia por SMS, WhatsApp y llamada; colegas por SMS y WhatsApp. Varios toques se unen al mismo episodio, y «Llegué» no cierra un SOS abierto. El aviso al grupo de WhatsApp de choferes queda siempre «no disponible» (`group_support_unverified`) hasta verificar que el proveedor entrega a grupos.
- **Respuesta del contacto.** Marcar que recibió y registrar qué hizo son hechos separados: entregado no es leído, y leído no es ayuda.
- **Mapa de zonas.** El conductor etiqueta cada incidente (robo, intento, falsa alarma, sin señal, otro). La página pública `/mapa` muestra celdas de ~5 km, día y noche, de los últimos 90 días, y cuenta **personas distintas**, no reportes. Una zona solo aparece con al menos 3 personas con teléfono verificado, y la página avisa si incluye datos de demostración.

## Qué funciona hoy y qué no

| En `main`, con pruebas automáticas | Dónde |
|---|---|
| API: camiones, contactos, viajes, ubicación, Pausa / Estoy bien / Llegué, SOS, incidentes, etiquetas, reportes, estado y lecturas del contacto | [`src/`](src/), [contrato](docs/contracts/runtime.md) |
| Envío durable: outbox, colas SQS, intentos por canal, conciliación, Zavu (SMS, WhatsApp, llamada), voz por Twilio y callbacks firmados | [`src/notifications/`](src/notifications/) |
| Controles y escalamiento en el servidor | [`src/checks/`](src/checks/) |
| Modo demo sin cuenta (personas sintéticas aisladas) | [`src/demo.ts`](src/demo.ts) |
| Mapa público de zonas | [`src/insights/`](src/insights/), [`public/mapa.html`](public/mapa.html) |
| App web: recorrido del conductor, vista del contacto, privacidad y cliente tipado de la API | [`web/`](web/README.md) |
| Despliegue de la demo en AWS (ECS Express, una tarea) | [`infra/demo/deploy.sh`](infra/demo/deploy.sh) |

**Todavía no:** compartir el GPS desde el teléfono (la API lo recibe; la app web aún no lo captura), el viaje por voz, la verificación del número por código en la demo (el contacto sembrado ya aceptó) y la plantilla de alta disponibilidad aplicada en AWS.

**Sin validar** (gates abiertos): entrevistas con transportistas y sus contactos ([#8](https://github.com/Robertzu43/andes-hackathon/issues/8)), límites del teléfono físico con pantalla bloqueada ([#9](https://github.com/Robertzu43/andes-hackathon/issues/9)), recibos reales del proveedor a escala ([#10](https://github.com/Robertzu43/andes-hackathon/issues/10)) y umbrales de seguridad ([#11](https://github.com/Robertzu43/andes-hackathon/issues/11)).

## Arquitectura

![Arquitectura de ANDES en AWS. El conductor y el contacto entran por un ALB HTTPS a la API en ECS/Fargate. La API guarda incidente, trabajos y outbox en un solo commit en RDS PostgreSQL Multi-AZ. El worker de control publica en dos colas SQS, emergencia y ordinaria, cada una con su DLQ, que solo llevan ID y versión. Los servicios de entrega autorizan en SQL, liberan la conexión y llaman a Zavu. Zavu devuelve callbacks firmados a la API.](docs/architecture/diagrams/andes-infrastructure-professional.svg)

[ADR-002](docs/architecture/ADR-002-aws-durable-dispatch.md): API modular en **TypeScript/Fastify**, una imagen y cuatro procesos en **ECS/Fargate** (API, control, entrega de emergencia y entrega ordinaria), **RDS PostgreSQL** como única autoridad de estado, **outbox transaccional** hacia **SQS** con colas separadas, y **Zavu** para SMS, WhatsApp y llamada. Cada decisión responde a una falla concreta:

| Decisión | Falla que evita |
|---|---|
| PostgreSQL es la autoridad; ni el teléfono ni la memoria de un proceso lo son | Perder una alerta porque el teléfono se apagó o un proceso se reinició |
| Incidente, trabajos e intención de publicar en un solo commit (outbox) | «Guardé el SOS pero no lo encolé» |
| Colas de emergencia y ordinaria separadas, con DLQ, que solo llevan ID, versión y clase | Que el trabajo ordinario retrase un SOS, o que teléfonos y ubicaciones viajen por la cola |
| Un solo intento autorizado por trabajo y versión; un resultado perdido queda «desconocido» y se concilia con el proveedor | Una alarma doble a ciegas |
| Cupos por canal en cada consumidor | Que un WhatsApp lento frene el SMS y la llamada |
| Transacciones cortas, solo SQL; pools separados para comandos, telemetría y callbacks | Agotar la base esperando al proveedor, o que un pico de ubicaciones deje sin conexión al SOS |
| Cerrar el viaje o revocar serializa con la autorización de envíos | Autorizar un aviso nuevo con la ubicación después de revocar |
| Los controles corren en el servidor, cada viaje en su propia transacción | Depender de un temporizador del navegador, o duplicar un escalamiento al reiniciar |

Ningún componente promete entrega «exactamente una vez»; el diseño la acota con autorización única y conciliación. La [justificación](docs/architecture/justificacion-arquitectura.md) explica por qué escala y por qué no Lambda, Step Functions, DynamoDB, Kubernetes, Kafka o Redis.

**Despliegue.** La demo corre con [`infra/demo/deploy.sh`](infra/demo/deploy.sh): ECS Express con una sola tarea Fargate (API, control y, con envío real, los consumidores de entrega), RDS PostgreSQL de una zona y las dos colas SQS. Debe ser una sola tarea, porque la clave que firma los tokens de demo vive en memoria. El objetivo de alta disponibilidad es [`infra/template.json`](infra/template.json) (cuatro servicios en dos zonas, RDS Multi-AZ, ALB HTTPS, SQS con DLQ, Secrets Manager y CloudWatch): pasa `cfn-lint` en CI pero no se ha aplicado. El [runbook](infra/README.md) tiene los requisitos.

## Diseño

La app usa Manrope y la paleta del deck ([`web/src/styles/tokens.css`](web/src/styles/tokens.css)). El sistema de diseño está en [`docs/design/`](docs/design/README.md): la identidad (dos caminos que forman una T), la [especificación](docs/design/specification.md), los tokens fuente, la galería HTML y seis pantallas de referencia, con catorce pares de contraste revisados ([verificación](docs/design/evidence/verification.md)). Los controles en ruta miden al menos 80 px y el orden Estoy bien, Pausa, SOS no cambia.

## Calidad

Cada push y cada PR corren [`ci.yml`](.github/workflows/ci.yml) con tres jobs independientes. Ninguna prueba envía mensajes reales: todos los teléfonos e identidades son sintéticos.

| Job | Qué corre |
|---|---|
| `backend` | Typecheck; `npm test` contra PostgreSQL 18; el cliente compartido contra el backend real; `npm run demo`; `cfn-lint`; `docker compose config`; imagen `linux/amd64` |
| `web` | Typecheck; build estricto y `npm test`; tipos de la API en modos NodeNext y Bundler |
| `app-integration` | Arnés con su propio PostgreSQL y reinicios de procesos; costura de navegador; la demo del teléfono en Chrome contra el backend real |

Todo entra por PR. Robert fusiona todos, incluidos los suyos, con `--match-head-commit` sobre el SHA revisado, y cada hallazgo se cierra con su commit y su prueba de regresión ([`CONTRIBUTING.md`](CONTRIBUTING.md)).

## Tracción

> [!WARNING]
> Una entrevista, informada por Sebastian Bimbi: un camionero de Colombia quiere usar Tándem y declaró que pagaría hasta US$100 al mes. Es intención declarada, no una venta ni una validación representativa. No hay usuarios ni uso real todavía.

El protocolo completo ([#8](https://github.com/Robertzu43/andes-hackathon/issues/8)) es exploratorio: cinco pares de conductor y contacto, cada uno reconstruye un viaje preocupante y uno normal. Las guías en español y portugués, el brief de la cohorte y las planillas están en [`docs/research/`](docs/research/README.md).

## Limitaciones

- No evitamos robos ni detectamos armas, sueño o fatiga. Sin respuesta es «estado sin confirmar», nunca «robo confirmado».
- Si el ladrón presiona «Estoy bien», hoy no lo podemos distinguir.
- Los mensajes de alerta están solo en español.
- La demo es una tarea en una zona, sin alta disponibilidad ni prueba de carga. Los tokens de demo terminan al reiniciar, hay un máximo de 30 sesiones por minuto y el modo demo nunca se debe activar con usuarios reales.
- Mapa de zonas: tres cuentas verificadas coordinadas pueden publicar una celda; antes de datos reales hay que subir el mínimo, ponderar por antigüedad o agregar ruido. Las coordenadas aún no tienen política de borrado.
- Los límites del backend aceptados para la demo están en el [contrato](docs/contracts/runtime.md#known-backend-limits-accepted-for-the-demo).

## Estructura y comandos

| Carpeta | Qué contiene |
|---|---|
| [`src/`](src/) | Backend TypeScript: API Fastify, envío durable, controles, demo e insights |
| [`db/migrations/`](db/migrations/) | Migraciones SQL numeradas, con hash verificado |
| [`web/`](web/README.md) | App web React + Vite |
| [`public/`](public/) | La página pública del mapa (`/mapa`) |
| [`scripts/`](scripts/) | Bootstrap, semilla de demo, demo sintética y arnés de integración |
| [`tests/`](tests/) | Pruebas del backend contra PostgreSQL real |
| [`infra/`](infra/README.md) | Plantilla CloudFormation, script de la demo y runbook |
| [`docs/`](docs/) | [Plan](docs/PLAN.md), ADR, contratos, diseño, investigación y entrega |

Node 24–26. Las pruebas necesitan un PostgreSQL 15+ desechable; nunca uses datos reales.

| Comando | Para qué |
|---|---|
| `npm ci` · `npm run typecheck` | Instala y revisa tipos del backend |
| `TEST_DATABASE_URL=… npm test` | Compila y corre las pruebas (cada una crea y borra su esquema) |
| `npm run demo` | Recorrido sintético: confirmación, ubicación, SOS duplicado, reinicio sin reenvío y revocación |
| `npm run build` · `npm start` | Compila · arranca la API |
| `npm run migrate` · `npm run bootstrap` | Migraciones · bootstrap de administrador (login de la app, migraciones y permisos) |
| `SEED_DEMO=1 npm run seed:demo` | Datos sintéticos para el mapa (después de `npm run build`) |
| `npm run worker:control` · `worker:emergency` · `worker:ordinary` | Workers; los de entrega no arrancan con `ZAVU_LIVE_SEND=false` |
| `npm ci --prefix web` · `npm --prefix web test` · `npm --prefix web run test:phone` | App web: instalar, probar, demo del teléfono en Chrome |
| `node scripts/app-integration/run.mjs` | Arnés de integración con su propio PostgreSQL |

Con Docker Compose (solo datos sintéticos; define antes `LOCAL_ADMIN_PASSWORD` y `LOCAL_APP_PASSWORD`):

```sh
docker compose up -d db
docker compose run --rm bootstrap
# Define OIDC_ISSUER, OIDC_AUDIENCE y OIDC_JWKS_URL de un emisor real
docker compose --profile api up -d api
```

## Equipo y licencia

Somos el equipo **GOAT**. El conductor y su gente avanzan juntos, en tándem: por eso el símbolo son dos caminos que forman una T.

| | Responsabilidades principales |
|---|---|
| **Robert** ([@Robertzu43](https://github.com/Robertzu43)) | Arquitectura, estado del servidor y contratos de eventos, envío durable, integraciones de canales, infraestructura y evaluación reproducible |
| **Sebastian** ([@sebasbimbi](https://github.com/sebasbimbi)) | Evidencia con conductores, acceso al proveedor, la app web (base, cliente tipado, recorridos del conductor y del contacto), consentimiento y decisiones de piloto; el pitch deck |

**Licencia:** sin licencia definida todavía.
