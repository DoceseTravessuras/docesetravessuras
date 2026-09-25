// 1. Configuração das credenciais do Supabase
const SUPABASE_URL = 'https://pznuqeqtytyjtupxnzqk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6bnVxZXF0eXR5anR1cHhuenFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MDIyMTAsImV4cCI6MjEwMzk3ODIxMH0.ZadwdTr-pERj7mBYQGnIRpg7M4RhN9K3xNCpcG_GOqQ'; // Insira sua chave anon publica aqui

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let listaPedidosGlobal = [];
let somAtivado = false;
let arquivoImagemSelecionado = null;
let caixaAtual = null;
window.usuarioAtual = null;
let itensCompraRascunho = [];
let historicoComprasUI = [];

const audioAlerta = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

// ============================================================
// OBTÉM O USUÁRIO AUTENTICADO ATUAL
// ============================================================

async function obterUsuarioAtual() {
    try {
        // 1. Obtém a identidade real do Supabase Auth
        const {
            data: {user},
            error: authError
        } = await _supabase.auth.getUser();

        if (authError) {
            console.error(
                    'Erro ao obter usuário do Supabase Auth:',
                    authError
                    );

            window.usuarioAtual = null;
            return null;
        }

        if (!user) {
            console.warn('Nenhum usuário autenticado.');

            window.usuarioAtual = null;
            return null;
        }

        // 2. Busca o perfil correspondente na tabela usuarios
        const {
            data: usuario,
            error: usuarioError
        } = await _supabase
                .from('usuarios')
                .select(`
                id,
                nome,
                email,
                cargo,
                ativo,
                auth_user_id
            `)
                .eq('auth_user_id', user.id)
                .eq('ativo', true)
                .maybeSingle();

        if (usuarioError) {
            console.error(
                    'Erro ao buscar perfil em public.usuarios:',
                    usuarioError
                    );

            window.usuarioAtual = null;
            return null;
        }

        if (!usuario) {
            console.warn(
                    'Usuário autenticado não possui perfil ativo no PDV.'
                    );

            window.usuarioAtual = null;
            return null;
        }

        // 3. ATUALIZA EXPLICITAMENTE A VARIÁVEL GLOBAL
        window.usuarioAtual = {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email,
            cargo: usuario.cargo,
            ativo: usuario.ativo,
            auth_user_id: usuario.auth_user_id
        };

        console.log(
                '✅ Usuário atual carregado:',
                window.usuarioAtual
                );

        return window.usuarioAtual;

    } catch (erro) {
        console.error(
                'Erro inesperado em obterUsuarioAtual():',
                erro
                );

        window.usuarioAtual = null;
        return null;
    }
}

// Substitua a escuta inicial do DOMContentLoaded no pdv.js
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const {
            data: {session}
        } = await _supabase.auth.getSession();

        if (session) {
            await exibirPDV();
        } else {
            bloquearPDV();
        }

    } catch (err) {
        console.error('Erro ao verificar sessão:', err);
        bloquearPDV();
    }
});

async function exibirPDV() {
    try {
        const usuario = await obterUsuarioAtual();

        if (!usuario) {
            bloquearPDV();
            document.body.classList.remove('pdv-carregando');
            return;
        }

        // Carrega as permissões ANTES de liberar a interface
        await carregarPermissoes();

        aplicarPermissoes();

        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('btn-logout').style.display = 'inline-block';
        // Só agora a interface fica disponível
        document.body.classList.remove('pdv-carregando');

        carregarPedidos();
        iniciarEscutaRealtime();

    } catch (err) {
        console.error('Erro ao inicializar o PDV:', err);

        bloquearPDV();
        // Mesmo em erro, libera somente a tela de login
        document.body.classList.remove('pdv-carregando');
    }
}

function bloquearPDV() {
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('btn-logout').style.display = 'none';
}

async function fazerLogin() {
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const erroEl = document.getElementById('login-erro');
    const btn = document.getElementById('btn-entrar');

    erroEl.textContent = '';

    if (!email || !senha) {
        erroEl.textContent = 'Informe e-mail e senha.';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Entrando...';

    try {
        // 1. Autenticação REAL no Supabase Auth
        const {data: authData, error: authError} =
                await _supabase.auth.signInWithPassword({
                    email: email,
                    password: senha
                });

        if (authError || !authData.user) {
            throw new Error('E-mail ou senha inválidos.');
        }

        const authUser = authData.user;

        // 2. Busca o perfil correspondente na tabela usuarios
        // A RLS permite que o usuário veja somente o próprio registro.
        const {data: usuario, error: usuarioError} = await _supabase
                .from('usuarios')
                .select('id, nome, email, cargo, ativo, auth_user_id')
                .eq('auth_user_id', authUser.id)
                .eq('ativo', true)
                .maybeSingle();

        if (usuarioError) {
            console.error('Erro ao carregar perfil:', usuarioError);
            throw new Error('Não foi possível carregar o perfil do usuário.');
        }

        if (!usuario) {
            // Existe no Auth, mas não está vinculado/ativo no PDV.
            await _supabase.auth.signOut();
            throw new Error(
                    'Usuário não autorizado no PDV. Verifique o cadastro e a ativação.'
                    );
        }

        // 3. Cache local APENAS para informações visuais.
        // NÃO usamos isso como fonte de autorização.
        localStorage.setItem('usuario_pdv', JSON.stringify({
            id: usuario.id,
            nome: usuario.nome,
            cargo: usuario.cargo,
            auth_user_id: usuario.auth_user_id
        }));

        btn.textContent = 'Entrando...';

        // 4. Abre o sistema
        await exibirPDV();

    } catch (err) {
        console.error('Erro no login:', err);

        erroEl.textContent =
                err.message || 'Não foi possível realizar o login.';

    } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar no Sistema';
    }
}

async function fazerLogout() {
    try {
        await _supabase.auth.signOut();
    } finally {
        localStorage.removeItem('usuario_pdv');
        window.location.reload();
    }
}

function ativarSom() {
    audioAlerta.play().then(() => {
        somAtivado = true;
        document.getElementById('btn-som').textContent = '🔔 Som Ativado';
        document.getElementById('btn-som').style.background = '#2e7d32';
    }).catch(() => {
        alert('Clique na página para permitir os alertas sonoros.');
    });
}

// 2. Busca inicial de pedidos e seus itens vinculados
async function carregarPedidos() {
    const {data: pedidos, error} = await _supabase
            .from('pedidos')
            .select(`
            *,
            clientes (
                nome,
                telefone
            ),
            itens_pedido (
                *,
                produtos (nome)
            )
        `)
            .order('criado_em', {ascending: false});

    if (error) {
        console.error('Erro ao buscar pedidos:', error.message);
        return;
    }

    listaPedidosGlobal = pedidos; // Salva para uso na impressão
    renderizarKanban(pedidos);
}

// Função auxiliar para verificar se a data atende ao filtro
function atendeFiltroData(dataISO, filtro) {
    if (!filtro || filtro === 'todos')
        return true;

    const dataPedido = new Date(dataISO);
    const agora = new Date();
    const hojeInicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

    if (filtro === 'hoje') {
        return dataPedido >= hojeInicio;
    }
    if (filtro === '7dias') {
        const limite7dias = new Date(hojeInicio);
        limite7dias.setDate(limite7dias.getDate() - 7);
        return dataPedido >= limite7dias;
    }
    if (filtro === 'mes') {
        const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
        return dataPedido >= inicioMes;
    }

    return true;
}

