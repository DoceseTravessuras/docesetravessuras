// 1. Configuração do Supabase (Substitua pelas suas chaves do Supabase)
const SUPABASE_URL = 'https://pznuqeqtytyjtupxnzqk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6bnVxZXF0eXR5anR1cHhuenFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MDIyMTAsImV4cCI6MjEwMzk3ODIxMH0.ZadwdTr-pERj7mBYQGnIRpg7M4RhN9K3xNCpcG_GOqQ'; // Insira sua chave anon publica aqui

const _supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Estado Global da Aplicação
let produtosList = [];
let categoriasList = [];
let carrinho = [];
let taxaEntrega = 0.00;
let pedidoAcompanhamentoAtual = null;
let statusAcompanhamentoAtual = 'PENDENTE';

const acompanhamentosPedidos = new Map();
const canaisAcompanhamentoPedidos = new Map();

const CHAVE_TOKENS_ACOMPANHAMENTO =
        'pedidos_tokens_acompanhamento';

const CHAVE_TOKEN_ACOMPANHAMENTO_ANTIGA =
        'pedido_token_acompanhamento';

let cidadesEntregaList = [];
let cidadeEntregaSelecionada = null;

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
    await carregarCategorias();
    await carregarProdutos();
    await carregarConfiguracoesLoja();
    await carregarCidadesEntrega();
    await escutarConfiguracoesRealtime();
    await recuperarAcompanhamentoPedido();
});

function salvarAcompanhamentosPedidos() {

    const lista = Array.from(
            acompanhamentosPedidos.entries()
            ).map(([pedidoId, dados]) => ({
            pedido_id: Number(pedidoId),
            token: dados.token,
            status: dados.status
        }));

    localStorage.setItem(
            CHAVE_TOKENS_ACOMPANHAMENTO,
            JSON.stringify(lista)
            );
}

function adicionarAcompanhamentoPedido(
        pedidoId,
        token,
        status = 'PENDENTE'
        ) {

    if (!pedidoId || !token) {
        return;
    }

    acompanhamentosPedidos.set(
            Number(pedidoId),
            {
                token: token,
                status: status
            }
    );

    salvarAcompanhamentosPedidos();
}

function atualizarStatusAcompanhamentoPedido(
        pedidoId,
        status
        ) {

    const acompanhamento =
            acompanhamentosPedidos.get(
                    Number(pedidoId)
                    );

    if (!acompanhamento) {
        return;
    }

    acompanhamento.status = status;

    acompanhamentosPedidos.set(
            Number(pedidoId),
            acompanhamento
            );

    salvarAcompanhamentosPedidos();
}

// ============================================================
// RECUPERA ACOMPANHAMENTO APÓS RECARREGAR A PÁGINA
// ============================================================
async function recuperarAcompanhamentoPedido() {

    if (!_supabase) {
        return;
    }

    try {

        let listaSalva = [];

        /*
         * 1. Tenta recuperar a nova lista
         */
        const armazenamentoNovo =
                localStorage.getItem(
                        CHAVE_TOKENS_ACOMPANHAMENTO
                        );

        if (armazenamentoNovo) {

            try {

                const dados =
                        JSON.parse(armazenamentoNovo);

                if (Array.isArray(dados)) {
                    listaSalva = dados;
                }

            } catch (err) {

                console.warn(
                        '⚠️ Lista de acompanhamentos inválida.',
                        err
                        );
            }
        }

        /*
         * 2. Compatibilidade com o sistema antigo
         *
         * Se ainda existir o token antigo,
         * transforma em um acompanhamento novo.
         */
        if (listaSalva.length === 0) {

            const tokenAntigo =
                    localStorage.getItem(
                            CHAVE_TOKEN_ACOMPANHAMENTO_ANTIGA
                            );

            if (tokenAntigo) {

                console.log(
                        '🔄 Convertendo acompanhamento antigo.'
                        );

                localStorage.removeItem(
                        CHAVE_TOKEN_ACOMPANHAMENTO_ANTIGA
                        );

                localStorage.setItem(
                        CHAVE_TOKENS_ACOMPANHAMENTO,
                        JSON.stringify([])
                        );

                listaSalva = [{
                        token: tokenAntigo
                    }];
            }
        }

        /*
         * 3. Nada para recuperar
         */
        if (listaSalva.length === 0) {
            return;
        }

        /*
         * 4. Consulta cada token
         */
        for (const item of listaSalva) {

            if (!item?.token) {
                continue;
            }

            const {data, error} =
                    await _supabase.rpc(
                            'consultar_pedido_por_token',
                            {
                                p_token: item.token
                            }
                    );

            if (error) {

                console.error(
                        'Erro ao recuperar pedido:',
                        error
                        );

                continue;
            }

            if (!data || !data.pedido_id) {

                console.warn(
                        '⚠️ Token de acompanhamento inválido:',
                        item.token
                        );

                continue;
            }

            const pedidoId =
                    Number(data.pedido_id);

            const status =
                    data.status || 'PENDENTE';

            adicionarAcompanhamentoPedido(
                    pedidoId,
                    item.token,
                    status
                    );

            await iniciarAcompanhamentoPedido(
                    pedidoId,
                    item.token,
                    status
                    );
        }

    } catch (err) {

        console.error(
                'Erro inesperado ao recuperar acompanhamentos:',
                err
                );
    }
}

