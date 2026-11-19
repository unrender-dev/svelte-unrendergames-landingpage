import { json } from '@sveltejs/kit';
import { sgaCtrlb } from '$lib/server/sgaCtrlb.js';

// O formulário de contato cai no SGA Ctrl+B (CRM da Unrender), pelo mesmo caminho
// de uma página gerada no Ctrl+B: contato + conversa, origem "site", etiqueta
// landing-unrender-games e os serviços que a pessoa abriu. O endereço do SGA
// vem do cofre (ver $lib/server/sgaCtrlb.js).
export async function POST({ request, fetch }) {
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Dados inválidos' }, { status: 400 });
    }
    try {
        const sga = await sgaCtrlb(fetch);
        const response = await fetch(sga.contato, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome: body.fullname,
                email: body.email,
                whatsapp: body.telephone,
                mensagem: body.text,
                assunto: body.subject,
                visitante: body.visitante,
                pagina: body.pagina || request.headers.get('referer') || '',
                website: body.website
            })
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return json({ error: errorData.error || 'Não foi possível enviar' }, { status: response.status });
        }
        return json({ success: true });
    } catch (error) {
        console.error('Contact form error:', error);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