// 3. Renderiza os cards nas colunas correspondentes
function renderizarKanban(pedidos) {
    const colunas = ['PENDENTE', 'PREPARANDO', 'A_CAMINHO', 'CONCLUIDO'];

    // Obtém o filtro selecionado (padrão: 'hoje')
    const elemFiltro = document.getElementById('filtro-concluidos');
    const filtroConcluido = elemFiltro ? elemFiltro.value : 'hoje';

    // Limpa containers
    colunas.forEach(c => {
        document.getElementById(`container-${c}`).innerHTML = '';
        document.getElementById(`count-${c.toLowerCase()}`).textContent = '0';
    });

    const contadores = {PENDENTE: 0, PREPARANDO: 0, A_CAMINHO: 0, CONCLUIDO: 0};

    pedidos.forEach(p => {
        if (!contadores.hasOwnProperty(p.status))
            return;

        // Aplica o filtro de data APENAS para os pedidos CONCLUÍDOS
        if (p.status === 'CONCLUIDO' && !atendeFiltroData(p.criado_em, filtroConcluido)) {
            return;
        }

        contadores[p.status]++;
        const container = document.getElementById(`container-${p.status}`);

        const hora = new Date(p.criado_em).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

        // Monta lista de itens
        let itensHTML = '';
        if (p.itens_pedido && p.itens_pedido.length > 0) {
            p.itens_pedido.forEach(item => {
                const nomeProd = item.produtos ? item.produtos.nome : 'Item';
                itensHTML += `
                    <div class="card-item-row">
                        <span>${item.quantidade}x ${nomeProd}</span>
                        <span>R$ ${parseFloat(item.subtotal || 0).toFixed(2).replace('.', ',')}</span>
                    </div>
                `;
            });
        }

        // Define o próximo status
        let proximoStatus = '';
        let textoBotao = '';
        if (p.status === 'PENDENTE') {
            proximoStatus = 'PREPARANDO';
            textoBotao = '▶️ Iniciar Preparo';
        } else if (p.status === 'PREPARANDO') {
            proximoStatus = 'A_CAMINHO';
            textoBotao = '🚀 Enviar / Pronto';
        } else if (p.status === 'A_CAMINHO') {
            proximoStatus = 'CONCLUIDO';
            textoBotao = '✅ Concluir';
        }

        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="card-top">
                <span class="card-id">#${p.id}</span>
                <span class="card-type">${p.tipo || 'BALCAO'}</span>
                <span>${hora}</span>
            </div>
            
            <div class="card-info">
                 ${p.clientes?.nome ? `<strong>Cliente:</strong> ${p.clientes.nome}<br>` : ''}
                 ${(p.telefone_cliente || p.clientes?.telefone) ? `<strong>📞 Telefone:</strong> ${formatarTelefoneExibicao(p.telefone_cliente || p.clientes.telefone)}<br>` : ''}
                   <strong>Endereço:</strong> ${p.endereco_snapshot || 'Balcão'}<br>
                   <strong>Pagamento:</strong> ${p.forma_pagamento || '-'} ${p.troco_para ? `(Troco p/ R$ ${p.troco_para})` : ''}
            </div>

            ${p.observacao ? `<div class="card-obs">⚠️ ${p.observacao}</div>` : ''}

            <div class="card-items">${itensHTML}</div>

            <div class="card-total">Total: R$ ${parseFloat(p.valor_total || 0).toFixed(2).replace('.', ',')}</div>

            <div class="card-actions">
                <button class="btn-action btn-print" onclick="imprimirPedido(${p.id})">🖨️ Imprimir</button>
                ${p.status !== 'CONCLUIDO' ? `<button class="btn-action btn-next" onclick="mudarStatus(${p.id}, '${proximoStatus}')">${textoBotao}</button>` : ''}
                ${p.status === 'PENDENTE' ? `<button class="btn-action btn-cancel" onclick="cancelarPedido(${p.id})">❌ Cancelar</button>` : ''}
            </div>`;

        container.appendChild(card);
    });

    // Atualiza contadores do cabeçalho
    Object.keys(contadores).forEach(c => {
        document.getElementById(`count-${c.toLowerCase()}`).textContent = contadores[c];
    });
}

function formatarTelefoneExibicao(telefone) {
    const numeros = String(telefone || '').replace(/\D/g, '');

    if (numeros.length === 11) {
        return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`;
    }

    if (numeros.length === 10) {
        return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 6)}-${numeros.slice(6)}`;
    }

    return telefone || '-';
}

// 4. Atualiza o status do pedido no banco de dados
async function mudarStatus(pedidoId, novoStatus) {
    if (novoStatus === 'CANCELADO') {
        return cancelarPedido(pedidoId);
    }

    const {data, error} = await _supabase.rpc(
            'avancar_status_pedido',
            {
                p_pedido_id: pedidoId,
                p_novo_status: novoStatus
            }
    );

    if (error) {
        console.error('Erro ao atualizar status:', error);

        const msg = error.message || '';

        if (msg.includes('TRANSICAO_NAO_PERMITIDA')) {
            alert('⚠️ Transição de status não permitida.');
        } else if (msg.includes('PEDIDO_FINALIZADO')) {
            alert('⚠️ Este pedido já foi finalizado.');
        } else if (msg.includes('PEDIDO_NAO_ENCONTRADO')) {
            alert('⚠️ Pedido não encontrado.');
        } else if (msg.includes('USUARIO_NAO_AUTORIZADO')) {
            alert('🔒 Usuário não autorizado.');
        } else {
            alert('❌ Erro ao atualizar pedido: ' + msg);
        }

        return;
    }

    console.log('Status atualizado:', data);
    await carregarPedidos();
}

async function cancelarPedido(pedidoId) {
    const usuario = window.usuarioAtual;

    if (!usuario) {
        alert('⚠️ Usuário não autenticado.');
        return;
    }

    const cargo = String(usuario.cargo || '').toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    // Usa a configuração que já foi carregada do Supabase
    const exigirGerente =
            permissoesAtuais.exigirGerenteCancelar === true;

    let pinGerente = null;

    // Só solicita PIN quando:
    // 1. A regra está ativa
    // 2. O usuário atual não é gerente/admin
    if (exigirGerente && !ehGerente) {

        pinGerente = prompt(
                '🔐 Digite o PIN do Gerente para cancelar este pedido:'
                );

        if (pinGerente === null) {
            return;
        }

        pinGerente = pinGerente.trim();

        if (!/^\d{4,6}$/.test(pinGerente)) {
            alert(
                    '⚠️ O PIN do gerente deve ter de 4 a 6 números.'
                    );
            return;
        }
    }

    const {data, error} = await _supabase.rpc(
            'cancelar_pedido_com_autorizacao',
            {
                p_pedido_id: pedidoId,
                p_pin_gerente: pinGerente
            }
    );

    if (error) {
        console.error(
                'Erro ao cancelar pedido:',
                error
                );

        const msg = error.message || '';

        if (msg.includes('PIN_GERENTE_INVALIDO')) {
            alert('❌ PIN do Gerente inválido.');

        } else if (msg.includes('AUTORIZACAO_GERENTE_NECESSARIA')) {
            alert(
                    '🔒 Este cancelamento exige autorização de um Gerente.'
                    );

        } else if (msg.includes('PEDIDO_JA_CANCELADO')) {
            alert('⚠️ Este pedido já está cancelado.');

        } else if (
                msg.includes(
                        'CANCELAMENTO_PERMITIDO_APENAS_PENDENTE'
                        )
                ) {
            alert(
                    '⚠️ Somente pedidos pendentes podem ser cancelados.'
                    );

        } else if (
                msg.includes('PEDIDO_NAO_ENCONTRADO')
                ) {
            alert('⚠️ Pedido não encontrado.');

        } else {
            alert(
                    '❌ Não foi possível cancelar o pedido.'
                    );
        }

        return;
    }

    console.log(
            '✅ Cancelamento autorizado:',
            data
            );

    await carregarPedidos();
}

// 5. Escuta novos pedidos ou atualizações em Tempo Real (Realtime)
function iniciarEscutaRealtime() {
    const statusLabel = document.getElementById('realtime-status');

    _supabase
            .channel('pedidos-realtime')
            .on('postgres_changes', {event: '*', schema: 'public', table: 'pedidos'}, (payload) => {

                // Se for um novo pedido inserido
                if (payload.eventType === 'INSERT') {
                    if (somAtivado) {
                        audioAlerta.play().catch(() => {
                        });
                    }
                }

                // Recarrega a tela com os dados atualizados
                carregarPedidos();
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    statusLabel.textContent = '🟢 Conectado em Tempo Real';
                    statusLabel.style.color = '#2e7d32';
                }
            });
}

async function alternarAba(nomeAba) {
    // ========================================================
    // PROTEÇÃO DA ABA FINANÇAS
    // ========================================================
    if (nomeAba === 'financas') {

        const cargo = String(
                window.usuarioAtual?.cargo || ''
                ).toUpperCase();

        const ehGerente =
                cargo === 'GERENTE' ||
                cargo === 'ADMIN';

        const financeiroBloqueado =
                permissoesAtuais.bloquearFinancas === true;

        if (!ehGerente && financeiroBloqueado) {
            console.warn(
                    '⛔ Acesso à aba Finanças bloqueado para este usuário.'
                    );

            alert(
                    '⛔ Você não tem permissão para acessar a área de Finanças.'
                    );

            return;
        }
    }

    const abaPedidos = document.getElementById('aba-pedidos');
    const abaBalcao = document.getElementById('aba-balcao');
    const abaProdutos = document.getElementById('aba-produtos');
    const abaFichaTecnica = document.getElementById('aba-ficha-tecnica');
    const abaCompras = document.getElementById('aba-compras');
    const abaHistorico = document.getElementById('aba-historico');
    const abaMovEstoque = document.getElementById('aba-mov-estoque');
    const abaConfig = document.getElementById('aba-config');
    const abaFinancas = document.getElementById('aba-financas');
    const abaPix = document.getElementById('aba-pix');

    const btnPedidos = document.getElementById('btn-tab-pedidos');
    const btnBalcao = document.getElementById('btn-tab-balcao');
    const btnProdutos = document.getElementById('btn-tab-produtos');
    const btnFichaTecnica = document.getElementById('btn-tab-ficha-tecnica');
    const btnCompras = document.getElementById('btn-tab-compras');
    const btnHistorico = document.getElementById('btn-tab-historico');
    const btnMovEstoque = document.getElementById('btn-tab-mov-estoque');
    const btnConfig = document.getElementById('btn-tab-config');
    const btnFinancas = document.getElementById('btn-tab-financas');
    const btnPix = document.getElementById('btn-tab-pix');

    // Oculta todas
    abaPedidos.style.display = 'none';
    abaBalcao.style.display = 'none';
    abaProdutos.style.display = 'none';
    abaCompras.style.display = 'none';
    abaFichaTecnica.style.display = 'none';
    abaHistorico.style.display = 'none';
    abaMovEstoque.style.display = 'none';
    abaConfig.style.display = 'none';
    abaFinancas.style.display = 'none';
    abaPix.style.display = 'none';

    btnPedidos.classList.remove('active');
    btnBalcao.classList.remove('active');
    btnProdutos.classList.remove('active');
    btnCompras.classList.remove('active');
    btnFichaTecnica.classList.remove('active');
    btnHistorico.classList.remove('active');
    btnMovEstoque.classList.remove('active');
    btnConfig.classList.remove('active');
    btnFinancas.classList.remove('active');
    btnPix.classList.remove('active');

    // Remove classe ativa de todos os botões
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    if (nomeAba === 'pedidos') {
        abaPedidos.style.display = 'grid';
        btnPedidos.classList.add('active');
        carregarPedidos();
    } else if (nomeAba === 'balcao') {
        document.getElementById('aba-balcao').style.display = 'block';
        document.getElementById('btn-tab-balcao').classList.add('active');
        carregarBalcao();
    } else if (nomeAba === 'produtos') {
        abaProdutos.style.display = 'block';
        btnProdutos.classList.add('active');
        carregarProdutosGerenciador();
    } else if (nomeAba === 'ficha-tecnica') {

        const cargo = String(
                window.usuarioAtual?.cargo || ''
                ).toUpperCase();

        const ehGerente =
                cargo === 'GERENTE' ||
                cargo === 'ADMIN';

        if (!ehGerente) {
            alert(
                    '⛔ Apenas GERENTE ou ADMIN podem acessar a Ficha Técnica.'
                    );
            return;
        }

        abaFichaTecnica.style.display = 'block';
        btnFichaTecnica.classList.add('active');

        carregarFichaTecnicaUI();
    } else if (nomeAba === 'compras') {
        abaCompras.style.display = 'block';
        btnCompras.classList.add('active');
        carregarInterfaceCompras();
    } else if (nomeAba === 'historico') {
        abaHistorico.style.display = 'block';
        btnHistorico.classList.add('active');
        carregarHistoricoVendas();
    } else if (nomeAba === 'mov-estoque') {
        abaMovEstoque.style.display = 'block';
        btnMovEstoque.classList.add('active');
        carregarHistoricoEstoque();
    } else if (nomeAba === 'pix') {
        abaPix.style.display = 'block';
        btnPix.classList.add('active');
        abrirPlacaPix();
    } else if (nomeAba === 'financas') {
        abaFinancas.style.display = 'block';
        btnFinancas.classList.add('active');
        carregarFinancas();
    } else if (nomeAba === 'config') {
        abaConfig.style.display = 'block';
        btnConfig.classList.add('active');
        carregarConfiguracoesPDV();
    }
}

// ============================================================
// FICHA TÉCNICA - CARREGAMENTO INICIAL
// ============================================================

let fichaTecnicaUI = {
    produtos: [],
    unidades: [],
    ficha: null,
    itens: []
};

async function carregarFichaTecnicaUI() {

    const selectProduto =
            document.getElementById('ficha-produto');

    const campoRendimento =
            document.getElementById('ficha-rendimento');

    const selectUnidadeRendimento =
            document.getElementById(
                    'ficha-unidade-rendimento'
                    );

    const campoObservacao =
            document.getElementById('ficha-observacao');

    const tbody =
            document.getElementById('ficha-itens-body');

    const status =
            document.getElementById('ficha-status');

    if (
            !selectProduto ||
            !campoRendimento ||
            !selectUnidadeRendimento ||
            !campoObservacao ||
            !tbody
            ) {
        console.error(
                '⛔ Elementos da Ficha Técnica não encontrados.'
                );
        return;
    }

    try {

        if (status) {
            status.textContent = 'Carregando...';
            status.style.color = '#aaa';
        }

        // ----------------------------------------------------
        // 1. PRODUTOS
        // ----------------------------------------------------

        const {
            data: produtos,
            error: erroProdutos
        } = await _supabase
                .from('produtos')
                .select('id, nome, ativo')
                .eq('ativo', true)
                .order('nome', {ascending: true});

        if (erroProdutos) {
            throw erroProdutos;
        }

        fichaTecnicaUI.produtos = produtos || [];

        const valorAtualProduto =
                selectProduto.value;

        selectProduto.innerHTML = `
            <option value="">
                Selecione um produto...
            </option>
        `;

        fichaTecnicaUI.produtos.forEach(produto => {

            const option =
                    document.createElement('option');

            option.value = produto.id;
            option.textContent = produto.nome;

            selectProduto.appendChild(option);
        });

        if (
                valorAtualProduto &&
                fichaTecnicaUI.produtos.some(
                        p => String(p.id) === String(valorAtualProduto)
                )
                ) {
            selectProduto.value = valorAtualProduto;
        }

        // ----------------------------------------------------
        // 2. UNIDADES
        // ----------------------------------------------------

        const {
            data: unidades,
            error: erroUnidades
        } = await _supabase
                .from('unidades_medida')
                .select(`
                id,
                codigo,
                nome,
                categoria,
                fator_base,
                ativa
            `)
                .eq('ativa', true)
                .order('categoria')
                .order('nome');

        if (erroUnidades) {
            throw erroUnidades;
        }

        fichaTecnicaUI.unidades = unidades || [];

        const valorAtualUnidade =
                selectUnidadeRendimento.value;

        selectUnidadeRendimento.innerHTML = `
            <option value="">
                Selecione...
            </option>
        `;

        fichaTecnicaUI.unidades.forEach(unidade => {

            const option =
                    document.createElement('option');

            option.value = unidade.id;
            option.textContent =
                    `${unidade.codigo} - ${unidade.nome}`;

            selectUnidadeRendimento.appendChild(option);
        });

        if (valorAtualUnidade) {
            selectUnidadeRendimento.value =
                    valorAtualUnidade;
        }

        // ----------------------------------------------------
        // 3. EVENTO DE TROCA DO PRODUTO
        // ----------------------------------------------------

        selectProduto.onchange =
                async function () {

                    await carregarFichaTecnicaUI();
                };

        // ----------------------------------------------------
        // 4. SEM PRODUTO SELECIONADO
        // ----------------------------------------------------

        if (!selectProduto.value) {

            campoRendimento.value = '';
            selectUnidadeRendimento.value = '';
            campoObservacao.value = '';

            fichaTecnicaUI.ficha = null;
            fichaTecnicaUI.itens = [];

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        style="
                            text-align:center;
                            color:#888;
                            padding:20px;
                        "
                    >
                        Selecione um produto para carregar
                        a ficha técnica.
                    </td>
                </tr>
            `;

            if (status) {
                status.textContent =
                        'Selecione um produto.';
                status.style.color = '#aaa';
            }

            return;
        }

        // ----------------------------------------------------
        // 5. BUSCA FICHA EXISTENTE
        // ----------------------------------------------------

        const produtoId =
                Number(selectProduto.value);

        const {
            data: ficha,
            error: erroFicha
        } = await _supabase
                .from('fichas_tecnicas')
                .select(`
                id,
                produto_id,
                rendimento,
                unidade_rendimento_id,
                observacao,
                ativa,
                criado_em,
                atualizado_em
            `)
                .eq('produto_id', produtoId)
                .maybeSingle();

        if (erroFicha) {
            throw erroFicha;
        }

        fichaTecnicaUI.ficha = ficha || null;

        // ----------------------------------------------------
        // 6. PREENCHE CABEÇALHO
        // ----------------------------------------------------

        if (ficha) {

            campoRendimento.value =
                    ficha.rendimento ?? '';

            selectUnidadeRendimento.value =
                    ficha.unidade_rendimento_id ?? '';

            campoObservacao.value =
                    ficha.observacao || '';

        } else {

            campoRendimento.value = '';
            selectUnidadeRendimento.value = '';
            campoObservacao.value = '';
        }

        // ----------------------------------------------------
        // 7. BUSCA ITENS DA FICHA
        // ----------------------------------------------------

        tbody.innerHTML = '';

        if (!ficha) {

            fichaTecnicaUI.itens = [];

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        style="
                            text-align:center;
                            color:#888;
                            padding:20px;
                        "
                    >
                        Este produto ainda não possui
                        uma Ficha Técnica.
                    </td>
                </tr>
            `;

        } else {

            const {
                data: itens,
                error: erroItens
            } = await _supabase
                    .from('itens_ficha_tecnica')
                    .select(`
                    id,
                    ficha_tecnica_id,
                    insumo_id,
                    unidade_id,
                    quantidade_bruta,
                    perda_percentual,
                    quantidade_liquida,
                    insumos (
                        id,
                        nome,
                        unidade_base_id
                    )
                `)
                    .eq('ficha_tecnica_id', ficha.id)
                    .order('id');

            if (erroItens) {
                throw erroItens;
            }

            fichaTecnicaUI.itens = itens || [];

            if (fichaTecnicaUI.itens.length === 0) {

                tbody.innerHTML = `
                    <tr>
                        <td
                            colspan="7"
                            style="
                                text-align:center;
                                color:#888;
                                padding:20px;
                            "
                        >
                            Ficha encontrada, mas sem ingredientes.
                        </td>
                    </tr>
                `;

            } else {

                fichaTecnicaUI.itens.forEach(item => {

                    const insumo =
                            item.insumos;

                    const unidade =
                            fichaTecnicaUI.unidades.find(
                                    u =>
                                String(u.id) ===
                                        String(item.unidade_id)
                            );

                    const qtdBruta =
                            Number(
                                    item.quantidade_bruta || 0
                                    );

                    const perda =
                            Number(
                                    item.perda_percentual || 0
                                    );

                    const qtdLiquida =
                            Number(
                                    item.quantidade_liquida || 0
                                    );

                    const tr =
                            document.createElement('tr');

// Guarda a identificação do item já existente.
// Isso permitirá que o Salvar Ficha faça UPDATE,
// em vez de tentar criar outro ingrediente.
                    tr.dataset.itemId = item.id;
                    tr.dataset.insumoId = item.insumo_id;

                    const opcoesUnidades =
                            (fichaTecnicaUI.unidades || [])
                            .map(u => `
            <option
                value="${u.id}"
                ${String(u.id) === String(item.unidade_id) ? 'selected' : ''}>
                ${u.codigo} - ${u.nome}
            </option>
        `)
                            .join('');

                    tr.innerHTML = `

    <!-- INSUMO -->
    <td>
        <strong>
            ${insumo?.nome || '-'}
        </strong>
    </td>

    <!-- UNIDADE -->
    <td>
        <select
            class="input-table ficha-item-unidade"
            style="width:100%;">
            ${opcoesUnidades}
        </select>
    </td>

    <!-- QUANTIDADE BRUTA -->
    <td>
        <input
            type="number"
            class="input-table ficha-item-qtd-bruta"
            min="0"
            step="0.001"
            value="${qtdBruta}"
            style="
                width:100%;
                text-align:right;
            "
        >
    </td>

    <!-- PERDA -->
    <td>
        <input
            type="number"
            class="input-table ficha-item-perda"
            min="0"
            max="100"
            step="0.01"
            value="${perda}"
            style="
                width:100%;
                text-align:right;
            "
        >
    </td>

    <!-- QUANTIDADE LÍQUIDA -->
    <td>
        <input
            type="number"
            class="input-table ficha-item-qtd-liquida"
            value="${qtdLiquida.toFixed(3)}"
            readonly
            style="
                width:100%;
                text-align:right;
                background:#202030;
            "
        >
    </td>

    <!-- CUSTO -->
    <td
        style="
            text-align:right;
            color:#aaa;
        "
    >
        --
    </td>

    <!-- AÇÃO -->
    <td style="text-align:center;">

    <button
        type="button"
        onclick="alternarExclusaoItemFicha(this)"
        title="Marcar ingrediente para exclusão"
        style="
            background:#dc3545;
            color:#fff;
            border:none;
            border-radius:6px;
            padding:6px 9px;
            cursor:pointer;
            font-size:0.95rem;
        "
    >
        🗑️
    </button>

</td>
`;

                    const campoQtdBruta =
                            tr.querySelector(
                                    '.ficha-item-qtd-bruta'
                                    );

                    const campoPerda =
                            tr.querySelector(
                                    '.ficha-item-perda'
                                    );

                    const campoQtdLiquida =
                            tr.querySelector(
                                    '.ficha-item-qtd-liquida'
                                    );

                    function recalcularQuantidadeLiquidaExistente() {

                        const bruta =
                                parseFloat(
                                        campoQtdBruta.value
                                        ) || 0;

                        const perdaAtual =
                                parseFloat(
                                        campoPerda.value
                                        ) || 0;

                        const liquida =
                                bruta *
                                (
                                        1 -
                                        perdaAtual / 100
                                        );

                        campoQtdLiquida.value =
                                liquida.toFixed(3);
                    }

                    campoQtdBruta.addEventListener(
                            'input',
                            recalcularQuantidadeLiquidaExistente
                            );

                    campoPerda.addEventListener(
                            'input',
                            recalcularQuantidadeLiquidaExistente
                            );

                    tbody.appendChild(tr);
                });
            }
        }

        await atualizarCustosFichaTecnicaUI();
        ativarEventosCustosFichaTecnicaUI();

        // ----------------------------------------------------
        // 8. STATUS
        // ----------------------------------------------------

        if (status) {

            status.textContent =
                    ficha
                    ? '✅ Ficha técnica carregada.'
                    : '📝 Novo produto sem ficha técnica.';

            status.style.color =
                    ficha
                    ? '#2ed573'
                    : '#ffa502';
        }

    } catch (err) {

        console.error(
                'Erro ao carregar Ficha Técnica:',
                err
                );

        if (status) {
            status.textContent =
                    '❌ Erro ao carregar a ficha.';
            status.style.color =
                    '#ff4757';
        }

        alert(
                '❌ Não foi possível carregar a Ficha Técnica:\n' +
                (err.message || err)
                );
    }
}

// ============================================================
// FICHA TÉCNICA - CÁLCULO DE CUSTOS
// ============================================================

async function atualizarCustosFichaTecnicaUI() {

    const tbody =
            document.getElementById('ficha-itens-body');

    const campoCustoTotal =
            document.getElementById('ficha-custo-total');

    const campoCustoUnitario =
            document.getElementById('ficha-custo-unitario');

    const campoRendimento =
            document.getElementById('ficha-rendimento');

    if (!tbody) {
        return;
    }

    const linhas = Array.from(
            tbody.querySelectorAll('tr')
            ).filter(tr => {

        return (
                tr.querySelector('select') &&
                tr.children.length >= 6
                );

    });

    if (linhas.length === 0) {

        if (campoCustoTotal) {
            campoCustoTotal.textContent =
                    'R$ 0,00';
        }

        if (campoCustoUnitario) {
            campoCustoUnitario.textContent =
                    'R$ 0,00';
        }

        return;
    }

    // --------------------------------------------------------
    // IDENTIFICA OS INSUMOS UTILIZADOS NAS LINHAS
    // --------------------------------------------------------

    const insumoIds = [];

    linhas.forEach(tr => {

        const selectInsumo =
                tr.querySelector('select');

        const insumoId =
                Number(
                        tr.dataset.insumoId ||
                        selectInsumo?.value ||
                        0
                        );

        if (insumoId) {
            insumoIds.push(insumoId);
        }

    });

    const idsUnicos = [
        ...new Set(insumoIds)
    ];

    if (idsUnicos.length === 0) {
        return;
    }

    // --------------------------------------------------------
    // BUSCA INSUMOS
    // --------------------------------------------------------

    const {
        data: insumos,
        error: erroInsumos
    } = await _supabase
            .from('insumos')
            .select(`
            id,
            nome,
            unidade_base_id
        `)
            .in('id', idsUnicos);

    if (erroInsumos) {
        console.error(
                'Erro ao buscar insumos para cálculo de custo:',
                erroInsumos
                );
        return;
    }

    // --------------------------------------------------------
    // BUSCA ESTOQUE + CUSTO MÉDIO
    // --------------------------------------------------------

    const {
        data: estoques,
        error: erroEstoques
    } = await _supabase
            .from('estoque_insumos')
            .select(`
            insumo_id,
            quantidade_base,
            custo_medio_base
        `)
            .in('insumo_id', idsUnicos);

    if (erroEstoques) {
        console.error(
                'Erro ao buscar custos dos insumos:',
                erroEstoques
                );
        return;
    }

    // --------------------------------------------------------
    // MAPAS PARA CONSULTA RÁPIDA
    // --------------------------------------------------------

    const mapaInsumos =
            new Map(
                    (insumos || []).map(
                    item => [
                            String(item.id),
                            item
                        ]
            )
                    );

    const mapaEstoques =
            new Map(
                    (estoques || []).map(
                    item => [
                            String(item.insumo_id),
                            item
                        ]
            )
                    );

    let custoTotal = 0;

    // --------------------------------------------------------
    // PROCESSA CADA LINHA
    // --------------------------------------------------------

    linhas.forEach(tr => {

        const selectInsumo =
                tr.querySelector('select');

        const selects =
                tr.querySelectorAll('select');

        const inputsNumericos =
                tr.querySelectorAll(
                        'input[type="number"]'
                        );

        const insumoId =
                Number(
                        tr.dataset.insumoId ||
                        selectInsumo?.value ||
                        0
                        );

        const insumo =
                mapaInsumos.get(
                        String(insumoId)
                        );

        const estoque =
                mapaEstoques.get(
                        String(insumoId)
                        );

        if (!insumo || !estoque) {

            if (tr.children[5]) {
                tr.children[5].textContent =
                        '--';
            }

            return;
        }

        // ----------------------------------------------------
        // QUANTIDADE BRUTA
        // ----------------------------------------------------

        const quantidadeBruta =
                Number(
                        inputsNumericos[0]?.value || 0
                        );

        if (
                !Number.isFinite(quantidadeBruta) ||
                quantidadeBruta <= 0
                ) {

            if (tr.children[5]) {
                tr.children[5].textContent =
                        'R$ 0,00';
            }

            return;
        }

        // ----------------------------------------------------
        // UNIDADE UTILIZADA NA FICHA
        // ----------------------------------------------------

        const unidadeId =
                Number(
                        selects[1]?.value ||
                        selects[0]?.value ||
                        0
                        );

        const unidade =
                fichaTecnicaUI.unidades.find(
                        u =>
                    String(u.id) ===
                            String(unidadeId)
                );

        const unidadeBase =
                fichaTecnicaUI.unidades.find(
                        u =>
                    String(u.id) ===
                            String(insumo.unidade_base_id)
                );

        if (!unidade || !unidadeBase) {

            if (tr.children[5]) {
                tr.children[5].textContent =
                        '--';
            }

            return;
        }

        // ----------------------------------------------------
        // CONVERSÃO DA QUANTIDADE PARA UNIDADE BASE
        // ----------------------------------------------------

        const fatorUnidade =
                Number(
                        unidade.fator_base || 1
                        );

        const fatorUnidadeBase =
                Number(
                        unidadeBase.fator_base || 1
                        );

        const quantidadeBase =
                quantidadeBruta *
                (
                        fatorUnidade /
                        fatorUnidadeBase
                        );

        // ----------------------------------------------------
        // CUSTO MÉDIO POR UNIDADE BASE
        // ----------------------------------------------------

        const custoMedioBase =
                Number(
                        estoque.custo_medio_base || 0
                        );

        const custoIngrediente =
                quantidadeBase *
                custoMedioBase;

        custoTotal +=
                custoIngrediente;

        // ----------------------------------------------------
        // MOSTRA CUSTO NA LINHA
        // ----------------------------------------------------

        if (tr.children[5]) {

            tr.children[5].textContent =
                    `R$ ${custoIngrediente
                    .toFixed(2)
                    .replace('.', ',')}`;

        }

    });

    // --------------------------------------------------------
    // MOSTRA CUSTO TOTAL DA RECEITA
    // --------------------------------------------------------

    if (campoCustoTotal) {

        campoCustoTotal.textContent =
                `R$ ${custoTotal
                .toFixed(2)
                .replace('.', ',')}`;

    }

    // --------------------------------------------------------
    // CUSTO POR UNIDADE DE RENDIMENTO
    // --------------------------------------------------------

    const rendimento =
            Number(
                    campoRendimento?.value || 0
                    );

    const custoPorUnidade =
            rendimento > 0
            ? custoTotal / rendimento
            : 0;

    if (campoCustoUnitario) {

        campoCustoUnitario.textContent =
                `R$ ${custoPorUnidade
                .toFixed(2)
                .replace('.', ',')}`;

    }

}

function ativarEventosCustosFichaTecnicaUI() {

    const tbody =
            document.getElementById('ficha-itens-body');

    const campoRendimento =
            document.getElementById('ficha-rendimento');

    if (!tbody) {
        return;
    }

    // --------------------------------------------------------
    // EVITA REGISTRAR OS EVENTOS MAIS DE UMA VEZ
    // --------------------------------------------------------

    if (tbody.dataset.eventosCustosAtivos !== '1') {

        tbody.dataset.eventosCustosAtivos = '1';

        // ----------------------------------------------------
        // ALTERAÇÕES NAS LINHAS DOS INGREDIENTES
        // ----------------------------------------------------

        tbody.addEventListener('input', async function (event) {

            const tr =
                    event.target.closest('tr');

            if (!tr) {
                return;
            }

            // Quantidade ou perda
            if (
                    event.target.matches(
                            'input[type="number"]'
                            )
                    ) {

                await atualizarCustosFichaTecnicaUI();

                return;
            }

        });

        // ----------------------------------------------------
        // TROCA DE INSUMO OU UNIDADE
        // ----------------------------------------------------

        tbody.addEventListener('change', async function (event) {

            const tr =
                    event.target.closest('tr');

            if (!tr) {
                return;
            }

            if (
                    event.target.matches('select')
                    ) {

                const selects =
                        tr.querySelectorAll('select');

                // Primeiro select = insumo
                if (event.target === selects[0]) {

                    tr.dataset.insumoId =
                            event.target.value;

                }

                await atualizarCustosFichaTecnicaUI();

                return;
            }

        });

    }

    // --------------------------------------------------------
    // ALTERAÇÃO DO RENDIMENTO
    // --------------------------------------------------------

    if (
            campoRendimento &&
            campoRendimento.dataset.eventoCustoAtivo !== '1'
            ) {

        campoRendimento.dataset.eventoCustoAtivo = '1';

        campoRendimento.addEventListener(
                'input',
                async function () {

                    await atualizarCustosFichaTecnicaUI();

                }
        );

    }

}

// ============================================================
// FICHA TÉCNICA - ADICIONAR INGREDIENTE
// ============================================================

async function adicionarLinhaIngredienteFicha() {

    const tbody =
            document.getElementById('ficha-itens-body');

    if (!tbody) {
        console.error(
                '⛔ Tabela de ingredientes da Ficha Técnica não encontrada.'
                );
        return;
    }

    // ---------------------------------------------------------
    // 1. Verifica se existe produto selecionado
    // ---------------------------------------------------------

    const selectProduto =
            document.getElementById('ficha-produto');

    if (!selectProduto || !selectProduto.value) {

        alert(
                '⚠️ Primeiro selecione um produto para cadastrar a ficha técnica.'
                );

        return;
    }

    // ---------------------------------------------------------
    // 2. Busca somente insumos ativos
    // ---------------------------------------------------------

    try {

        const {
            data: insumos,
            error
        } = await _supabase
                .from('insumos')
                .select(`
                id,
                nome,
                unidade_base_id
            `)
                .eq('ativo', true)
                .order('nome', {
                    ascending: true
                });

        if (error) {
            throw error;
        }

        // -----------------------------------------------------
        // 3. Verifica se existem insumos
        // -----------------------------------------------------

        if (!insumos || insumos.length === 0) {

            alert(
                    '⚠️ Nenhum insumo ativo está cadastrado.'
                    );

            return;
        }

        // -----------------------------------------------------
        // 4. Remove a mensagem "Nenhum ingrediente..."
        // -----------------------------------------------------

        const primeiraLinha =
                tbody.querySelector('tr');

        if (
                primeiraLinha &&
                primeiraLinha.children.length === 1
                ) {
            tbody.innerHTML = '';
        }

        // -----------------------------------------------------
        // 5. Cria a nova linha
        // -----------------------------------------------------

        const tr =
                document.createElement('tr');

        // -----------------------------------------------------
        // 6. Opções dos insumos
        // -----------------------------------------------------

        const opcoesInsumos =
                insumos.map(insumo => {

                    return `
                    <option
                        value="${insumo.id}"
                        data-unidade-base="${insumo.unidade_base_id}">
                        ${insumo.nome}
                    </option>
                `;

                }).join('');

        // -----------------------------------------------------
        // 7. Opções das unidades
        // -----------------------------------------------------

        const opcoesUnidades =
                (fichaTecnicaUI.unidades || [])
                .map(unidade => {

                    return `
                    <option value="${unidade.id}">
                        ${unidade.codigo} - ${unidade.nome}
                    </option>
                `;

                }).join('');

        // -----------------------------------------------------
        // 8. Monta a linha
        // -----------------------------------------------------

        tr.innerHTML = `

            <!-- INSUMO -->
            <td>
                <select
                    class="input-table ficha-item-insumo"
                    style="width:100%;">

                    <option value="">
                        Selecione...
                    </option>

                    ${opcoesInsumos}

                </select>
            </td>

            <!-- UNIDADE -->
            <td>
                <select
                    class="input-table ficha-item-unidade"
                    style="width:100%;">

                    <option value="">
                        Selecione...
                    </option>

                    ${opcoesUnidades}

                </select>
            </td>

            <!-- QUANTIDADE BRUTA -->
            <td>
                <input
                    type="number"
                    class="input-table ficha-item-qtd-bruta"
                    min="0"
                    step="0.001"
                    value=""
                    placeholder="0,000"
                    style="
                        width:100%;
                        text-align:right;
                    "
                >
            </td>

            <!-- PERDA -->
            <td>
                <input
                    type="number"
                    class="input-table ficha-item-perda"
                    min="0"
                    max="100"
                    step="0.01"
                    value="0"
                    style="
                        width:100%;
                        text-align:right;
                    "
                >
            </td>

            <!-- QUANTIDADE LÍQUIDA -->
            <td>
                <input
                    type="number"
                    class="input-table ficha-item-qtd-liquida"
                    value="0"
                    readonly
                    style="
                        width:100%;
                        text-align:right;
                        background:#202030;
                    "
                >
            </td>

            <!-- CUSTO -->
            <td
                style="
                    text-align:right;
                    color:#aaa;
                "
            >
                --
            </td>

            <!-- AÇÃO -->
            <td style="text-align:center;">

                <button
                    type="button"
                    class="btn-qty"
                    style="
                        background:#dc3545;
                        color:#fff;
                    "
                    onclick="this.closest('tr').remove();"
                    title="Remover ingrediente"
                >
                    🗑️
                </button>

            </td>
        `;

        // ---------------------------------------------------------
        // 9. Referências dos campos
        // ---------------------------------------------------------

        const selectInsumo =
                tr.querySelector(
                        '.ficha-item-insumo'
                        );

        const selectUnidade =
                tr.querySelector(
                        '.ficha-item-unidade'
                        );

        const campoQtdBruta =
                tr.querySelector(
                        '.ficha-item-qtd-bruta'
                        );

        const campoPerda =
                tr.querySelector(
                        '.ficha-item-perda'
                        );

        const campoQtdLiquida =
                tr.querySelector(
                        '.ficha-item-qtd-liquida'
                        );

        // ---------------------------------------------------------
        // 10. Calcula quantidade líquida
        //
        // mesma regra existente no banco:
        //
        // líquida = bruta × (1 - perda / 100)
        // ---------------------------------------------------------

        function recalcularQuantidadeLiquida() {

            const quantidadeBruta =
                    parseFloat(
                            campoQtdBruta.value
                            ) || 0;

            const perda =
                    parseFloat(
                            campoPerda.value
                            ) || 0;

            const quantidadeLiquida =
                    quantidadeBruta *
                    (
                            1 -
                            perda / 100
                            );

            campoQtdLiquida.value =
                    quantidadeLiquida.toFixed(3);
        }

        campoQtdBruta.addEventListener(
                'input',
                recalcularQuantidadeLiquida
                );

        campoPerda.addEventListener(
                'input',
                recalcularQuantidadeLiquida
                );

        // ---------------------------------------------------------
        // 11. Seleciona automaticamente a unidade base
        //     do insumo
        // ---------------------------------------------------------

        selectInsumo.addEventListener(
                'change',
                function () {

                    const optionSelecionada =
                            this.options[
                                    this.selectedIndex
                            ];

                    const unidadeBase =
                            optionSelecionada
                            ?.dataset
                            ?.unidadeBase;

                    if (unidadeBase) {

                        selectUnidade.value =
                                String(unidadeBase);
                    }
                }
        );

        // ---------------------------------------------------------
        // 12. Adiciona a linha na tabela
        // ---------------------------------------------------------

        tbody.appendChild(tr);

        // Coloca o foco no insumo
        selectInsumo.focus();

    } catch (err) {

        console.error(
                '❌ Erro ao carregar insumos da Ficha Técnica:',
                err
                );

        alert(
                '❌ Não foi possível carregar os insumos:\n\n' +
                (err.message || err)
                );
    }
}

// ============================================================
// FICHA TÉCNICA - MARCAR / DESFAZER EXCLUSÃO DE INGREDIENTE
// ============================================================

function alternarExclusaoItemFicha(botao) {

    const tr =
            botao?.closest('tr');

    if (!tr) {
        return;
    }

    const itemId =
            Number(
                    tr.dataset.itemId || 0
                    );

    // ---------------------------------------------------------
    // Linha nova:
    // não existe no banco ainda.
    //
    // Nesse caso, simplesmente remove a linha da tela.
    // ---------------------------------------------------------

    if (!itemId) {

        tr.remove();

        return;
    }

    // ---------------------------------------------------------
    // Linha já salva:
    // alterna entre marcado e não marcado.
    // ---------------------------------------------------------

    const estaMarcado =
            tr.dataset.excluir === 'true';

    if (!estaMarcado) {

        tr.dataset.excluir = 'true';

        tr.style.opacity = '0.45';

        tr.style.background =
                '#3a2525';

        // Impede alterações enquanto estiver marcada
        // para exclusão.
        tr.querySelectorAll(
                'input, select'
                ).forEach(campo => {
            campo.disabled = true;
        });

        botao.innerHTML =
                '↩️';

        botao.title =
                'Desfazer exclusão';

        botao.style.background =
                '#6c757d';

    } else {

        tr.dataset.excluir = 'false';

        tr.style.opacity = '1';

        tr.style.background = '';

        tr.querySelectorAll(
                'input, select'
                ).forEach(campo => {
            campo.disabled = false;
        });

        botao.innerHTML =
                '🗑️';

        botao.title =
                'Marcar ingrediente para exclusão';

        botao.style.background =
                '#dc3545';
    }
}

// ============================================================
// FICHA TÉCNICA - SALVAR
// ============================================================

async function salvarFichaTecnicaUI() {

    const btn =
            document.querySelector(
                    '#aba-ficha-tecnica button[onclick="salvarFichaTecnicaUI()"]'
                    );

    const selectProduto =
            document.getElementById('ficha-produto');

    const campoRendimento =
            document.getElementById('ficha-rendimento');

    const selectUnidadeRendimento =
            document.getElementById(
                    'ficha-unidade-rendimento'
                    );

    const campoObservacao =
            document.getElementById('ficha-observacao');

    const tbody =
            document.getElementById('ficha-itens-body');

    const status =
            document.getElementById('ficha-status');

    // ========================================================
    // 1. VERIFICAÇÃO DE PERMISSÃO
    // ========================================================

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    ).toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem salvar a Ficha Técnica.'
                );

        return;
    }

    if (!btn) {

        console.error(
                '⛔ Botão Salvar Ficha Técnica não encontrado.'
                );

        return;
    }

    if (!tbody) {

        console.error(
                '⛔ Tabela de ingredientes não encontrada.'
                );

        return;
    }

    // ========================================================
    // 2. CAMPOS PRINCIPAIS
    // ========================================================

    const produtoId =
            Number(
                    selectProduto?.value
                    );

    const rendimento =
            parseFloat(
                    campoRendimento?.value
                    );

    const unidadeRendimentoId =
            Number(
                    selectUnidadeRendimento?.value
                    );

    const observacao =
            campoObservacao?.value.trim() || null;

    if (!produtoId) {

        alert(
                '⚠️ Selecione o produto.'
                );

        selectProduto?.focus();

        return;
    }

    if (
            !Number.isFinite(rendimento) ||
            rendimento <= 0
            ) {

        alert(
                '⚠️ Informe um rendimento maior que zero.'
                );

        campoRendimento?.focus();

        return;
    }

    if (!unidadeRendimentoId) {

        alert(
                '⚠️ Selecione a unidade do rendimento.'
                );

        selectUnidadeRendimento?.focus();

        return;
    }

    // ========================================================
    // 3. LOCALIZA TODAS AS LINHAS DE INGREDIENTES
    // ========================================================
    //
    // Uma linha de ingrediente precisa possuir:
    // .ficha-item-qtd-bruta
    //
    // Isso vale tanto para:
    // - linha antiga carregada do banco
    // - linha nova adicionada pelo botão
    //

    const todasAsLinhas =
            Array.from(
                    tbody.querySelectorAll('tr')
                    ).filter(
            tr =>
        tr.querySelector(
                '.ficha-item-qtd-bruta'
                )
    );

    // ========================================================
    // 4. SEPARA LINHAS MARCADAS PARA EXCLUSÃO
    // ========================================================

    const linhasExcluidas =
            todasAsLinhas.filter(
                    tr =>
                tr.dataset.excluir === 'true'
            );

    // ========================================================
    // 5. LINHAS QUE CONTINUARÃO NA FICHA
    // ========================================================

    const linhasAtivas =
            todasAsLinhas.filter(
                    tr =>
                tr.dataset.excluir !== 'true'
            );

    // ========================================================
    // 6. EVITA FICHA NOVA SEM INGREDIENTES
    // ========================================================

    if (
            !fichaTecnicaUI.ficha &&
            linhasAtivas.length === 0
            ) {

        alert(
                '⚠️ Adicione pelo menos um ingrediente antes de salvar.'
                );

        return;
    }

    // ========================================================
    // 7. MONTA OS ITENS PARA INSERT / UPDATE
    // ========================================================

    const itensParaSalvar = [];

    for (
            let i = 0;
            i < linhasAtivas.length;
            i++
            ) {

        const tr =
                linhasAtivas[i];

        // ----------------------------------------------------
        // ID DO ITEM
        //
        // Se existir → item já veio do banco.
        // Se não existir → item novo.
        // ----------------------------------------------------

        const itemId =
                Number(
                        tr.dataset.itemId || 0
                        );

        // ----------------------------------------------------
        // INSUMO
        //
        // Linha nova:
        //   vem do select
        //
        // Linha existente:
        //   vem de data-insumo-id
        // ----------------------------------------------------

        let insumoId =
                Number(
                        tr.dataset.insumoId || 0
                        );

        const selectInsumo =
                tr.querySelector(
                        '.ficha-item-insumo'
                        );

        if (selectInsumo) {

            insumoId =
                    Number(
                            selectInsumo.value
                            );
        }

        // ----------------------------------------------------
        // UNIDADE
        // ----------------------------------------------------

        const selectUnidade =
                tr.querySelector(
                        '.ficha-item-unidade'
                        );

        const unidadeId =
                Number(
                        selectUnidade?.value
                        );

        // ----------------------------------------------------
        // QUANTIDADE BRUTA
        // ----------------------------------------------------

        const campoQtdBruta =
                tr.querySelector(
                        '.ficha-item-qtd-bruta'
                        );

        const quantidadeBruta =
                parseFloat(
                        campoQtdBruta?.value
                        );

        // ----------------------------------------------------
        // PERDA
        // ----------------------------------------------------

        const campoPerda =
                tr.querySelector(
                        '.ficha-item-perda'
                        );

        const perdaPercentual =
                parseFloat(
                        campoPerda?.value
                        ) || 0;

        // ----------------------------------------------------
        // VALIDAÇÕES
        // ----------------------------------------------------

        const numeroLinha =
                i + 1;

        if (!insumoId) {

            alert(
                    `⚠️ Linha ${numeroLinha}: selecione o insumo.`
                    );

            selectInsumo?.focus();

            return;
        }

        if (!unidadeId) {

            alert(
                    `⚠️ Linha ${numeroLinha}: selecione a unidade.`
                    );

            selectUnidade?.focus();

            return;
        }

        if (
                !Number.isFinite(
                        quantidadeBruta
                        ) ||
                quantidadeBruta <= 0
                ) {

            alert(
                    `⚠️ Linha ${numeroLinha}: informe uma quantidade bruta maior que zero.`
                    );

            campoQtdBruta?.focus();

            return;
        }

        if (
                !Number.isFinite(
                        perdaPercentual
                        ) ||
                perdaPercentual < 0 ||
                perdaPercentual > 100
                ) {

            alert(
                    `⚠️ Linha ${numeroLinha}: a perda deve estar entre 0 e 100%.`
                    );

            campoPerda?.focus();

            return;
        }

        // ----------------------------------------------------
        // CALCULA A QUANTIDADE LÍQUIDA
        // ----------------------------------------------------

        const quantidadeLiquida =
                quantidadeBruta *
                (
                        1 -
                        perdaPercentual / 100
                        );

        // ----------------------------------------------------
        // GUARDA O ITEM
        // ----------------------------------------------------

        itensParaSalvar.push({

            id:
                    itemId || null,

            insumo_id:
                    insumoId,

            unidade_id:
                    unidadeId,

            quantidade_bruta:
                    quantidadeBruta,

            perda_percentual:
                    perdaPercentual,

            quantidade_liquida:
                    Number(
                            quantidadeLiquida.toFixed(6)
                            )
        });
    }

    // ========================================================
    // 8. FEEDBACK IMEDIATO
    // ========================================================

    const textoOriginal =
            btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML =
            '⏳ Salvando...';

    if (status) {

        status.textContent =
                '⏳ Salvando Ficha Técnica...';

        status.style.color =
                '#ffa502';
    }

    try {

        // ====================================================
        // 9. USUÁRIO AUTENTICADO
        // ====================================================

        const authUserId =
                window.usuarioAtual?.auth_user_id
                || null;

        // ====================================================
        // 10. SALVA CABEÇALHO DA FICHA
        // ====================================================

        let fichaId = null;

        // ----------------------------------------------------
        // FICHA JÁ EXISTE → UPDATE
        // ----------------------------------------------------

        if (
                fichaTecnicaUI.ficha &&
                fichaTecnicaUI.ficha.id
                ) {

            fichaId =
                    Number(
                            fichaTecnicaUI.ficha.id
                            );

            const {
                data: fichaAtualizada,
                error
            } = await _supabase
                    .from('fichas_tecnicas')
                    .update({

                        rendimento:
                                rendimento,

                        unidade_rendimento_id:
                                unidadeRendimentoId,

                        observacao:
                                observacao,

                        atualizado_em:
                                new Date().toISOString(),

                        usuario_auth_id:
                                authUserId
                    })
                    .eq(
                            'id',
                            fichaId
                            )
                    .select(`
                    id,
                    produto_id,
                    rendimento,
                    unidade_rendimento_id,
                    observacao,
                    ativa,
                    criado_em,
                    atualizado_em
                `)
                    .single();

            if (error) {
                throw error;
            }

            fichaTecnicaUI.ficha =
                    fichaAtualizada;

        } else {

            // ------------------------------------------------
            // NOVA FICHA → INSERT
            // ------------------------------------------------

            const {
                data: fichaCriada,
                error
            } = await _supabase
                    .from('fichas_tecnicas')
                    .insert({

                        produto_id:
                                produtoId,

                        rendimento:
                                rendimento,

                        unidade_rendimento_id:
                                unidadeRendimentoId,

                        observacao:
                                observacao,

                        ativa:
                                true,

                        usuario_auth_id:
                                authUserId
                    })
                    .select(`
                    id,
                    produto_id,
                    rendimento,
                    unidade_rendimento_id,
                    observacao,
                    ativa,
                    criado_em,
                    atualizado_em
                `)
                    .single();

            if (error) {
                throw error;
            }

            fichaId =
                    Number(
                            fichaCriada.id
                            );

            fichaTecnicaUI.ficha =
                    fichaCriada;
        }

        // ====================================================
        // 11. INSERT / UPDATE DOS INGREDIENTES
        // ====================================================

        for (
                const item
                of itensParaSalvar
                ) {

            // ------------------------------------------------
            // ITEM EXISTENTE → UPDATE
            // ------------------------------------------------

            if (item.id) {

                const {
                    error
                } = await _supabase
                        .from('itens_ficha_tecnica')
                        .update({

                            insumo_id:
                                    item.insumo_id,

                            unidade_id:
                                    item.unidade_id,

                            quantidade_bruta:
                                    item.quantidade_bruta,

                            perda_percentual:
                                    item.perda_percentual
                        })
                        .eq(
                                'id',
                                item.id
                                )
                        .eq(
                                'ficha_tecnica_id',
                                fichaId
                                );
                if (error) {
                    throw error;
                }

            } else {

                // ------------------------------------------------
                // ITEM NOVO → INSERT
                // ------------------------------------------------

                const {
                    error
                } = await _supabase
                        .from('itens_ficha_tecnica')
                        .insert({

                            ficha_tecnica_id:
                                    fichaId,

                            insumo_id:
                                    item.insumo_id,

                            unidade_id:
                                    item.unidade_id,

                            quantidade_bruta:
                                    item.quantidade_bruta,

                            perda_percentual:
                                    item.perda_percentual
                        });

                if (error) {
                    throw error;
                }
            }
        }

        // ====================================================
        // 12. DELETE DOS INGREDIENTES MARCADOS
        // ====================================================

        for (
                const tr
                of linhasExcluidas
                ) {

            const itemId =
                    Number(
                            tr.dataset.itemId || 0
                            );
            if (!itemId) {
                continue;
            }

            const {
                error
            } = await _supabase
                    .from('itens_ficha_tecnica')
                    .delete()
                    .eq(
                            'id',
                            itemId
                            )
                    .eq(
                            'ficha_tecnica_id',
                            fichaId
                            );

            if (error) {
                throw error;
            }

            console.log(
                    '🗑️ Ingrediente excluído:',
                    itemId
                    );
        }

        // ====================================================
        // 13. SUCESSO
        // ====================================================

        console.log(
                '✅ Ficha Técnica salva:',
                {
                    fichaId,
                    itensSalvos:
                            itensParaSalvar.length,
                    itensExcluidos:
                            linhasExcluidas.length
                }
        );

        if (status) {

            status.textContent =
                    '✅ Ficha técnica salva com sucesso.';

            status.style.color =
                    '#2ed573';
        }

        btn.innerHTML =
                '✅ Salvo!';

        await new Promise(
                resolve =>
            setTimeout(
                    resolve,
                    500
                    )
        );

        alert(
                '✅ Ficha Técnica salva com sucesso!'
                );

        // ====================================================
        // 14. RECARREGA TUDO DIRETAMENTE DO BANCO
        // ====================================================

        await carregarFichaTecnicaUI();

    } catch (err) {

        console.error(
                '❌ Erro ao salvar Ficha Técnica:',
                err
                );

        if (status) {

            status.textContent =
                    '❌ Erro ao salvar a ficha.';

            status.style.color =
                    '#ff4757';
        }

        const mensagem =
                err?.message ||
                String(err);

        if (
                mensagem
                .toLowerCase()
                .includes(
                        'row-level security'
                        ) ||
                mensagem
                .toLowerCase()
                .includes(
                        'permission denied'
                        )
                ) {

            alert(
                    '⛔ O banco recusou a operação por regra de segurança (RLS).\n\n' +
                    mensagem
                    );

        } else {

            alert(
                    '❌ Não foi possível salvar a Ficha Técnica:\n\n' +
                    mensagem
                    );
        }

    } finally {

        btn.disabled = false;

        btn.innerHTML =
                textoOriginal;
    }
}

// ============================================================
// FICHA TÉCNICA - LIMPAR INTERFACE
// ============================================================

function limparFichaTecnicaUI() {

    const selectProduto =
            document.getElementById('ficha-produto');

    const campoRendimento =
            document.getElementById('ficha-rendimento');

    const selectUnidadeRendimento =
            document.getElementById(
                    'ficha-unidade-rendimento'
                    );

    const campoObservacao =
            document.getElementById('ficha-observacao');

    const tbody =
            document.getElementById('ficha-itens-body');

    const campoCustoTotal =
            document.getElementById('ficha-custo-total');

    const campoCustoUnitario =
            document.getElementById('ficha-custo-unitario');

    const status =
            document.getElementById('ficha-status');

    // --------------------------------------------------------
    // LIMPA O ESTADO EM MEMÓRIA
    // --------------------------------------------------------

    fichaTecnicaUI.ficha = null;
    fichaTecnicaUI.itens = [];

    // --------------------------------------------------------
    // LIMPA PRODUTO
    // --------------------------------------------------------

    if (selectProduto) {
        selectProduto.value = '';
    }

    // --------------------------------------------------------
    // LIMPA DADOS DA FICHA
    // --------------------------------------------------------

    if (campoRendimento) {
        campoRendimento.value = '';
    }

    if (selectUnidadeRendimento) {
        selectUnidadeRendimento.value = '';
    }

    if (campoObservacao) {
        campoObservacao.value = '';
    }

    // --------------------------------------------------------
    // LIMPA INGREDIENTES
    // --------------------------------------------------------

    if (tbody) {

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="7"
                    style="
                        text-align:center;
                        color:#aaa;
                        padding:25px;
                    "
                >
                    Nenhum ingrediente adicionado.
                </td>
            </tr>
        `;

    }

    // --------------------------------------------------------
    // ZERA CUSTOS
    // --------------------------------------------------------

    if (campoCustoTotal) {
        campoCustoTotal.textContent =
                'R$ 0,00';
    }

    if (campoCustoUnitario) {
        campoCustoUnitario.textContent =
                'R$ 0,00';
    }

    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

    if (status) {

        status.textContent =
                'Nenhuma ficha selecionada';

        status.style.color =
                '#aaa';

    }

    console.log(
            '🧹 Interface da Ficha Técnica limpa.'
            );
}