// Busca Categorias no Supabase
async function carregarCategorias() {
    if (!_supabase)
        return;
    const {data, error} = await _supabase
            .from('categorias')
            .select('*')
            .eq('ativo', true)
            .order('ordem');

    if (data && !error) {
        categoriasList = data;
        renderizarCategorias();
    }
}

// Busca Produtos no Supabase
// --- CARREGA APENAS PRODUTOS ATIVOS ---
async function carregarProdutos() {
    const {data, error} = await _supabase
            .from('produtos')
            .select('*')
            .eq('ativo', true) // 👈 Garante que produtos pausados não apareçam
            .order('nome');

    if (error) {
        console.error('Erro ao buscar produtos:', error.message);
        return;
    }

    produtosList = data;
    renderizarProdutos(produtosList);
}

// --- ATUALIZAÇÃO EM TEMPO REAL NO CARDÁPIO DO CLIENTE ---
function escutarProdutosRealtime() {
    _supabase
            .channel('mudancas-produtos-catalogo')
            .on('postgres_changes', {event: '*', schema: 'public', table: 'produtos'}, () => {
                // Se você pausar, alterar preço ou estoque no PDV,
                // o cardápio do cliente recarrega sozinho em tempo real!
                carregarProdutos();
            })
            .subscribe();
}

// Inicia as chamadas ao carregar a página
document.addEventListener('DOMContentLoaded', () => {
    carregarProdutos();
    escutarProdutosRealtime();
});

function renderizarCategorias() {
    const nav = document.getElementById('categories-container');
    categoriasList.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'cat-btn';
        btn.textContent = cat.nome;
        btn.onclick = (e) => filtrarCategoria(cat.id, e);
        nav.appendChild(btn);
    });
}

function renderizarProdutos(lista) {
    const grid = document.getElementById('products-container');
    grid.innerHTML = '';

    lista.forEach(p => {
        const img = p.imagem_url || 'https://via.placeholder.com/300?text=Sem+Foto';
        const semEstoque = p.estoque <= 0;

        grid.innerHTML += `
            <div class="product-card" style="${semEstoque ? 'opacity: 0.6;' : ''}">
                <img src="${img}" class="product-img" alt="${p.nome}">
                <div class="product-info">
                    <h3 class="product-title">${p.nome}</h3>
                    <p class="product-desc">${p.descricao || ''}</p>
                    <div class="product-price">R$ ${p.preco.toFixed(2).replace('.', ',')}</div>
                    
                    ${semEstoque ?
                `<button class="add-btn" disabled style="background:#888; cursor:not-allowed;">Esgotado</button>` :
                `<button class="add-btn" onclick="adicionarAoCarrinho(${p.id})">Adicionar (${p.estoque} em estoque)</button>`
                }
                </div>
            </div>
        `;
    });
}

function filtrarCategoria(catId, event) {
    const btns = document.querySelectorAll('.cat-btn');
    btns.forEach(b => b.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    }

    if (catId === 'todas') {
        renderizarProdutos(produtosList);
    } else {
        const filtrados = produtosList.filter(p => p.categoria_id === catId);
        renderizarProdutos(filtrados);
    }
}

// Gerenciamento do Carrinho
function adicionarAoCarrinho(produtoId) {
    const prod = produtosList.find(p => p.id === produtoId);
    const itemExistente = carrinho.find(i => i.id === produtoId);

    const qtdAtualNoCarrinho = itemExistente ? itemExistente.qtd : 0;

    // Validação de Limite de Estoque
    if (qtdAtualNoCarrinho + 1 > prod.estoque) {
        alert(`Ops! Só temos ${prod.estoque} unidades de "${prod.nome}" em estoque.`);
        return;
    }

    if (itemExistente) {
        itemExistente.qtd++;
    } else {
        carrinho.push({...prod, qtd: 1});
    }
    atualizarCarrinho();
}

function alterarQtd(produtoId, delta) {
    const item = carrinho.find(i => i.id === produtoId);
    const prod = produtosList.find(p => p.id === produtoId);
    if (!item)
        return;

    // Validação de estoque ao aumentar a quantidade dentro do carrinho
    if (delta > 0 && item.qtd + delta > prod.estoque) {
        alert(`Ops! Só temos ${prod.estoque} unidades de "${prod.nome}" em estoque.`);
        return;
    }

    item.qtd += delta;
    if (item.qtd <= 0) {
        carrinho = carrinho.filter(i => i.id !== produtoId);
    }
    atualizarCarrinho();
}

