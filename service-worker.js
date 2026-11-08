/* ============================================================
 * SERVICE WORKER - WEB PUSH DO PDV
 * Usa o escopo real da página, inclusive em GitHub Pages de projeto
 * (ex.: https://usuario.github.io/nome-do-repositorio/).
 * Não implementa cache/offline.
 * ============================================================ */

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

function urlBaseDoPDV() {
    return new URL('pdv.html', self.registration.scope);
}

function obterDestino(dados) {
    const destino = urlBaseDoPDV();
    const dadosInternos = dados && typeof dados.data === 'object' && dados.data
        ? dados.data
        : {};

    // Aceita apenas caminhos para o pdv.html dentro do escopo deste projeto.
    const caminhos = [
        dados?.path,
        dados?.url,
        dadosInternos.path,
        dadosInternos.url
    ];

    let urlInformada = null;

    for (const caminho of caminhos) {
        if (typeof caminho !== 'string' || !caminho.trim()) continue;

        try {
            const candidata = new URL(caminho, self.registration.scope);
            if (
                candidata.origin === destino.origin &&
                candidata.pathname === destino.pathname
            ) {
                urlInformada = candidata;
                break;
            }
        } catch (_) {
            // Ignora caminhos inválidos e continua tentando os demais.
        }
    }

    const encomendaInformada =
        dados?.encomenda_id ??
        dadosInternos.encomenda_id ??
        urlInformada?.searchParams.get('encomenda');

    const abaInformada =
        dados?.aba ??
        dadosInternos.aba ??
        urlInformada?.searchParams.get('aba');

    // Encomenda: aceita somente ID numérico e direciona à aba própria.
    if (
        String(abaInformada || '').toLowerCase() === 'encomendas' &&
        encomendaInformada != null &&
        /^\d+$/.test(String(encomendaInformada))
    ) {
        destino.searchParams.set('aba', 'encomendas');
        destino.searchParams.set('encomenda', String(encomendaInformada));
        return destino;
    }

    // Compatibilidade com Push de pedidos já existente.
    const pedidoInformado =
        dados?.pedido_id ??
        dadosInternos.pedido_id ??
        urlInformada?.searchParams.get('pedido');

    if (pedidoInformado != null && /^\d+$/.test(String(pedidoInformado))) {
        destino.searchParams.set('pedido', String(pedidoInformado));
        return destino;
    }

    return destino;
}

self.addEventListener('push', (event) => {
    let dados = {};

    try {
        dados = event.data ? event.data.json() : {};
    } catch (erro) {
        dados = {
            title: 'Novo pedido online',
            body: event.data ? event.data.text() : 'Você recebeu um novo pedido.'
        };
    }

    const destino = obterDestino(dados);
    const pedidoId = destino.searchParams.get('pedido') || '';
    const encomendaId = destino.searchParams.get('encomenda') || '';
    const ehEncomenda = Boolean(encomendaId);

    const tituloPadrao = ehEncomenda
        ? 'Nova encomenda agendada'
        : 'Novo pedido online';
    const corpoPadrao = ehEncomenda
        ? `Encomenda #${encomendaId} · ${String(dados.tipo_pedido || '')}`
        : 'Um novo pedido chegou ao PDV.';

    const titulo = String(dados.title || tituloPadrao);
    const corpo = String(dados.body || corpoPadrao);

    const opcoes = {
        body: corpo,
        data: {
            path: destino.pathname + destino.search,
            pedido_id: /^\d+$/.test(pedidoId) ? pedidoId : '',
            encomenda_id: /^\d+$/.test(encomendaId) ? encomendaId : '',
            aba: ehEncomenda ? 'encomendas' : '',
            tipo_evento: String(dados.tipo_evento || ''),
            tipo_pedido: String(dados.tipo_pedido || '')
        },
        tag: ehEncomenda
            ? `pdv-encomenda-${encomendaId}`
            : (/^\d+$/.test(pedidoId) ? `pdv-pedido-${pedidoId}` : 'pdv-novo-pedido'),
        renotify: false,
        requireInteraction: true
    };

    event.waitUntil(
        self.registration.showNotification(titulo, opcoes)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil((async () => {
        const destino = obterDestino(event.notification.data || {});
        const paginaPDV = urlBaseDoPDV();

        const janelas = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });

        for (const janela of janelas) {
            try {
                const urlJanela = new URL(janela.url);
                if (
                    urlJanela.origin === paginaPDV.origin &&
                    urlJanela.pathname === paginaPDV.pathname &&
                    'navigate' in janela
                ) {
                    await janela.navigate(destino.href);
                    return await janela.focus();
                }
            } catch (_) {
                // Tenta abrir uma nova janela abaixo.
            }
        }

        return self.clients.openWindow(destino.href);
    })());
});