// ============================================================
// COMPRAS - INTERFACE
// ============================================================
const comprasRecebimentoEmAndamento = new Set();

async function carregarInterfaceCompras() {
    const dataAtual = new Date().toISOString().split('T')[0];

    const campoData = document.getElementById('compra-data');

    if (campoData && !campoData.value) {
        campoData.value = dataAtual;
    }

    await carregarFornecedoresCompras();
    await carregarProdutosCompras();

    renderizarItensCompraUI();
    recalcularCompraUI();

    await carregarComprasAbertasUI();
    await carregarHistoricoComprasUI();
}

async function carregarFornecedoresCompras() {
    const select = document.getElementById('compra-fornecedor');

    if (!select) {
        return;
    }

    select.innerHTML = `
        <option value="">Carregando fornecedores...</option>
    `;

    const {data, error} = await _supabase
            .from('fornecedores')
            .select(`
            id,
            nome,
            documento
        `)
            .eq('ativo', true)
            .order('nome');

    if (error) {
        console.error(
                'Erro ao carregar fornecedores:',
                error
                );

        select.innerHTML = `
            <option value="">Erro ao carregar fornecedores</option>
        `;

        return;
    }

    select.innerHTML = `
        <option value="">Selecione o fornecedor</option>
    `;

    (data || []).forEach(fornecedor => {
        const documento = fornecedor.documento
                ? ` - ${fornecedor.documento}`
                : '';

        select.innerHTML += `
            <option value="${fornecedor.id}">
                ${fornecedor.nome}${documento}
            </option>
        `;
    });

    await carregarComprasAbertasUI();
}

async function carregarComprasAbertasUI() {
    const container =
            document.getElementById(
                    'compras-abertas-body'
                    );

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div style="
            text-align: center;
            color: #888;
            padding: 20px;
        ">
            ⏳ Carregando compras...
        </div>
    `;

    const {data: compras, error} = await _supabase
            .from('compras')
            .select(`
            id,
            fornecedor_id,
            numero_nota,
            data_compra,
            status,
            subtotal,
            desconto,
            frete,
            total,
            observacao,
            criado_em,
            fornecedores (
                nome
            ),
            itens_compra (
                id,
                produto_id,
                produto_nome,
                quantidade,
                custo_unitario,
                total_item
            )
        `)
            .eq('status', 'ABERTA')
            .order('id', {
                ascending: false
            });

    if (error) {
        console.error(
                'Erro ao carregar compras abertas:',
                error
                );

        container.innerHTML = `
            <div style="
                color: #ff4757;
                text-align: center;
                padding: 20px;
            ">
                ❌ Erro ao carregar compras:
                ${error.message}
            </div>
        `;

        return;
    }

    if (!compras || compras.length === 0) {
        container.innerHTML = `
            <div style="
                text-align: center;
                color: #888;
                padding: 25px;
            ">
                ✅ Nenhuma compra aguardando recebimento.
            </div>
        `;

        return;
    }

    container.innerHTML = '';

    compras.forEach(compra => {
        const itens =
                compra.itens_compra || [];

        const quantidadeItens =
                itens.reduce(
                        (total, item) =>
                    total + Number(item.quantidade || 0),
                        0
                        );

        const fornecedor =
                compra.fornecedores?.nome ||
                'Fornecedor não identificado';

        const nota =
                compra.numero_nota ||
                'Sem NF';

        const total =
                Number(compra.total || 0)
                .toFixed(2)
                .replace('.', ',');

        const dataCompra =
                compra.data_compra
                ? compra.data_compra
                .split('-')
                .reverse()
                .join('/')
                : '--/--/----';

        const card =
                document.createElement('div');

        card.style.cssText = `
            background: #1e1e24;
            border: 1px solid #3d3d4e;
            border-radius: 8px;
            padding: 16px;
        `;

        card.innerHTML = `
            <div style="
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 15px;
            ">

                <div style="flex: 1;">

                    <div style="
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        margin-bottom: 8px;
                    ">
                        <strong style="
                            font-size: 1.1rem;
                            color: #fff;
                        ">
                            Compra #${compra.id}
                        </strong>

                        <span style="
                            background: #ffa502;
                            color: #111;
                            padding: 3px 8px;
                            border-radius: 12px;
                            font-size: 0.75rem;
                            font-weight: bold;
                        ">
                            ABERTA
                        </span>
                    </div>

                    <div style="
                        color: #bbb;
                        line-height: 1.7;
                    ">
                        <div>
                            <strong>Fornecedor:</strong>
                            ${fornecedor}
                        </div>

                        <div>
                            <strong>Nota:</strong>
                            ${nota}
                        </div>

                        <div>
                            <strong>Data:</strong>
                            ${dataCompra}
                        </div>

                        <div>
                            <strong>Itens:</strong>
                            ${itens.length}
                            produto(s) | 
                            ${quantidadeItens}
                            unidade(s)
                        </div>
                    </div>
                </div>

                <div style="
                    text-align: right;
                    min-width: 180px;
                ">

                    <small style="
                        display: block;
                        color: #aaa;
                        margin-bottom: 4px;
                    ">
                        Total da Compra
                    </small>

                    <strong style="
                        display: block;
                        color: #2ed573;
                        font-size: 1.35rem;
                        margin-bottom: 12px;
                    ">
                        R$ ${total}
                    </strong>

                    <button
                        type="button"
                        class="btn-save-prod"
                        onclick="receberCompraUI(${compra.id})"
                        style="
                            width: 180px;
                            min-width: 180px;
                            height: 42px;
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            line-height: 1;
                            box-sizing: border-box;
                            white-space: nowrap;
                        ">
                        📦 Receber Mercadoria
                    </button>
                </div>
            </div>
        `;

        container.appendChild(card);
    });
}

async function carregarHistoricoComprasUI() {

    const tbody =
            document.getElementById(
                    'historico-compras-body'
                    );

    if (!tbody) {
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td
                colspan="8"
                style="
                    text-align:center;
                    color:#888;
                ">
                ⏳ Carregando compras...
            </td>
        </tr>
    `;

    const status =
            document.getElementById(
                    'filtro-compras-status'
                    )?.value || 'TODOS';

    const periodo =
            document.getElementById(
                    'filtro-compras-periodo'
                    )?.value || 'TODOS';

    let query = _supabase
            .from('compras')
            .select(`
            id,
            fornecedor_id,
            numero_nota,
            data_compra,
            status,
            subtotal,
            desconto,
            frete,
            total,
            observacao,
            usuario_auth_id,
            usuario_nome,
            criado_em,
            recebido_em,
            fornecedores (
                id,
                nome
            ),
            itens_compra (
                id,
                produto_id,
                produto_nome,
                quantidade,
                custo_unitario,
                total_item
            )
        `)
            .order('id', {
                ascending: false
            });

    // ========================================================
    // FILTRO POR STATUS
    // ========================================================

    if (status !== 'TODOS') {
        query = query.eq(
                'status',
                status
                );
    }

    // ========================================================
    // FILTRO POR PERÍODO
    // ========================================================

    const agora = new Date();

    if (periodo === 'HOJE') {

        const inicioHoje =
                new Date(
                        agora.getFullYear(),
                        agora.getMonth(),
                        agora.getDate()
                        ).toISOString();

        query = query.gte(
                'criado_em',
                inicioHoje
                );

    } else if (periodo === '7DIAS') {

        const data7Dias =
                new Date(agora);

        data7Dias.setDate(
                data7Dias.getDate() - 7
                );

        query = query.gte(
                'criado_em',
                data7Dias.toISOString()
                );

    } else if (periodo === 'MES') {

        const inicioMes =
                new Date(
                        agora.getFullYear(),
                        agora.getMonth(),
                        1
                        ).toISOString();

        query = query.gte(
                'criado_em',
                inicioMes
                );
    }

    const {
        data,
        error
    } = await query;

    if (error) {

        console.error(
                'Erro ao carregar histórico de compras:',
                error
                );

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    style="
                        text-align:center;
                        color:#ff4757;
                    ">
                    ❌ Erro ao carregar compras.
                </td>
            </tr>
        `;

        return;
    }

    historicoComprasUI =
            Array.isArray(data)
            ? data
            : [];

    renderizarHistoricoComprasUI();
}

function renderizarHistoricoComprasUI() {

    const tbody =
            document.getElementById(
                    'historico-compras-body'
                    );

    if (!tbody) {
        return;
    }

    if (
            !Array.isArray(historicoComprasUI) ||
            historicoComprasUI.length === 0
            ) {

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    style="
                        text-align:center;
                        color:#888;
                        padding:25px;
                    ">
                    Nenhuma compra encontrada.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = '';

    historicoComprasUI.forEach(compra => {

        const itens =
                compra.itens_compra || [];

        const quantidadeItens =
                itens.reduce(
                        (soma, item) =>
                    soma +
                            Number(
                                    item.quantidade || 0
                                    ),
                        0
                        );

        const fornecedor =
                compra.fornecedores?.nome ||
                'Fornecedor não identificado';

        const nota =
                compra.numero_nota ||
                '-';

        const data =
                compra.data_compra
                ? compra.data_compra
                .split('-')
                .reverse()
                .join('/')
                : '-';

        const total =
                Number(
                        compra.total || 0
                        )
                .toFixed(2)
                .replace('.', ',');

        let statusHTML = '';

        if (compra.status === 'ABERTA') {

            statusHTML = `
                <span style="
                    background:#ffa502;
                    color:#111;
                    padding:4px 8px;
                    border-radius:12px;
                    font-size:0.75rem;
                    font-weight:bold;">
                    🟡 ABERTA
                </span>
            `;

        } else if (compra.status === 'RECEBIDA') {

            statusHTML = `
                <span style="
                    background:#2ed573;
                    color:#111;
                    padding:4px 8px;
                    border-radius:12px;
                    font-size:0.75rem;
                    font-weight:bold;">
                    🟢 RECEBIDA
                </span>
            `;

        } else {

            statusHTML = `
                <span style="
                    background:#ff4757;
                    color:#fff;
                    padding:4px 8px;
                    border-radius:12px;
                    font-size:0.75rem;
                    font-weight:bold;">
                    🔴 CANCELADA
                </span>
            `;
        }

        const tr =
                document.createElement('tr');

        tr.dataset.compraId =
                compra.id;

        tr.innerHTML = `
            <td>
                <strong>
                    #${compra.id}
                </strong>
            </td>

            <td>
                ${fornecedor}
            </td>

            <td>
                ${nota}
            </td>

            <td>
                ${data}
            </td>

            <td>
                ${itens.length}
                produto(s)
                /
                ${quantidadeItens}
                un.
            </td>

            <td>
                <strong>
                    R$ ${total}
                </strong>
            </td>

            <td>
                ${statusHTML}
            </td>

            <td>

                <button
                    type="button"
                    class="btn-qty"
                    onclick="abrirDetalhesCompraUI(${compra.id})"
                    style="
                        min-width:110px;
                        height:36px;
                        display:inline-flex;
                        align-items:center;
                        justify-content:center;
                        line-height:1;
                    ">
                    👁️ Detalhes
                </button>

            </td>
        `;

        tbody.appendChild(tr);
    });
}

function filtrarHistoricoComprasUI() {

    const campo =
            document.getElementById(
                    'filtro-compras-texto'
                    );

    const termo =
            (campo?.value || '')
            .trim()
            .toLowerCase();

    const linhas =
            document.querySelectorAll(
                    '#historico-compras-body tr[data-compra-id]'
                    );

    historicoComprasUI.forEach(compra => {

        const fornecedor =
                String(
                        compra.fornecedores?.nome || ''
                        ).toLowerCase();

        const nota =
                String(
                        compra.numero_nota || ''
                        ).toLowerCase();

        const numero =
                String(
                        compra.id
                        );

        const corresponde =
                !termo ||
                fornecedor.includes(termo) ||
                nota.includes(termo) ||
                numero.includes(termo);

        const linha =
                document.querySelector(
                        `#historico-compras-body tr[data-compra-id="${compra.id}"]`
                        );

        if (linha) {
            linha.style.display =
                    corresponde
                    ? ''
                    : 'none';
        }
    });
}

function abrirDetalhesCompraUI(compraId) {

    const compra =
            historicoComprasUI.find(
                    item =>
                Number(item.id) ===
                        Number(compraId)
            );

    if (!compra) {
        alert(
                '❌ Compra não encontrada.'
                );
        return;
    }

    const modal =
            document.getElementById(
                    'modal-detalhes-compra'
                    );

    const titulo =
            document.getElementById(
                    'titulo-detalhes-compra'
                    );

    const conteudo =
            document.getElementById(
                    'conteudo-detalhes-compra'
                    );

    if (!modal || !titulo || !conteudo) {
        return;
    }

    const fornecedor =
            compra.fornecedores?.nome ||
            'Não identificado';

    const itens =
            compra.itens_compra || [];

    const data =
            compra.data_compra
            ? compra.data_compra
            .split('-')
            .reverse()
            .join('/')
            : '-';

    const subtotal =
            Number(
                    compra.subtotal || 0
                    )
            .toFixed(2)
            .replace('.', ',');

    const desconto =
            Number(
                    compra.desconto || 0
                    )
            .toFixed(2)
            .replace('.', ',');

    const frete =
            Number(
                    compra.frete || 0
                    )
            .toFixed(2)
            .replace('.', ',');

    const total =
            Number(
                    compra.total || 0
                    )
            .toFixed(2)
            .replace('.', ',');

    titulo.textContent =
            `📋 Compra #${compra.id}`;

    let itensHTML = '';

    itens.forEach(item => {

        const itemTotal =
                Number(
                        item.total_item || 0
                        )
                .toFixed(2)
                .replace('.', ',');

        const custo =
                Number(
                        item.custo_unitario || 0
                        )
                .toFixed(2)
                .replace('.', ',');

        itensHTML += `
            <tr>

                <td>
                    ${item.produto_nome}
                </td>

                <td style="text-align:center;">
                    ${item.quantidade}
                </td>

                <td style="text-align:right;">
                    R$ ${custo}
                </td>

                <td style="text-align:right;">
                    <strong>
                        R$ ${itemTotal}
                    </strong>
                </td>

            </tr>
        `;
    });

    conteudo.innerHTML = `

        <div style="
            background:#2a2a35;
            border:1px solid #3d3d4e;
            border-radius:8px;
            padding:15px;
            margin-bottom:15px;
        ">

            <div style="
                display:grid;
                grid-template-columns:1fr 1fr;
                gap:10px;
            ">

                <div>
                    <small style="color:#aaa;">
                        Fornecedor
                    </small>

                    <strong style="
                        display:block;
                        color:#fff;">
                        ${fornecedor}
                    </strong>
                </div>

                <div>
                    <small style="color:#aaa;">
                        Nota
                    </small>

                    <strong style="
                        display:block;
                        color:#fff;">
                        ${compra.numero_nota || '-'}
                    </strong>
                </div>

                <div>
                    <small style="color:#aaa;">
                        Data da Compra
                    </small>

                    <strong style="
                        display:block;
                        color:#fff;">
                        ${data}
                    </strong>
                </div>

                <div>
                    <small style="color:#aaa;">
                        Usuário
                    </small>

                    <strong style="
                        display:block;
                        color:#fff;">
                        ${compra.usuario_nome || 'Sistema'}
                    </strong>
                </div>

                <div>
                    <small style="color:#aaa;">
                        Status
                    </small>

                    <strong style="
                        display:block;
                        color:#fff;">
                        ${compra.status}
                    </strong>
                </div>

                <div>
                    <small style="color:#aaa;">
                        Recebimento
                    </small>

                    <strong style="
                        display:block;
                        color:#fff;">
                        ${
            compra.recebido_em
            ? new Date(
                    compra.recebido_em
                    ).toLocaleString('pt-BR')
            : '-'
            }
                    </strong>
                </div>

            </div>

        </div>

        <div style="
            background:#2a2a35;
            border:1px solid #3d3d4e;
            border-radius:8px;
            padding:15px;
            margin-bottom:15px;
        ">

            <h3 style="margin-top:0;">
                📦 Itens
            </h3>

            <div class="table-responsive">

                <table class="products-table">

                    <thead>
                        <tr>
                            <th>Produto</th>
                            <th style="text-align:center;">
                                Quantidade
                            </th>
                            <th style="text-align:right;">
                                Custo Unit.
                            </th>
                            <th style="text-align:right;">
                                Total
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        ${itensHTML}
                    </tbody>

                </table>

            </div>

        </div>

        <div style="
            background:#2a2a35;
            border:1px solid #3d3d4e;
            border-radius:8px;
            padding:15px;
        ">

            <div style="
                display:flex;
                justify-content:flex-end;
            ">

                <div style="
                    width:280px;
                ">

                    <div style="
                        display:flex;
                        justify-content:space-between;
                        margin-bottom:7px;
                    ">
                        <span>Subtotal:</span>
                        <strong>
                            R$ ${subtotal}
                        </strong>
                    </div>

                    <div style="
                        display:flex;
                        justify-content:space-between;
                        margin-bottom:7px;
                    ">
                        <span>Desconto:</span>
                        <strong>
                            R$ ${desconto}
                        </strong>
                    </div>

                    <div style="
                        display:flex;
                        justify-content:space-between;
                        margin-bottom:7px;
                    ">
                        <span>Frete:</span>
                        <strong>
                            R$ ${frete}
                        </strong>
                    </div>

                    <hr style="
                        border:0;
                        border-top:1px solid #3d3d4e;
                    ">

                    <div style="
                        display:flex;
                        justify-content:space-between;
                        font-size:1.2rem;
                    ">
                        <strong>Total:</strong>

                        <strong style="
                            color:#2ed573;">
                            R$ ${total}
                        </strong>
                    </div>

                </div>

            </div>

        </div>

        ${
            compra.observacao
            ? `
                    <div style="
                        margin-top:15px;
                        background:#1e1e24;
                        border:1px solid #3d3d4e;
                        border-radius:8px;
                        padding:12px;
                        color:#bbb;
                    ">
                        <strong style="color:#fff;">
                            Observação:
                        </strong>
                        <div style="margin-top:5px;">
                            ${compra.observacao}
                        </div>
                    </div>
                `
            : ''
            }

    `;

    modal.style.display = 'flex';
}

function fecharDetalhesCompraUI() {

    const modal =
            document.getElementById(
                    'modal-detalhes-compra'
                    );

    if (modal) {
        modal.style.display = 'none';
    }
}