function atualizarCarrinho() {
    const totalItens = carrinho.reduce((sum, item) => sum + item.qtd, 0);
    document.getElementById('cart-count').textContent = totalItens;

    const container = document.getElementById('cart-items');
    const summary = document.getElementById('cart-summary');

    if (carrinho.length === 0) {
        container.innerHTML = '<p class="empty-cart">Seu carrinho está vazio.</p>';
        summary.style.display = 'none';
        return;
    }

    summary.style.display = 'block';
    container.innerHTML = '';

    let subtotal = 0;
    carrinho.forEach(item => {
        const itemSubtotal = item.preco * item.qtd;
        subtotal += itemSubtotal;

        container.innerHTML += `
            <div class="cart-item">
                <div>
                    <strong>${item.nome}</strong><br>
                    <small>R$ ${item.preco.toFixed(2).replace('.', ',')}</small>
                </div>
                <div class="cart-item-qty">
                    <button class="qty-btn" onclick="alterarQtd(${item.id}, -1)">-</button>
                    <span>${item.qtd}</span>
                    <button class="qty-btn" onclick="alterarQtd(${item.id}, 1)">+</button>
                </div>
            </div>
        `;
    });

    const tipoPedido = document.getElementById('tipo_pedido').value;
    const frete = tipoPedido === 'DELIVERY' ? taxaEntrega : 0;
    const total = subtotal + frete;

    document.getElementById('subtotal-val').textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
    document.getElementById('taxa-val').textContent = `R$ ${frete.toFixed(2).replace('.', ',')}`;
    document.getElementById('total-val').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
}

function toggleCarrinho() {
    const modal = document.getElementById('cart-modal');
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
}

function atualizarTaxa() {
    atualizarCarrinho();
    const tipo = document.getElementById('tipo_pedido').value;
    const endSection = document.getElementById('endereco-section');
    const inputs = endSection.querySelectorAll('input, select');

    if (tipo === 'RETIRADA') {
        endSection.style.display = 'none';
        inputs.forEach(i => i.removeAttribute('required'));
    } else {
        endSection.style.display = 'block';
        inputs.forEach(i => i.setAttribute('required', 'true'));
        document.getElementById('cli_complemento').removeAttribute('required');
        document.getElementById('cli_referencia').removeAttribute('required');
    }
}

function toggleTroco() {
    const forma = document.getElementById('forma_pagamento').value;
    const trocoGroup = document.getElementById('troco-group');
    trocoGroup.style.display = forma === 'DINHEIRO' ? 'block' : 'none';
}

// ============================================================
// PAINEL VISUAL DE ACOMPANHAMENTO
// ============================================================
function atualizarAcompanhamentoVisual(pedidoId, status) {

    if (!pedidoId) {
        return;
    }

    const idPedido = Number(pedidoId);

    // ------------------------------------------------------------
    // Container geral dos acompanhamentos
    // ------------------------------------------------------------
    let container =
            document.getElementById(
                    'painel-acompanhamento-pedidos'
                    );

    if (!container) {

        container = document.createElement('div');

        container.id =
                'painel-acompanhamento-pedidos';

        const destino =
                document.querySelector('main') ||
                document.body;

        destino.appendChild(container);
    }

    // ------------------------------------------------------------
    // Card específico deste pedido
    // ------------------------------------------------------------
    const idCard =
            `acompanhamento-pedido-${idPedido}`;

    let card =
            document.getElementById(idCard);

    if (!card) {

        card = document.createElement('div');

        card.id = idCard;

        card.className =
                'painel-acompanhamento-pedido';

        container.appendChild(card);
    }

    // ------------------------------------------------------------
    // Etapas
    // ------------------------------------------------------------
    const etapas = [
        {
            status: 'PENDENTE',
            icone: '✅',
            texto: 'Pedido recebido'
        },
        {
            status: 'PREPARANDO',
            icone: '👨‍🍳',
            texto: 'Em preparo'
        },
        {
            status: 'A_CAMINHO',
            icone: '🛵',
            texto: 'Saiu para entrega'
        },
        {
            status: 'CONCLUIDO',
            icone: '✅',
            texto: 'Concluído'
        }
    ];

    const indiceAtual =
            etapas.findIndex(
                    etapa =>
                etapa.status === status
            );

    const statusTexto = {
        PENDENTE:
                'Pedido recebido!',

        PREPARANDO:
                'Seu pedido está sendo preparado.',

        A_CAMINHO:
                'Seu pedido saiu para entrega.',

        CONCLUIDO:
                'Seu pedido foi concluído. Obrigado!',

        CANCELADO:
                'Seu pedido foi cancelado.'
    };

    // ------------------------------------------------------------
    // CANCELADO
    // ------------------------------------------------------------
    if (status === 'CANCELADO') {

        card.innerHTML = `
            <div class="acomp-titulo">
                ❌ Pedido #${idPedido}
            </div>

            <div class="acomp-subtitulo">
                Acompanhamento do pedido
            </div>

            <div class="acomp-status-atual cancelado">
                ❌ ${statusTexto.CANCELADO}
            </div>
        `;

        return;
    }

    // ------------------------------------------------------------
    // Status desconhecido
    // ------------------------------------------------------------
    if (indiceAtual < 0) {

        card.innerHTML = `
            <div class="acomp-titulo">
                Pedido #${idPedido}
            </div>

            <div class="acomp-subtitulo">
                Acompanhamento do pedido
            </div>

            <div class="acomp-status-atual">
                Atualizando pedido...
            </div>
        `;

        return;
    }

    // ------------------------------------------------------------
    // Monta o cartão deste pedido
    // ------------------------------------------------------------
    card.innerHTML = `
        <div class="acomp-titulo">
            Pedido #${idPedido}
        </div>

        <div class="acomp-subtitulo">
            Acompanhe seu pedido em tempo real
        </div>

        <div class="acomp-progresso">

            ${etapas.map((etapa, index) => {

        const concluida =
                index < indiceAtual;

        const atual =
                index === indiceAtual;

        return `
                    <div class="
                        acomp-etapa
                        ${concluida ? 'concluida' : ''}
                        ${atual ? 'atual' : ''}
                    ">

                        <div class="acomp-circulo">
                            ${etapa.icone}
                        </div>

                        <div class="acomp-texto">
                            ${etapa.texto}
                        </div>

                        ${
                index < etapas.length - 1
                ? '<div class="acomp-linha"></div>'
                : ''
                }

                    </div>
                `;

    }).join('')}

        </div>

        <div class="acomp-status-atual">
            ${statusTexto[status] || 'Atualizando pedido...'}
        </div>
    `;
}

