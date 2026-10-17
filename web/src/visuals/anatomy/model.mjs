// Explanatory examples only. No live trip, deadline, provider or sensor inputs.
export const SCENARIOS = Object.freeze(['local', 'accepted', 'unconfirmed', 'acknowledged']);

export function exampleOf(name) {
  if (!SCENARIOS.includes(name)) throw new RangeError('Unknown relay example');
  return Object.freeze({
    name,
    local: name === 'local',
    serverAccepted: name !== 'local',
    delivery: 'unconfirmed',
    contactAcknowledged: name === 'acknowledged',
    assistance: 'unconfirmed',
    // Unitless mechanical poses, never elapsed time or delivery probabilities.
    dispatch: name === 'local' ? 0 : 1,
    carriage: name === 'local' ? 0 : 1,
    flag: name === 'acknowledged' ? 1 : 0,
  });
}

export const COPY = {
  es: {
    demo: 'Demostración', title: 'Qué confirma una alerta',
    intro: 'Una solicitud aceptada y una respuesta del contacto son hechos distintos.',
    parked: 'Explora los ejemplos con el camión estacionado.',
    figure: 'Figura 01', instrument: 'Relé de mensajes',
    svg: 'Relé mecánico con palanca de solicitud, carro de registro y una bandera independiente para la confirmación del contacto.',
    hint: 'Elige un ejemplo', group: 'Ejemplos de una alerta',
    controls: ['En el teléfono', 'Aceptada por el servidor', 'Entrega sin confirmar', 'Contacto confirma'],
    headings: ['En el teléfono', 'Aceptada por el servidor', 'Entrega sin confirmar', 'Contacto confirma'],
    details: [
      'La solicitud está en la cola local del teléfono. El servidor todavía no la ha aceptado.',
      'El servidor aceptó la solicitud. Esto no confirma que el mensaje haya llegado al contacto.',
      'Sin una confirmación de entrega, el resultado sigue sin conocerse. El mecanismo permanece en la misma posición.',
      'En este ejemplo, el contacto registró su confirmación por separado. Eso no confirma ayuda ni resuelve la alerta.',
    ],
    sources: ['Fuente: cola local del teléfono.', 'Fuente: respuesta del servidor.', 'Fuente: no hay confirmación de entrega.', 'Fuente: confirmación registrada por el contacto.'],
    facts: ['Solicitud', 'Entrega del mensaje', 'Respuesta del contacto', 'Ayuda recibida'],
    values: { local: 'Pendiente en el teléfono', accepted: 'Aceptada por el servidor', unknown: 'Sin confirmar', absent: 'No registrada', ack: 'Confirmación registrada' },
    legend: 'Palanca: solicitud · Carro: aceptación · Bandera: confirmación del contacto',
    caveat: 'Estos ejemplos no envían mensajes ni muestran el estado de un viaje. La entrega, la respuesta del contacto y la ayuda recibida se comprueban por separado.',
  },
  'pt-BR': {
    demo: 'Demonstração', title: 'O que um alerta confirma',
    intro: 'Uma solicitação aceita e uma resposta do contato são fatos distintos.',
    parked: 'Explore os exemplos com o caminhão estacionado.',
    figure: 'Figura 01', instrument: 'Relé de mensagens',
    svg: 'Relé mecânico com alavanca de solicitação, carro de registro e uma bandeira independente para a confirmação do contato.',
    hint: 'Escolha um exemplo', group: 'Exemplos de um alerta',
    controls: ['No telefone', 'Aceita pelo servidor', 'Entrega não confirmada', 'Contato confirma'],
    headings: ['No telefone', 'Aceita pelo servidor', 'Entrega não confirmada', 'Contato confirma'],
    details: [
      'A solicitação está na fila local do telefone. O servidor ainda não a aceitou.',
      'O servidor aceitou a solicitação. Isso não confirma que a mensagem chegou ao contato.',
      'Sem uma confirmação de entrega, o resultado continua desconhecido. O mecanismo permanece na mesma posição.',
      'Neste exemplo, o contato registrou sua confirmação separadamente. Isso não confirma ajuda nem resolve o alerta.',
    ],
    sources: ['Fonte: fila local do telefone.', 'Fonte: resposta do servidor.', 'Fonte: não há confirmação de entrega.', 'Fonte: confirmação registrada pelo contato.'],
    facts: ['Solicitação', 'Entrega da mensagem', 'Resposta do contato', 'Ajuda recebida'],
    values: { local: 'Pendente no telefone', accepted: 'Aceita pelo servidor', unknown: 'Não confirmada', absent: 'Não registrada', ack: 'Confirmação registrada' },
    legend: 'Alavanca: solicitação · Carro: aceitação · Bandeira: confirmação do contato',
    caveat: 'Estes exemplos não enviam mensagens nem mostram o estado de uma viagem. A entrega, a resposta do contato e a ajuda recebida são verificadas separadamente.',
  },
};

export function factsOf(example, copy) {
  return [example.serverAccepted ? copy.values.accepted : copy.values.local,
    copy.values.unknown, example.contactAcknowledged ? copy.values.ack : copy.values.absent, copy.values.unknown];
}
