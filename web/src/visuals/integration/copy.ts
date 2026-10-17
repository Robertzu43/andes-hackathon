import type { VisualCopy, VisualKind, VisualLocale } from './contract.ts';

const controls = {
  es: {
    fallback: 'La explicación en texto está disponible sin la ilustración.',
    explore: 'Explorar ilustración',
    enableMotion: 'Activar movimiento',
    disableMotion: 'Detener movimiento',
    retry: 'Reintentar ilustración',
    loading: 'Cargando ilustración. Puedes seguir leyendo.',
    ready: 'Ilustración disponible. El movimiento está detenido.',
    unavailable: 'No se pudo mostrar la ilustración. Puedes seguir leyendo o reintentar.',
    still: 'Movimiento detenido.',
    moving: 'Movimiento activado para esta explicación.',
    parked: 'Usa esta explicación solo cuando estés detenido.',
  },
  'pt-BR': {
    fallback: 'A explicação em texto está disponível sem a ilustração.',
    explore: 'Explorar ilustração',
    enableMotion: 'Ativar movimento',
    disableMotion: 'Parar movimento',
    retry: 'Tentar ilustração novamente',
    loading: 'Carregando ilustração. Você pode continuar lendo.',
    ready: 'Ilustração disponível. O movimento está parado.',
    unavailable: 'Não foi possível mostrar a ilustração. Você pode continuar lendo ou tentar novamente.',
    still: 'Movimento parado.',
    moving: 'Movimento ativado para esta explicação.',
    parked: 'Use esta explicação apenas quando estiver parado.',
  },
} as const;

export const visualCopy: Record<VisualLocale, Record<VisualKind, VisualCopy>> = {
  es: {
    phone: {
      ...controls.es,
      title: 'Tu teléfono durante el viaje',
      caption: 'El teléfono puede dejar de aportar datos. Su silencio no confirma una emergencia ni que estés bien.',
      facts: [
        'Los permisos pueden denegarse o revocarse.',
        'Otra app o la pantalla bloqueada pueden interrumpir la captura en el navegador.',
        'La última ubicación disponible puede ser antigua. Revisa su origen y su hora.',
      ],
    },
    relay: {
      ...controls.es,
      title: 'Cómo se registra una solicitud',
      caption: 'El registro de una solicitud, su entrega y la respuesta de un contacto son hechos distintos. Ninguno confirma que la ayuda haya llegado.',
      facts: [
        'Una solicitud pendiente en el teléfono aún puede no estar registrada en el servidor.',
        'La aceptación del servidor no confirma la entrega al contacto.',
        'La respuesta de un contacto se muestra por separado. No confirma asistencia.',
      ],
    },
  },
  'pt-BR': {
    phone: {
      ...controls['pt-BR'],
      title: 'Seu telefone durante a viagem',
      caption: 'O telefone pode deixar de fornecer dados. Seu silêncio não confirma uma emergência nem que você esteja bem.',
      facts: [
        'As permissões podem ser negadas ou revogadas.',
        'Outro app ou a tela bloqueada podem interromper a captura no navegador.',
        'A última localização disponível pode ser antiga. Confira sua origem e seu horário.',
      ],
    },
    relay: {
      ...controls['pt-BR'],
      title: 'Como uma solicitação é registrada',
      caption: 'O registro de uma solicitação, sua entrega e a resposta de um contato são fatos distintos. Nenhum confirma que a ajuda tenha chegado.',
      facts: [
        'Uma solicitação pendente no telefone ainda pode não estar registrada no servidor.',
        'A aceitação pelo servidor não confirma a entrega ao contato.',
        'A resposta de um contato aparece separadamente. Não confirma assistência.',
      ],
    },
  },
};