// ============================================================
// ACOMPANHAMENTO DO PEDIDO EM TEMPO REAL
// ============================================================
async function iniciarAcompanhamentoPedido(pedidoId, token, statusInicial = 'PENDENTE') {

    if (!_supabase) {
        console.error('Supabase não configurado.');
        return;
    }

    if (!pedidoId || !token) {
        console.error(
                'Dados inválidos para acompanhamento do pedido:',
                {pedidoId, token}
        );
        return;
    }

    const idPedido = Number(pedidoId);

    // Remove somente o canal deste pedido, se já existir
    const canalExistente =
            canaisAcompanhamentoPedidos.get(idPedido);

    if (canalExistente) {
        try {
            await _supabase.removeChannel(canalExistente);
        } catch (err) {
            console.warn(
                    `Não foi possível remover o canal do pedido #${idPedido}:`,
                    err
                    );
        }

        canaisAcompanhamentoPedidos.delete(idPedido);
    }

    // Garante o estado local
    adicionarAcompanhamentoPedido(
            idPedido,
            token,
            statusInicial || 'PENDENTE'
            );

    // Mostra o estado inicial imediatamente
    atualizarAcompanhamentoVisual(
            idPedido,
            statusInicial || 'PENDENTE'
            );

    const topico = `pedido-${token}`;

    console.log(
            '📡 Iniciando acompanhamento do pedido:',
            idPedido,
            topico
            );

    const canal =
            _supabase
            .channel(topico)
            .on(
                    'broadcast',
                    {
                        event: 'status_pedido_atualizado'
                    },
                    (payload) => {

                console.log(
                        '📩 Atualização recebida do pedido:',
                        payload
                        );

                const dados =
                        payload?.payload || {};

                if (
                        dados.pedido_id &&
                        Number(dados.pedido_id) !== idPedido
                        ) {
                    console.warn(
                            'Atualização recebida para outro pedido:',
                            dados
                            );
                    return;
                }

                const novoStatus =
                        dados.status;

                if (!novoStatus) {
                    console.warn(
                            'Broadcast sem status:',
                            payload
                            );
                    return;
                }

                atualizarStatusAcompanhamentoPedido(
                        idPedido,
                        novoStatus
                        );

                console.log(
                        `🔄 Pedido #${idPedido} mudou para: ${novoStatus}`
                        );

                atualizarAcompanhamentoVisual(
                        idPedido,
                        novoStatus
                        );
            }
            )
            .subscribe((status, err) => {

                if (status === 'SUBSCRIBED') {
                    console.log(
                            `🟢 Acompanhamento ativo para o pedido #${idPedido}`
                            );
                    return;
                }

                if (
                        status === 'CHANNEL_ERROR' ||
                        status === 'TIMED_OUT'
                        ) {
                    console.error(
                            `❌ Erro no canal do pedido #${idPedido}:`,
                            status,
                            err
                            );
                }
            });

    canaisAcompanhamentoPedidos.set(
            idPedido,
            canal
            );
}