async function receberCompraUI(compraId) {
    const id = Number(compraId);

    if (!Number.isInteger(id) || id <= 0) {
        alert('❌ ID de compra inválido.');
        return;
    }

    if (comprasRecebimentoEmAndamento.has(id)) {
        return;
    }

    const confirmar = confirm(
            `📦 Confirmar recebimento da compra #${id}?\n\n` +
            `O estoque dos produtos desta compra será aumentado ` +
            `e a compra passará para RECEBIDA.\n\n` +
            `Essa operação não poderá ser repetida.`
            );

    if (!confirmar) {
        return;
    }

    comprasRecebimentoEmAndamento.add(id);

    try {
        const {
            data,
            error
        } = await _supabase.rpc(
                'registrar_entrada_compra',
                {
                    p_compra_id: id
                }
        );

        if (error) {
            console.error(
                    'Erro ao receber compra:',
                    error
                    );

            const mensagem =
                    error.message || '';

            if (
                    mensagem.includes(
                            'não está ABERTA'
                            )
                    ) {
                alert(
                        '⚠️ Esta compra já foi recebida, cancelada ou não está disponível para recebimento.'
                        );
            } else if (
                    mensagem.includes(
                            'não possui itens'
                            )
                    ) {
                alert(
                        '⚠️ Esta compra não possui itens para entrada.'
                        );
            } else {
                alert(
                        '❌ Não foi possível receber a compra:\n\n' +
                        mensagem
                        );
            }

            return;
        }

        if (!data?.sucesso) {
            throw new Error(
                    'O banco não confirmou o recebimento da compra.'
                    );
        }

        console.log(
                '✅ Entrada de mercadoria realizada:',
                data
                );

        alert(
                `✅ Compra #${id} recebida com sucesso!\n\n` +
                `Itens processados: ${data.itens_processados}\n` +
                `Quantidade total: ${data.quantidade_total}\n\n` +
                `📦 Estoque atualizado\n` +
                `📜 Histórico registrado\n` +
                `🟢 Compra marcada como RECEBIDA`
                );

        await carregarComprasAbertasUI();

    } catch (err) {
        console.error(
                'Exceção ao receber compra:',
                err
                );

        alert(
                '❌ Erro ao receber mercadoria:\n\n' +
                (err.message || err)
                );

    } finally {
        comprasRecebimentoEmAndamento.delete(id);
    }
}

async function carregarProdutosCompras() {
    const select = document.getElementById('compra-produto');

    if (!select) {
        return;
    }

    select.innerHTML = `
        <option value="">Carregando produtos...</option>
    `;

    const {data, error} = await _supabase
            .from('produtos')
            .select(`
            id,
            nome,
            preco_custo,
            ativo
        `)
            .eq('ativo', true)
            .order('nome');

    if (error) {
        console.error(
                'Erro ao carregar produtos para compra:',
                error
                );

        select.innerHTML = `
            <option value="">Erro ao carregar produtos</option>
        `;

        return;
    }

    select.innerHTML = `
        <option value="">Selecione o produto</option>
    `;

    (data || []).forEach(produto => {
        select.innerHTML += `
            <option
                value="${produto.id}"
                data-custo="${produto.preco_custo || 0}"
            >
                ${produto.nome}
            </option>
        `;
    });

    select.onchange = function () {
        const optionSelecionada =
                this.options[this.selectedIndex];

        const custo =
                optionSelecionada?.dataset?.custo || '0';

        const campoCusto =
                document.getElementById('compra-custo');

        if (campoCusto) {
            campoCusto.value =
                    Number(custo).toFixed(2);
        }
    };
}

function adicionarItemCompraUI() {
    const produtoSelect =
            document.getElementById('compra-produto');

    const quantidadeInput =
            document.getElementById('compra-quantidade');

    const custoInput =
            document.getElementById('compra-custo');

    if (!produtoSelect || !quantidadeInput || !custoInput) {
        return;
    }

    const produtoId =
            Number(produtoSelect.value);

    const quantidade =
            parseInt(quantidadeInput.value, 10);

    const custoUnitario =
            parseFloat(custoInput.value);

    if (!produtoId) {
        alert('Selecione um produto.');
        return;
    }

    if (
            !Number.isInteger(quantidade) ||
            quantidade <= 0
            ) {
        alert('Informe uma quantidade válida.');
        return;
    }

    if (
            !Number.isFinite(custoUnitario) ||
            custoUnitario < 0
            ) {
        alert('Informe um custo unitário válido.');
        return;
    }

    const optionSelecionada =
            produtoSelect.options[
                    produtoSelect.selectedIndex
            ];

    const produtoNome =
            optionSelecionada?.textContent?.trim() ||
            'Produto';

    const itemExistente =
            itensCompraRascunho.find(
                    item => item.produto_id === produtoId
            );

    if (itemExistente) {
        itemExistente.quantidade += quantidade;
        itemExistente.custo_unitario =
                custoUnitario;
    } else {
        itensCompraRascunho.push({
            produto_id: produtoId,
            produto_nome: produtoNome,
            quantidade,
            custo_unitario: custoUnitario
        });
    }

    renderizarItensCompraUI();
    recalcularCompraUI();

    produtoSelect.value = '';
    quantidadeInput.value = '1';
    custoInput.value = '0.00';
}

function removerItemCompraUI(index) {
    if (
            index < 0 ||
            index >= itensCompraRascunho.length
            ) {
        return;
    }

    itensCompraRascunho.splice(index, 1);

    renderizarItensCompraUI();
    recalcularCompraUI();
}

function renderizarItensCompraUI() {
    const tbody =
            document.getElementById('compra-itens-body');

    if (!tbody) {
        return;
    }

    if (itensCompraRascunho.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td
                    colspan="5"
                    style="text-align:center; color:#888;">
                    Nenhum item adicionado.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = '';

    itensCompraRascunho.forEach((item, index) => {
        const totalItem =
                item.quantidade *
                item.custo_unitario;

        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td>
                <strong>${item.produto_nome}</strong>
            </td>

            <td style="text-align:center;">
                ${item.quantidade}
            </td>

            <td style="text-align:right;">
                R$ ${item.custo_unitario
                .toFixed(2)
                .replace('.', ',')}
            </td>

            <td style="text-align:right;">
                <strong>
                    R$ ${totalItem
                .toFixed(2)
                .replace('.', ',')}
                </strong>
            </td>

            <td style="text-align:center;">
                <button
                    class="btn-qty"
                    onclick="removerItemCompraUI(${index})"
                    title="Remover item">
                    🗑️
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });
}

function recalcularCompraUI() {
    const subtotal = itensCompraRascunho.reduce(
            (total, item) =>
        total +
                (item.quantidade *
                        item.custo_unitario),
            0
            );

    const desconto =
            parseFloat(
                    document.getElementById(
                            'compra-desconto'
                            )?.value
                    ) || 0;

    const frete =
            parseFloat(
                    document.getElementById(
                            'compra-frete'
                            )?.value
                    ) || 0;

    const total =
            Math.max(
                    0,
                    subtotal - desconto + frete
                    );

    const campoSubtotal =
            document.getElementById(
                    'compra-subtotal'
                    );

    const campoTotal =
            document.getElementById(
                    'compra-total'
                    );

    if (campoSubtotal) {
        campoSubtotal.textContent =
                `R$ ${subtotal
                .toFixed(2)
                .replace('.', ',')}`;
    }

    if (campoTotal) {
        campoTotal.textContent =
                `R$ ${total
                .toFixed(2)
                .replace('.', ',')}`;
    }
}

function limparCompraUI() {
    itensCompraRascunho = [];

    const campos = [
        'compra-fornecedor',
        'compra-nota',
        'compra-data',
        'compra-observacao',
        'compra-produto',
        'compra-quantidade',
        'compra-custo',
        'compra-desconto',
        'compra-frete'
    ];

    campos.forEach(id => {
        const campo =
                document.getElementById(id);

        if (!campo) {
            return;
        }

        if (id === 'compra-quantidade') {
            campo.value = '1';
        } else if (
                id === 'compra-custo' ||
                id === 'compra-desconto' ||
                id === 'compra-frete'
                ) {
            campo.value = '0.00';
        } else if (id === 'compra-data') {
            campo.value =
                    new Date()
                    .toISOString()
                    .split('T')[0];
        } else {
            campo.value = '';
        }
    });

    renderizarItensCompraUI();
    recalcularCompraUI();
}

async function salvarCompraUI() {
    const btn =
            document.getElementById('btn-salvar-compra');

    if (!btn) {
        console.error(
                'Botão btn-salvar-compra não encontrado.'
                );
        return;
    }

    const fornecedorId =
            Number(
                    document.getElementById(
                            'compra-fornecedor'
                            )?.value
                    );

    const numeroNota =
            document.getElementById(
                    'compra-nota'
                    )?.value.trim() || null;

    const dataCompra =
            document.getElementById(
                    'compra-data'
                    )?.value;

    const observacao =
            document.getElementById(
                    'compra-observacao'
                    )?.value.trim() || null;

    const desconto =
            parseFloat(
                    document.getElementById(
                            'compra-desconto'
                            )?.value
                    ) || 0;

    const frete =
            parseFloat(
                    document.getElementById(
                            'compra-frete'
                            )?.value
                    ) || 0;

    // ========================================================
    // VALIDAÇÕES DA INTERFACE
    // ========================================================

    if (!fornecedorId) {
        alert('Selecione o fornecedor.');
        return;
    }

    if (!dataCompra) {
        alert('Informe a data da compra.');
        return;
    }

    if (itensCompraRascunho.length === 0) {
        alert(
                'Adicione pelo menos um produto à compra.'
                );
        return;
    }

    if (
            !Number.isFinite(desconto) ||
            desconto < 0
            ) {
        alert('Informe um desconto válido.');
        return;
    }

    if (
            !Number.isFinite(frete) ||
            frete < 0
            ) {
        alert('Informe um frete válido.');
        return;
    }

    // ========================================================
    // ENVIA SOMENTE OS DADOS NECESSÁRIOS
    // O BANCO RECALCULA OS TOTAIS.
    // ========================================================

    const itensRPC =
            itensCompraRascunho.map(item => ({
                    produto_id: Number(item.produto_id),
                    quantidade: Number(item.quantidade),
                    custo_unitario:
                            Number(item.custo_unitario)
                }));

    const textoOriginal =
            btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML =
            '⏳ Salvando...';

    try {
        const {
            data,
            error
        } = await _supabase.rpc(
                'criar_compra_com_itens',
                {
                    p_fornecedor_id: fornecedorId,
                    p_numero_nota: numeroNota,
                    p_data_compra: dataCompra,
                    p_desconto: desconto,
                    p_frete: frete,
                    p_observacao: observacao,
                    p_itens: itensRPC
                }
        );

        if (error) {
            console.error(
                    'Erro ao criar compra:',
                    error
                    );

            const mensagem =
                    error.message || '';

            if (
                    mensagem.includes(
                            'Fornecedor não encontrado'
                            )
                    ) {
                alert(
                        '⚠️ O fornecedor não foi encontrado ou está inativo.'
                        );
            } else if (
                    mensagem.includes(
                            'Produto'
                            ) &&
                    mensagem.includes(
                            'não encontrado'
                            )
                    ) {
                alert(
                        '⚠️ Um dos produtos não foi encontrado ou está inativo.'
                        );
            } else {
                alert(
                        '❌ Não foi possível salvar a compra:\n\n' +
                        mensagem
                        );
            }

            return;
        }

        if (!data?.sucesso) {
            throw new Error(
                    'O banco não confirmou a criação da compra.'
                    );
        }

        console.log(
                '✅ Compra criada:',
                data
                );

        alert(
                `✅ Compra #${data.compra_id} salva com sucesso!\n\n` +
                `Fornecedor: ${data.fornecedor_nome}\n` +
                `Itens: ${data.itens_processados}\n` +
                `Subtotal: R$ ${Number(data.subtotal).toFixed(2).replace('.', ',')}\n` +
                `Total: R$ ${Number(data.total).toFixed(2).replace('.', ',')}\n\n` +
                `Status: ABERTA`
                );

        // Limpa o rascunho após salvar.
        limparCompraUI();

        // Mostra novamente os dados carregados.
        await carregarInterfaceCompras();

    } catch (err) {
        console.error(
                'Exceção ao salvar compra:',
                err
                );

        alert(
                '❌ Erro ao salvar compra: ' +
                (err.message || err)
                );

    } finally {
        btn.disabled = false;
        btn.innerHTML =
                textoOriginal;
    }
}

// --- CARREGA PRODUTOS COM CUSTO E MARGEM ---
async function carregarProdutosGerenciador() {
    const tbody = document.getElementById('produtos-table-body');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Carregando produtos...</td></tr>';

    const {data: produtos, error} = await _supabase
            .from('produtos')
            .select('*')
            .order('nome');

    if (error) {
        alert('Erro ao carregar produtos: ' + error.message);
        return;
    }

    tbody.innerHTML = '';

    produtos.forEach(p => {
        const tr = document.createElement('tr');
        const img = p.imagem_url || 'https://via.placeholder.com/40';
        const custo = p.preco_custo || 0;
        const margem = p.margem_lucro || 0;
        const precoVenda = p.preco || 0;

        tr.innerHTML = `
            <td>
                <img src="${img}" class="product-row-img" alt="${p.nome}">
                <strong>${p.nome}</strong>
            </td>
            <td>
                <input type="number" step="0.10" min="0" value="${custo}" id="custo-${p.id}" class="input-table" style="width: 80px;" oninput="calcularPrecoPeloCusto(${p.id})">
            </td>
            <td>
                <input type="number" step="1" min="0" value="${margem}" id="margem-${p.id}" class="input-table" style="width: 70px;" oninput="calcularPrecoPeloCusto(${p.id})">
            </td>
            <td>
                <input type="number" step="0.50" min="0" value="${precoVenda}" id="preco-${p.id}" class="input-table" style="width: 80px;" oninput="calcularMargemPeloPreco(${p.id})">
            </td>
            <td>
                <input type="number" min="0" value="${p.estoque || 0}" id="estoque-${p.id}" class="input-table" style="width: 70px;" readonly title="Use os botões para movimentar o estoque.">
            </td>
            <td>
                <div class="qty-controls">
                    <button class="btn-qty" onclick="ajustarEstoqueInput(${p.id}, -5)">-5</button>
                    <button class="btn-qty" onclick="ajustarEstoqueInput(${p.id}, -1)">-1</button>
                    <button class="btn-qty" onclick="ajustarEstoqueInput(${p.id}, 1)">+1</button>
                    <button class="btn-qty" onclick="ajustarEstoqueInput(${p.id}, 5)">+5</button>
                </div>
            </td>
            <td>
                <select id="ativo-${p.id}" class="input-table" style="width: 90px;">
                    <option value="true" ${p.ativo ? 'selected' : ''}>Ativo</option>
                    <option value="false" ${!p.ativo ? 'selected' : ''}>Pausado</option>
                </select>
            </td>
            <td>
                <button class="btn-save-prod" id="btn-save-${p.id}" onclick="salvarProduto(${p.id})">💾 Salvar</button>
            </td>
        `;

        tbody.appendChild(tr);
    });

    aplicarPermissoes();
}

//
// ============================================================
// HISTÓRICO DE PRODUÇÕES
// ============================================================
function alternarHistoricoProducoes() {

    const container = document.getElementById(
            'historico-producoes-container'
            );

    if (!container) {
        console.error(
                '⛔ Histórico de produções não encontrado.'
                );
        return;
    }

    const aberto =
            container.style.display === 'block';

    if (aberto) {

        container.style.display = 'none';

        document.body.style.overflow = '';

        return;
    }

    container.style.display = 'block';

    document.body.style.overflow = 'hidden';

    carregarHistoricoProducoes();
}


async function carregarHistoricoProducoes() {

    const tbody =
            document.getElementById(
                    'historico-producoes-table-body'
                    );

    if (!tbody) {
        console.error(
                'Tabela do histórico de produções não encontrada.'
                );
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td
                colspan="8"
                style="text-align:center;"
            >
                Carregando produções...
            </td>
        </tr>
    `;


    const {
        data: producoes,
        error
    } = await _supabase
            .from('producoes')
            .select(`
            id,
            produto_id,
            quantidade_produzida,
            custo_total,
            custo_unitario,
            observacao,
            usuario_nome,
            criado_em,
            produtos (
                nome
            )
        `)
            .order(
                    'criado_em',
                    {
                        ascending: false
                    }
            );


    if (error) {

        console.error(
                'Erro ao carregar histórico de produções:',
                error
                );

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    style="
                        text-align:center;
                        color:#c62828;
                    "
                >
                    ❌ Erro ao carregar o histórico.
                </td>
            </tr>
        `;

        return;
    }


    if (!producoes || producoes.length === 0) {

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    style="text-align:center;"
                >
                    Nenhuma produção registrada.
                </td>
            </tr>
        `;

        return;
    }


    tbody.innerHTML = '';


    producoes.forEach(producao => {

        const tr =
                document.createElement('tr');


        const dataHora =
                producao.criado_em
                ? new Date(
                        producao.criado_em
                        ).toLocaleString('pt-BR')
                : '-';


        const nomeProduto =
                producao.produtos?.nome ||
                'Produto não encontrado';


        const quantidade =
                Number(
                        producao.quantidade_produzida || 0
                        );


        const custoTotal =
                Number(
                        producao.custo_total || 0
                        );


        const custoUnitario =
                Number(
                        producao.custo_unitario || 0
                        );


        tr.innerHTML = `
            <td>
                ${dataHora}
            </td>

            <td>
                <strong>
                    #${producao.id}
                </strong>
            </td>

            <td>
                ${nomeProduto}
            </td>

            <td style="text-align:center;">
                ${quantidade}
            </td>

            <td>
                R$
                ${custoTotal
                .toFixed(4)
                .replace('.', ',')}
            </td>

            <td>
                R$
                ${custoUnitario
                .toFixed(4)
                .replace('.', ',')}
            </td>

            <td>
                ${producao.usuario_nome || '-'}
            </td>

            <td>
                ${producao.observacao || '-'}
            </td>
        `;

        tbody.appendChild(tr);
    });
}

// ============================================================
// PRODUÇÃO - INTERFACE
// ============================================================
let producaoUI = {
    produtos: [],
    fichas: [],
    itens: [],
    unidades: [],
    estoques: [],
    insumos: []
};

// ------------------------------------------------------------
// ABRE O MODAL DE PRODUÇÃO
// ------------------------------------------------------------
async function abrirModalProducao() {

    const modal = document.getElementById('modal-producao');

    if (!modal) {
        console.error('Modal de produção não encontrado.');
        return;
    }

    modal.style.display = 'flex';

    const select = document.getElementById('producao-produto');

    if (!select) {
        return;
    }

    select.innerHTML =
            '<option value="">Carregando produtos...</option>';

    const {data: produtos, error} = await _supabase
            .from('produtos')
            .select(`
            id,
            nome,
            estoque,
            ativo
        `)
            .eq('ativo', true)
            .order('nome');

    if (error) {
        console.error(
                'Erro ao carregar produtos para produção:',
                error
                );

        select.innerHTML =
                '<option value="">Erro ao carregar produtos</option>';

        return;
    }

    producaoUI.produtos = produtos || [];

    select.innerHTML =
            '<option value="">Selecione o produto...</option>';

    producaoUI.produtos.forEach(produto => {

        const option = document.createElement('option');

        option.value = produto.id;

        option.textContent =
                `${produto.nome} — estoque: ${produto.estoque || 0}`;

        select.appendChild(option);
    });
}

function fecharModalProducao() {

    const modal =
            document.getElementById('modal-producao');

    if (modal) {
        modal.style.display = 'none';
    }
}

async function carregarDadosProducaoUI() {

    const select =
            document.getElementById('producao-produto');

    const info =
            document.getElementById('producao-info');

    const resumo =
            document.getElementById('producao-resumo');

    const produtoId =
            Number(select?.value || 0);

    if (!produtoId) {

        if (info) {
            info.style.display = 'none';
            info.innerHTML = '';
        }

        if (resumo) {
            resumo.style.display = 'none';
            resumo.innerHTML = '';
        }

        producaoUI.fichas = [];
        producaoUI.itens = [];

        return;
    }

    const {
        data: ficha,
        error: erroFicha
    } = await _supabase
            .from('fichas_tecnicas')
            .select(`
            id,
            produto_id,
            rendimento,
            unidade_rendimento_id,
            observacao,
            ativa
        `)
            .eq('produto_id', produtoId)
            .eq('ativa', true)
            .maybeSingle();

    if (erroFicha) {

        console.error(
                'Erro ao carregar ficha técnica:',
                erroFicha
                );

        alert(
                '❌ Erro ao carregar a Ficha Técnica.'
                );

        return;
    }

    if (!ficha) {

        if (info) {
            info.innerHTML = `
                <strong>⚠️ Este produto não possui Ficha Técnica ativa.</strong>
            `;

            info.style.display = 'block';
        }

        producaoUI.fichas = [];
        producaoUI.itens = [];

        if (resumo) {
            resumo.style.display = 'none';
        }

        return;
    }

    producaoUI.fichas = [ficha];

    const {
        data: itens,
        error: erroItens
    } = await _supabase
            .from('itens_ficha_tecnica')
            .select(`
            id,
            insumo_id,
            unidade_id,
            quantidade_bruta,
            perda_percentual
        `)
            .eq('ficha_tecnica_id', ficha.id)
            .order('id');

    if (erroItens) {

        console.error(
                'Erro ao carregar itens da ficha:',
                erroItens
                );

        alert(
                '❌ Erro ao carregar os itens da Ficha Técnica.'
                );

        return;
    }

    producaoUI.itens = itens || [];

    if (info) {

        info.innerHTML = `
            <strong>📋 Ficha Técnica encontrada</strong><br><br>

            Rendimento:
            <strong>${Number(ficha.rendimento)}</strong> unidade(s)<br>

            Insumos cadastrados:
            <strong>${producaoUI.itens.length}</strong>
        `;

        info.style.display = 'block';
    }

    if (resumo) {
        resumo.innerHTML = `
            ✅ Ficha Técnica carregada.
        `;

        resumo.style.display = 'block';
    }

    await carregarDetalhesInsumosProducaoUI();
}

async function carregarDetalhesInsumosProducaoUI() {

    const select =
            document.getElementById('producao-produto');

    const resumo =
            document.getElementById('producao-resumo');

    const produtoId =
            Number(select?.value || 0);

    if (!produtoId) {
        return;
    }

    const ficha =
            producaoUI.fichas.find(
                    f => f.produto_id === produtoId
            );

    if (!ficha || !producaoUI.itens.length) {
        return;
    }

    const insumoIds =
            [...new Set(
                        producaoUI.itens.map(
                                item => item.insumo_id
                        )
                        )];

    if (insumoIds.length === 0) {
        return;
    }

    const {
        data: insumos,
        error: erroInsumos
    } = await _supabase
            .from('insumos')
            .select(`
            id,
            nome,
            unidade_base_id,
            ativo
        `)
            .in('id', insumoIds);

    if (erroInsumos) {
        console.error(
                'Erro ao carregar insumos:',
                erroInsumos
                );

        alert(
                '❌ Erro ao carregar os insumos da produção.'
                );

        return;
    }

    producaoUI.insumos = insumos || [];

    const {
        data: estoques,
        error: erroEstoques
    } = await _supabase
            .from('estoque_insumos')
            .select(`
            insumo_id,
            quantidade_base,
            custo_medio_base
        `)
            .in('insumo_id', insumoIds);

    if (erroEstoques) {
        console.error(
                'Erro ao carregar estoque dos insumos:',
                erroEstoques
                );

        alert(
                '❌ Erro ao carregar o estoque dos insumos.'
                );

        return;
    }

    producaoUI.estoques = estoques || [];

    const unidadeIds =
            [
                ...new Set([
                    ...producaoUI.itens.map(
                            item => item.unidade_id
                    ),
                    ...producaoUI.insumos.map(
                            insumo => insumo.unidade_base_id
                    )
                ])
            ];

    const {
        data: unidades,
        error: erroUnidades
    } = await _supabase
            .from('unidades_medida')
            .select(`
            id,
            codigo,
            nome,
            fator_base
        `)
            .in('id', unidadeIds);

    if (erroUnidades) {
        console.error(
                'Erro ao carregar unidades:',
                erroUnidades
                );

        alert(
                '❌ Erro ao carregar as unidades de medida.'
                );

        return;
    }

    producaoUI.unidades = unidades || [];

    let html = `
        <strong>📦 Insumos da produção</strong>
        <br><br>
    `;

    producaoUI.itens.forEach(item => {

        const insumo =
                producaoUI.insumos.find(
                        i => i.id === item.insumo_id
                );

        const estoque =
                producaoUI.estoques.find(
                        e => e.insumo_id === item.insumo_id
                );

        const unidade =
                producaoUI.unidades.find(
                        u => u.id === item.unidade_id
                );

        if (!insumo) {
            return;
        }

        const unidadeBase =
                producaoUI.unidades.find(
                        u => u.id === insumo.unidade_base_id
                );

        html += `
            <div
                style="
                    border-bottom:1px solid #ddd;
                    padding:8px 0;
                "
            >
                <strong>${insumo.nome}</strong><br>

                Ficha:
                ${Number(item.quantidade_bruta)}
                ${unidade?.codigo || ''}<br>

                Perda:
                ${Number(item.perda_percentual || 0).toFixed(2)}%<br>

                Estoque:
                ${Number(estoque?.quantidade_base || 0).toFixed(3)}
                ${unidadeBase?.codigo || ''}<br>

                Custo:
                R$
                ${Number(
                estoque?.custo_medio_base || 0
                ).toFixed(6).replace('.', ',')}
                /
                ${unidadeBase?.codigo || ''}
            </div>
        `;
    });

    if (resumo) {
        resumo.innerHTML = html;
        resumo.style.display = 'block';
    }
}

function atualizarResumoProducaoUI() {

    const select = document.getElementById('producao-produto');
    const quantidadeInput = document.getElementById('producao-quantidade');
    const resumo = document.getElementById('producao-resumo');

    if (!select || !quantidadeInput || !resumo) {
        return;
    }

    const produtoId = Number(select.value || 0);
    const quantidade = Number(quantidadeInput.value || 0);

    if (!produtoId) {
        resumo.style.display = 'none';
        resumo.innerHTML = '';
        return;
    }

    if (!Number.isInteger(quantidade) || quantidade <= 0) {
        resumo.innerHTML =
                '<strong>⚠️ Informe uma quantidade válida.</strong>';

        resumo.style.display = 'block';
        return;
    }

    const produto = producaoUI.produtos.find(
            p => p.id === produtoId
    );

    const ficha = producaoUI.fichas.find(
            f => f.produto_id === produtoId
    );

    if (!produto || !ficha) {
        resumo.style.display = 'none';
        return;
    }

    const rendimento = Number(ficha.rendimento || 0);

    if (rendimento <= 0) {
        resumo.innerHTML =
                '<strong>⚠️ Rendimento da ficha inválido.</strong>';

        resumo.style.display = 'block';
        return;
    }

    if (
            !Array.isArray(producaoUI.itens) ||
            !Array.isArray(producaoUI.insumos) ||
            !Array.isArray(producaoUI.unidades) ||
            !Array.isArray(producaoUI.estoques)
            ) {
        resumo.innerHTML =
                '<strong>⚠️ Dados da produção ainda não carregados.</strong>';

        resumo.style.display = 'block';
        return;
    }

    const fatorProducao = quantidade / rendimento;

    let custoTotal = 0;
    let estoqueInsuficiente = false;
    let detalhesHTML = '';

    producaoUI.itens.forEach(function (item) {

        const insumo = producaoUI.insumos.find(
                function (i) {
                    return i.id === item.insumo_id;
                }
        );

        if (!insumo) {
            return;
        }

        const unidadeItem = producaoUI.unidades.find(
                function (u) {
                    return u.id === item.unidade_id;
                }
        );

        const unidadeBase = producaoUI.unidades.find(
                function (u) {
                    return u.id === insumo.unidade_base_id;
                }
        );

        const estoque = producaoUI.estoques.find(
                function (e) {
                    return e.insumo_id === item.insumo_id;
                }
        );

        if (!unidadeItem || !unidadeBase) {
            return;
        }

        const quantidadeBrutaBase =
                Number(item.quantidade_bruta || 0) *
                fatorProducao *
                Number(unidadeItem.fator_base || 0) /
                Number(unidadeBase.fator_base || 1);

        const perdaBase =
                quantidadeBrutaBase *
                Number(item.perda_percentual || 0) /
                100;

        const quantidadeLiquidaBase =
                quantidadeBrutaBase -
                perdaBase;

        const custoInsumo =
                quantidadeBrutaBase *
                Number(estoque?.custo_medio_base || 0);

        custoTotal += custoInsumo;

        const estoqueAtual =
                Number(estoque?.quantidade_base || 0);

        if (estoqueAtual < quantidadeBrutaBase) {
            estoqueInsuficiente = true;
        }

        detalhesHTML +=
                '<div style="border-bottom:1px solid #ddd;padding:7px 0;">' +
                '<div style="display:flex;justify-content:space-between;gap:10px;">' +
                '<strong>' +
                insumo.nome +
                '</strong>' +
                '<span>' +
                quantidadeBrutaBase
                .toFixed(3)
                .replace('.', ',') +
                ' ' +
                unidadeBase.codigo +
                '</span>' +
                '</div>' +
                '<div style="font-size:0.85rem;margin-top:3px;color:#555;">' +
                'Custo: R$ ' +
                custoInsumo
                .toFixed(4)
                .replace('.', ',') +
                ' | Perda: ' +
                perdaBase
                .toFixed(3)
                .replace('.', ',') +
                ' ' +
                unidadeBase.codigo +
                ' | Líquido: ' +
                quantidadeLiquidaBase
                .toFixed(3)
                .replace('.', ',') +
                ' ' +
                unidadeBase.codigo +
                '</div>' +
                '</div>';
    });

    const custoUnitario =
            custoTotal / quantidade;

    const estoqueAtualProduto =
            Number(produto.estoque || 0);

    const estoqueDepois =
            estoqueAtualProduto + quantidade;

    let statusEstoque;

    if (estoqueInsuficiente) {

        statusEstoque =
                '<div style="margin-top:12px;color:#c62828;font-weight:bold;">' +
                '⚠️ Estoque insuficiente para esta produção.' +
                '</div>';

    } else {

        statusEstoque =
                '<div style="margin-top:12px;color:#2e7d32;font-weight:bold;">' +
                '✅ Estoque suficiente para esta produção.' +
                '</div>';
    }

    resumo.innerHTML =
            '<strong>📊 Resumo da Produção</strong>' +
            '<div style="margin-top:10px;line-height:1.7;">' +
            'Quantidade: ' +
            '<strong>' +
            quantidade +
            '</strong><br>' +
            'Estoque atual: ' +
            '<strong>' +
            estoqueAtualProduto +
            '</strong><br>' +
            'Estoque após produção: ' +
            '<strong>' +
            estoqueDepois +
            '</strong><br>' +
            'Custo total estimado: ' +
            '<strong>' +
            'R$ ' +
            custoTotal
            .toFixed(4)
            .replace('.', ',') +
            '</strong><br>' +
            'Custo por unidade: ' +
            '<strong>' +
            'R$ ' +
            custoUnitario
            .toFixed(4)
            .replace('.', ',') +
            '</strong>' +
            '</div>' +
            '<hr style="border:0;border-top:1px solid #ddd;margin:12px 0;">' +
            '<strong>📦 Consumo previsto</strong>' +
            '<div style="margin-top:6px;">' +
            (
                    detalhesHTML ||
                    'Nenhum insumo cadastrado.'
                    ) +
            '</div>' +
            statusEstoque;

    resumo.style.display = 'block';
}

async function registrarProducaoUI() {

    const select =
            document.getElementById('producao-produto');

    const quantidadeInput =
            document.getElementById('producao-quantidade');

    const observacaoInput =
            document.getElementById('producao-observacao');

    if (!select || !quantidadeInput) {
        alert('❌ Elementos da produção não encontrados.');
        return;
    }

    const produtoId =
            Number(select.value || 0);

    const quantidade =
            Number(quantidadeInput.value || 0);

    const observacao =
            observacaoInput?.value.trim() || null;

    if (!produtoId) {
        alert('⚠️ Selecione o produto.');
        return;
    }

    if (
            !Number.isInteger(quantidade) ||
            quantidade <= 0
            ) {
        alert('⚠️ Informe uma quantidade válida.');
        return;
    }

    const produto =
            producaoUI.produtos.find(
                    p => p.id === produtoId
            );

    const ficha =
            producaoUI.fichas.find(
                    f => f.produto_id === produtoId
            );

    if (!produto || !ficha) {
        alert(
                '❌ Produto ou Ficha Técnica não encontrada.'
                );
        return;
    }

    const confirmar = confirm(
            'Confirmar produção?\n\n' +
            `Produto: ${produto.nome}\n` +
            `Quantidade: ${quantidade}\n` +
            `Estoque atual: ${Number(produto.estoque || 0)}\n` +
            `Estoque após produção: ${Number(produto.estoque || 0) + quantidade}\n\n` +
            'Os insumos serão consumidos automaticamente.'
            );

    if (!confirmar) {
        return;
    }

    const btn =
            document.querySelector(
                    '#modal-producao button[onclick="registrarProducaoUI()"]'
                    );

    const textoOriginal =
            btn?.innerHTML || '🏭 Produzir';

    try {

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Produzindo...';
        }

        const {
            data,
            error
        } = await _supabase.rpc(
                'registrar_producao',
                {
                    p_produto_id: produtoId,
                    p_quantidade_produzida: quantidade,
                    p_observacao: observacao
                }
        );

        if (error) {
            throw error;
        }

        alert(
                '✅ Produção registrada com sucesso!\n\n' +
                `Produção #${data}\n` +
                `Produto: ${produto.nome}\n` +
                `Quantidade: ${quantidade}`
                );

        fecharModalProducao();

        await carregarProdutosGerenciador();

    } catch (err) {

        console.error(
                'Erro ao registrar produção:',
                err
                );

        alert(
                '❌ Não foi possível registrar a produção:\n\n' +
                (err.message || err)
                );

    } finally {

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        }

    }
}









