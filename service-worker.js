/* ============================================================
 * SERVICE WORKER - WEB PUSH DO PDV
 * Escopo: raiz do site. Não implementa cache/offline.
 * ============================================================ */

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

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
    const pedidoId = dados.pedido_id ? String(dados.pedido_id) : '';

    // Só aceita navegação interna para a tela do PDV.
    let caminho = '/pdv.html';
    if (typeof dados.path === 'string' && dados.path.startsWith('/pdv.html')) {
        caminho = dados.path;
    } else if (pedidoId && /^\d+$/.test(pedidoId)) {
        caminho = `/pdv.html?pedido=${encodeURIComponent(pedidoId)}`;
    }

    const opcoes = {
        body: corpo,
        data: {
            path: caminho,
            pedido_id: pedidoId,
            tipo_pedido: String(dados.tipo_pedido || '')
        },
        tag: pedidoId ? `pdv-pedido-${pedidoId}` : 'pdv-novo-pedido',
        renotify: true
    };

    event.waitUntil(
        self.registration.showNotification(titulo, opcoes)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil((async () => {
        const dados = event.notification.data || {};
        let destino = new URL('/pdv.html', self.location.origin);

        if (typeof dados.path === 'string') {
            try {
                const candidato = new URL(dados.path, self.location.origin);
                if (
                    candidato.origin === self.location.origin &&
                    candidato.pathname.endsWith('/pdv.html')
                ) {
                    destino = candidato;
                }
            } catch (_) {
                // Mantém o destino padrão do PDV.
            }
        }

        const janelas = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });

        for (const janela of janelas) {
            try {
                const urlJanela = new URL(janela.url);
                if (
                    urlJanela.origin === self.location.origin &&
                    urlJanela.pathname.endsWith('/pdv.html') &&
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