// ============================================================
// FINALIZAÇÃO DO PEDIDO ONLINE
// ============================================================
// Envio do Pedido ao Supabase
async function finalizarPedido(event) {

    // Impede o submit tradicional do formulário
    if (event) {
        event.preventDefault();
    }

    // ------------------------------------------------------------
    // 1. Verifica conexão com Supabase
    // ------------------------------------------------------------
    if (!_supabase) {
        alert('❌ Configure o Supabase no app.js!');
        return;
    }

    // ------------------------------------------------------------
    // 2. Verifica se a loja está aberta
    // ------------------------------------------------------------
    if (!configLoja.loja_aberta) {
        alert('⛔ A loja está FECHADA no momento. Não é possível enviar o pedido.');
        return;
    }

    // ------------------------------------------------------------
    // 3. Carrinho não pode estar vazio
    // ------------------------------------------------------------
    if (!Array.isArray(carrinho) || carrinho.length === 0) {
        alert('Seu carrinho está vazio!');
        return;
    }

    // ------------------------------------------------------------
    // 4. Tipo do pedido
    // ------------------------------------------------------------
    const tipo = document.getElementById('tipo_pedido')?.value;

    if (!['DELIVERY', 'RETIRADA'].includes(tipo)) {
        alert('⚠️ Selecione o tipo de pedido.');
        return;
    }

    // ------------------------------------------------------------
    // 5. Dados do cliente
    // ------------------------------------------------------------
    const nome = document.getElementById('cli_nome')?.value.trim() || '';
    const telefoneFormatado = document.getElementById('cli_telefone')?.value.trim() || '';
    // Remove máscara antes de enviar ao banco
    const telefone = telefoneFormatado.replace(/\D/g, '');

    if (!nome) {
        alert('⚠️ Informe o nome do cliente.');
        document.getElementById('cli_nome')?.focus();
        return;
    }

    if (!/^\d{10,11}$/.test(telefone)) {
        alert('⚠️ Informe um telefone válido com DDD.');
        document.getElementById('cli_telefone')?.focus();
        return;
    }

    // ------------------------------------------------------------
    // 6. Validação dos dados de DELIVERY
    // ------------------------------------------------------------
    const rua =
            document.getElementById('cli_rua')?.value.trim() || '';

    const numero =
            document.getElementById('cli_numero')?.value.trim() || '';

    const bairro =
            document.getElementById('cli_bairro')?.value.trim() || '';

    const complemento =
            document.getElementById('cli_complemento')?.value.trim() || '';

    const referencia =
            document.getElementById('cli_referencia')?.value.trim() || '';

    let cidadeId = null;

    if (tipo === 'DELIVERY') {

        if (!rua) {
            alert('⚠️ Informe a rua.');
            document.getElementById('cli_rua')?.focus();
            return;
        }

        if (!numero) {
            alert('⚠️ Informe o número.');
            document.getElementById('cli_numero')?.focus();
            return;
        }

        if (!bairro) {
            alert('⚠️ Informe o bairro.');
            document.getElementById('cli_bairro')?.focus();
            return;
        }

        // Compatível caso cidadeEntregaSelecionada seja:
        // - um ID
        // - um objeto { id, nome, ... }
        if (typeof cidadeEntregaSelecionada !== 'undefined') {

            if (
                    cidadeEntregaSelecionada !== null &&
                    typeof cidadeEntregaSelecionada === 'object'
                    ) {
                cidadeId = cidadeEntregaSelecionada.id;
            } else {
                cidadeId = cidadeEntregaSelecionada;
            }
        }

        if (
                cidadeId === null ||
                cidadeId === undefined ||
                cidadeId === ''
                ) {
            alert('⚠️ Selecione a cidade de entrega.');
            return;
        }

        cidadeId = Number(cidadeId);

        if (!Number.isInteger(cidadeId) || cidadeId <= 0) {
            alert('⚠️ Cidade de entrega inválida.');
            return;
        }
    }

    // ------------------------------------------------------------
    // 7. Forma de pagamento
    // ------------------------------------------------------------
    const formaPagamento =
            document.getElementById('forma_pagamento')?.value || '';

    if (
            ![
                'PIX',
                'DINHEIRO',
                'CARTAO_DEBITO',
                'CARTAO_CREDITO'
            ].includes(formaPagamento)
            ) {
        alert('⚠️ Selecione uma forma de pagamento válida.');
        document.getElementById('forma_pagamento')?.focus();
        return;
    }

    // ------------------------------------------------------------
    // 8. Troco
    // ------------------------------------------------------------
    const trocoInput =
            document.getElementById('troco_para')?.value.trim() || '';

    let trocoPara = null;

    if (formaPagamento === 'DINHEIRO' && trocoInput !== '') {

        const trocoNormalizado = trocoInput.replace(',', '.');
        const valorTroco = Number(trocoNormalizado);

        if (!Number.isFinite(valorTroco) || valorTroco < 0) {
            alert('⚠️ Informe um valor de troco válido.');
            document.getElementById('troco_para')?.focus();
            return;
        }

        trocoPara = valorTroco;
    }

    // ------------------------------------------------------------
    // 9. Observação
    // ------------------------------------------------------------
    const observacao =
            document.getElementById('observacao')?.value.trim() || null;

    const notificarWhatsApp =
            document.getElementById('notificar_whatsapp')?.checked === true;

    // ------------------------------------------------------------
    // 10. Validação local de estoque
    //
    // Essa validação serve para melhorar a experiência.
    // A validação REAL acontece dentro da RPC no banco.
    // ------------------------------------------------------------
    for (const item of carrinho) {

        const produto =
                produtosList.find(p => p.id === item.id);
        const estoqueDisponivel =
                produto ? Number(produto.estoque || 0) : 0;

        const quantidade =
                Number(item.qtd);

        if (
                !produto ||
                !Number.isInteger(quantidade) ||
                quantidade <= 0
                ) {
            alert(
                    `⚠️ O produto "${item.nome}" não está disponível.`
                    );
            return;
        }

        if (quantidade > estoqueDisponivel) {
            alert(
                    `⚠️ Não há estoque suficiente para "${item.nome}". ` +
                    `Estoque disponível: ${estoqueDisponivel}.`
                    );

            // Atualiza a lista para refletir o estoque real
            await carregarProdutos();

            return;
        }
    }

    // ------------------------------------------------------------
    // 11. Validação visual do pedido mínimo
    //
    // Novamente: a validação oficial é feita pela RPC.
    // ------------------------------------------------------------
    const subtotalCarrinho =
            carrinho.reduce(
                    (acc, item) =>
                acc + (Number(item.preco) * Number(item.qtd)),
                    0
                    );

    const valorMinimo =
            Number(configLoja.valor_minimo_pedido || 0);

    if (subtotalCarrinho < valorMinimo) {

        alert(
                `O valor mínimo para pedidos é de ` +
                `R$ ${valorMinimo.toFixed(2).replace('.', ',')}. ` +
                `Seu subtotal atual é de ` +
                `R$ ${subtotalCarrinho.toFixed(2).replace('.', ',')}.`
                );

        return;
    }

    // ------------------------------------------------------------
    // 12. Botão
    // ------------------------------------------------------------
    const btn = document.getElementById('btn-submit');

    const textoOriginal =
            btn ? btn.textContent : 'Enviar Pedido';

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Enviando...';
    }

    // ------------------------------------------------------------
    // 13. Monta somente os dados necessários para a RPC
    //
    // IMPORTANTE:
    // Não enviamos:
    // - preço
    // - subtotal
    // - taxa de entrega
    // - total
    // - estoque
    //
    // O banco calcula tudo isso.
    // ------------------------------------------------------------
    const itensRPC = carrinho.map(item => ({
            produto_id: Number(item.id),
            quantidade: Number(item.qtd)
        }));

    try {

        // --------------------------------------------------------
        // 14. Chama UMA ÚNICA RPC
        // --------------------------------------------------------
        const {data, error} =
                await _supabase.rpc(
                        'registrar_pedido_online_v2',
                        {
                            p_nome_cliente: nome,
                            p_telefone: telefone,
                            p_tipo: tipo,
                            p_cidade_id: cidadeId,
                            p_rua: tipo === 'DELIVERY' ? rua : null,
                            p_numero: tipo === 'DELIVERY' ? numero : null,
                            p_bairro: tipo === 'DELIVERY' ? bairro : null,
                            p_complemento:
                                    tipo === 'DELIVERY'
                                    ? complemento || null
                                    : null,
                            p_ponto_referencia:
                                    tipo === 'DELIVERY'
                                    ? referencia || null
                                    : null,
                            p_forma_pagamento: formaPagamento,
                            p_troco_para: trocoPara,
                            p_observacao: observacao,
                            p_itens: itensRPC,
                            p_notificar_whatsapp: notificarWhatsApp
                        }
                );

        // --------------------------------------------------------
        // 15. Trata erro retornado pelo banco
        // --------------------------------------------------------
        if (error) {
            throw error;
        }

        if (!data || !data.pedido_id) {
            throw new Error(
                    'O banco não retornou o número do pedido.'
                    );
        }

        // --------------------------------------------------------
        // 16. O banco é a fonte oficial dos valores
        // --------------------------------------------------------
        const pedidoId = data.pedido_id;

        const tokenAcompanhamento = data.token_acompanhamento;

        if (!tokenAcompanhamento) {
            throw new Error(
                    'O banco não retornou o token de acompanhamento do pedido.'
                    );
        }

        adicionarAcompanhamentoPedido(
                pedidoId,
                tokenAcompanhamento,
                data.status || 'PENDENTE'
                );

        await iniciarAcompanhamentoPedido(
                pedidoId,
                tokenAcompanhamento
                );

        const valorProdutos =
                Number(data.valor_produtos || 0);

        const taxaEntregaBanco =
                Number(data.taxa_entrega || 0);

        const valorTotalBanco =
                Number(data.valor_total || 0);

        const cidadeBanco =
                data.cidade || '';

        // Inicia o acompanhamento em tempo real
        await iniciarAcompanhamentoPedido(
                pedidoId,
                tokenAcompanhamento
                );

        // --------------------------------------------------------
        // 17. Atualiza os produtos na tela
        //
        // O estoque já foi alterado pelo trigger no banco.
        // Não fazemos UPDATE de estoque aqui.
        // --------------------------------------------------------
        await carregarProdutos();

        // --------------------------------------------------------
        // 18. Limpa o carrinho
        // --------------------------------------------------------
        carrinho = [];

        atualizarCarrinho();

        // --------------------------------------------------------
        // 19. Fecha o carrinho/modal
        // --------------------------------------------------------
        toggleCarrinho();

        // --------------------------------------------------------
        // 20. Confirmação para o cliente
        // --------------------------------------------------------
        let mensagem =
                `🎉 Pedido #${pedidoId} realizado com sucesso!\n\n` +
                `Subtotal: R$ ${valorProdutos.toFixed(2).replace('.', ',')}\n`;

        if (taxaEntregaBanco > 0) {
            mensagem +=
                    `Taxa de entrega: R$ ` +
                    `${taxaEntregaBanco.toFixed(2).replace('.', ',')}\n`;
        }

        mensagem +=
                `Total: R$ ${valorTotalBanco.toFixed(2).replace('.', ',')}`;

        if (tipo === 'DELIVERY' && cidadeBanco) {
            mensagem += `\nCidade: ${cidadeBanco}`;
        }

        alert(mensagem);

    } catch (err) {

        console.error(
                'Erro ao registrar pedido online:',
                err
                );

        let mensagemErro =
                err?.message ||
                'Não foi possível registrar o pedido.';

        // Mensagens amigáveis para erros da RPC
        if (mensagemErro.includes('LOJA_FECHADA')) {
            mensagemErro =
                    'A loja acabou de ser fechada e não está aceitando novos pedidos.';
        } else if (mensagemErro.includes('ESTOQUE_INSUFICIENTE')) {
            mensagemErro =
                    'Um dos produtos ficou sem estoque suficiente. O pedido não foi criado.';
            await carregarProdutos();
        } else if (mensagemErro.includes('PRODUTO_INATIVO')) {
            mensagemErro =
                    'Um dos produtos foi pausado. Atualizamos o cardápio.';
            await carregarProdutos();
        } else if (mensagemErro.includes('CIDADE_NAO_DISPONIVEL')) {
            mensagemErro =
                    'A cidade selecionada não está mais disponível para entrega.';
        } else if (mensagemErro.includes('PEDIDO_ABAIXO_DO_MINIMO')) {
            mensagemErro =
                    'O valor do pedido está abaixo do mínimo permitido.';
        } else if (mensagemErro.includes('TELEFONE_INVALIDO')) {
            mensagemErro =
                    'Informe um telefone válido com DDD.';
        } else if (mensagemErro.includes('FORMA_PAGAMENTO_INVALIDA')) {
            mensagemErro =
                    'A forma de pagamento selecionada não é válida.';
        }

        alert('❌ Erro ao enviar pedido:\n\n' + mensagemErro);

    } finally {

        // --------------------------------------------------------
        // 21. Reabilita botão
        // --------------------------------------------------------
        if (btn) {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    }
}