// Recalcula o Preço de Venda quando o Custo ou a Margem mudam
function calcularPrecoPeloCusto(id) {
    const inputCusto = document.getElementById(`custo-${id}`);
    const inputMargem = document.getElementById(`margem-${id}`);
    const inputVenda = document.getElementById(`preco-${id}`);

    const custo = parseFloat(inputCusto.value) || 0;
    const margem = parseFloat(inputMargem.value) || 0;

    inputVenda.value = (custo * (1 + margem / 100)).toFixed(2);

    // Marca que a origem da alteração foi custo/markup
    inputVenda.dataset.modoPreco = 'CUSTO_MARKUP';
}

// Recalcula a Margem (%) se você alterar o Preço de Venda diretamente
function calcularMargemPeloPreco(id) {
    const inputCusto = document.getElementById(`custo-${id}`);
    const inputVenda = document.getElementById(`preco-${id}`);
    const inputMargem = document.getElementById(`margem-${id}`);

    const custo = parseFloat(inputCusto.value) || 0;
    const venda = parseFloat(inputVenda.value) || 0;

    if (custo > 0) {
        const margemObtida = ((venda / custo) - 1) * 100;
        inputMargem.value = margemObtida.toFixed(2);
    }

    // Marca que a origem da alteração foi o preço
    inputVenda.dataset.modoPreco = 'PRECO';
}

// --- SALVA CUSTO, MARGEM, PREÇO E ESTOQUE ---
async function salvarProduto(id) {
    const cargo = String(
            window.usuarioAtual?.cargo || ''
            ).toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (
            !ehGerente &&
            permissoesAtuais.bloquearProdutos
            ) {
        alert(
                '⛔ Você não tem permissão para alterar produtos.'
                );
        return;
    }

    const btn = document.getElementById(`btn-save-${id}`);

    if (!btn) {
        console.error(
                `Botão de salvar do produto ${id} não encontrado.`
                );
        return;
    }

    const textoOriginal = btn.innerHTML;

    try {
        btn.disabled = true;
        btn.innerHTML = '⏳...';

        const inputCusto = document.getElementById(`custo-${id}`);
        const inputMargem = document.getElementById(`margem-${id}`);
        const inputPreco = document.getElementById(`preco-${id}`);
        const inputAtivo = document.getElementById(`ativo-${id}`);
        const custo = parseFloat(inputCusto.value);
        const margem = parseFloat(inputMargem.value);
        const preco = parseFloat(inputPreco.value);
        const ativo = inputAtivo.value === 'true';

        if (
                !Number.isFinite(custo) ||
                custo < 0 ||
                !Number.isFinite(margem) ||
                margem < 0 ||
                !Number.isFinite(preco) ||
                preco < 0
                ) {
            throw new Error(
                    'Verifique custo, margem e preço. Os valores não podem ser negativos.'
                    );
        }

        // =====================================================
        // 1. PREÇO / CUSTO / MARGEM
        //    Sempre passa pelo RPC seguro.
        // =====================================================

        const modoPreco =
                inputPreco.dataset.modoPreco || 'CUSTO_MARKUP';

        let resultadoPreco;

        if (modoPreco === 'PRECO') {

            const {data, error} = await _supabase.rpc(
                    'atualizar_preco_produto',
                    {
                        p_produto_id: Number(id),
                        p_modo: 'PRECO',
                        p_preco_custo: null,
                        p_margem_lucro: null,
                        p_preco: preco
                    }
            );

            if (error) {
                throw new Error(
                        'Erro ao atualizar preço: ' + error.message
                        );
            }

            resultadoPreco = data;

        } else {

            const {data, error} = await _supabase.rpc(
                    'atualizar_preco_produto',
                    {
                        p_produto_id: Number(id),
                        p_modo: 'CUSTO_MARKUP',
                        p_preco_custo: custo,
                        p_margem_lucro: margem,
                        p_preco: null
                    }
            );

            if (error) {
                throw new Error(
                        'Erro ao atualizar custo/margem: ' +
                        error.message
                        );
            }

            resultadoPreco = data;
        }

        // =====================================================
        // 2. ESTOQUE + ATIVO
        // =====================================================

        const {error: erroProduto} = await _supabase
                .from('produtos')
                .update({
                    ativo: ativo
                })
                .eq('id', id);

        if (erroProduto) {
            throw new Error(
                    'Erro ao atualizar status: ' + erroProduto.message
                    );
        }

        // =====================================================
        // 3. SINCRONIZA A TELA COM O RESULTADO DO BANCO
        // =====================================================

        if (resultadoPreco) {
            inputCusto.value =
                    Number(resultadoPreco.preco_custo).toFixed(2);

            inputMargem.value =
                    Number(resultadoPreco.margem_lucro).toFixed(2);

            inputPreco.value =
                    Number(resultadoPreco.preco).toFixed(2);
        }

        // Depois de salvar, a próxima alteração começa limpa.
        delete inputPreco.dataset.modoPreco;

        alert('✅ Produto atualizado com sucesso!');

    } catch (err) {
        console.error(err);
        alert('❌ Falha ao atualizar: ' + err.message);

    } finally {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
}

// Ajusta o valor do campo de estoque na tela antes de salvar
const movimentacoesEstoqueEmAndamento = new Set();

async function ajustarEstoqueInput(produtoId, delta) {
    const cargo = String(
            window.usuarioAtual?.cargo || ''
            ).toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (
            !ehGerente &&
            permissoesAtuais.bloquearProdutos
            ) {
        alert('⛔ Você não tem permissão para alterar o estoque.');
        return;
    }

    if (!Number.isInteger(delta) || delta === 0) {
        console.error('Delta de estoque inválido:', delta);
        return;
    }

    if (movimentacoesEstoqueEmAndamento.has(produtoId)) {
        return;
    }

    const inputEstoque = document.getElementById(
            `estoque-${produtoId}`
            );

    if (!inputEstoque) {
        console.error(
                `Campo de estoque do produto ${produtoId} não encontrado.`
                );
        return;
    }

    const tipo = delta > 0
            ? 'ENTRADA'
            : 'AJUSTE';

    const motivo = delta > 0
            ? `Entrada manual pelo PDV (+${delta})`
            : `Ajuste manual pelo PDV (${delta})`;

    movimentacoesEstoqueEmAndamento.add(produtoId);

    try {
        const {data, error} = await _supabase.rpc(
                'movimentar_estoque_manual',
                {
                    p_produto_id: Number(produtoId),
                    p_tipo: tipo,
                    p_quantidade: delta,
                    p_motivo: motivo
                }
        );

        if (error) {
            throw new Error(error.message);
        }

        if (!data) {
            throw new Error(
                    'O banco não retornou os dados da movimentação.'
                    );
        }

        inputEstoque.value = Number(
                data.estoque_posterior
                );

        console.log(
                '✅ Movimentação de estoque:',
                data
                );

    } catch (err) {
        console.error(
                'Erro na movimentação de estoque:',
                err
                );

        alert(
                '❌ Não foi possível movimentar o estoque: ' +
                err.message
                );

    } finally {
        movimentacoesEstoqueEmAndamento.delete(produtoId);
    }
}

// --- FUNÇÃO PARA GERAR E IMPRIMIR O CUPOM TÉRMICO ---
function imprimirPedido(pedidoId) {
    // Garante que o body não está no modo de impressão da Placa PIX
    document.body.classList.remove('imprimindo-pix');

    if (!listaPedidosGlobal || listaPedidosGlobal.length === 0) {
        alert('Aguarde o carregamento dos pedidos e tente novamente.');
        return;
    }

    const p = listaPedidosGlobal.find(item => item.id === pedidoId);
    if (!p) {
        alert('Pedido não encontrado para impressão.');
        return;
    }

    const printArea = document.getElementById('print-area');
    if (!printArea) {
        alert('Elemento #print-area não encontrado no HTML.');
        return;
    }

    const dataHora = p.criado_em ? new Date(p.criado_em).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');

    let itensHTML = '';
    if (p.itens_pedido && p.itens_pedido.length > 0) {
        p.itens_pedido.forEach(item => {
            const nomeProd = item.produtos ? item.produtos.nome : 'Item';
            const subtotal = (item.subtotal || (item.preco_unitario * item.quantidade) || 0).toFixed(2).replace('.', ',');
            itensHTML += `
                <tr>
                    <td style="text-align: left; color: #000;">${item.quantidade}x ${nomeProd}</td>
                    <td style="text-align: right; color: #000;">R$ ${subtotal}</td>
                </tr>
            `;
        });
    }

    const valorProdutos = (p.valor_produtos || p.valor_total || 0).toFixed(2).replace('.', ',');
    const taxaEntrega = (p.taxa_entrega || 0).toFixed(2).replace('.', ',');
    const valorTotal = (p.valor_total || 0).toFixed(2).replace('.', ',');

    printArea.innerHTML = `
        <div class="receipt" style="color: #000; background: #fff; padding: 10px; font-family: monospace;">
            <h2 style="text-align: center; margin: 0; color: #000;">🍰 Doces e Travessuras</h2>
            <p style="text-align: center; font-size: 10px; margin: 2px 0 8px 0; color: #000;">PEDIDO DE PRODUÇÃO / ENTREGA</p>
            <hr style="border-top: 1px dashed #000;">
            <p style="margin: 4px 0; color: #000;"><strong>PEDIDO:</strong> #${p.id} (${p.tipo || 'PDV'})</p>
            <p style="margin: 4px 0; color: #000;"><strong>DATA:</strong> ${dataHora}</p>
            <p style="margin: 4px 0; color: #000;"><strong>CLIENTE:</strong> ${p.clientes?.nome || 'Cliente'}</p>
            <p style="margin: 4px 0; color: #000;"><strong>📞 TELEFONE:</strong> ${formatarTelefoneExibicao(p.telefone_cliente || p.clientes?.telefone)}</p>
            <p style="margin: 4px 0; color: #000;"><strong>ENDEREÇO:</strong><br> ${p.endereco_snapshot || 'Balcão'}</p>
            <hr style="border-top: 1px dashed #000;">
            <table style="width: 100%; border-collapse: collapse; color: #000;">
                <thead>
                    <tr>
                        <th style="text-align: left; color: #000;">ITEM</th>
                        <th style="text-align: right; color: #000;">TOTAL</th>
                    </tr>
                </thead>
                <tbody>
                    ${itensHTML}
                </tbody>
            </table>
            <hr style="border-top: 1px dashed #000;">
            <p style="margin: 2px 0; color: #000;">Subtotal: R$ ${valorProdutos}</p>
            <p style="margin: 2px 0; color: #000;">Taxa Entrega: R$ ${taxaEntrega}</p>
            <p style="font-size: 13px; margin: 6px 0; color: #000;"><strong>TOTAL: R$ ${valorTotal}</strong></p>
            <hr style="border-top: 1px dashed #000;">
            <p style="margin: 4px 0; color: #000;"><strong>PAGAMENTO:</strong> ${p.forma_pagamento || 'N/I'} ${p.troco_para ? `(Troco p/ R$ ${p.troco_para})` : ''}</p>
            ${p.observacao ? `<p style="margin-top:4px; color: #000;"><strong>OBS:</strong> ${p.observacao}</p>` : ''}
            <hr style="border-top: 1px dashed #000;">
            <p style="text-align: center; font-size: 10px; margin-top: 8px; color: #000;">--- Obrigado e bom apetite! ---</p>
        </div>
    `;

    // Aguarda o DOM inserir o conteúdo antes de chamar a janela de impressão
    setTimeout(() => {
        window.print();
    }, 150);
}

// 1. Função para carregar o histórico gerando Checkboxes nas linhas
async function carregarHistoricoVendas() {
    const tbody = document.getElementById('historico-table-body');
    const filtro = document.getElementById('filtro-periodo').value;

    // Reseta o checkbox "Selecionar Todos"
    const masterCheckbox = document.getElementById('select-all-pedidos');
    if (masterCheckbox)
        masterCheckbox.checked = false;

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Carregando histórico...</td></tr>';

    let query = _supabase
            .from('pedidos')
            .select(`
            *,
            itens_pedido (
                *,
                produtos (nome)
            )
        `)
            .order('criado_em', {ascending: false});

    // Filtros de data
    const agora = new Date();
    if (filtro === 'hoje') {
        const inicioDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
        query = query.gte('criado_em', inicioDia);
    } else if (filtro === '7dias') {
        const seteDiasAtras = new Date(agora.setDate(agora.getDate() - 7)).toISOString();
        query = query.gte('criado_em', seteDiasAtras);
    } else if (filtro === 'mes') {
        const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
        query = query.gte('criado_em', inicioMes);
    }

    const {data: pedidos, error} = await query;

    if (error) {
        alert('Erro ao carregar histórico: ' + error.message);
        return;
    }

    listaPedidosGlobal = pedidos;

    // Métricas
    const concluidos = pedidos.filter(p => p.status === 'CONCLUIDO');
    const cancelados = pedidos.filter(p => p.status === 'CANCELADO').length;
    // Cálculo de Balcão vs Delivery
    const qtdBalcao = concluidos.filter(p =>
        (p.tipo || '').toUpperCase() === 'BALCAO' ||
                (p.endereco_snapshot || '').toLowerCase().includes('balcão')
    ).length;

    const totalFaturado = concluidos.reduce((acc, p) => acc + (p.valor_total || 0), 0);
    const qtdConcluidos = concluidos.length;
    const ticketMedio = qtdConcluidos > 0 ? totalFaturado / qtdConcluidos : 0;
    const qtdDelivery = qtdConcluidos - qtdBalcao;

    // Soma total de produtos individuais vendidos
    const totalItensVendidos = concluidos.reduce((acc, p) => {
        const totalDoPedido = (p.itens_pedido || []).reduce((subAcc, item) => subAcc + (item.quantidade || 0), 0);
        return acc + totalDoPedido;
    }, 0);

    document.getElementById('metric-faturamento').textContent = `R$ ${totalFaturado.toFixed(2).replace('.', ',')}`;
    document.getElementById('metric-qtd-pedidos').textContent = qtdConcluidos;
    document.getElementById('metric-ticket-medio').textContent = `R$ ${ticketMedio.toFixed(2).replace('.', ',')}`;
    document.getElementById('metric-itens-vendidos').textContent = `${totalItensVendidos} un`;
    document.getElementById('metric-cancelados').textContent = cancelados;
    document.getElementById('metric-canais').textContent = `${qtdBalcao} Balcão / ${qtdDelivery} Deliv.`;

    tbody.innerHTML = '';

    if (pedidos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Nenhum pedido encontrado neste período.</td></tr>';
        return;
    }

    pedidos.forEach(p => {
        const tr = document.createElement('tr');
        const dataHora = new Date(p.criado_em).toLocaleString('pt-BR');
        const badgeClasse = p.status === 'CONCLUIDO' ? 'status-concluido' : (p.status === 'CANCELADO' ? 'status-cancelado' : 'status-concluido');

        tr.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="chk-pedido" value="${p.id}" style="cursor: pointer; transform: scale(1.2);">
            </td>
            <td><strong>#${p.id}</strong></td>
            <td>${dataHora}</td>
            <td>${p.tipo || 'PDV'} / ${p.forma_pagamento}</td>
            <td>${p.endereco_snapshot || 'Balcão'}</td>
            <td><strong>R$ ${(p.valor_total || 0).toFixed(2).replace('.', ',')}</strong></td>
            <td><span class="status-badge-table ${badgeClasse}">${p.status}</span></td>
        `;

        tbody.appendChild(tr);
    });
}

// 2. Marcar/Desmarcar todos os pedidos
window.toggleSelecionarTodos = function (master) {
    const checkboxes = document.querySelectorAll('.chk-pedido');
    checkboxes.forEach(cb => {
        cb.checked = master.checked;
    });
};

// 3. Reimprimir todos os marcados convertendo o ID para número
// Função de pausa para aguardar o redesenho do DOM do navegador
const aguardar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

window.reimprimirPedidoSelecionado = async function () {
    const selecionados = Array.from(document.querySelectorAll('input.chk-pedido:checked'));

    if (selecionados.length === 0) {
        alert('⚠️ Selecione pelo menos um pedido na tabela para reimprimir!');
        return;
    }

    if (typeof window.imprimirPedido !== 'function') {
        alert('⚠️ Função de impressão (imprimirPedido) não encontrada.');
        return;
    }

    // Opcional: desabilita o botão durante o processo para evitar múltiplos cliques
    const btnReimprimir = document.querySelector('button[onclick="reimprimirPedidoSelecionado()"]');
    if (btnReimprimir)
        btnReimprimir.disabled = true;

    for (let i = 0; i < selecionados.length; i++) {
        const chk = selecionados[i];
        const rawValue = chk.value;
        const pedidoId = !isNaN(rawValue) ? Number(rawValue) : rawValue;

        // 1. Chama a função de impressão do pedido atual
        await window.imprimirPedido(pedidoId);

        // 2. Se houver mais de um pedido na fila, aguarda 800ms para o navegador
        // concluir o render do HTML e liberar a próxima caixa de impressão
        if (i < selecionados.length - 1) {
            await aguardar(800);
        }
    }

    if (btnReimprimir)
        btnReimprimir.disabled = false;
};

async function carregarConfiguracoesPDV() {

    const {data: cfg, error} = await _supabase
            .from('configuracoes')
            .select(`
            nome_loja,
            loja_aberta,
            valor_minimo_pedido,
            whatsapp_notificacoes_ativas
        `)
            .eq('id', 1)
            .single();

    if (!error && cfg) {

        const campoLojaAberta =
                document.getElementById('cfg-loja-aberta');

        const campoValorMinimo =
                document.getElementById('cfg-valor-minimo');

        const campoWhatsapp =
                document.getElementById('cfg-whatsapp-notificacoes');

        if (campoLojaAberta) {
            campoLojaAberta.value =
                    cfg.loja_aberta ? 'true' : 'false';
        }

        if (campoValorMinimo) {
            campoValorMinimo.value =
                    cfg.valor_minimo_pedido || 0;
        }

        if (campoWhatsapp) {
            campoWhatsapp.checked =
                    cfg.whatsapp_notificacoes_ativas === true;
        }
    }

    await carregarStatusCaixaEOperador();
    await carregarPermissoes();
}

async function salvarConfiguracoes() {

    const btn =
            document.getElementById('btn-salvar-cfg');

    if (!btn) {
        console.error(
                'Botão #btn-salvar-cfg não encontrado.'
                );
        return;
    }

    const campoLojaAberta =
            document.getElementById('cfg-loja-aberta');

    const campoValorMinimo =
            document.getElementById('cfg-valor-minimo');

    const campoWhatsapp =
            document.getElementById('cfg-whatsapp-notificacoes');

    const whatsappNotificacoesAtivas =
            campoWhatsapp?.checked === true;

    if (!campoLojaAberta || !campoValorMinimo) {
        alert(
                '❌ Não foi possível localizar os campos de configuração.'
                );
        return;
    }

    const lojaAberta =
            campoLojaAberta.value === 'true';

    const valorMinimo =
            parseFloat(campoValorMinimo.value) || 0;

    if (valorMinimo < 0) {
        alert(
                '⚠️ O valor mínimo não pode ser negativo.'
                );
        campoValorMinimo.focus();
        return;
    }

    const textoOriginal = btn.textContent;

    btn.textContent = '⏳ Salvando...';
    btn.disabled = true;

    try {

        const {error} = await _supabase
                .from('configuracoes')
                .update({
                    loja_aberta: lojaAberta,
                    valor_minimo_pedido: valorMinimo,
                    whatsapp_notificacoes_ativas: whatsappNotificacoesAtivas
                })
                .eq('id', 1);

        if (error) {
            throw error;
        }

        alert(
                '✅ Configurações salvas com sucesso!'
                );

    } catch (err) {

        console.error(
                'Erro ao salvar configurações:',
                err
                );

        alert(
                '❌ Erro ao salvar configurações: ' +
                (err.message || err)
                );

    } finally {

        btn.disabled = false;
        btn.textContent = textoOriginal;
    }
}

window.alternarSubAba = function (idSubAba, elementoBotao) {
    document.querySelectorAll('.sub-aba-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.btn-sub-tab').forEach(b => {
        b.style.background = '#1e1e24';
        b.style.color = '#aaa';
    });

    document.getElementById(idSubAba).style.display = 'block';
    elementoBotao.style.background = '#2a2a35';
    elementoBotao.style.color = '#fff';

    // Se abrir a sub-aba de Permissões/Equipe, recarrega os usuários na tabela
    if (idSubAba === 'sub-permissoes') {
        carregarListaUsuarios();
    }
};

// 1. Carrega o Operador logado e consulta o status do Caixa no Supabase
async function carregarStatusCaixaEOperador() {
    // Busca o usuário salvo localmente ao fazer login (ou usa um padrão)
    const usuarioLogado = JSON.parse(localStorage.getItem('usuario_pdv') || 'null');

    const elemOperador = document.getElementById('caixa-operador-nome');
    if (elemOperador) {
        elemOperador.innerText = usuarioLogado ? usuarioLogado.nome : 'Nenhum Operador Selecionado';
    }

    try {
        // Busca se existe algum caixa atualmente ABERTO
        const {data: caixaAberto, error} = await _supabase
                .from('caixa_diario')
                .select('*')
                .eq('status', 'ABERTO')
                .order('data_abertura', {ascending: false})
                .limit(1)
                .maybeSingle();

        const elemStatus = document.getElementById('caixa-status-texto');
        const elemTroco = document.getElementById('caixa-fundo-troco');
        const btnAbrir = document.getElementById('btn-abrir-caixa');
        const btnFechar = document.getElementById('btn-fechar-caixa');

        if (caixaAberto) {
            if (elemStatus) {
                elemStatus.innerText = '🟢 ABERTO';
                elemStatus.style.color = '#2ed573';
            }
            if (elemTroco) {
                elemTroco.innerText = `R$ ${parseFloat(caixaAberto.saldo_inicial || 0).toFixed(2).replace('.', ',')}`;
            }
            if (btnAbrir)
                btnAbrir.disabled = true;
            if (btnFechar)
                btnFechar.disabled = false;
        } else {
            if (elemStatus) {
                elemStatus.innerText = '🔴 FECHADO';
                elemStatus.style.color = '#ff4757';
            }
            if (elemTroco)
                elemTroco.innerText = 'R$ 0,00';
            if (btnAbrir)
                btnAbrir.disabled = false;
            if (btnFechar)
                btnFechar.disabled = true;
        }
    } catch (err) {
        console.error('Erro ao verificar status do caixa:', err);
    }
}

// ============================================================
// PERMISSÕES DO PDV
// ============================================================
// Guarda as permissões atualmente carregadas do banco.
// Isto é apenas estado da interface.
let permissoesAtuais = {
    bloquearFinancas: false,
    exigirGerenteCancelar: false,
    bloquearProdutos: false
};

async function salvarPermissoes() {
    const usuario = window.usuarioAtual;

    if (
            !usuario ||
            !['GERENTE', 'ADMIN'].includes(
            String(usuario.cargo || '').toUpperCase()
            )
            ) {
        alert(
                '⚠️ Apenas Gerente/Admin pode alterar as permissões.'
                );

        await carregarPermissoes();
        return;
    }

    const btn =
            document.getElementById('btn-salvar-permissoes');

    if (!btn) {
        console.error(
                'Botão #btn-salvar-permissoes não encontrado.'
                );
        return;
    }

    const textoOriginal = btn.innerHTML;

    const bloquearFinancas =
            document.getElementById(
                    'perm-ver-financas'
                    )?.checked === true;

    const exigirGerenteCancelar =
            document.getElementById(
                    'perm-cancelar-pedido'
                    )?.checked === true;

    const bloquearProdutos =
            document.getElementById(
                    'perm-alterar-produtos'
                    )?.checked === true;

    // Feedback IMEDIATO
    btn.disabled = true;
    btn.innerHTML = '⏳ Salvando...';

    try {

        const {error} = await _supabase
                .from('configuracoes')
                .update({
                    bloquear_financas: bloquearFinancas,
                    exigir_gerente_cancelar:
                            exigirGerenteCancelar,
                    bloquear_produtos: bloquearProdutos
                })
                .eq('id', 1);

        if (error) {
            throw new Error(error.message);
        }

        permissoesAtuais = {
            bloquearFinancas,
            exigirGerenteCancelar,
            bloquearProdutos
        };

        aplicarPermissoes();

        btn.innerHTML = '✅ Salvo!';

        await new Promise(
                resolve => setTimeout(resolve, 700)
        );

        alert(
                '✅ Permissões salvas com sucesso!'
                );

    } catch (err) {

        console.error(
                'Erro ao salvar permissões:',
                err
                );

        alert(
                '❌ Não foi possível salvar as permissões.'
                );

        await carregarPermissoes();

    } finally {

        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
}

async function carregarPermissoes() {
    const {data: cfg, error} = await _supabase
            .from('configuracoes')
            .select(`
            bloquear_financas,
            exigir_gerente_cancelar,
            bloquear_produtos
        `)
            .eq('id', 1)
            .single();

    if (error) {
        console.error('Erro ao carregar permissões:', error);
        return;
    }

    permissoesAtuais = {
        bloquearFinancas: cfg?.bloquear_financas === true,
        exigirGerenteCancelar: cfg?.exigir_gerente_cancelar === true,
        bloquearProdutos: cfg?.bloquear_produtos === true
    };

    const chkFinancas = document.getElementById('perm-ver-financas');
    const chkCancelar = document.getElementById('perm-cancelar-pedido');
    const chkProdutos = document.getElementById('perm-alterar-produtos');

    if (chkFinancas) {
        chkFinancas.checked = permissoesAtuais.bloquearFinancas;
    }

    if (chkCancelar) {
        chkCancelar.checked = permissoesAtuais.exigirGerenteCancelar;
    }

    if (chkProdutos) {
        chkProdutos.checked = permissoesAtuais.bloquearProdutos;
    }

    aplicarPermissoes();
}

function aplicarPermissoes() {
    const usuario = window.usuarioAtual;

    if (!usuario) {
        return;
    }

    const cargo = String(usuario.cargo || '').toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    const bloquearProdutosParaOperador =
            !ehGerente &&
            permissoesAtuais.bloquearProdutos === true;

    // ========================================================
    // FINANÇAS
    // ========================================================
    const btnMenuFinancas =
            document.getElementById('btn-tab-financas');

    if (btnMenuFinancas) {
        btnMenuFinancas.style.display =
                (!ehGerente && permissoesAtuais.bloquearFinancas)
                ? 'none'
                : 'block';
    }

    const btnMenuCompras =
            document.getElementById('btn-tab-compras');

    if (btnMenuCompras) {
        btnMenuCompras.style.display =
                ehGerente ? 'block' : 'none';
    }

    // ========================================================
// FICHA TÉCNICA
// GERENTE/ADMIN: pode acessar
// OPERADOR: não exibe a aba
// ========================================================

    const btnMenuFichaTecnica =
            document.getElementById('btn-tab-ficha-tecnica');

    if (btnMenuFichaTecnica) {
        btnMenuFichaTecnica.style.display =
                ehGerente ? '' : 'none';
    }

    // ========================================================
    // CONFIGURAÇÕES DA LOJA VIRTUAL
    // GERENTE/ADMIN: pode editar
    // OPERADOR: somente visualização
    // ========================================================
    const camposConfiguracaoLoja = [
        document.getElementById('cfg-loja-aberta'),
        document.getElementById('cfg-valor-minimo'),
        document.getElementById('cfg-whatsapp-notificacoes')
    ];

    camposConfiguracaoLoja.forEach(campo => {
        if (campo) {
            campo.disabled = !ehGerente;

            campo.title = !ehGerente
                    ? 'Somente Gerente/Admin pode alterar a loja.'
                    : '';
        }
    });

    const btnSalvarConfiguracoes =
            document.getElementById('btn-salvar-cfg');

    if (btnSalvarConfiguracoes) {
        btnSalvarConfiguracoes.style.display =
                ehGerente ? '' : 'none';
    }

    // ========================================================
    // CHECKBOXES DE PERMISSÕES
    // ========================================================
    const checks = [
        document.getElementById('perm-ver-financas'),
        document.getElementById('perm-cancelar-pedido'),
        document.getElementById('perm-alterar-produtos')
    ];

    checks.forEach(check => {
        if (check) {
            check.disabled = !ehGerente;
        }
    });

    // ========================================================
    // NOVO COLABORADOR
    // ========================================================
    const botoesNovoUsuario =
            document.querySelectorAll(
                    '[onclick="abrirModalNovoUsuario()"]'
                    );

    botoesNovoUsuario.forEach(btn => {
        btn.style.display = ehGerente ? '' : 'none';
    });

    // ========================================================
    // PRODUTOS
    // OPERADOR PODE VISUALIZAR.
    // SE BLOQUEAR PRODUTOS ESTIVER ATIVO,
    // NÃO PODE ALTERAR CUSTO, MARGEM, PREÇO,
    // ESTOQUE, STATUS OU SALVAR.
    // ========================================================

    document.querySelectorAll(
            '#produtos-table-body input[id^="custo-"],' +
            '#produtos-table-body input[id^="margem-"],' +
            '#produtos-table-body input[id^="preco-"],' +
            '#produtos-table-body input[id^="estoque-"]'
            ).forEach(input => {
        input.disabled = bloquearProdutosParaOperador;
    });

    document.querySelectorAll(
            '#produtos-table-body select[id^="ativo-"]'
            ).forEach(select => {
        select.disabled = bloquearProdutosParaOperador;
    });

    document.querySelectorAll(
            '#produtos-table-body .btn-qty'
            ).forEach(btn => {
        btn.disabled = bloquearProdutosParaOperador;

        btn.title = bloquearProdutosParaOperador
                ? 'Você não tem permissão para alterar o estoque.'
                : '';
    });

    document.querySelectorAll(
            '#produtos-table-body .btn-save-prod'
            ).forEach(btn => {
        btn.disabled = bloquearProdutosParaOperador;

        btn.title = bloquearProdutosParaOperador
                ? 'Você não tem permissão para alterar produtos.'
                : '';
    });

    // ========================================================
    // NOVO PRODUTO
    // ========================================================
    const botoesNovoProduto =
            document.querySelectorAll(
                    '[onclick="abrirModalNovoProduto()"]'
                    );

    botoesNovoProduto.forEach(btn => {
        btn.style.display =
                bloquearProdutosParaOperador
                ? 'none'
                : '';
    });

    const botoesStatusUsuario =
            document.querySelectorAll(
                    '#lista-usuarios-tabela button[onclick^="alternarStatusUsuario"]'
                    );

    botoesStatusUsuario.forEach(btn => {
        btn.style.display = ehGerente ? '' : 'none';
    });
}

// --- MODAL NOVO PRODUTO ---
async function abrirModalNovoProduto() {
    const cargo = String(
            window.usuarioAtual?.cargo || ''
            ).toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (
            !ehGerente &&
            permissoesAtuais.bloquearProdutos
            ) {
        alert(
                '⛔ Você não tem permissão para cadastrar produtos.'
                );

        return;
    }

    // Código original continua abaixo
    document.getElementById('form-novo-produto').reset();
    document.getElementById('np-custo').value = '0.00';
    document.getElementById('np-margem').value = '50';
    document.getElementById('np-venda').value = '0.00';

    await carregarCategoriasModal();

    document.getElementById('modal-produto').style.display = 'flex';
}

function fecharModalNovoProduto() {
    arquivoImagemSelecionado = null;
    const form = document.getElementById('form-novo-produto');
    if (form)
        form.reset();

    const statusLabel = document.getElementById('status-upload-img');
    if (statusLabel)
        statusLabel.innerText = '';

    const modal = document.getElementById('modal-produto');
    if (modal)
        modal.style.display = 'none';
}

// Carrega a lista de categorias dinamicamente da tabela 'categorias'
async function carregarCategoriasModal() {
    const selectCat = document.getElementById('np-categoria');
    selectCat.innerHTML = '<option value="">Selecione</option>';

    const {data: categorias} = await _supabase.from('categorias').select('*').order('nome');
    if (categorias) {
        categorias.forEach(c => {
            selectCat.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
        });
    }
}

// Cálculos automáticos de preço e margem dentro da modal
function calcularPrecoModal() {
    const custo = parseFloat(document.getElementById('np-custo').value) || 0;
    const margem = parseFloat(document.getElementById('np-margem').value) || 0;
    document.getElementById('np-venda').value = (custo * (1 + (margem / 100))).toFixed(2);
}

function calcularMargemModal() {
    const custo = parseFloat(document.getElementById('np-custo').value) || 0;
    const venda = parseFloat(document.getElementById('np-venda').value) || 0;
    if (custo > 0) {
        document.getElementById('np-margem').value = (((venda - custo) / custo) * 100).toFixed(1);
    }
}

// Grava o novo produto no Supabase
async function salvarNovoProduto(event) {
    if (event) {
        event.preventDefault();
    }

    const cargo = String(
            window.usuarioAtual?.cargo || ''
            ).toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (
            !ehGerente &&
            permissoesAtuais.bloquearProdutos
            ) {
        alert(
                '⛔ Você não tem permissão para cadastrar produtos.'
                );

        return;
    }

    const btn = document.getElementById('btn-salvar-modal');

    if (!btn) {
        return;
    }

    const textoOriginal = btn.innerHTML;

    try {
        btn.disabled = true;
        btn.innerHTML = '⏳ Cadastrando...';

        let urlFinalImagem = document.getElementById('np-imagem').value.trim();

        // 1. Upload da foto para o Storage (se selecionada)
        if (arquivoImagemSelecionado) {
            btn.innerHTML = '⏳ Enviando foto...';
            const fileExt = arquivoImagemSelecionado.name.split('.').pop();
            const fileName = `prod_${Date.now()}.${fileExt}`;

            const {data, error: uploadError} = await _supabase.storage
                    .from('produtos')
                    .upload(fileName, arquivoImagemSelecionado);

            if (uploadError)
                throw new Error('Erro ao enviar imagem: ' + uploadError.message);

            const {data: publicData} = _supabase.storage
                    .from('produtos')
                    .getPublicUrl(fileName);

            urlFinalImagem = publicData.publicUrl;
        }

        // 2. Coleta dos dados usando os IDs corretos da modal
        const nome = document.getElementById('np-nome').value;
        const codigoBarra = document.getElementById('np-codigo').value;
        const descricao = document.getElementById('np-descricao').value;
        const categoriaId = document.getElementById('np-categoria').value || null;
        const estoque = parseInt(document.getElementById('np-estoque').value) || 0;
        const custo = parseFloat(document.getElementById('np-custo').value) || 0;
        const margem = parseFloat(document.getElementById('np-margem').value) || 0;
        const precoVenda = parseFloat(document.getElementById('np-venda').value) || 0;

        btn.innerHTML = '⏳ Salvando no banco...';

        // 3. Gravando no Supabase
        const {error: dbError} = await _supabase
                .from('produtos')
                .insert([{
                        nome: nome,
                        codigo_barras: codigoBarra,
                        descricao: descricao,
                        categoria_id: categoriaId,
                        estoque: estoque,
                        preco_custo: custo,
                        margem_lucro: margem,
                        preco: precoVenda,
                        imagem_url: urlFinalImagem,
                        ativo: true
                    }]);

        if (dbError)
            throw new Error('Erro ao salvar produto: ' + dbError.message);

        alert('✅ Produto cadastrado com sucesso!');
        fecharModalNovoProduto();

        if (typeof carregarProdutosGerenciador === 'function') {
            carregarProdutosGerenciador();
        }

    } catch (err) {
        console.error(err);
        alert('❌ Falha ao cadastrar: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
}

let carrinhoBalcao = [];
let listaProdutosBalcao = [];

// --- INICIALIZAÇÃO DA ABA BALCÃO ---
// 1. Ao carregar a aba, guarda a lista na memória mas mantém a grade VAZIA
async function carregarBalcao() {
    const {data: produtos, error} = await _supabase
            .from('produtos')
            .select('*')
            .eq('ativo', true)
            .order('nome');

    if (error) {
        console.error('Erro ao carregar produtos do balcão:', error.message);
        return;
    }

    listaProdutosBalcao = produtos;
    renderizarProdutosBalcao([]); // "[]" Inicia a grade limpa ou "listaProdutosBalcao" inicia com a grade prenchida
    verificarStatusCaixa();
}

function renderizarProdutosBalcao(produtos) {
    const grid = document.getElementById('grid-balcao-produtos');
    grid.innerHTML = '';

    produtos.forEach(p => {
        const indisponivel = p.estoque <= 0;
        grid.innerHTML += `
            <div style="background: #2a2a32; padding: 12px; border-radius: 8px; border: 1px solid #3d3d4a; opacity: ${indisponivel ? '0.5' : '1'}; text-align: center;">
              <td>
                <img src="${p.imagem_url}" class="product-row-img" alt="${p.nome}">
              </td>
                
                <strong style="display: block; font-size: 0.95rem; margin-bottom: 5px;">${p.nome}</strong>
                <div style="color: #2ed573; font-weight: bold; margin-bottom: 5px;">R$ ${parseFloat(p.preco).toFixed(2).replace('.', ',')}</div>
                <small style="display: block; color: #aaa; margin-bottom: 8px;">Estoque: ${p.estoque}</small>
                
                <button class="btn-qty" style="width: 100%; background: ${indisponivel ? '#555' : '#ff4757'}; height: 32px;" 
                    onclick="adicionarAoCarrinhoBalcao('${p.id}')" ${indisponivel ? 'disabled' : ''}>
                    ${indisponivel ? 'Esgotado' : '➕ Adicionar'}
                </button>
            </div>
        `;
    });
}

// 2. Filtra e exibe os cards APENAS quando houver texto no campo
function filtrarProdutosBalcao(termo) {
    const busca = termo ? termo.toLowerCase().trim() : '';

    // Se a busca estiver vazia, limpa a grade
    if (!busca) {
        renderizarProdutosBalcao([]);
        return;
    }

    const filtrados = listaProdutosBalcao.filter(p =>
        p.nome.toLowerCase().includes(busca) ||
                (p.codigo_barras && String(p.codigo_barras).toLowerCase().includes(busca)) ||
                String(p.id) === busca
    );

    renderizarProdutosBalcao(filtrados);
}

// --- GERENCIAMENTO DO CARRINHO PRESENCIAL ---
window.adicionarAoCarrinhoBalcao = function (produtoId) {
    if (!caixaAtual || caixaAtual.status !== 'ABERTO') {
        alert('⚠️ O caixa está FECHADO! Abra o caixa para iniciar o atendimento.');
        return;
    }
    // Converte os IDs para String para garantir a comparação correta
    const prod = listaProdutosBalcao.find(p => String(p.id) === String(produtoId));
    if (!prod) {
        console.error('Produto não encontrado:', produtoId);
        return;
    }

    const itemExistente = carrinhoBalcao.find(i => String(i.id) === String(produtoId));
    const qtdAtual = itemExistente ? itemExistente.qtd : 0;

    if (qtdAtual + 1 > prod.estoque) {
        alert(`Estoque insuficiente para "${prod.nome}". Restam apenas ${prod.estoque} unidades.`);
        return;
    }

    if (itemExistente) {
        itemExistente.qtd += 1;
    } else {
        carrinhoBalcao.push({id: prod.id, nome: prod.nome, preco: prod.preco, qtd: 1});
    }

    atualizarCarrinhoBalcaoUI();
};

window.alterarQtdBalcao = function (produtoId, delta) {
    const item = carrinhoBalcao.find(i => String(i.id) === String(produtoId));
    if (!item)
        return;

    const prodOriginal = listaProdutosBalcao.find(p => String(p.id) === String(produtoId));

    if (delta > 0 && prodOriginal && item.qtd + delta > prodOriginal.estoque) {
        alert('Limite de estoque atingido!');
        return;
    }

    item.qtd += delta;
    if (item.qtd <= 0) {
        carrinhoBalcao = carrinhoBalcao.filter(i => String(i.id) !== String(produtoId));
    }
    atualizarCarrinhoBalcaoUI();
};

function atualizarCarrinhoBalcaoUI() {
    const conteiner = document.getElementById('lista-carrinho-balcao');
    conteiner.innerHTML = '';

    let total = 0;

    if (carrinhoBalcao.length === 0) {
        conteiner.innerHTML = '<p style="color: #888; text-align: center; margin-top: 30px;">Nenhum item selecionado.</p>';
    } else {
        carrinhoBalcao.forEach(i => {
            const subtotal = i.preco * i.qtd;
            total += subtotal;

            conteiner.innerHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #2a2a32;">
                    <div>
                        <div style="font-weight: bold; font-size: 0.9rem;">${i.nome}</div>
                        <small style="color: #aaa;">R$ ${parseFloat(i.preco).toFixed(2).replace('.', ',')}</small>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <button class="btn-qty" style="width:24px; height:24px; padding:0;" onclick="alterarQtdBalcao('${i.id}', -1)">-</button>
                        <span>${i.qtd}</span>
                        <button class="btn-qty" style="width:24px; height:24px; padding:0;" onclick="alterarQtdBalcao('${i.id}', 1)">+</button>
                    </div>
                </div>
            `;
        });
    }

    document.getElementById('balcao-total-val').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
}

