/* ============================================================
 * WEB PUSH - PDV
 * Gerencia a inscrição deste navegador para receber novos pedidos.
 * Requer usuário autenticado/ativo e VAPID public key configurada.
 * ============================================================ */
(function () {
    'use strict';

    const CHAVE_DONO_ASSINATURA = 'pdv_push_auth_user_id';

    function obterBotao() {
        return document.getElementById('btn-push');
    }

    function obterChavePublica() {
        const chave = window.PDV_PUSH_CONFIG?.vapidPublicKey;
        if (typeof chave !== 'string' || !chave.trim()) return '';
        if (chave.includes('COLE_AQUI')) return '';
        return chave.trim();
    }

    function base64UrlParaUint8Array(base64Url) {
        const base64 = base64Url
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const raw = atob(base64 + padding);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            output[i] = raw.charCodeAt(i);
        }
        return output;
    }

    function arrayBufferParaBase64Url(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
    }

    function obterRotuloDispositivo() {
        const ua = navigator.userAgent || '';
        if (/tablet|ipad/i.test(ua)) return 'Tablet';
        if (/mobile|android|iphone/i.test(ua)) return 'Celular';
        return 'Computador';
    }

    function mostrarEstadoBotao(texto, ativo, visivel = true) {
        const botao = obterBotao();
        if (!botao) return;
        botao.style.display = visivel ? 'inline-block' : 'none';
        botao.disabled = false;
        botao.textContent = texto;
        botao.style.background = ativo ? '#166534' : '#0f766e';
        botao.title = ativo
            ? 'Notificações Push ativadas neste dispositivo'
            : 'Ativar notificações de novos pedidos neste dispositivo';
    }

    function garantirAmbienteSuportado() {
        const seguro = window.isSecureContext ||
            location.hostname === 'localhost' ||
            location.hostname === '127.0.0.1';

        if (!seguro) {
            throw new Error('As notificações Push exigem HTTPS (ou localhost).');
        }
        if (!('serviceWorker' in navigator)) {
            throw new Error('Este navegador não oferece suporte a Service Worker.');
        }
        if (!('PushManager' in window)) {
            throw new Error('Este navegador não oferece suporte a notificações Push.');
        }
        if (!('Notification' in window)) {
            throw new Error('Este navegador não oferece suporte à permissão de notificações.');
        }
        if (!obterChavePublica()) {
            throw new Error('A chave pública VAPID ainda não foi configurada em js/push-config.js.');
        }
    }

    async function obterUsuarioAuthAtual() {
        const { data, error } = await _supabase.auth.getUser();
        if (error) throw error;

        const authUser = data?.user;
        const perfil = window.usuarioAtual;

        if (!authUser || !perfil?.ativo || !perfil?.auth_user_id) {
            throw new Error('Faça login com um colaborador ativo para ativar as notificações.');
        }
        if (authUser.id !== perfil.auth_user_id) {
            throw new Error('A sessão autenticada não corresponde ao colaborador ativo. Entre novamente no PDV.');
        }

        return authUser;
    }

    // O PDV pode estar publicado em uma subpasta do GitHub Pages
    // (ex.: /docesetravessuras/). Use a pasta da própria página como escopo,
    // em vez de assumir a raiz do domínio.
    function obterEscopoServiceWorker() {
        return new URL('./', window.location.href).pathname;
    }

    function obterUrlServiceWorker() {
        return new URL('service-worker.js', window.location.href).href;
    }

    async function obterRegistroServiceWorker() {
        const escopo = obterEscopoServiceWorker();
        const urlScript = obterUrlServiceWorker();

        const registro = await navigator.serviceWorker.register(
            urlScript,
            { scope: escopo }
        );

        await navigator.serviceWorker.ready;
        return registro;
    }

    async function salvarAssinaturaNoBanco(assinatura, authUser) {
        const chaveP256dhBuffer = assinatura.getKey('p256dh');
        const chaveAuthBuffer = assinatura.getKey('auth');

        if (!chaveP256dhBuffer || !chaveAuthBuffer) {
            throw new Error('O navegador não forneceu as chaves da assinatura Push.');
        }

        const agora = new Date().toISOString();
        const dados = {
            auth_user_id: authUser.id,
            endpoint: assinatura.endpoint,
            chave_p256dh: arrayBufferParaBase64Url(chaveP256dhBuffer),
            chave_auth: arrayBufferParaBase64Url(chaveAuthBuffer),
            expira_em: assinatura.expirationTime
                ? new Date(assinatura.expirationTime).toISOString()
                : null,
            dispositivo: obterRotuloDispositivo(),
            user_agent: (navigator.userAgent || '').slice(0, 500),
            atualizado_em: agora,
            revogado_em: null
        };

        // Atualiza a assinatura deste usuário/dispositivo se já existir.
        // Não depende de um índice UNIQUE nem de um nome específico de constraint.
        const { data: existente, error: consultaErro } = await _supabase
            .from('pdv_push_assinaturas')
            .select('id')
            .eq('auth_user_id', authUser.id)
            .eq('endpoint', assinatura.endpoint)
            .limit(1)
            .maybeSingle();

        if (consultaErro) {
            throw new Error('Não foi possível consultar a assinatura existente: ' + consultaErro.message);
        }

        let resultado;
        if (existente?.id) {
            resultado = await _supabase
                .from('pdv_push_assinaturas')
                .update(dados)
                .eq('id', existente.id)
                .eq('auth_user_id', authUser.id)
                .select('id')
                .single();
        } else {
            resultado = await _supabase
                .from('pdv_push_assinaturas')
                .insert(dados)
                .select('id')
                .single();
        }

        if (resultado.error) {
            throw new Error('Não foi possível salvar o dispositivo no Supabase: ' + resultado.error.message);
        }

        localStorage.setItem(CHAVE_DONO_ASSINATURA, authUser.id);
    }

    window.pdvPushAtualizarBotao = async function () {
        const botao = obterBotao();
        if (!botao) return;

        if (!window.usuarioAtual?.ativo || !window.usuarioAtual?.auth_user_id) {
            mostrarEstadoBotao('', false, false);
            return;
        }

        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !obterChavePublica()) {
            mostrarEstadoBotao('🔔 Push indisponível', false, false);
            return;
        }

        if (Notification.permission === 'denied') {
            mostrarEstadoBotao('🔕 Push bloqueado', false, true);
            botao.title = 'A permissão foi bloqueada nas configurações do navegador.';
            return;
        }

        try {
            const registro = await navigator.serviceWorker.getRegistration(obterEscopoServiceWorker());
            const assinatura = registro
                ? await registro.pushManager.getSubscription()
                : null;

            if (!assinatura) {
                mostrarEstadoBotao('🔔 Ativar Push', false, true);
                return;
            }

            const { data: authData, error: authError } = await _supabase.auth.getUser();
            if (authError || !authData?.user || authData.user.id !== window.usuarioAtual.auth_user_id) {
                mostrarEstadoBotao('🔔 Ativar Push', false, true);
                return;
            }

            const { data: registroBanco, error: bancoErro } = await _supabase
                .from('pdv_push_assinaturas')
                .select('id')
                .eq('auth_user_id', authData.user.id)
                .eq('endpoint', assinatura.endpoint)
                .is('revogado_em', null)
                .limit(1)
                .maybeSingle();

            if (!bancoErro && registroBanco?.id) {
                mostrarEstadoBotao('✅ Push ativo', true, true);
            } else {
                mostrarEstadoBotao('🔔 Ativar Push', false, true);
            }
        } catch (erro) {
            console.warn('Não foi possível consultar o estado do Push:', erro);
            mostrarEstadoBotao('🔔 Ativar Push', false, true);
        }
    };

    window.pdvPushAtivarNotificacoes = async function () {
        const botao = obterBotao();
        if (botao) {
            botao.disabled = true;
            botao.textContent = 'Ativando...';
        }

        let assinaturaNova = null;

        try {
            garantirAmbienteSuportado();
            const authUser = await obterUsuarioAuthAtual();

            // Se outro colaborador usou este navegador, descarta a assinatura
            // local anterior antes de vincular o dispositivo à conta atual.
            const donoAnterior = localStorage.getItem(CHAVE_DONO_ASSINATURA);
            const registro = await obterRegistroServiceWorker();
            let assinatura = await registro.pushManager.getSubscription();

            if (assinatura && donoAnterior && donoAnterior !== authUser.id) {
                await assinatura.unsubscribe();
                assinatura = null;
            }

            let permissao = Notification.permission;
            if (permissao !== 'granted') {
                permissao = await Notification.requestPermission();
            }
            if (permissao !== 'granted') {
                throw new Error(
                    permissao === 'denied'
                        ? 'Permissão bloqueada. Libere as notificações nas configurações do navegador.'
                        : 'A permissão para notificações não foi concedida.'
                );
            }

            if (!assinatura) {
                assinatura = await registro.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: base64UrlParaUint8Array(obterChavePublica())
                });
                assinaturaNova = assinatura;
            }

            await salvarAssinaturaNoBanco(assinatura, authUser);

            mostrarEstadoBotao('✅ Push ativo', true, true);
            alert('Notificações Push ativadas neste dispositivo.');

        } catch (erro) {
            console.error('Erro ao ativar notificações Push:', erro);

            // Se a gravação no banco falhar, desfaz a assinatura recém-criada
            // para não deixar um dispositivo sem vínculo no Supabase.
            if (assinaturaNova) {
                try {
                    await assinaturaNova.unsubscribe();
                } catch (erroUnsubscribe) {
                    console.warn('Não foi possível desfazer a assinatura local:', erroUnsubscribe);
                }
            }

            alert(erro?.message || 'Não foi possível ativar as notificações Push.');
            await window.pdvPushAtualizarBotao();
        } finally {
            if (botao) botao.disabled = false;
        }
    };

    window.pdvPushDesativarNesteDispositivo = async function () {
        try {
            const { data: authData } = await _supabase.auth.getUser();
            const authUserId = authData?.user?.id || window.usuarioAtual?.auth_user_id;
            const registro = await navigator.serviceWorker?.getRegistration(obterEscopoServiceWorker());
            const assinatura = registro
                ? await registro.pushManager.getSubscription()
                : null;

            if (assinatura && authUserId) {
                const { error } = await _supabase
                    .from('pdv_push_assinaturas')
                    .delete()
                    .eq('auth_user_id', authUserId)
                    .eq('endpoint', assinatura.endpoint);

                if (error) {
                    console.warn('Não foi possível remover a assinatura do banco:', error.message);
                }
            }

            if (assinatura) {
                await assinatura.unsubscribe();
            }
        } catch (erro) {
            console.warn('Erro ao desativar Push neste dispositivo:', erro);
        } finally {
            localStorage.removeItem(CHAVE_DONO_ASSINATURA);
        }
    };

    window.pdvPushProcessarPedidoURL = async function () {
        const url = new URL(window.location.href);

        // -----------------------------------------------------
        // NOVA ENCOMENDA AGENDADA
        // -----------------------------------------------------
        const aba = (url.searchParams.get('aba') || '').toLowerCase();
        const encomendaTexto = url.searchParams.get('encomenda');

        if (aba === 'encomendas' && encomendaTexto !== null) {
            const encomendaId = Number(encomendaTexto);

            if (!Number.isSafeInteger(encomendaId) || encomendaId <= 0) {
                url.searchParams.delete('aba');
                url.searchParams.delete('encomenda');
                history.replaceState({}, document.title, url.pathname + url.search + url.hash);
                console.warn('ID de encomenda recebido pela notificação é inválido.');
                return;
            }

            if (typeof window.alternarAba !== 'function') {
                console.warn('A função de abrir a aba Encomendas ainda não está disponível.');
                return;
            }

            const filtro = document.getElementById('filtro-encomendas-status');
            if (filtro) filtro.value = 'TODAS';

            await window.alternarAba('encomendas');

            // Remove os parâmetros após carregar a aba, evitando reabrir a rota
            // em toda atualização manual da página.
            url.searchParams.delete('aba');
            url.searchParams.delete('encomenda');
            history.replaceState({}, document.title, url.pathname + url.search + url.hash);

            const card = document.getElementById(`encomenda-card-${encomendaId}`);
            if (card) {
                card.style.outline = '3px solid #f59e0b';
                card.style.outlineOffset = '3px';
                card.style.boxShadow = '0 0 24px rgba(245,158,11,.35)';
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });

                window.setTimeout(() => {
                    if (!card.isConnected) return;
                    card.style.outline = '';
                    card.style.outlineOffset = '';
                    card.style.boxShadow = '';
                }, 8000);
            } else {
                console.warn(`A encomenda #${encomendaId} não foi encontrada na lista carregada.`);
                alert(`A encomenda #${encomendaId} não foi encontrada na lista atual. Atualize a aba Encomendas para conferir.`);
            }

            return;
        }

        // -----------------------------------------------------
        // PEDIDO ONLINE — MANTÉM O COMPORTAMENTO EXISTENTE
        // -----------------------------------------------------
        const pedidoIdTexto = url.searchParams.get('pedido');
        if (!pedidoIdTexto) return;

        const pedidoId = Number(pedidoIdTexto);
        if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) {
            url.searchParams.delete('pedido');
            history.replaceState({}, document.title, url.pathname + url.search + url.hash);
            return;
        }

        if (typeof window.salaoAbrirPedidoOnlineUI !== 'function') {
            console.warn('A função de abrir pedido online ainda não está disponível.');
            return;
        }

        await window.salaoAbrirPedidoOnlineUI(pedidoId);

        // Limpa o parâmetro para evitar reabrir o mesmo pedido ao atualizar a página.
        url.searchParams.delete('pedido');
        history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    };
})();