let configLoja = {
    loja_aberta: true,
    valor_minimo_pedido: 0,
    whatsapp_notificacoes_ativas: false
};

// --- CARREGA E ESCUTA CONFIGURAÇÕES DA LOJA ---
async function carregarConfiguracoesLoja() {
    const {data, error} = await _supabase
            .from('configuracoes')
            .select(`
            nome_loja,
            loja_aberta,
            valor_minimo_pedido,
            whatsapp_notificacoes_ativas
        `)
            .limit(1)
            .single();

    if (error) {
        console.error('Erro ao buscar configurações:', error.message);
        return;
    }

    configLoja = data;
    atualizarBannerStatus();
    atualizarOpcaoWhatsApp();
}

function escutarConfiguracoesRealtime() {
    const canal = _supabase
            .channel('loja-configuracoes')
            .on(
                    'broadcast',
                    {
                        event: 'configuracoes_atualizadas'
                    },
                    (payload) => {
                console.log('🔄 CONFIGURAÇÃO RECEBIDA EM TEMPO REAL:', payload);

                const dados = payload?.payload || payload;

                if (!dados || typeof dados.loja_aberta === 'undefined') {
                    console.warn('⚠️ Payload de configuração inválido:', payload);
                    return;
                }

                configLoja = {
                    nome_loja: dados.nome_loja,
                    loja_aberta: dados.loja_aberta,
                    taxa_entrega_padrao: Number(dados.taxa_entrega_padrao || 0),
                    valor_minimo_pedido: Number(dados.valor_minimo_pedido || 0)
                };

                atualizarBannerStatus();
            }
            )
            .subscribe((status, error) => {
                console.log('📡 Broadcast configurações:', status);

                if (error) {
                    console.error('❌ Erro Broadcast configurações:', error);
                }
            });

    return canal;
}