// --- FINALIZAÇÃO DA VENDA, BAIXA NO ESTOQUE E COMPROVANTE ---
// --- FINALIZAÇÃO DA VENDA DE BALCÃO VIA RPC ---
async function finalizarVendaBalcao() {
    if (!caixaAtual || caixaAtual.status !== 'ABERTO') {
        alert('⚠️ O caixa está FECHADO! Abra o caixa no painel para poder realizar vendas.');
        return;
    }

    if (carrinhoBalcao.length === 0) {
        alert('Adicione ao menos um produto no carrinho do balcão.');
        return;
    }

    const btn = document.getElementById('btn-finalizar-balcao');

    if (!btn) {
        console.error('Botão btn-finalizar-balcao não encontrado.');
        return;
    }

    btn.textContent = '⏳ Processando Venda...';
    btn.disabled = true;

    try {
        const formaPagamento = document.getElementById('balcao-pagamento').value;
        const nomeCliente = document.getElementById('balcao-cliente').value.trim();

        // O banco passa a ser a fonte da verdade para preço e estoque.
        const itensRPC = carrinhoBalcao.map(item => ({
                produto_id: Number(item.id),
                quantidade: Number(item.qtd)
            }));

        // Uma única operação:
        // pedido + itens + baixa de estoque.
        const {data: pedidoId, error: erroVenda} = await _supabase.rpc(
                'registrar_venda_balcao',
                {
                    p_caixa_id: Number(caixaAtual.id),
                    p_forma_pagamento: formaPagamento,
                    p_nome_cliente: nomeCliente || null,
                    p_itens: itensRPC
                }
        );

        if (erroVenda) {
            console.error('Erro na RPC registrar_venda_balcao:', erroVenda);

            if (erroVenda.message?.includes('CAIXA_FECHADO')) {
                alert('🔒 O caixa está fechado.');
            } else if (erroVenda.message?.includes('ESTOQUE_INSUFICIENTE')) {
                alert('⚠️ Estoque insuficiente para um ou mais produtos.');
            } else if (erroVenda.message?.includes('PRODUTO_NAO_ENCONTRADO')) {
                alert('⚠️ Um dos produtos não está mais disponível.');
            } else if (erroVenda.message?.includes('FORMA_PAGAMENTO_INVALIDA')) {
                alert('⚠️ Forma de pagamento inválida.');
            } else {
                alert('❌ Não foi possível registrar a venda: ' + erroVenda.message);
            }

            return;
        }

        if (!pedidoId) {
            throw new Error('A venda foi processada, mas nenhum ID de pedido foi retornado.');
        }

        // Recarrega o pedido criado pelo banco para manter
        // listaPedidosGlobal e a impressão compatíveis com o sistema atual.
        const {data: novoPedido, error: erroBuscaPedido} = await _supabase
                .from('pedidos')
                .select(`
                *,
                itens_pedido (
                    *,
                    produtos (nome)
                )
            `)
                .eq('id', pedidoId)
                .single();

        if (erroBuscaPedido) {
            throw erroBuscaPedido;
        }

        // Atualiza a lista global usada pelo PDV.
        if (!Array.isArray(listaPedidosGlobal)) {
            listaPedidosGlobal = [];
        }

        listaPedidosGlobal.push(novoPedido);

        // Imprime usando o ID criado pela RPC.
        if (typeof window.imprimirPedido === 'function') {
            window.imprimirPedido(pedidoId);
        }

        // Limpa o carrinho.
        carrinhoBalcao = [];

        const campoCliente = document.getElementById('balcao-cliente');
        if (campoCliente) {
            campoCliente.value = '';
        }

        atualizarCarrinhoBalcaoUI();

        // Recarrega produtos para refletir o novo estoque.
        await carregarBalcao();

        // Atualiza o resumo do caixa.
        await exibirPainelCaixaAberto();

        alert(`✅ Venda #${pedidoId} realizada com sucesso!`);

    } catch (err) {
        console.error('Exceção ao finalizar venda:', err);
        alert('❌ Erro ao finalizar venda: ' + (err.message || err));

    } finally {
        btn.textContent = '✅ Finalizar e Imprimir';
        btn.disabled = false;
    }
}

// Captura a tecla Enter do teclado ou do leitor de código de barras
function tratarEntradaLeitor(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        processarBuscaEntrada();
    }
}

// 3. Processa a busca/leitor e limpa a grade após adicionar ao carrinho
async function processarBuscaEntrada() {
    const input = document.getElementById('balcao-input-codigo');
    const termo = input.value.trim().toLowerCase();

    if (!termo)
        return;

    // 1. Correspondência EXATA por Código de Barras ou ID
    const produtoExato = listaProdutosBalcao.find(p =>
        (p.codigo_barras && String(p.codigo_barras).toLowerCase() === termo) ||
                String(p.id) === termo
    );

    if (produtoExato) {
        adicionarAoCarrinhoBalcao(produtoExato.id);
        input.value = '';
        renderizarProdutosBalcao([]); // Reseta a grade para vazia
        return;
    }

    // 2. Busca parcial por Nome
    const filtrados = listaProdutosBalcao.filter(p => p.nome.toLowerCase().includes(termo));

    if (filtrados.length === 1) {
        adicionarAoCarrinhoBalcao(filtrados[0].id);
        input.value = '';
        renderizarProdutosBalcao([]); // Reseta a grade para vazia
    } else if (filtrados.length > 1) {
        renderizarProdutosBalcao(filtrados);
    } else {
        alert('❌ Produto não encontrado ou sem estoque!');
        input.select();
    }
}

function selecionarFotoLocal(event) {
    const file = event.target.files[0];
    if (!file)
        return;

    arquivoImagemSelecionado = file;
    const statusLabel = document.getElementById('status-upload-img');
    if (statusLabel) {
        statusLabel.style.color = '#2ed573';
        statusLabel.innerText = `📷 Foto selecionada: ${file.name}`;
    }
}

// ============================================================
// HISTÓRICO DE MOVIMENTAÇÕES DE ESTOQUE
// ============================================================
async function carregarHistoricoEstoque() {

    const tbody = document.getElementById(
            'historico-estoque-table-body'
            );

    if (!tbody) {
        console.error(
                'Tabela de histórico de estoque não encontrada.'
                );
        return;
    }

    const filtroProduto =
            document.getElementById(
                    'filtro-estoque-produto'
                    )?.value
            ?.trim()
            ?.toLowerCase() || '';

    const filtroTipo =
            document.getElementById(
                    'filtro-estoque-tipo'
                    )?.value || 'TODOS';

    const filtroPeriodo =
            document.getElementById(
                    'filtro-estoque-periodo'
                    )?.value || 'hoje';

    tbody.innerHTML = `
        <tr>
            <td colspan="9" style="text-align:center;">
                Carregando movimentações...
            </td>
        </tr>
    `;

    let query = _supabase
            .from('movimentacoes_estoque')
            .select(`
            id,
            produto_id,
            produto_nome,
            tipo,
            quantidade,
            estoque_anterior,
            estoque_posterior,
            motivo,
            pedido_id,
            usuario_auth_id,
            usuario_nome,
            criado_em
        `)
            .order('criado_em', {
                ascending: false
            });

    // --------------------------------------------------------
    // FILTRO POR PRODUTO
    // --------------------------------------------------------
    if (filtroProduto) {
        query = query.ilike(
                'produto_nome',
                `%${filtroProduto}%`
                );
    }

    // --------------------------------------------------------
    // FILTRO POR TIPO
    // --------------------------------------------------------
    if (filtroTipo !== 'TODOS') {
        query = query.eq(
                'tipo',
                filtroTipo
                );
    }

    // --------------------------------------------------------
    // FILTRO POR PERÍODO
    // --------------------------------------------------------
    const agora = new Date();

    if (filtroPeriodo === 'hoje') {

        const inicioDia = new Date(
                agora.getFullYear(),
                agora.getMonth(),
                agora.getDate()
                );

        query = query.gte(
                'criado_em',
                inicioDia.toISOString()
                );

    } else if (filtroPeriodo === '7dias') {

        const limite = new Date();
        limite.setDate(
                limite.getDate() - 7
                );

        query = query.gte(
                'criado_em',
                limite.toISOString()
                );

    } else if (filtroPeriodo === 'mes') {

        const inicioMes = new Date(
                agora.getFullYear(),
                agora.getMonth(),
                1
                );

        query = query.gte(
                'criado_em',
                inicioMes.toISOString()
                );
    }

    const {
        data: movimentacoes,
        error
    } = await query;

    if (error) {

        console.error(
                'Erro ao carregar histórico de estoque:',
                error
                );

        tbody.innerHTML = `
            <tr>
                <td colspan="9"
                    style="color:red; text-align:center;">
                    Erro ao carregar histórico:
                    ${error.message}
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML = '';

    if (
            !movimentacoes ||
            movimentacoes.length === 0
            ) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9"
                    style="text-align:center;">
                    Nenhuma movimentação encontrada.
                </td>
            </tr>
        `;

        return;
    }

    movimentacoes.forEach(mov => {

        const dataHora = mov.criado_em
                ? new Date(
                        mov.criado_em
                        ).toLocaleString('pt-BR')
                : '-';

        const quantidade =
                Number(mov.quantidade || 0);

        const tipo =
                String(
                        mov.tipo || ''
                        ).toUpperCase();

        let tipoTexto = tipo;

        if (tipo === 'VENDA') {
            tipoTexto = '🛒 VENDA';
        } else if (tipo === 'ENTRADA') {
            tipoTexto = '📥 ENTRADA';
        } else if (tipo === 'AJUSTE') {
            tipoTexto = '🔧 AJUSTE';
        } else if (tipo === 'CANCELAMENTO') {
            tipoTexto = '↩️ CANCELAMENTO';
        }

        const pedidoTexto =
                mov.pedido_id
                ? `#${mov.pedido_id}`
                : '-';

        const usuarioTexto =
                mov.usuario_nome || 'Sistema';

        const quantidadeTexto =
                quantidade > 0
                ? `+${quantidade}`
                : String(quantidade);

        const tr =
                document.createElement('tr');

        tr.innerHTML = `
            <td>${dataHora}</td>

            <td>
                <strong>
                    ${mov.produto_nome || '-'}
                </strong>
            </td>

            <td>
                <strong>
                    ${tipoTexto}
                </strong>
            </td>

            <td>
                <strong>
                    ${quantidadeTexto}
                </strong>
            </td>

            <td>
                ${mov.estoque_anterior}
            </td>

            <td>
                <strong>
                    ${mov.estoque_posterior}
                </strong>
            </td>

            <td>
                ${mov.motivo || '-'}
            </td>

            <td>
                ${pedidoTexto}
            </td>

            <td>
                ${usuarioTexto}
           </td>
        `;

        tbody.appendChild(tr);
    });
}

