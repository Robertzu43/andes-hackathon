# Estado de la alerta

Route: /trips/:tripId/alerts
Owner: component50
Job: Separate local intent, server acceptance, channel facts and contact response

First phone viewport: route title, actual state or explicit empty/loading/error state, the next meaningful action, and any limit directly affecting that action.

Primary action: Ver respuesta. Its label and result must agree; unsupported actions show the recovery/limit.

Required sections: Solicitud, Canales, Respuesta de contactos.

States: loading, empty, populated, unauthenticated/forbidden, expired/revoked where applicable, validation error, network failure, ambiguous write, success, disabled, long Spanish/pt-BR text, focus and reduced motion. Sensitive facts require live authorisation; do not embed route data in share-card or page metadata.

Proof: actual backend records/source time; synthetic fixtures clearly labelled. Conversion traces are local test receipts; no analytics collection or external transport enabled. No schema.org safety claims.

Viewports:390x844,1440x900,1920x1080; narrow phone360x800 and large phone430x932. Validate every declared control and meaningful state, plus browser back/reload, keyboard/focus and zero horizontal overflow. No actual physical qualification is implied.
