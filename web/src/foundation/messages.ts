export type Locale = 'es' | 'pt-BR';
export const locales: readonly Locale[] = ['es', 'pt-BR'];
export const isLocale = (value: unknown): value is Locale => locales.includes(value as Locale);

const es = {
  skip: 'Ir al contenido', language: 'Idioma', navigation: 'Navegación principal',
  home: 'Tu viaje', trucks: 'Camiones', contacts: 'Contactos', trucksTitle: 'Mis camiones', contactsTitle: 'Mis contactos', session: 'Entrar a Tándem',
  tripNew: 'Preparar viaje', activeTrip: 'Viaje', checkIn: 'Tu respuesta',
  alerts: 'Estado de la alerta', contactTrip: 'Viaje compartido', invitation: 'Invitación de contacto',
  summary: 'Resumen del viaje', privacy: 'Privacidad', access: 'Acceso', testMode: 'Modo de prueba',
  continue: 'Continuar', signOut: 'Salir de la cuenta', connecting: 'Conectando…',
  disconnected: 'El acceso a tu cuenta aún no está disponible aquí.',
  accessRecovery: 'Podrás continuar cuando el acceso a tu cuenta esté habilitado.',
  signedOut: 'Conecta tu cuenta para ver únicamente la información que tienes permiso de consultar.',
  authenticated: 'Tu cuenta está conectada.', expired: 'Tu acceso ha caducado. Conecta tu cuenta de nuevo.',
  accessError: 'No pudimos conectar tu cuenta. Inténtalo de nuevo.',
  demo: 'Demostración', demoNotice: 'Datos de ejemplo. Los avisos reales solo llegan al número autorizado para la prueba.',
  demoUnavailable: 'No hay una demostración conectada en esta sesión.',
  demoAvailable: 'Puedes recorrer esta demostración con datos de ejemplo.',
  unavailableTitle: 'Esta vista aún no está disponible',
  unavailableBody: 'Puedes volver a tu viaje o elegir otra opción en la navegación.',
  backHome: 'Volver a tu viaje', notFound: 'No encontramos esta página',
  notFoundBody: 'Comprueba el enlace o vuelve a tu viaje.', loading: 'Cargando información…',
  unknown: 'Sin información', source: 'Fuente', observedAt: 'Registrado',
  capturedAt: 'Capturado', receivedAt: 'Recibido', readAt: 'Consultado en el servidor',
  viewError: 'No pudimos mostrar esta vista', viewRecovery: 'Puedes intentar abrirla de nuevo o elegir otra opción en la navegación.',
  retry: 'Intentar de nuevo', pending: 'Pendiente', error: 'No se pudo completar',
  permission: 'Permiso', permitted: 'Permitido', notPermitted: 'Sin permiso',
  footer: 'Tándem · Equipo GOAT', return: 'Volver',
};
export type MessageKey = keyof typeof es;
const pt: Record<MessageKey, string> = {
  skip: 'Ir para o conteúdo', language: 'Idioma', navigation: 'Navegação principal',
  home: 'Sua viagem', trucks: 'Caminhões', contacts: 'Contatos', trucksTitle: 'Meus caminhões', contactsTitle: 'Meus contatos', session: 'Entrar na Tándem',
  tripNew: 'Preparar viagem', activeTrip: 'Viagem', checkIn: 'Sua resposta',
  alerts: 'Estado do alerta', contactTrip: 'Viagem compartilhada', invitation: 'Convite de contato',
  summary: 'Resumo da viagem', privacy: 'Privacidade', access: 'Acesso', testMode: 'Modo de teste',
  continue: 'Continuar', signOut: 'Sair da conta', connecting: 'Conectando…',
  disconnected: 'O acesso à sua conta ainda não está disponível aqui.',
  accessRecovery: 'Você poderá continuar quando o acesso à sua conta estiver habilitado.',
  signedOut: 'Conecte sua conta para ver apenas as informações que você tem permissão para consultar.',
  authenticated: 'Sua conta está conectada.', expired: 'Seu acesso expirou. Conecte sua conta novamente.',
  accessError: 'Não foi possível conectar sua conta. Tente novamente.',
  demo: 'Demonstração', demoNotice: 'Dados de exemplo. Os avisos reais só chegam ao número autorizado para o teste.',
  demoUnavailable: 'Não há uma demonstração conectada nesta sessão.',
  demoAvailable: 'Você pode explorar esta demonstração com dados de exemplo.',
  unavailableTitle: 'Esta tela ainda não está disponível',
  unavailableBody: 'Você pode voltar à sua viagem ou escolher outra opção na navegação.',
  backHome: 'Voltar à sua viagem', notFound: 'Não encontramos esta página',
  notFoundBody: 'Confira o link ou volte à sua viagem.', loading: 'Carregando informações…',
  unknown: 'Sem informação', source: 'Fonte', observedAt: 'Registrado',
  capturedAt: 'Capturado', receivedAt: 'Recebido', readAt: 'Consultado no servidor',
  viewError: 'Não foi possível mostrar esta tela', viewRecovery: 'Você pode tentar abri-la novamente ou escolher outra opção na navegação.',
  retry: 'Tentar novamente', pending: 'Pendente', error: 'Não foi possível concluir',
  permission: 'Permissão', permitted: 'Permitido', notPermitted: 'Sem permissão',
  footer: 'Tándem · Equipe GOAT', return: 'Voltar',
};
export const messages: Record<Locale, Readonly<Record<MessageKey, string>>> = { es, 'pt-BR': pt };
export function message(locale: Locale, key: MessageKey): string { return messages[locale][key]; }

// Only the user's language choice persists here. No identity, token or trip state.
export function readLanguageChoice(storage?: Pick<Storage, 'getItem'>): Locale {
  try { const value = storage?.getItem('andes.locale'); return isLocale(value) ? value : 'es'; }
  catch { return 'es'; }
}
export function saveLanguageChoice(locale: Locale, storage?: Pick<Storage, 'setItem'>): void {
  try { storage?.setItem('andes.locale', locale); } catch { /* A blocked preference store must not block a task. */ }
}