function atualizarBannerStatus() {
    const banner = document.getElementById('store-status-banner');
    if (!banner)
        return;

    banner.style.display = 'block';

    if (!configLoja.loja_aberta) {
        banner.className = 'status-banner fechada';
        banner.innerHTML = '🔴 <strong>LOJA FECHADA NO MOMENTO</strong><br>Estamos fora do horário de atendimento. Não estamos aceitando novos pedidos.';
    } else {
        banner.className = 'status-banner aberta';
        let texto = '🟢 <strong>LOJA ABERTA</strong>';
        // if (configLoja.valor_minimo_pedido > 0) {
        //     texto += ` | Pedido mínimo: R$ ${configLoja.valor_minimo_pedido.toFixed(2).replace('.', ',')}`;
        // }
        banner.innerHTML = texto;
    }
}

async function carregarCidadesEntrega() {
    if (!_supabase)
        return;

    const selectCidade = document.getElementById('cli_cidade');

    if (!selectCidade)
        return;

    const {data, error} = await _supabase
            .from('cidades_entrega')
            .select('id, nome, uf, taxa_entrega')
            .eq('ativa', true)
            .order('nome');

    if (error) {
        console.error('Erro ao carregar cidades de entrega:', error.message);
        selectCidade.innerHTML = '<option value="">Não foi possível carregar as cidades</option>';
        return;
    }

    cidadesEntregaList = data || [];

    selectCidade.innerHTML = '<option value="">Selecione sua cidade</option>';

    cidadesEntregaList.forEach(cidade => {
        const option = document.createElement('option');

        option.value = cidade.id;
        option.textContent = `${cidade.nome} - ${cidade.uf}`;

        selectCidade.appendChild(option);
    });

    taxaEntrega = 0;
    cidadeEntregaSelecionada = null;

    atualizarCarrinho();
}

