// Endereços do SGA Ctrl+B para os botões e catálogo desta landing, lidos do cofre
// (sga/cofre, projeto `publico`) em tempo de execução — publicar é só trocar o
// SGA_URL / SGA_API_URL no cofre, sem rebuild nem env nova aqui.
//
// COFRE_URL (env do servidor desta landing) diz onde o cofre está; padrão
// http://127.0.0.1:7700. Cache de 60 s; cofre fora do ar = último valor bom ou
// o padrão local.
import { env } from '$env/dynamic/private';

const SITE = 'unrender-games';
const UNIDADE_SLUG = 'unrender';
const PADRAO = { SGA_URL: 'http://localhost:8081', SGA_API_URL: 'http://localhost:3002/api/v1' };
let cache = { em: 0, valor: null };

export async function sgaCtrlb(fetchFn = fetch) {
  if (cache.valor && Date.now() - cache.em < 60_000) return cache.valor;
  const cofre = (env.COFRE_URL || 'http://127.0.0.1:7700').replace(/\/+$/, '');
  let amb = null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetchFn(`${cofre}/v1/publico/publico.json`, { signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) amb = await r.json();
  } catch {
    /* cofre fora do ar */
  }
  if (!amb?.SGA_URL && cache.valor) return cache.valor;
  const sga = (amb?.SGA_URL || PADRAO.SGA_URL).replace(/\/+$/, '');
  const api = (amb?.SGA_API_URL || PADRAO.SGA_API_URL).replace(/\/+$/, '');
  const valor = {
    url: sga,
    api,
    site: SITE,
    unidadeSlug: UNIDADE_SLUG,
    whatsapp: `${api}/public/landing/${SITE}/whatsapp`,
    contato: `${api}/public/landing/${SITE}/contato`,
    eventos: `${api}/public/landing/${SITE}/eventos`,
    catalogo: `${api}/public/landing/${SITE}/catalogo`,
    unidadeDados: `${api}/public/unidade/${UNIDADE_SLUG}/dados`
  };
  if (amb?.SGA_URL) cache = { em: Date.now(), valor };
  return valor;
}
