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
    const pedidoId = dados && dados.pedido_id != null
        ? String(dados.pedido_id)
        : '';

    // Aceita apenas ID numérico de pedido.
    if (/^\d+$/.test(pedidoId)) {
        destino.searchParams.set('pedido', pedidoId);
        return destino;
    }

    // Compatibilidade com payloads antigos que enviam path absoluto.
    if (dados && typeof dados.path === 'string') {
        try {
            const informado = new URL(dados.path, self.registration.scope);
            const paginaPDV = urlBaseDoPDV();

            if (
                informado.origin === paginaPDV.origin &&
                informado.pathname.endsWith('/pdv.html')
            ) {
                const pedidoInformado = informado.searchParams.get('pedido');
                if (pedidoInformado && /^\d+$/.test(pedidoInformado)) {
                    destino.searchParams.set('pedido', pedidoInformado);
                }
            }
        } catch (_) {
            // Mantém a página do PDV no escopo atual.
        }
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

    const titulo = String(dados.title || 'Novo pedido online');
    const corpo = String(dados.body || 'Um novo pedido chegou ao PDV.');
    const pedidoId = dados.pedido_id != null ? String(dados.pedido_id) : '';
    const destino = obterDestino(dados);

    const opcoes = {
        body: corpo,
        data: {
            path: destino.pathname + destino.search,
            pedido_id: /^\d+$/.test(pedidoId) ? pedidoId : '',
            tipo_pedido: String(dados.tipo_pedido || '')
        },
        tag: /^\d+$/.test(pedidoId) ? `pdv-pedido-${pedidoId}` : 'pdv-novo-pedido',
        renotify: true
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
