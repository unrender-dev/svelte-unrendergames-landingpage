import { env } from '$env/dynamic/private';
import { sgaCtrlb } from '$lib/server/sgaCtrlb.js';

// Dados do layout (SGA, catálogo e tenant) ficam em cache na memória do servidor.
// Antes cada página esperava até 3 fetches em série (3,5 s + 2,5 s + API sem
// timeout) antes de mandar o primeiro byte. Agora:
//  - as chamadas rodam em paralelo e todas têm timeout curto;
//  - resposta servida do cache (stale-while-revalidate): fresca por 60 s,
//    e mesmo "velha" é devolvida na hora enquanto atualiza em segundo plano.
const FRESH_MS = 60_000;
const MAX_STALE_MS = 30 * 60_000;
let cache = { em: 0, valor: null };
let emAndamento = null;

async function fetchJson(url, ms, init = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
        const res = await fetch(url, { ...init, signal: ctl.signal });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    } finally {
        clearTimeout(t);
    }
}

async function carregar() {
    const sga = await sgaCtrlb(fetch);
    const apiUrl = env.API_BASE_URL || 'http://localhost:8080';

    const [catalogo, unidade, tenantApi] = await Promise.all([
        fetchJson(sga.catalogo, 2500),
        fetchJson(sga.unidadeDados, 2500),
        fetchJson(`${apiUrl}/api/v1/tenants/master/public`, 2500, {
            headers: { Authorization: `Bearer ${env.LANDING_PAGE_TOKEN}` }
        })
    ]);

    // Mesma prioridade de antes: catálogo da landing → dados da unidade
    const catalogoSga = catalogo ?? unidade ?? null;

    const tenant =
        tenantApi ??
        (catalogoSga?.unidade
            ? {
                  name: catalogoSga.unidade.nome || 'Unrender Games',
                  whatsapp: catalogoSga.whatsapp_e164 || '5565999207154',
                  phone: catalogoSga.whatsapp_e164 || '5565999207154'
              }
            : null);

    return { tenant, sga, catalogoSga };
}

function atualizar() {
    if (!emAndamento) {
        emAndamento = carregar()
            .then((valor) => {
                cache = { em: Date.now(), valor };
                return valor;
            })
            .finally(() => {
                emAndamento = null;
            });
    }
    return emAndamento;
}

// Usa o fetch global (não o do evento): a atualização em segundo plano pode
// terminar depois que a requisição atual já respondeu.
export async function load() {
    const idade = Date.now() - cache.em;
    if (cache.valor && idade < FRESH_MS) return cache.valor;
    if (cache.valor && idade < MAX_STALE_MS) {
        atualizar().catch(() => {});
        return cache.valor;
    }
    return atualizar();
}