// Função principal para inicializar a aba de Finanças
async function carregarFinancas() {
    await carregarResumoFinanceiro();
    await carregarHistoricoCaixas();
    await carregarTabelaDespesas();

    // Define a data atual no input de vencimento por padrão
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('desp-vencimento').value = hoje;
}

// 1. Calcula os totais (Faturamento, CMV, Despesas e Lucro Líquido)
async function carregarResumoFinanceiro() {
    let faturamento = 0;

    let cmvTotal = 0;
    let cmvRealTotal = 0;
    let cmvEstimadoTotal = 0;

    let totalDespesas = 0;

    const contagemPagamentos = {};
    let totalVendasValidas = 0;

    const filtroPeriodo =
            document.getElementById('fin-filtro-periodo')?.value
            || 'todos';

    const agora = new Date();

    let inicioPeriodo = null;

    if (filtroPeriodo === 'hoje') {

        inicioPeriodo = new Date(
                agora.getFullYear(),
                agora.getMonth(),
                agora.getDate()
                );

    } else if (filtroPeriodo === '7dias') {

        inicioPeriodo = new Date(
                agora
                );

        inicioPeriodo.setDate(
                inicioPeriodo.getDate() - 7
                );

    } else if (filtroPeriodo === 'mes') {

        inicioPeriodo = new Date(
                agora.getFullYear(),
                agora.getMonth(),
                1
                );
    }

    const inicioPeriodoISO =
            inicioPeriodo
            ? inicioPeriodo.toISOString()
            : null;

    try {
        // Busca apenas colunas reais da tabela pedidos (forma_pagamento e valor_total)
        let queryVendas = _supabase
                .from('pedidos')
                .select(`
        status,
        forma_pagamento,
        valor_total,
        criado_em,
        itens_pedido (
            quantidade,
            custo_medio_unitario,
            produtos (
                preco_custo
            )
        )
    `)
                .eq('status', 'CONCLUIDO');

        if (inicioPeriodoISO) {
            queryVendas = queryVendas.gte(
                    'criado_em',
                    inicioPeriodoISO
                    );
        }

        const {data: vendas, error: errVendas} =
                await queryVendas;

        if (errVendas) {
            console.error('Erro na consulta de vendas:', errVendas);
        } else if (vendas && vendas.length > 0) {
            vendas.forEach(venda => {
                // Faturamento
                const valor = parseFloat(venda.valor_total || 0);
                faturamento += valor;

                // CMV
                const listaItens = venda.itens_pedido || [];

                if (Array.isArray(listaItens)) {

                    listaItens.forEach(item => {

                        const qtd =
                                parseInt(item.quantidade || 1);

                        const custoSnapshot =
                                item.custo_medio_unitario;

                        let custoUnitario;

                        if (
                                custoSnapshot !== null &&
                                custoSnapshot !== undefined
                                ) {

                            // CMV REAL:
                            // custo congelado no momento da venda.
                            custoUnitario =
                                    parseFloat(custoSnapshot || 0);

                            cmvRealTotal +=
                                    custoUnitario * qtd;

                        } else {

                            // CMV ESTIMADO:
                            // venda antiga sem snapshot.
                            custoUnitario =
                                    parseFloat(
                                            item.produtos?.preco_custo || 0
                                            );

                            cmvEstimadoTotal +=
                                    custoUnitario * qtd;
                        }

                        cmvTotal +=
                                custoUnitario * qtd;
                    });
                }

                // Contagem da Forma de Pagamento
                if (venda.forma_pagamento) {
                    const metodo = String(venda.forma_pagamento).toUpperCase().trim();
                    contagemPagamentos[metodo] = (contagemPagamentos[metodo] || 0) + 1;
                    totalVendasValidas++;
                }
            });
        }
    } catch (e) {
        console.error('Exceção ao calcular faturamento/CMV:', e);
    }

    try {
        // Busca as despesas
        let queryDespesas = _supabase
                .from('despesas')
                .select('valor');

        if (inicioPeriodoISO) {
            queryDespesas = queryDespesas.gte(
                    'created_at',
                    inicioPeriodoISO
                    );
        }

        const {data: despesas, error: errDesp} =
                await queryDespesas;

        if (!errDesp && despesas) {
            totalDespesas = despesas.reduce((acc, d) => acc + parseFloat(d.valor || 0), 0);
        }
    } catch (e) {
        console.error('Exceção ao consultar despesas:', e);
    }

    // Identifica o método de pagamento mais usado
    let formaDominante = 'Sem dados';
    let maxQtd = 0;

    for (const [metodo, qtd] of Object.entries(contagemPagamentos)) {
        if (qtd > maxQtd) {
            maxQtd = qtd;
            formaDominante = metodo;
        }
    }

    const porcentagem = totalVendasValidas > 0
            ? Math.round((maxQtd / totalVendasValidas) * 100)
            : 0;

    // Cálculos DRE
    const lucroBruto = faturamento - cmvTotal;

    console.log('📊 CMV REAL:', cmvRealTotal);
    console.log('📊 CMV ESTIMADO:', cmvEstimadoTotal);
    console.log('📊 CMV TOTAL:', cmvTotal);

    const lucroLiquido = lucroBruto - totalDespesas;

    // Atualização dos cards na interface
    document.getElementById('fin-faturamento').innerText = `R$ ${faturamento.toFixed(2).replace('.', ',')}`;
    document.getElementById('fin-cmv').innerText = `R$ ${cmvTotal.toFixed(2).replace('.', ',')}`;
    const elemCmvReal =
            document.getElementById('fin-cmv-real');

    const elemCmvEstimado =
            document.getElementById('fin-cmv-estimado');

    if (elemCmvReal) {
        elemCmvReal.innerText =
                `R$ ${cmvRealTotal.toFixed(2).replace('.', ',')}`;
    }

    if (elemCmvEstimado) {
        elemCmvEstimado.innerText =
                `R$ ${cmvEstimadoTotal.toFixed(2).replace('.', ',')}`;
    }
    document.getElementById('fin-lucro-bruto').innerText = `R$ ${lucroBruto.toFixed(2).replace('.', ',')}`;
    document.getElementById('fin-despesas').innerText = `R$ ${totalDespesas.toFixed(2).replace('.', ',')}`;

    const elemLucro = document.getElementById('fin-lucro');
    elemLucro.innerText = `R$ ${lucroLiquido.toFixed(2).replace('.', ',')}`;
    elemLucro.style.color = lucroLiquido >= 0 ? '#2ed573' : '#ff4757';

    const elemDominante = document.getElementById('fin-pagamento-dominante');
    if (elemDominante) {
        elemDominante.innerText = maxQtd > 0 ? `${formaDominante} (${porcentagem}%)` : 'Sem dados';
    }
}

async function carregarHistoricoCaixas() {

    const tbody = document.getElementById('historico-caixas-body');

    if (!tbody)
        return;

    const filtro =
            document.getElementById('filtro-periodo-caixas')?.value
            || 'todos';

    tbody.innerHTML = `
        <tr>
            <td colspan="10"
                style="text-align:center;color:#aaa;">
                Carregando histórico...
            </td>
        </tr>
    `;

    try {

        let query = _supabase
                .from('caixa_diario')
                .select(`
                id,
                data_abertura,
                data_fechamento,
                saldo_inicial,
                total_entradas_dinheiro,
                total_outras_formas,
                total_saidas,
                saldo_esperado,
                saldo_informado,
                diferenca,
                status
            `)
                .eq('status', 'FECHADO')
                .order('data_fechamento', {ascending: false})
                .limit(50);

        // Filtro por período
        const agora = new Date();

        if (filtro === 'hoje') {

            const inicioDia = new Date(
                    agora.getFullYear(),
                    agora.getMonth(),
                    agora.getDate()
                    ).toISOString();

            query = query.gte(
                    'data_fechamento',
                    inicioDia
                    );

        } else if (filtro === '7dias') {

            const seteDiasAtras = new Date();
            seteDiasAtras.setDate(
                    seteDiasAtras.getDate() - 7
                    );

            query = query.gte(
                    'data_fechamento',
                    seteDiasAtras.toISOString()
                    );

        } else if (filtro === 'mes') {

            const inicioMes = new Date(
                    agora.getFullYear(),
                    agora.getMonth(),
                    1
                    ).toISOString();

            query = query.gte(
                    'data_fechamento',
                    inicioMes
                    );
        }

        const {data: caixas, error} = await query;

        if (error) {

            console.error(
                    'Erro ao carregar histórico dos caixas:',
                    error
                    );

            tbody.innerHTML = `
                <tr>
                    <td colspan="10"
                        style="text-align:center;color:#ff4757;">
                        Erro ao carregar histórico.
                    </td>
                </tr>
            `;

            return;
        }

        if (!caixas || caixas.length === 0) {

            tbody.innerHTML = `
                <tr>
                    <td colspan="10"
                        style="text-align:center;color:#aaa;">
                        Nenhum caixa fechado encontrado.
                    </td>
                </tr>
            `;

            return;
        }

        const dinheiro = valor =>
                `R$ ${Number(valor || 0)
                    .toFixed(2)
                    .replace('.', ',')}`;

        const dataHora = valor =>
            valor
                    ? new Date(valor).toLocaleString('pt-BR')
                    : '-';

        tbody.innerHTML = caixas.map(caixa => {

            const diferenca =
                    Number(caixa.diferenca || 0);

            let corDiferenca = '#fff';

            if (diferenca > 0) {
                corDiferenca = '#ffa502';
            } else if (diferenca < 0) {
                corDiferenca = '#ff4757';
            } else {
                corDiferenca = '#2ed573';
            }

            return `
    <tr
        onclick="abrirDetalhesCaixa(${caixa.id})"
        style="cursor:pointer;"
        title="Clique para ver o detalhamento do caixa"
    >

        <td>
            <strong>#${caixa.id}</strong>
        </td>

        <td>
            ${dataHora(caixa.data_abertura)}
        </td>

        <td>
            ${dataHora(caixa.data_fechamento)}
        </td>

        <td>
            ${dinheiro(caixa.saldo_inicial)}
        </td>

        <td style="color:#2ed573;">
            ${dinheiro(caixa.total_entradas_dinheiro)}
        </td>

        <td style="color:#1e90ff;">
            ${dinheiro(caixa.total_outras_formas)}
        </td>

        <td style="color:#ff4757;">
            ${dinheiro(caixa.total_saidas)}
        </td>

        <td>
            ${dinheiro(caixa.saldo_esperado)}
        </td>

        <td>
            ${dinheiro(caixa.saldo_informado)}
        </td>

        <td style="
            color:${corDiferenca};
            font-weight:bold;
        ">
            ${diferenca > 0 ? '+' : ''}
            ${dinheiro(diferenca)}
        </td>

    </tr>
`;

        }).join('');

    } catch (err) {

        console.error(
                'Exceção ao carregar histórico dos caixas:',
                err
                );

        tbody.innerHTML = `
            <tr>
                <td colspan="10"
                    style="text-align:center;color:#ff4757;">
                    Erro inesperado ao carregar histórico.
                </td>
            </tr>
        `;
    }
}

async function abrirDetalhesCaixa(caixaId) {

    const painel = document.getElementById('detalhes-caixa');
    const conteudo = document.getElementById('detalhes-caixa-conteudo');
    const titulo = document.getElementById('detalhes-caixa-titulo');

    if (!painel || !conteudo)
        return;

    painel.style.display = 'block';

    titulo.innerText =
            `🧾 Detalhamento do Caixa #${caixaId}`;

    conteudo.innerHTML = `
        <div style="text-align:center;color:#aaa;">
            Carregando detalhes...
        </div>
    `;

    try {

        const [
            resultadoCaixa,
            resultadoMovimentacoes,
            resultadoDespesas,
            resultadoVendas
        ] = await Promise.all([

            _supabase
                    .from('caixa_diario')
                    .select(`
                    id,
                    data_abertura,
                    data_fechamento,
                    saldo_inicial,
                    total_entradas_dinheiro,
                    total_outras_formas,
                    total_saidas,
                    saldo_esperado,
                    saldo_informado,
                    diferenca,
                    status
                `)
                    .eq('id', caixaId)
                    .single(),

            _supabase
                    .from('movimentacoes_caixa')
                    .select(`
                    tipo,
                    valor,
                    motivo,
                    usuario_nome,
                    criado_em
                `)
                    .eq('caixa_id', caixaId)
                    .order('criado_em', {ascending: false}),

            _supabase
                    .from('despesas')
                    .select(`
                    descricao,
                    valor,
                    forma_pagamento,
                    created_at
                `)
                    .eq('caixa_id', caixaId)
                    .eq('pago', true)
                    .order('created_at', {ascending: false}),

            _supabase
                    .from('pedidos')
                    .select(`
                    id,
                    valor_total,
                    forma_pagamento,
                    criado_em
                `)
                    .eq('caixa_id', caixaId)
                    .eq('status', 'CONCLUIDO')
                    .order('criado_em', {ascending: false})

        ]);

        if (resultadoCaixa.error)
            throw resultadoCaixa.error;

        if (resultadoMovimentacoes.error)
            throw resultadoMovimentacoes.error;

        if (resultadoDespesas.error)
            throw resultadoDespesas.error;

        if (resultadoVendas.error)
            throw resultadoVendas.error;

        const caixa = resultadoCaixa.data;
        const movimentacoes =
                resultadoMovimentacoes.data || [];

        const despesas =
                resultadoDespesas.data || [];

        const vendas =
                resultadoVendas.data || [];

        const dinheiro = valor =>
                `R$ ${Number(valor || 0)
                    .toFixed(2)
                    .replace('.', ',')}`;

        const dataHora = valor =>
            valor
                    ? new Date(valor).toLocaleString('pt-BR')
                    : '-';

        const vendasDinheiro =
                vendas
                .filter(v =>
                    (v.forma_pagamento || '').toUpperCase()
                            === 'DINHEIRO'
                )
                .reduce(
                        (total, v) =>
                    total + Number(v.valor_total || 0),
                        0
                        );

        const vendasOutras =
                vendas
                .filter(v =>
                    (v.forma_pagamento || '').toUpperCase()
                            !== 'DINHEIRO'
                )
                .reduce(
                        (total, v) =>
                    total + Number(v.valor_total || 0),
                        0
                        );

        const suprimentos =
                movimentacoes
                .filter(m => m.tipo === 'SUPRIMENTO')
                .reduce(
                        (total, m) =>
                    total + Number(m.valor || 0),
                        0
                        );

        const sangrias =
                movimentacoes
                .filter(m => m.tipo === 'SANGRIA')
                .reduce(
                        (total, m) =>
                    total + Number(m.valor || 0),
                        0
                        );

        const despesasDinheiro =
                despesas
                .filter(d =>
                    (d.forma_pagamento || '').toUpperCase()
                            === 'DINHEIRO'
                )
                .reduce(
                        (total, d) =>
                    total + Number(d.valor || 0),
                        0
                        );

        const diferenca =
                Number(caixa.diferenca || 0);

        const corDiferenca =
                diferenca > 0
                ? '#ffa502'
                : diferenca < 0
                ? '#ff4757'
                : '#2ed573';

        const linhasVendas = vendas.length
                ? vendas.map(v => `
                <tr>
                    <td>#${v.id}</td>
                    <td>${dataHora(v.criado_em)}</td>
                    <td>${v.forma_pagamento || '-'}</td>
                    <td>${dinheiro(v.valor_total)}</td>
                </tr>
            `).join('')
                : `
                <tr>
                    <td colspan="4"
                        style="text-align:center;color:#aaa;">
                        Nenhuma venda vinculada.
                    </td>
                </tr>
            `;

        const linhasMovimentacoes =
                movimentacoes.length
                ? movimentacoes.map(m => `
                    <tr>
                        <td>${dataHora(m.criado_em)}</td>
                        <td>${m.tipo === 'SUPRIMENTO'
                            ? '➕ Suprimento'
                            : '➖ Sangria'}</td>
                        <td>${dinheiro(m.valor)}</td>
                        <td>${m.motivo || '-'}</td>
                        <td>${m.usuario_nome || '-'}</td>
                    </tr>
                `).join('')
                : `
                    <tr>
                        <td colspan="5"
                            style="text-align:center;color:#aaa;">
                            Nenhuma movimentação.
                        </td>
                    </tr>
                `;

        const linhasDespesas =
                despesas.length
                ? despesas.map(d => `
                    <tr>
                        <td>${d.descricao || '-'}</td>
                        <td>${d.forma_pagamento || '-'}</td>
                        <td>${dataHora(d.created_at)}</td>
                        <td>${dinheiro(d.valor)}</td>
                    </tr>
                `).join('')
                : `
                    <tr>
                        <td colspan="4"
                            style="text-align:center;color:#aaa;">
                            Nenhuma despesa vinculada.
                        </td>
                    </tr>
                `;

        conteudo.innerHTML = `

            <!-- RESUMO -->
            <div style="
                display:grid;
                grid-template-columns:
                    repeat(auto-fit,minmax(170px,1fr));
                gap:12px;
                margin-bottom:20px;
            ">

                <div class="metric-card">
                    <span class="metric-title">
                        Saldo Inicial
                    </span>
                    <h3 class="metric-value">
                        ${dinheiro(caixa.saldo_inicial)}
                    </h3>
                </div>

                <div class="metric-card">
                    <span class="metric-title">
                        Vendas Dinheiro
                    </span>
                    <h3 class="metric-value">
                        ${dinheiro(vendasDinheiro)}
                    </h3>
                </div>

                <div class="metric-card">
                    <span class="metric-title">
                        Suprimentos
                    </span>
                    <h3 class="metric-value">
                        ${dinheiro(suprimentos)}
                    </h3>
                </div>

                <div class="metric-card">
                    <span class="metric-title">
                        Sangrias
                    </span>
                    <h3 class="metric-value">
                        ${dinheiro(sangrias)}
                    </h3>
                </div>

                <div class="metric-card">
                    <span class="metric-title">
                        Despesas Dinheiro
                    </span>
                    <h3 class="metric-value">
                        ${dinheiro(despesasDinheiro)}
                    </h3>
                </div>

                <div class="metric-card">
                    <span class="metric-title">
                        Saldo Esperado
                    </span>
                    <h3 class="metric-value">
                        ${dinheiro(caixa.saldo_esperado)}
                    </h3>
                </div>

                <div class="metric-card">
                    <span class="metric-title">
                        Saldo Informado
                    </span>
                    <h3 class="metric-value">
                        ${dinheiro(caixa.saldo_informado)}
                    </h3>
                </div>

                <div class="metric-card">
                    <span class="metric-title">
                        Diferença
                    </span>
                    <h3
                        class="metric-value"
                        style="color:${corDiferenca};"
                    >
                        ${diferenca > 0 ? '+' : ''}
                        ${dinheiro(diferenca)}
                    </h3>
                </div>

            </div>

            <!-- DATAS -->
            <div style="
                background:#2a2a35;
                padding:15px;
                border-radius:8px;
                margin-bottom:20px;
            ">
                <strong>Abertura:</strong>
                ${dataHora(caixa.data_abertura)}
                &nbsp;&nbsp; | &nbsp;&nbsp;
                <strong>Fechamento:</strong>
                ${dataHora(caixa.data_fechamento)}
            </div>

            <!-- VENDAS -->
            <h4 style="margin-bottom:8px;">
                🛒 Vendas do Caixa
            </h4>

            <div style="
                max-height:250px;
                overflow:auto;
                margin-bottom:20px;
            ">
                <table class="products-table"
                       style="width:100%;">
                    <thead>
                        <tr>
                            <th>Pedido</th>
                            <th>Data</th>
                            <th>Pagamento</th>
                            <th>Valor</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${linhasVendas}
                    </tbody>
                </table>
            </div>

            <!-- MOVIMENTAÇÕES -->
            <h4 style="margin-bottom:8px;">
                💵 Movimentações do Caixa
            </h4>

            <div style="
                max-height:250px;
                overflow:auto;
                margin-bottom:20px;
            ">
                <table class="products-table"
                       style="width:100%;">
                    <thead>
                        <tr>
                            <th>Data</th>
                            <th>Tipo</th>
                            <th>Valor</th>
                            <th>Motivo</th>
                            <th>Usuário</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${linhasMovimentacoes}
                    </tbody>
                </table>
            </div>

            <!-- DESPESAS -->
            <h4 style="margin-bottom:8px;">
                💸 Despesas Pagas
            </h4>

            <div style="
                max-height:250px;
                overflow:auto;
            ">
                <table class="products-table"
                       style="width:100%;">
                    <thead>
                        <tr>
                            <th>Descrição</th>
                            <th>Pagamento</th>
                            <th>Data</th>
                            <th>Valor</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${linhasDespesas}
                    </tbody>
                </table>
            </div>
        `;

        painel.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });

    } catch (err) {

        console.error(
                'Erro ao carregar detalhamento do caixa:',
                err
                );

        conteudo.innerHTML = `
            <div style="
                color:#ff4757;
                text-align:center;
                padding:20px;
            ">
                ❌ Erro ao carregar os detalhes do caixa.
            </div>
        `;
    }
}

function fecharDetalhesCaixa() {

    const painel =
            document.getElementById('detalhes-caixa');

    if (painel) {
        painel.style.display = 'none';
    }
}

// 2. Salva uma nova despesa
async function salvarDespesa() {
    const descricao = document.getElementById('desp-descricao').value.trim();
    const valor = parseFloat(document.getElementById('desp-valor').value);
    const categoria = document.getElementById('desp-categoria').value;
    const vencimento = document.getElementById('desp-vencimento').value;
    const pago = document.getElementById('desp-pago').checked;
    const formaPagamento = String(
            document.getElementById('desp-forma-pagamento').value || ''
            ).toUpperCase().trim();

    if (!descricao || isNaN(valor) || valor <= 0) {
        alert('⚠️ Preencha a descrição e um valor válido!');
        return;
    }

    if (
            !formaPagamento ||
            !['DINHEIRO', 'PIX', 'CARTAO', 'TRANSFERENCIA'].includes(formaPagamento)
            ) {
        alert('⚠️ Selecione uma forma de pagamento válida.');
        return;
    }

    try {
        /*
         * Primeiro registra a despesa como PENDENTE.
         * O pagamento será confirmado pela RPC.
         *
         * Isso é importante porque, se for DINHEIRO e
         * não houver saldo suficiente, a despesa não ficará
         * falsamente marcada como paga.
         */
        const novaDespesa = {
            descricao: descricao,
            valor: valor,
            categoria: categoria,
            data_vencimento: vencimento,
            pago: false,
            forma_pagamento: formaPagamento,
            caixa_id: null
        };

        const {data: despesaCriada, error: erroCriacao} = await _supabase
                .from('despesas')
                .insert([novaDespesa])
                .select('id')
                .single();

        if (erroCriacao) {
            throw erroCriacao;
        }

        /*
         * Se o usuário marcou "Já está pago",
         * confirma o pagamento através da RPC.
         */
        if (pago) {
            const {data: resultadoPagamento, error: erroPagamento} =
                    await _supabase.rpc(
                            'atualizar_pagamento_despesa',
                            {
                                p_despesa_id: Number(despesaCriada.id),
                                p_pago: true,
                                p_forma_pagamento: formaPagamento
                            }
                    );

            if (erroPagamento) {
                console.error(
                        'Erro ao confirmar pagamento da despesa:',
                        erroPagamento
                        );

                // Remove a despesa recém-criada,
                // pois o pagamento não foi concluído.
                await _supabase
                        .from('despesas')
                        .delete()
                        .eq('id', despesaCriada.id);

                if (erroPagamento.message?.includes('SALDO_CAIXA_INSUFICIENTE')) {
                    alert(
                            '❌ Saldo insuficiente no caixa para pagar esta despesa em dinheiro.'
                            );
                } else if (erroPagamento.message?.includes('CAIXA_NAO_ABERTO')) {
                    alert(
                            '⚠️ Não existe caixa aberto para realizar este pagamento em dinheiro.'
                            );
                } else {
                    alert(
                            '❌ Não foi possível confirmar o pagamento: ' +
                            erroPagamento.message
                            );
                }

                return;
            }
        }

        // Limpa o formulário
        document.getElementById('desp-descricao').value = '';
        document.getElementById('desp-valor').value = '';
        document.getElementById('desp-pago').checked = false;
        document.getElementById('desp-forma-pagamento').value = 'DINHEIRO';

        alert(
                pago
                ? '✅ Despesa registrada e pagamento confirmado!'
                : '✅ Despesa registrada como pendente!'
                );

        await carregarFinancas();

        if (caixaAtual && caixaAtual.status === 'ABERTO') {
            await exibirPainelCaixaAberto();
        }

    } catch (err) {
        console.error('Erro ao salvar despesa:', err);
        alert('❌ Erro ao salvar despesa: ' + (err.message || err));
    }
}

