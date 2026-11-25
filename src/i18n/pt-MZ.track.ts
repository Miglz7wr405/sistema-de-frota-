// Textos da página pública /track (e do que ela partilha com o painel: percurso, mapa, câmara).
// Ficheiro separado para a página do cliente não descarregar o dicionário inteiro (3G). pt-MZ.ts reexporta tudo.

export const tt = {
  states: {
    error: 'Ocorreu um erro.', errorDetail: 'Não foi possível carregar os dados.', offline: 'Sem ligação à internet.',
    offlineDetail: 'Os dados mostrados podem não estar atualizados. Vamos tentar de novo automaticamente.',
    stale: 'Dados desatualizados', empty: 'Ainda não há nada aqui.', forbidden: 'Não tem permissão para ver isto.',
    notFound: 'Não encontrado.',
    crashTitle: 'Algo correu mal', crashText: 'Esta página teve um problema. Recarregue para continuar; os seus dados estão guardados.', reload: 'Recarregar',
  },
  track: {
    district: (n: string, prov: string | null) => `${/^cidade (de|da|do) /i.test(n) ? n : `Distrito de ${n}`}${prov ? ` · ${prov}` : ''}`,
    nowAt: (label: string) => `Agora: ${label}`, lastSeenAt: (label: string) => `Última posição: ${label}`,
    title: 'Acompanhe a sua viagem', enterCode: 'Introduza o código da viagem', codePh: 'FT-XXXX-XXXX', go: 'Acompanhar',
    invalidCode: 'Código inválido. Verifique e tente de novo.',
    unavailable: 'Este link já não está disponível. Contacte a transportadora.', trip: 'Viagem',
    pctDone: (p: number) => `${p}% concluído`, remaining: 'Restantes', eta: 'Chegada prevista', etaUnavailable: 'Previsão indisponível',
    etaApprox: 'aproximada', delivered: (time: string) => `Entregue às ${time}`, cancelled: 'Viagem cancelada',
    notStarted: 'A viagem ainda não começou.', paused: 'Viagem em pausa', updated: (ago: string) => `Localização atualizada ${ago}`,
    stale: (ago: string) => `Localização desatualizada (${ago})`, noPosition: 'Ainda sem localização do camião.',
    departed: (place: string) => `Partiu de ${place}`, routeWarning: 'Rota indicativa.', poweredBy: 'Rastreamento por insightFrota',
  },
  strip: {
    title: 'Percurso',
    district: (n: string) => (/^cidade (de|da|do) /i.test(n) ? n : `Distrito de ${n}`),
    done: (km: string) => `${km} feitos`, left: (km: string) => `faltam ${km}`,
    speed: 'Velocidade', accelerating: 'a acelerar', slowing: 'a reduzir', steady: 'estável', stopped: 'parado',
    pace: 'Ao ritmo atual', paceNone: 'Sem dados de ritmo', eta: 'Chegada prevista',
    limit: (n: number) => `limite ${n} km/h`, limitUnknown: 'limite desconhecido (não registado no mapa)',
    overLimit: 'Acima do limite', road: 'Estrada', noRoad: 'Estrada não identificada',
    accuracy: (m: number) => `precisão do GPS ±${m} m`, passed: 'passou', now: 'agora aqui', near: (n: string) => `passou ${n}`,
  },
  map: { inTrip: 'Em viagem', stopped: 'Parado', noSignal: 'Sem sinal', unavailable: 'Mapa indisponível sem ligação.', attribution: '© OpenStreetMap', loading: 'A carregar mapa…' },
  common: { loading: 'A carregar…' },
  errors: { network: 'Sem ligação ao servidor. Verifique a internet.', rateLimited: 'Demasiadas tentativas. Aguarde um pouco.' },
  trip: {
    statuses: { planeada: 'Planeada', aguardando_partida: 'Aguardando partida', em_viagem: 'Em viagem', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' } as Record<string, string>,
  },
  ownGps: { fullRoute: 'rota completa — a aguardar GPS preciso' },
  driverApp: { nowIn: (n: string) => `📍 Agora em ${n}`, passedPlace: (n: string) => `Já passou por ${n}` },
};