function selecionarCidadeEntrega() {
    const selectCidade = document.getElementById('cli_cidade');

    if (!selectCidade)
        return;

    const cidadeId = Number(selectCidade.value);

    const cidade = cidadesEntregaList.find(c => Number(c.id) === cidadeId);

    if (!cidade) {
        cidadeEntregaSelecionada = null;
        taxaEntrega = 0;
        atualizarCarrinho();
        return;
    }

    cidadeEntregaSelecionada = cidade;
    taxaEntrega = Number(cidade.taxa_entrega || 0);

    atualizarCarrinho();
}

function formatarTelefone(input) {
    // Remove tudo que não for número
    let numero = input.value.replace(/\D/g, '');

    // Limita a 11 dígitos
    numero = numero.substring(0, 11);

    if (numero.length === 0) {
        input.value = '';
        return;
    }

    if (numero.length <= 2) {
        input.value = `(${numero}`;
        return;
    }

    const ddd = numero.substring(0, 2);
    const corpo = numero.substring(2);

    // Telefone com 10 dígitos: (18) 3333-4444
    if (numero.length <= 10) {
        if (corpo.length <= 4) {
            input.value = `(${ddd}) ${corpo}`;
        } else {
            input.value =
                    `(${ddd}) ${corpo.substring(0, 4)}-${corpo.substring(4)}`;
        }

        return;
    }

    // Celular com 11 dígitos: (18) 99999-9999
    input.value =
            `(${ddd}) ${corpo.substring(0, 5)}-${corpo.substring(5)}`;
}

function atualizarOpcaoWhatsApp() {

    const grupo =
            document.getElementById(
                    'whatsapp-notificacao-group'
                    );

    const checkbox =
            document.getElementById(
                    'notificar_whatsapp'
                    );

    if (!grupo || !checkbox) {
        return;
    }

    const ativo =
            configLoja.whatsapp_notificacoes_ativas === true;

    grupo.style.display =
            ativo ? 'block' : 'none';

    if (!ativo) {
        checkbox.checked = false;
    }
}

/* ---------- SOMENTE NÚMEROS ---------- */
function somenteNumerosClienteInput(input) {

    input.value =
            String(input.value || '')
            .replace(/\D/g, '')
            .slice(0, 10);
}