// 3. Renderiza a tabela de despesas
async function carregarTabelaDespesas() {
    const tbody = document.getElementById('tbody-despesas');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Carregando...</td></tr>';

    try {
        const {data: despesas, error} = await _supabase
                .from('despesas')
                .select('*')
                .order('data_vencimento', {ascending: false});

        if (error)
            throw error;

        if (!despesas || despesas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: #aaa;">Nenhuma despesa registrada.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        despesas.forEach(d => {
            const dataFmt = d.data_vencimento ? d.data_vencimento.split('-').reverse().join('/') : '-';

            tbody.innerHTML += `
                <tr>
                    <td><strong>${d.descricao}</strong></td>
                    <td><small style="background:#3d3d4e; padding:3px 8px; border-radius:4px;">${d.categoria}</small></td>
                    <td>${dataFmt}</td>
                    <td style="color: #ff4757; font-weight: bold;">R$ ${parseFloat(d.valor).toFixed(2).replace('.', ',')}</td>
                    <td>
                        <button onclick="alternarStatusPago(${d.id}, ${!d.pago})" 
                                style="background: ${d.pago ? '#2ed57322' : '#ff475722'}; color: ${d.pago ? '#2ed573' : '#ff4757'}; border: 1px solid ${d.pago ? '#2ed573' : '#ff4757'}; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size:0.75rem;">
                            ${d.pago ? '✓ Pago' : '⏳ Pendente'}
                        </button>
                    </td>
                    <td>
                        <button onclick="excluirDespesa(${d.id})" style="background: none; border: none; color: #ff4757; cursor: pointer; font-size: 1.1rem;" title="Excluir">
                            🗑️
                        </button>
                    </td>
                </tr>
            `;
        });

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">Erro: ${err.message}</td></tr>`;
    }
}

// 4. Alterna o status (Pago / Pendente)
async function alternarStatusPago(id, novoStatus) {
    try {
        // Quando volta para pendente, desfaz o pagamento.
        if (novoStatus === false) {
            const {data, error} = await _supabase.rpc(
                    'atualizar_pagamento_despesa',
                    {
                        p_despesa_id: Number(id),
                        p_pago: false,
                        p_forma_pagamento: null
                    }
            );

            if (error) {
                console.error('Erro ao voltar despesa para pendente:', error);
                alert('❌ Não foi possível alterar a despesa: ' + error.message);
                return;
            }
        } else {
            // Busca a forma de pagamento cadastrada na despesa.
            const {data: despesa, error: erroBusca} = await _supabase
                    .from('despesas')
                    .select('forma_pagamento')
                    .eq('id', id)
                    .single();

            if (erroBusca) {
                console.error('Erro ao buscar despesa:', erroBusca);
                alert('❌ Não foi possível identificar a forma de pagamento.');
                return;
            }

            const formaPagamento = String(
                    despesa?.forma_pagamento || ''
                    ).toUpperCase().trim();

            if (!formaPagamento) {
                alert('⚠️ Informe a forma de pagamento antes de marcar como paga.');
                return;
            }

            const {data, error} = await _supabase.rpc(
                    'atualizar_pagamento_despesa',
                    {
                        p_despesa_id: Number(id),
                        p_pago: true,
                        p_forma_pagamento: formaPagamento
                    }
            );

            if (error) {
                console.error('Erro ao pagar despesa:', error);

                if (error.message?.includes('SALDO_CAIXA_INSUFICIENTE')) {
                    alert(
                            '❌ Saldo insuficiente no caixa para pagar esta despesa em dinheiro.'
                            );
                } else if (error.message?.includes('CAIXA_NAO_ABERTO')) {
                    alert(
                            '⚠️ Não existe caixa aberto para realizar este pagamento em dinheiro.'
                            );
                } else {
                    alert('❌ Não foi possível pagar a despesa: ' + error.message);
                }

                return;
            }
        }

        await carregarFinancas();

        if (caixaAtual && caixaAtual.status === 'ABERTO') {
            await exibirPainelCaixaAberto();
        }

    } catch (err) {
        console.error('Exceção ao alternar pagamento:', err);
        alert('❌ Erro ao atualizar pagamento: ' + (err.message || err));
    }
}

// 5. Exclui despesa
async function excluirDespesa(id) {
    if (confirm('Deseja realmente remover esta despesa?')) {
        await _supabase.from('despesas').delete().eq('id', id);
        carregarFinancas();
    }
}

// 1. Verifica no banco se existe um caixa aberto no momento
async function verificarStatusCaixa() {
    try {
        const {data, error} = await _supabase
                .from('caixa_diario')
                .select('*')
                .eq('status', 'ABERTO')
                .order('id', {ascending: false})
                .limit(1);

        if (error)
            throw error;

        if (data && data.length > 0) {
            caixaAtual = data[0];
            exibirPainelCaixaAberto();
        } else {
            caixaAtual = null;
            exibirPainelCaixaFechado();
        }
    } catch (err) {
        console.error('Erro ao verificar caixa:', err.message);
    }
}

// 2. Transição visual para caixa FECHADO
function exibirPainelCaixaFechado() {
    document.getElementById('caixa-badge-status').innerText = 'FECHADO';
    document.getElementById('caixa-badge-status').style.background = '#ff4757';
    document.getElementById('caixa-status-texto').innerText = 'O caixa está fechado. Informe o valor inicial para iniciar as vendas.';
    document.getElementById('box-abrir-caixa').style.display = 'block';
    document.getElementById('box-fechar-caixa').style.display = 'none';
}

// 3. Transição visual e cálculo de totais para caixa ABERTO
async function exibirPainelCaixaAberto() {
    if (!caixaAtual)
        return;

    const dataInicio = caixaAtual.data_abertura || caixaAtual.created_at;

// Busca somente vendas efetivamente concluídas deste caixa
    let query = _supabase
            .from('pedidos')
            .select('valor_total, forma_pagamento')
            .eq('status', 'CONCLUIDO');

    if (caixaAtual.id) {
        query = query.eq('caixa_id', caixaAtual.id);
    } else if (dataInicio) {
        query = query.gte('created_at', dataInicio);
    }

    const {data: vendas, error} = await query;

    if (error) {
        console.error('Erro ao buscar vendas do caixa:', error.message);
    }

    let totalDinheiro = 0;
    let totalOutros = 0;

    if (vendas) {
        vendas.forEach(v => {
            const val = parseFloat(v.valor_total || 0);
            const pgto = String(v.forma_pagamento || '').toUpperCase().trim();

            if (pgto === 'DINHEIRO') {
                totalDinheiro += val;
            } else {
                totalOutros += val;
            }
        });
    }

    let totalSaidasDinheiro = 0;

    try {
        const {data: despesasDinheiro, error: erroDespesas} = await _supabase
                .from('despesas')
                .select('valor')
                .eq('caixa_id', caixaAtual.id)
                .eq('pago', true)
                .eq('forma_pagamento', 'DINHEIRO');

        if (erroDespesas) {
            console.error('Erro ao buscar saídas de dinheiro:', erroDespesas);
        } else if (despesasDinheiro) {
            totalSaidasDinheiro = despesasDinheiro.reduce(
                    (acc, d) => acc + parseFloat(d.valor || 0),
                    0
                    );
        }
    } catch (err) {
        console.error('Exceção ao calcular saídas de dinheiro:', err);
    }

    let totalSuprimentos = 0;
    let totalSangrias = 0;

    try {
        const {data: movimentacoes, error: erroMovimentacoes} = await _supabase
                .from('movimentacoes_caixa')
                .select('tipo, valor')
                .eq('caixa_id', caixaAtual.id);

        if (erroMovimentacoes) {
            console.error('Erro ao buscar movimentações do caixa:', erroMovimentacoes);
        } else if (movimentacoes) {
            movimentacoes.forEach(m => {
                const valor = parseFloat(m.valor || 0);

                if (m.tipo === 'SUPRIMENTO') {
                    totalSuprimentos += valor;
                } else if (m.tipo === 'SANGRIA') {
                    totalSangrias += valor;
                }
            });
        }
    } catch (err) {
        console.error('Exceção ao calcular movimentações do caixa:', err);
    }

    const saldoInicial = parseFloat(caixaAtual.saldo_inicial || 0);
    const saldoEsperadoGaveta =
            saldoInicial
            + totalDinheiro
            + totalSuprimentos
            - totalSaidasDinheiro
            - totalSangrias;

    // Atualiza interface
    document.getElementById('caixa-badge-status').innerText = 'ABERTO';
    document.getElementById('caixa-badge-status').style.background = '#2ed573';
    document.getElementById('caixa-status-texto').innerText = dataInicio
            ? `Aberto em: ${new Date(dataInicio).toLocaleString('pt-BR')}`
            : 'Caixa aberto';

    document.getElementById('caixa-resumo-inicial').innerText = `R$ ${saldoInicial.toFixed(2).replace('.', ',')}`;
    document.getElementById('caixa-resumo-dinheiro').innerText = `R$ ${totalDinheiro.toFixed(2).replace('.', ',')}`;
    document.getElementById('caixa-resumo-outros').innerText = `R$ ${totalOutros.toFixed(2).replace('.', ',')}`;
    document.getElementById('caixa-resumo-saidas').innerText = `R$ ${totalSaidasDinheiro.toFixed(2).replace('.', ',')}`;
    document.getElementById('caixa-resumo-esperado').innerText = `R$ ${saldoEsperadoGaveta.toFixed(2).replace('.', ',')}`;

    document.getElementById('box-abrir-caixa').style.display = 'none';
    document.getElementById('box-fechar-caixa').style.display = 'block';

    // Guarda totais calculados no objeto atual
    caixaAtual.total_entradas_dinheiro = totalDinheiro;
    caixaAtual.total_outras_formas = totalOutros;
    caixaAtual.total_saidas = totalSaidasDinheiro;
    caixaAtual.saldo_esperado = saldoEsperadoGaveta;
    caixaAtual.total_suprimentos = totalSuprimentos;
    caixaAtual.total_sangrias = totalSangrias;

    await carregarHistoricoMovimentacoesCaixa();
}

async function registrarMovimentacaoCaixaUI(tipo) {
    try {
        if (!caixaAtual || !caixaAtual.id) {
            alert('Nenhum caixa está aberto.');
            return;
        }

        const valor = parseFloat(
                document.getElementById('caixa-valor-movimento').value
                );

        const motivo = document
                .getElementById('caixa-motivo-movimento')
                .value
                .trim();

        if (!valor || valor <= 0) {
            alert('Informe um valor maior que zero.');
            return;
        }

        if (!motivo || motivo.length < 2) {
            alert('Informe o motivo da movimentação.');
            return;
        }

        const {data, error} = await _supabase.rpc('movimentar_caixa', {
            p_caixa_id: Number(caixaAtual.id),
            p_tipo: tipo,
            p_valor: valor,
            p_motivo: motivo
        });

        if (error) {
            console.error(error);
            alert(error.message || 'Não foi possível registrar a movimentação.');
            return;
        }

        console.log('Movimentação registrada:', data);

        document.getElementById('caixa-valor-movimento').value = '';
        document.getElementById('caixa-motivo-movimento').value = '';

        await exibirPainelCaixaAberto();

    } catch (err) {
        console.error(err);
        alert('Erro ao registrar movimentação de caixa.');
    }
}

async function carregarHistoricoMovimentacoesCaixa() {
    const tbody = document.getElementById('caixa-historico-movimentacoes');

    if (!tbody)
        return;

    if (!caixaAtual || !caixaAtual.id) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;color:#aaa;">
                    Nenhum caixa aberto.
                </td>
            </tr>
        `;
        return;
    }

    const {data, error} = await _supabase
            .from('movimentacoes_caixa')
            .select('criado_em, tipo, valor, motivo, usuario_nome')
            .eq('caixa_id', caixaAtual.id)
            .order('criado_em', {ascending: false});

    if (error) {
        console.error('Erro ao carregar histórico do caixa:', error);

        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;color:#ff4757;">
                    Erro ao carregar histórico.
                </td>
            </tr>
        `;
        return;
    }

    if (!data || data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;color:#aaa;">
                    Nenhuma movimentação registrada.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = data.map(mov => {
        const dataHora = new Date(mov.criado_em).toLocaleString('pt-BR');

        const tipoTexto =
                mov.tipo === 'SUPRIMENTO'
                ? '➕ Suprimento'
                : '➖ Sangria';

        const valor = `R$ ${parseFloat(mov.valor || 0)
                .toFixed(2)
                .replace('.', ',')}`;

        const corTipo =
                mov.tipo === 'SUPRIMENTO'
                ? '#2ed573'
                : '#ff4757';

        return `
            <tr>
                <td>${dataHora}</td>
                <td style="color:${corTipo};font-weight:bold;">
                    ${tipoTexto}
                </td>
                <td>${valor}</td>
                <td>${mov.motivo || ''}</td>
                <td>${mov.usuario_nome || ''}</td>
            </tr>
        `;
    }).join('');
}

// 4. Executa a Abertura do Caixa
async function abrirCaixa() {
    const inputValor = document.getElementById('caixa-valor-inicial');

    const valorInicial = parseFloat(inputValor.value);

    if (isNaN(valorInicial) || valorInicial < 0) {
        alert('⚠️ Informe um saldo inicial válido.');
        return;
    }

    try {
        const {data: novoCaixaId, error} = await _supabase.rpc(
                'abrir_caixa',
                {
                    p_saldo_inicial: valorInicial
                }
        );

        if (error) {
            console.error('Erro ao abrir caixa:', error);

            if (error.message?.includes('JA_EXISTE_CAIXA_ABERTO')) {
                alert('⚠️ Já existe um caixa aberto.');
            } else if (error.message?.includes('SALDO_INICIAL_INVALIDO')) {
                alert('⚠️ O saldo inicial informado é inválido.');
            } else {
                alert('❌ Erro ao abrir caixa: ' + error.message);
            }

            return;
        }

        inputValor.value = '';

        alert(`🟢 Caixa #${novoCaixaId} aberto com sucesso!`);

        await verificarStatusCaixa();

    } catch (err) {
        console.error('Exceção ao abrir caixa:', err);
        alert('❌ Erro ao abrir caixa: ' + (err.message || err));
    }
}

// 5. Executa o Fechamento do Caixa com Conferência
async function fecharCaixa() {
    if (!caixaAtual || caixaAtual.status !== 'ABERTO') {
        alert('⚠️ Não existe um caixa aberto para fechar.');
        return;
    }

    const inputContado = document.getElementById('caixa-valor-contado');
    const valorInformado = parseFloat(inputContado.value);

    if (isNaN(valorInformado) || valorInformado < 0) {
        alert('⚠️ Digite um valor contado válido.');
        return;
    }

    // Este valor é apenas informativo para a confirmação.
    // O valor definitivo será recalculado pelo banco.
    const saldoEsperadoTela =
            parseFloat(caixaAtual.saldo_esperado || 0);

    const mensagemPrevia =
            valorInformado === saldoEsperadoTela
            ? '✅ A contagem coincide com o saldo esperado exibido.'
            : `⚠️ O valor contado difere do saldo esperado exibido.`;

    const confirmar = confirm(
            `Confirma o fechamento do caixa?\n\n` +
            `Saldo esperado exibido: R$ ${saldoEsperadoTela.toFixed(2).replace('.', ',')}\n` +
            `Valor contado: R$ ${valorInformado.toFixed(2).replace('.', ',')}\n\n` +
            `${mensagemPrevia}`
            );

    if (!confirmar) {
        return;
    }

    try {
        const {data: resultado, error} = await _supabase.rpc(
                'fechar_caixa',
                {
                    p_caixa_id: Number(caixaAtual.id),
                    p_saldo_informado: valorInformado
                }
        );

        if (error) {
            console.error('Erro ao fechar caixa:', error);

            if (error.message?.includes('CAIXA_JA_FECHADO')) {
                alert('⚠️ Este caixa já está fechado.');
            } else if (error.message?.includes('CAIXA_NAO_ENCONTRADO')) {
                alert('⚠️ Caixa não encontrado.');
            } else if (error.message?.includes('SALDO_INFORMADO_INVALIDO')) {
                alert('⚠️ O valor informado é inválido.');
            } else {
                alert('❌ Erro ao fechar caixa: ' + error.message);
            }

            return;
        }

        if (!resultado) {
            throw new Error(
                    'O banco não retornou os dados do fechamento.'
                    );
        }

        inputContado.value = '';

        const diferenca = Number(resultado.diferenca || 0);
        const saldoEsperado = Number(resultado.saldo_esperado || 0);
        const saldoInformado = Number(resultado.saldo_informado || 0);

        let mensagemFinal;

        if (diferenca === 0) {
            mensagemFinal = '✅ Caixa bateu perfeitamente!';
        } else if (diferenca > 0) {
            mensagemFinal =
                    `⚠️ Sobra de caixa: R$ ${diferenca.toFixed(2).replace('.', ',')}`;
        } else {
            mensagemFinal =
                    `❌ Quebra/Falta de caixa: R$ ${Math.abs(diferenca).toFixed(2).replace('.', ',')}`;
        }

        alert(
                `🔴 Caixa fechado com sucesso!\n\n` +
                `Saldo esperado: R$ ${saldoEsperado.toFixed(2).replace('.', ',')}\n` +
                `Valor contado: R$ ${saldoInformado.toFixed(2).replace('.', ',')}\n\n` +
                mensagemFinal
                );

        await verificarStatusCaixa();

    } catch (err) {
        console.error('Exceção ao fechar caixa:', err);
        alert('❌ Erro ao fechar caixa: ' + (err.message || err));
    }
}

// Função Pagamento com PIX:
// Algoritmo para cálculo de validação CRC16 exigido pelo Banco Central
function calcularCRC16Pix(payload) {
    let crc = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
        crc ^= (payload.charCodeAt(i) << 8);
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Monta a string oficial do PIX (EMV BR Code)
function criarPayloadPix(chave, nome, valor, cidade = 'SAO PAULO') {
    const valorFmt = parseFloat(valor).toFixed(2);

    function blk(id, val) {
        return `${id}${String(val.length).padStart(2, '0')}${val}`;
    }

    const merchantAccount = blk('00', 'br.gov.bcb.pix') + blk('01', chave);

    let payload =
            blk('00', '01') +
            blk('26', merchantAccount) +
            blk('52', '0000') +
            blk('53', '986') +
            blk('54', valorFmt) +
            blk('58', 'BR') +
            blk('59', nome.substring(0, 25)) +
            blk('60', cidade.substring(0, 15)) +
            blk('62', blk('05', '***')) +
            '6304';

    return payload + calcularCRC16Pix(payload);
}

// Função acionada ao clicar em "Gerar Placa PIX"
function processarEExibirPix() {
    // Esconde o cupom de fundo para não vazar na impressão
    const cupom = document.getElementById('comprovante-venda');
    if (cupom)
        cupom.style.display = 'none';

    const chave = document.getElementById('input-pix-chave').value.trim();
    const nome = document.getElementById('input-pix-nome').value.trim();
    const valor = parseFloat(document.getElementById('input-pix-valor').value);

    if (!chave || !nome || isNaN(valor) || valor <= 0) {
        alert('⚠️ Preencha a chave PIX, o nome do beneficiário e um valor válido!');
        return;
    }

    // 1. Gera o código oficial do PIX
    const payloadPix = criarPayloadPix(chave, nome, valor);

    // 2. Gera a imagem do QR Code usando a API gratuita
    const urlQrCodeImg = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(payloadPix)}`;

    // 3. Atualiza os dados da placa visual
    document.getElementById('pix-img-qrcode').src = urlQrCodeImg;
    document.getElementById('pix-exibir-chave').innerText = chave;
    document.getElementById('pix-exibir-nome').innerText = nome;
    document.getElementById('pix-exibir-valor').innerText = `R$ ${valor.toFixed(2).replace('.', ',')}`;

    // 4. Alterna a visão do formulário para a placa gerada
    document.getElementById('box-form-pix').style.display = 'none';
    document.getElementById('box-resultado-pix').style.display = 'block';
}

// Abre o modal na etapa de formulário
function abrirPlacaPix(valorSugerido = null) {
    const abaPix = document.getElementById('aba-pix');
    if (abaPix)
        abaPix.style.display = 'block';

    if (valorSugerido) {
        document.getElementById('input-pix-valor').value = parseFloat(valorSugerido).toFixed(2);
    }

    voltarParaFormularioPix();
}

function voltarParaFormularioPix() {
    document.getElementById('box-form-pix').style.display = 'block';
    document.getElementById('box-resultado-pix').style.display = 'none';
}

function fecharModalPix() {
    const abaPix = document.getElementById('aba-pix');
    if (abaPix)
        abaPix.style.display = 'none';
}

function imprimirPix() {
    // 1. Oculta dinamicamente qualquer comprovante ou cupom antigo presente no HTML
    const elementosComprovante = document.querySelectorAll(
            '#comprovante-venda, #cupom-balcao, .area-impressao, .comprovante-pedido, [id*="comprovante"], [id*="cupom"]'
            );
    elementosComprovante.forEach(el => el.style.setProperty('display', 'none', 'important'));

    // 2. Ativa o modo de impressão do PIX
    document.body.classList.add('imprimindo-pix');

    // 3. Abre a janela de impressão do navegador
    window.print();

    // 4. Restaura a tela após o fechamento da janela de impressão
    setTimeout(() => {
        document.body.classList.remove('imprimindo-pix');
        elementosComprovante.forEach(el => el.style.removeProperty('display'));
    }, 1000);
}

// 1. Carrega os usuários salvos no banco e exibe na tabela
async function carregarListaUsuarios() {
    try {
        const {data: usuarios, error} = await _supabase
                .from('usuarios')
                .select('*')
                .order('nome', {ascending: true});

        if (error) {
            console.error('Erro ao buscar usuários:', error.message);
            return;
        }

        const tbody = document.getElementById('lista-usuarios-tabela');
        if (!tbody)
            return;

        tbody.innerHTML = '';

        if (!usuarios || usuarios.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 15px; color: #aaa;">Nenhum colaborador encontrado.</td></tr>`;
            return;
        }

        usuarios.forEach(u => {
            const cargo = u.cargo || 'GERENTE';
            const statusAtivo = u.ativo !== false;

            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid #3d3d4e;">
                    <td style="padding: 10px; color: #fff;"><strong>${u.nome}</strong></td>
                    <td style="padding: 10px;"><span style="background: #1e1e24; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; color: #a29bfe;">${cargo}</span></td>
                    <td style="padding: 10px; color: #aaa;">••••</td>
                    <td style="padding: 10px; color: ${statusAtivo ? '#2ed573' : '#ff4757'}; font-weight: bold;">${statusAtivo ? 'Ativo' : 'Inativo'}</td>
                    <td style="padding: 10px;">
                        <button onclick="alternarStatusUsuario('${u.id}', ${statusAtivo})" style="background: none; border: 1px solid #3d3d4e; color: #ddd; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">
                            ${statusAtivo ? '🚫 Desativar' : '✅ Ativar'}
                        </button>
                    </td>
                </tr>
            `;
        });

        aplicarPermissoes();
    } catch (e) {
        console.error('Exceção ao carregar lista de usuários:', e);
    }

    aplicarPermissoes();
}

// 2. Controladores do Modal
function abrirModalNovoUsuario() {
    const usuario = window.usuarioAtual;

    if (!usuario || !['GERENTE', 'ADMIN'].includes(usuario.cargo)) {
        alert('🔒 Apenas Gerente/Admin pode cadastrar colaboradores.');
        return;
    }

    document.getElementById('usr-nome').value = '';
    document.getElementById('usr-email').value = '';
    document.getElementById('usr-pin').value = '';
    document.getElementById('modal-usuario').style.display = 'flex';
}

function fecharModalNovoUsuario() {
    document.getElementById('modal-usuario').style.display = 'none';
}

// 3. Cadastra o novo usuário no Supabase
// 3. Cadastra o novo usuário no Supabase
async function salvarNovoUsuario() {
    const usuario = window.usuarioAtual;

    // Somente Gerente/Admin pode cadastrar colaboradores
    if (!usuario || !['GERENTE', 'ADMIN'].includes(usuario.cargo)) {
        alert('🔒 Apenas Gerente/Admin pode cadastrar colaboradores.');
        return;
    }

    const nomeEl = document.getElementById('usr-nome');
    const emailEl = document.getElementById('usr-email');
    const senha = document.getElementById('usr-senha')?.value || '';
    const cargoEl = document.getElementById('usr-cargo');
    const pinEl = document.getElementById('usr-pin');

    const nome = nomeEl?.value.trim() || '';
    const email = emailEl?.value.trim() || '';
    const cargo = cargoEl?.value || '';
    const pin = pinEl?.value.trim() || '';

    // Mantém a validação básica atual
    if (!nome || !pin) {
        alert('Por favor, preencha o Nome e o PIN de acesso!');
        return;
    }

    if (!email) {
        alert('⚠️ Informe o e-mail do colaborador.');
        return;
    }

    if (senha.length < 6) {
        alert('⚠️ A senha deve ter pelo menos 6 caracteres.');
        return;
    }

    // Validação adicional no cliente para evitar chamada desnecessária
    if (!/^\d{4,6}$/.test(pin)) {
        alert('⚠️ O PIN deve ter de 4 a 6 números.');
        return;
    }

    if (!['GERENTE', 'ADMIN', 'OPERADOR'].includes(cargo.toUpperCase())) {
        alert('⚠️ Selecione um cargo válido.');
        return;
    }

    const btnSalvar = document.querySelector(
            '#modal-usuario button[onclick="salvarNovoUsuario()"]'
            );

    // Feedback visual durante o cadastro
    if (btnSalvar) {
        btnSalvar.disabled = true;
        btnSalvar.dataset.textoOriginal = btnSalvar.innerHTML;
        btnSalvar.innerHTML = '⏳ Salvando...';
    }

    try {
        const {data, error} = await _supabase.functions.invoke(
                'criar-colaborador',
                {
                    body: {
                        nome,
                        email,
                        cargo,
                        senha,
                        pin
                    }
                }
        );

        if (error) {
            console.error('Erro ao cadastrar colaborador:', error);

            const msg = String(error.message || '');

            if (msg.includes('USUARIO_NAO_AUTORIZADO')) {
                alert('🔒 Apenas Gerente/Admin pode cadastrar colaboradores.');
            } else if (msg.includes('NOME_OBRIGATORIO')) {
                alert('⚠️ Informe o nome do colaborador.');
            } else if (msg.includes('PIN_INVALIDO')) {
                alert('⚠️ O PIN deve ter de 4 a 6 números.');
            } else if (msg.includes('CARGO_INVALIDO')) {
                alert('⚠️ Cargo inválido.');
            } else if (msg.includes('duplicate') || msg.includes('unique')) {
                alert('⚠️ Já existe um colaborador com esses dados.');
            } else {
                alert('❌ Erro ao cadastrar: ' + (error.message || 'Erro desconhecido.'));
            }

            return;
        }

        console.log('Colaborador criado:', data);

        alert('✅ Colaborador cadastrado com sucesso!');

        fecharModalNovoUsuario();

        // Atualiza a lista
        await carregarListaUsuarios();

    } catch (e) {
        console.error('Exceção ao cadastrar colaborador:', e);
        alert('❌ Não foi possível cadastrar o colaborador.');
    } finally {
        // Restaura o botão
        if (btnSalvar) {
            btnSalvar.disabled = false;
            btnSalvar.innerHTML =
                    btnSalvar.dataset.textoOriginal || 'Salvar';
            delete btnSalvar.dataset.textoOriginal;
        }
    }
}

// 4. Alterna entre Ativo / Inativo
async function alternarStatusUsuario(id, statusAtual) {
    const usuario = window.usuarioAtual;

    const ehGerente =
            usuario &&
            ['GERENTE', 'ADMIN'].includes(
            String(usuario.cargo || '').toUpperCase()
            );

    if (!ehGerente) {
        alert('🔒 Apenas Gerente/Admin pode alterar o status de colaboradores.');
        return;
    }

    const acao = statusAtual ? 'desativar' : 'ativar';

    if (!confirm(`Deseja realmente ${acao} este colaborador?`)) {
        return;
    }

    const {error} = await _supabase
            .from('usuarios')
            .update({
                ativo: !statusAtual
            })
            .eq('id', id);

    if (error) {
        console.error(
                'Erro ao alterar status do colaborador:',
                error
                );

        alert(
                '❌ Não foi possível alterar o status do colaborador.'
                );

        return;
    }

    alert(
            statusAtual
            ? '✅ Colaborador desativado com sucesso.'
            : '✅ Colaborador ativado com sucesso.'
            );

    await carregarListaUsuarios();
}