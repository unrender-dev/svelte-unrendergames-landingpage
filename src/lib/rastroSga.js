// Cliques desta landing no SGA Ctrl+B (como uma página gerada no Ctrl+B): um id
// de visitante no navegador, visita, páginas de serviço abertas (= interesse no
// produto) e o WhatsApp com o visitante. Quando a pessoa manda o formulário, os
// cliques viram "Interesses na landing" no card do contato.
const CHAVE = 'unrender_visitante';

export function visitante() {
  try {
    let v = localStorage.getItem(CHAVE);
    if (!v || !/^[A-Za-z0-9-]{8,64}$/.test(v)) {
      v = crypto.randomUUID?.() || 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(CHAVE, v);
    }
    return v;
  } catch {
    return '';
  }
}

export function enviarEvento(sga, eventos) {
  const v = visitante();
  if (!sga?.eventos || !v) return;
  const corpo = JSON.stringify({ visitante: v, pagina: location.href, eventos });
  const ok = navigator.sendBeacon?.(sga.eventos, new Blob([corpo], { type: 'text/plain' }));
  if (!ok) fetch(sga.eventos, { method: 'POST', body: corpo, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
}

const ROTULOS = {
  jogos: 'Jogos', 'web-interativa': 'Web Interativa', fortnite: 'Fortnite', roblox: 'Roblox',
  audiovisual: 'Audiovisual', vr: 'VR / AR', gamificacao: 'Gamificação', vfx: 'VFX',
  metahuman: 'MetaHuman', hardware: 'Hardware', produtos: 'Produtos', loja: 'Loja', 'tps-game': 'TPS Game'
};

/** Página de serviço aberta → interesse no produto. */
export function produtoDaRota(pathname) {
  const seg = (pathname || '').split('/').filter(Boolean)[0];
  return seg && ROTULOS[seg] ? { tipo: 'produto', alvo: `servico:${seg}`, rotulo: ROTULOS[seg] } : null;
}

export function whatsappComVisitante(sga, fallback) {
  if (!sga?.whatsapp) return fallback;
  const v = visitante();
  return v ? `${sga.whatsapp}?v=${encodeURIComponent(v)}` : sga.whatsapp;
}
