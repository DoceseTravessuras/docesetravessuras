// 1. Configuração do Supabase (Substitua pelas suas chaves do Supabase)
const { url, anonKey } = window.SUPABASE_CONFIG || {};

if (!url || !anonKey) {
    throw new Error(
        'Configuração do Supabase não encontrada ou incompleta.'
    );
}

const _supabase = window.supabase.createClient(url, anonKey);

// QR Code do Salão: catálogo somente para consulta, sem envio de pedido público.
const PARAMS_CARDAPIO = new URLSearchParams(window.location.search);
const MODO_CONSULTA_SALAO = PARAMS_CARDAPIO.get('salao_consulta') === '1';
const MESA_CONSULTA_SALAO = PARAMS_CARDAPIO.get('mesa') || '';

function prepararModoConsultaSalao() {
    if (!MODO_CONSULTA_SALAO || !document.body)
        return;
    document.body.classList.add('modo-consulta-salao');
    document.title = MESA_CONSULTA_SALAO ? `Cardápio — Mesa ${MESA_CONSULTA_SALAO}` : 'Cardápio — Consulta';
    const header = document.querySelector('header.header') || document.querySelector('header');
    const aviso = document.createElement('div');
    aviso.style.cssText = 'max-width:1180px;margin:12px auto;padding:12px 16px;border:1px solid #d6d3d1;border-radius:10px;background:#fffaf7;color:#5b4646;font:600 14px/1.5 Arial,sans-serif;';
    aviso.textContent = MESA_CONSULTA_SALAO
            ? `Cardápio para consulta — Mesa ${MESA_CONSULTA_SALAO}. Para fazer o pedido, chame o garçom.`
            : 'Cardápio em modo de consulta. Para fazer o pedido, chame a equipe.';
    if (header && header.parentNode)
        header.insertAdjacentElement('afterend', aviso);
    const estilo = document.createElement('style');
    estilo.textContent = '.modo-consulta-salao .cart-btn,.modo-consulta-salao .add-btn,.modo-consulta-salao #cart-modal,.modo-consulta-salao [aria-label="Modalidade de compra"]{display:none!important}body.modo-consulta-salao{padding-bottom:12px}.modo-consulta-salao .product-card{cursor:default}';
    document.head.appendChild(estilo);
    const carrinho = document.getElementById('cart-modal');
    if (carrinho) {
        carrinho.style.display = 'none';
        carrinho.setAttribute('aria-hidden', 'true');
    }
}


// Estado Global da Aplicação
let produtosList = [];
let categoriasList = [];
let carrinho = []; // carrinho exclusivo de pronta entrega
let carrinhoEncomenda = []; // carrinho separado para data futura
let modoCardapioAtual = 'PRONTA_ENTREGA';
let categoriaAtualFiltro = 'todas';
let chaveIdempotenciaEncomenda = null;
let taxaEntrega = 0.00;

const CHAVE_TOKENS_ENCOMENDAS = 'encomendas_tokens_acompanhamento';
let acompanhamentosEncomendasCliente = [];
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
    prepararModoConsultaSalao();
    await carregarCategorias();
    await carregarProdutos();
    selecionarModoCardapio('PRONTA_ENTREGA');
    await carregarConfiguracoesLoja();
    await carregarCidadesEntrega();
    await escutarConfiguracoesRealtime();

    // Atualiza a disponibilidade de encomendas quando o cliente volta ao catálogo
    // e periodicamente, mesmo que não receba um evento em tempo real.
    const atualizarConfigAoRetornar = () => {
        if (!document.hidden)
            carregarConfiguracoesLoja();
    };
    window.addEventListener('focus', atualizarConfigAoRetornar);
    document.addEventListener('visibilitychange', atualizarConfigAoRetornar);
    window.setInterval(() => {
        if (!document.hidden)
            carregarConfiguracoesLoja();
    }, 30000);

    await recuperarAcompanhamentoPedido();
    await recuperarAcompanhamentoEncomendas();

    const formularioCheckout = document.getElementById('checkout-form');
    if (formularioCheckout) {
        ['input', 'change'].forEach(evento => formularioCheckout.addEventListener(evento, () => {
                const botaoEnvio = document.getElementById('btn-submit');
                if (!botaoEnvio?.disabled)
                    chaveIdempotenciaEncomenda = null;
            }));
    }

    // Atualiza o acompanhamento quando o cliente mantém o cardápio aberto.
    if (!MODO_CONSULTA_SALAO) {
        window.setInterval(() => atualizarAcompanhamentosEncomendas(), 45000);
    }
});

function salvarAcompanhamentosPedidos() {

    const lista = Array.from(
            acompanhamentosPedidos.entries()
            ).map(([pedidoId, dados]) => ({
            pedido_id: Number(pedidoId),
            token: dados.token,
            status: dados.status,
            motivo_cancelamento: dados.motivo_cancelamento || null
        }));

    localStorage.setItem(
            CHAVE_TOKENS_ACOMPANHAMENTO,
            JSON.stringify(lista)
            );
}

function adicionarAcompanhamentoPedido(
        pedidoId,
        token,
        status = 'PENDENTE',
        motivoCancelamento = null
        ) {

    if (!pedidoId || !token) {
        return;
    }

    const dadosAnteriores = acompanhamentosPedidos.get(Number(pedidoId)) || {};

    acompanhamentosPedidos.set(
            Number(pedidoId),
            {
                token: token,
                status: status,
                motivo_cancelamento: motivoCancelamento || dadosAnteriores.motivo_cancelamento || null
            }
    );

    salvarAcompanhamentosPedidos();
}

function atualizarStatusAcompanhamentoPedido(
        pedidoId,
        status,
        motivoCancelamento = null
        ) {

    const acompanhamento =
            acompanhamentosPedidos.get(
                    Number(pedidoId)
                    );

    if (!acompanhamento) {
        return;
    }

    acompanhamento.status = status;
    if (motivoCancelamento) {
        acompanhamento.motivo_cancelamento = motivoCancelamento;
    }

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
                    status,
                    item.motivo_cancelamento || data.motivo_cancelamento || null
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

    produtosList = data || [];
    renderizarCatalogo();
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
    if (!nav)
        return;
    nav.innerHTML = '';

    const btnTodas = document.createElement('button');
    btnTodas.type = 'button';
    btnTodas.className = 'cat-btn active';
    btnTodas.textContent = 'Todas';
    btnTodas.onclick = (event) => filtrarCategoria('todas', event);
    nav.appendChild(btnTodas);

    categoriasList.forEach(cat => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cat-btn';
        btn.textContent = cat.nome;
        btn.onclick = (event) => filtrarCategoria(cat.id, event);
        nav.appendChild(btn);
    });
}

function selecionarModoCardapio(modo) {
    if (MODO_CONSULTA_SALAO)
        return;
    if (modo === 'ENCOMENDA' && configLoja.encomendas_ativas === false) {
        alert('A loja não está aceitando encomendas no momento.');
        return;
    }
    modoCardapioAtual = modo === 'ENCOMENDA' ? 'ENCOMENDA' : 'PRONTA_ENTREGA';

    const btnPronta = document.getElementById('btn-modo-pronta-entrega');
    const btnEncomenda = document.getElementById('btn-modo-encomenda');
    const aviso = document.getElementById('aviso-modo-cardapio');

    if (btnPronta) {
        const ativo = modoCardapioAtual === 'PRONTA_ENTREGA';
        btnPronta.setAttribute('aria-pressed', String(ativo));
        btnPronta.style.background = ativo ? '#176b45' : '#fff';
        btnPronta.style.color = ativo ? '#fff' : '#4a3e3d';
        btnPronta.style.borderColor = ativo ? '#176b45' : '#ead7e0';
    }
    if (btnEncomenda) {
        const ativo = modoCardapioAtual === 'ENCOMENDA';
        btnEncomenda.setAttribute('aria-pressed', String(ativo));
        btnEncomenda.style.background = ativo ? '#176b45' : '#fff';
        btnEncomenda.style.color = ativo ? '#fff' : '#4a3e3d';
        btnEncomenda.style.borderColor = ativo ? '#176b45' : '#ead7e0';
    }

    if (aviso) {
        aviso.textContent = modoCardapioAtual === 'ENCOMENDA'
                ? 'Escolha produtos que aceitam encomenda. A data e o horário serão solicitados no carrinho; a loja precisa confirmar antes da encomenda ficar aceita.'
                : 'Os produtos são exibidos conforme o estoque disponível. Produtos esgotados não podem ser adicionados.';
    }

    renderizarCatalogo();
    atualizarCarrinho();
}

function renderizarCatalogo() {
    let lista = [...produtosList];

    if (modoCardapioAtual === 'ENCOMENDA') {
        // Encomenda independe da disponibilidade para pronta entrega.
        lista = lista.filter(p => p.aceita_encomenda === true);
    } else {
        // Se a opção estiver desmarcada, o produto não aparece nesta aba.
        // `!== false` mantém compatibilidade com produtos legados até a migração.
        lista = lista.filter(p => p.disponivel_pronta_entrega !== false);
    }

    if (categoriaAtualFiltro !== 'todas') {
        lista = lista.filter(p => String(p.categoria_id) === String(categoriaAtualFiltro));
    }

    renderizarProdutos(lista);
}

function estoqueDisponivelCatalogo(produto) {
    return Math.max(0, Number(produto?.estoque || 0) - Number(produto?.estoque_reservado_encomendas || 0));
}

function renderizarProdutos(lista) {
    const grid = document.getElementById('products-container');
    if (!grid)
        return;
    grid.innerHTML = '';

    if (!Array.isArray(lista) || lista.length === 0) {
        const mensagem = modoCardapioAtual === 'ENCOMENDA'
                ? 'Nenhum produto está habilitado para encomenda no momento.'
                : 'Nenhum produto encontrado nesta categoria.';
        grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;padding:24px;color:#76656b;">${mensagem}</p>`;
        return;
    }

    lista.forEach(p => {
        const imagemInformada = String(p.imagem_url || '');
        const imagemValida = /^https?:\/\//i.test(imagemInformada);
        const img = escaparHTMLCardapio(imagemValida ? imagemInformada : 'https://via.placeholder.com/300?text=Sem+Foto');
        const nomeSeguro = escaparHTMLCardapio(p.nome || 'Produto');
        const descricaoSegura = escaparHTMLCardapio(p.descricao || '');
        const estoque = estoqueDisponivelCatalogo(p);
        const semEstoque = estoque <= 0;
        const preco = Number(p.preco || 0);
        const limite = p.quantidade_max_encomenda ? Number(p.quantidade_max_encomenda) : null;
        const disabledPronta = modoCardapioAtual === 'PRONTA_ENTREGA' && semEstoque;
        const etiqueta = modoCardapioAtual === 'ENCOMENDA'
                ? `Encomenda${limite ? ` • máximo ${limite}` : ''}`
                : (semEstoque ? 'Esgotado' : `${estoque} em estoque`);
        const textoBotao = disabledPronta
                ? 'Esgotado'
                : (modoCardapioAtual === 'ENCOMENDA' ? 'Adicionar à encomenda' : `Adicionar`);

        grid.innerHTML += `
            <div class="product-card" style="${disabledPronta ? 'opacity: 0.6;' : ''}">
                <img src="${img}" class="product-img" alt="${nomeSeguro}">
                <div class="product-info">
                    <h3 class="product-title">${nomeSeguro}</h3>
                    <p class="product-desc">${descricaoSegura}</p>
                    <div class="product-price">R$ ${preco.toFixed(2).replace('.', ',')}</div>
                    <small style="display:block;margin:4px 0 10px;color:#76656b;">${etiqueta}</small>
                    ${disabledPronta
                ? `<button class="add-btn" disabled style="background:#888;cursor:not-allowed;">${textoBotao}</button>`
                : `<button class="add-btn" onclick="adicionarAoCarrinho(${Number(p.id)})">${textoBotao}</button>`}
                </div>
            </div>
        `;
    });
}

function filtrarCategoria(catId, event) {
    categoriaAtualFiltro = catId === 'todas' ? 'todas' : String(catId);
    const btns = document.querySelectorAll('.cat-btn');
    btns.forEach(b => b.classList.remove('active'));
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
    renderizarCatalogo();
}

function obterCarrinhoAtivo() {
    return modoCardapioAtual === 'ENCOMENDA' ? carrinhoEncomenda : carrinho;
}

function atualizarContadorCarrinho() {
    const totalPronta = carrinho.reduce((sum, item) => sum + Number(item.qtd || 0), 0);
    const totalEncomenda = carrinhoEncomenda.reduce((sum, item) => sum + Number(item.qtd || 0), 0);
    const el = document.getElementById('cart-count');
    const elPronta = document.getElementById('cart-count-pronta');
    const elEncomenda = document.getElementById('cart-count-encomenda');
    const label = document.getElementById('cart-button-label');

    // O botão principal mostra somente a modalidade selecionada.
    if (el)
        el.textContent = modoCardapioAtual === 'ENCOMENDA' ? totalEncomenda : totalPronta;
    if (elPronta)
        elPronta.textContent = totalPronta;
    if (elEncomenda)
        elEncomenda.textContent = totalEncomenda;
    if (label)
        label.textContent = modoCardapioAtual === 'ENCOMENDA' ? 'Minhas Encomendas' : 'Meu Pedido';
}

// Gerenciamento de carrinhos separados: estoque atual x encomenda futura.
function adicionarAoCarrinho(produtoId) {
    if (MODO_CONSULTA_SALAO) {
        alert('Este QR Code está em modo de consulta. Chame o garçom para registrar o pedido na comanda.');
        return;
    }
    const prod = produtosList.find(p => Number(p.id) === Number(produtoId));
    if (!prod) {
        alert('Este produto não está mais disponível. Atualize o cardápio.');
        return;
    }

    if (modoCardapioAtual === 'PRONTA_ENTREGA' && prod.disponivel_pronta_entrega === false) {
        alert(`O produto "${prod.nome}" não está disponível para pronta entrega. Consulte a aba Encomendas.`);
        renderizarCatalogo();
        return;
    }

    const carrinhoAtivo = obterCarrinhoAtivo();
    const itemExistente = carrinhoAtivo.find(i => Number(i.id) === Number(produtoId));
    const qtdAtual = itemExistente ? Number(itemExistente.qtd) : 0;
    const limite = prod.quantidade_max_encomenda ? Number(prod.quantidade_max_encomenda) : null;

    if (modoCardapioAtual === 'PRONTA_ENTREGA') {
        const estoque = modoCardapioAtual === 'ENCOMENDA' ? Math.max(0, Number(prod.estoque || 0)) : estoqueDisponivelCatalogo(prod);
        if (qtdAtual + 1 > estoque) {
            alert(`Ops! Só temos ${estoque} unidades de "${prod.nome}" em estoque.`);
            return;
        }
    } else {
        if (prod.aceita_encomenda !== true) {
            alert(`O produto "${prod.nome}" não está habilitado para encomenda.`);
            return;
        }
        if (limite && qtdAtual + 1 > limite) {
            alert(`A quantidade máxima para "${prod.nome}" é ${limite}.`);
            return;
        }
    }

    if (itemExistente) {
        itemExistente.qtd++;
    } else {
        carrinhoAtivo.push({...prod, id: Number(prod.id), qtd: 1});
    }
    if (modoCardapioAtual === 'ENCOMENDA')
        chaveIdempotenciaEncomenda = null;
    atualizarCarrinho();
}

function alterarQtd(produtoId, delta) {
    const carrinhoAtivo = obterCarrinhoAtivo();
    const item = carrinhoAtivo.find(i => Number(i.id) === Number(produtoId));
    const prod = produtosList.find(p => Number(p.id) === Number(produtoId));
    if (!item || !prod)
        return;

    if (delta > 0 && modoCardapioAtual === 'PRONTA_ENTREGA') {
        const estoque = modoCardapioAtual === 'ENCOMENDA' ? Math.max(0, Number(prod.estoque || 0)) : estoqueDisponivelCatalogo(prod);
        if (item.qtd + delta > estoque) {
            alert(`Ops! Só temos ${estoque} unidades de "${prod.nome}" em estoque.`);
            return;
        }
    }

    if (delta > 0 && modoCardapioAtual === 'ENCOMENDA') {
        const limite = prod.quantidade_max_encomenda ? Number(prod.quantidade_max_encomenda) : null;
        if (prod.aceita_encomenda !== true || (limite && item.qtd + delta > limite)) {
            alert(limite ? `A quantidade máxima para "${prod.nome}" é ${limite}.` : 'Este produto não aceita encomendas.');
            return;
        }
    }

    item.qtd += delta;
    if (item.qtd <= 0) {
        const idx = carrinhoAtivo.findIndex(i => Number(i.id) === Number(produtoId));
        if (idx >= 0)
            carrinhoAtivo.splice(idx, 1);
    }
    if (modoCardapioAtual === 'ENCOMENDA')
        chaveIdempotenciaEncomenda = null;
    atualizarCarrinho();
}

function atualizarInterfaceCarrinho() {
    const ehEncomenda = modoCardapioAtual === 'ENCOMENDA';
    const titulo = document.getElementById('cart-title');
    const subtitulo = document.getElementById('cart-subtitle');
    const agendamento = document.getElementById('encomenda-agendamento');
    const data = document.getElementById('data_encomenda');
    const hora = document.getElementById('hora_encomenda');
    const btn = document.getElementById('btn-submit');
    const nota = document.getElementById('checkout-mode-note');
    const rotuloPagamento = document.getElementById('checkout-payment-title');

    if (titulo)
        titulo.textContent = ehEncomenda ? '📅 Sua encomenda' : '🛒 Seu Pedido';
    if (subtitulo)
        subtitulo.textContent = ehEncomenda
                ? 'Confira os itens e solicite a data e o horário desejados.'
                : 'Confira os itens antes de finalizar.';
    if (agendamento)
        agendamento.style.display = ehEncomenda ? 'block' : 'none';
    [data, hora].forEach(campo => {
        if (!campo)
            return;
        campo.disabled = !ehEncomenda;
        campo.required = ehEncomenda;
    });
    if (data) {
        const hoje = new Date();
        const offset = hoje.getTimezoneOffset();
        const local = new Date(hoje.getTime() - offset * 60000).toISOString().slice(0, 10);
        data.min = local;
    }
    if (btn)
        btn.textContent = ehEncomenda ? '📅 Solicitar encomenda' : '✅ Enviar Pedido';
    if (nota)
        nota.textContent = ehEncomenda
                ? 'A forma de pagamento é apenas uma preferência nesta etapa. A encomenda aguardará confirmação da loja; nenhum pagamento será processado agora.'
                : 'Selecione a forma de pagamento do pedido.';
    if (rotuloPagamento)
        rotuloPagamento.textContent = ehEncomenda ? '💳 Pagamento pretendido' : '💳 Pagamento';
}

function atualizarCarrinho() {
    atualizarContadorCarrinho();
    atualizarInterfaceCarrinho();

    const carrinhoAtivo = obterCarrinhoAtivo();
    const container = document.getElementById('cart-items');
    const summary = document.getElementById('cart-summary');
    if (!container || !summary)
        return;

    if (carrinhoAtivo.length === 0) {
        container.innerHTML = modoCardapioAtual === 'ENCOMENDA'
                ? '<p class="empty-cart">Sua lista de encomendas está vazia. Escolha produtos na aba Encomendas.</p>'
                : '<p class="empty-cart">Seu carrinho está vazio.</p>';
        summary.style.display = 'none';
        return;
    }

    summary.style.display = 'block';
    container.innerHTML = '';
    let subtotal = 0;
    carrinhoAtivo.forEach(item => {
        const itemSubtotal = Number(item.preco || 0) * Number(item.qtd || 0);
        subtotal += itemSubtotal;
        container.innerHTML += `
            <div class="cart-item">
                <div>
                    <strong>${escaparHTMLCardapio(item.nome)}</strong><br>
                    <small>R$ ${Number(item.preco || 0).toFixed(2).replace('.', ',')}</small>
                </div>
                <div class="cart-item-qty">
                    <button type="button" class="qty-btn" onclick="alterarQtd(${Number(item.id)}, -1)">-</button>
                    <span>${Number(item.qtd)}</span>
                    <button type="button" class="qty-btn" onclick="alterarQtd(${Number(item.id)}, 1)">+</button>
                </div>
            </div>
        `;
    });

    const tipoPedido = document.getElementById('tipo_pedido')?.value || 'RETIRADA';
    const frete = tipoPedido === 'DELIVERY' ? taxaEntrega : 0;
    const total = subtotal + frete;
    const fmt = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
    document.getElementById('subtotal-val').textContent = fmt(subtotal);
    document.getElementById('taxa-val').textContent = fmt(frete);
    document.getElementById('total-val').textContent = fmt(total);
}

function toggleCarrinho() {
    if (MODO_CONSULTA_SALAO)
        return;
    const modal = document.getElementById('cart-modal');
    if (!modal)
        return;
    const vaiAbrir = modal.style.display !== 'flex';
    if (vaiAbrir)
        atualizarCarrinho();
    modal.style.display = vaiAbrir ? 'flex' : 'none';
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
        // CEP é opcional: o cliente pode digitar o endereço manualmente.
        document.getElementById('cli_cep')?.removeAttribute('required');
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

        const dadosCancelamento = acompanhamentosPedidos.get(idPedido) || {};
        const motivoCancelamento = dadosCancelamento.motivo_cancelamento || '';

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

            ${motivoCancelamento ? `
                <div style="margin-top:10px;padding:10px 12px;border-radius:8px;background:#fff3f3;color:#7f1d1d;text-align:left;">
                    <strong>Motivo:</strong> ${escaparHTMLPedidoOnline(motivoCancelamento)}
                </div>
            ` : ''}
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

        ${status === 'PENDENTE' ? `
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid #f0dce2;">
                <p style="margin:0 0 9px;color:#78666b;font-size:.86rem;line-height:1.45;">
                    Você pode cancelar enquanto o preparo ainda não começou. Será necessário informar o motivo.
                </p>
                <button type="button" onclick="abrirModalCancelamentoPedido(${idPedido})" style="border:0;border-radius:8px;padding:10px 14px;background:#b42318;color:#fff;font-weight:700;cursor:pointer;">
                    Cancelar pedido
                </button>
            </div>
        ` : ''}
    `;
}

function escaparHTMLPedidoOnline(valor) {
    return String(valor ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

let pedidoCancelamentoOnlineId = null;

function abrirModalCancelamentoPedido(pedidoId) {
    const id = Number(pedidoId);
    const acompanhamento = acompanhamentosPedidos.get(id);
    const modal = document.getElementById('modal-cancelar-pedido-online');

    if (!modal || !acompanhamento?.token || acompanhamento.status !== 'PENDENTE') {
        alert('Este pedido não pode mais ser cancelado por aqui. Se o preparo já começou, entre em contato com a loja.');
        return;
    }

    pedidoCancelamentoOnlineId = id;
    document.getElementById('motivo-cancelamento-online').value = '';
    document.getElementById('detalhe-cancelamento-online').value = '';
    document.getElementById('erro-cancelamento-online').textContent = '';
    atualizarCampoDetalheCancelamentoOnline();
    modal.style.display = 'flex';
}

function fecharModalCancelamentoPedido() {
    const modal = document.getElementById('modal-cancelar-pedido-online');
    if (modal)
        modal.style.display = 'none';
    pedidoCancelamentoOnlineId = null;
}

function atualizarCampoDetalheCancelamentoOnline() {
    const motivo = document.getElementById('motivo-cancelamento-online')?.value;
    const grupo = document.getElementById('grupo-detalhe-cancelamento-online');
    const detalhe = document.getElementById('detalhe-cancelamento-online');
    if (grupo)
        grupo.style.display = motivo === 'OUTRO' ? 'block' : 'none';
    if (detalhe) {
        if (motivo === 'OUTRO')
            detalhe.setAttribute('required', 'required');
        else
            detalhe.removeAttribute('required');
    }
}

async function confirmarCancelamentoPedidoOnline() {
    const id = Number(pedidoCancelamentoOnlineId || 0);
    const acompanhamento = acompanhamentosPedidos.get(id);
    const campoMotivo = document.getElementById('motivo-cancelamento-online');
    const campoDetalhe = document.getElementById('detalhe-cancelamento-online');
    const erroEl = document.getElementById('erro-cancelamento-online');
    const botao = document.getElementById('btn-confirmar-cancelamento-online');

    if (!id || !acompanhamento?.token) {
        if (erroEl)
            erroEl.textContent = 'Não encontramos o token de acompanhamento deste pedido. Atualize a página e tente novamente.';
        return;
    }

    if (acompanhamento.status !== 'PENDENTE') {
        if (erroEl)
            erroEl.textContent = 'O pedido não está mais aguardando preparo e não pode ser cancelado por aqui.';
        return;
    }

    const motivos = {
        ENGANO: 'Pedido feito por engano',
        DUPLICADO: 'Pedido duplicado',
        ENDERECO_INCORRETO: 'Endereço incorreto',
        DEMORA: 'Desisti devido à demora',
        MUDANCA_PLANOS: 'Mudei de ideia',
        OUTRO: 'Outro motivo'
    };
    const motivoSelecionado = campoMotivo?.value || '';
    const detalhe = (campoDetalhe?.value || '').trim();

    if (!Object.prototype.hasOwnProperty.call(motivos, motivoSelecionado)) {
        if (erroEl)
            erroEl.textContent = 'Selecione o motivo do cancelamento.';
        campoMotivo?.focus();
        return;
    }
    if (motivoSelecionado === 'OUTRO' && detalhe.length < 3) {
        if (erroEl)
            erroEl.textContent = 'Descreva o motivo do cancelamento (mínimo de 3 caracteres).';
        campoDetalhe?.focus();
        return;
    }

    const motivoFinal = motivoSelecionado === 'OUTRO'
            ? `${motivos[motivoSelecionado]}: ${detalhe}`
            : motivos[motivoSelecionado] + (detalhe ? ` — ${detalhe}` : '');

    if (botao) {
        botao.disabled = true;
        botao.textContent = 'Cancelando...';
    }
    if (erroEl)
        erroEl.textContent = '';

    try {
        const {data, error} = await _supabase.rpc('cancelar_pedido_online_cliente', {
            p_token: acompanhamento.token,
            p_motivo: motivoFinal
        });

        if (error)
            throw error;
        if (!data || data.sucesso !== true) {
            throw new Error('O banco não confirmou o cancelamento.');
        }

        atualizarStatusAcompanhamentoPedido(id, 'CANCELADO', data.motivo_cancelamento || motivoFinal);
        atualizarAcompanhamentoVisual(id, 'CANCELADO');
        fecharModalCancelamentoPedido();
        alert(`✅ Pedido #${id} cancelado.

Motivo: ${data.motivo_cancelamento || motivoFinal}

Se o pagamento já foi realizado antecipadamente, este cancelamento não efetua reembolso automático. Entre em contato com a loja para tratar do estorno.`);
    } catch (err) {
        console.error('Erro ao cancelar pedido online:', err);
        const mensagem = String(err?.message || err || 'Não foi possível cancelar o pedido.');
        let amigavel = mensagem;
        if (mensagem.includes('CANCELAMENTO_PERMITIDO_APENAS_PENDENTE')) {
            amigavel = 'O preparo já começou ou o pedido deixou de estar pendente. Entre em contato com a loja.';
        } else if (mensagem.includes('PEDIDO_NAO_ENCONTRADO')) {
            amigavel = 'Não foi possível localizar este pedido. Atualize a página e tente novamente.';
        } else if (mensagem.includes('MOTIVO_OBRIGATORIO') || mensagem.includes('MOTIVO_INVALIDO')) {
            amigavel = 'Informe um motivo válido para o cancelamento.';
        } else if (mensagem.includes('ESTOQUE') || mensagem.includes('LOTE')) {
            amigavel = 'Não foi possível concluir o cancelamento de forma segura. Entre em contato com a loja para que a equipe confira o estoque.';
        }
        if (erroEl)
            erroEl.textContent = amigavel;
        else
            alert('Não foi possível cancelar o pedido: ' + amigavel);
    } finally {
        if (botao) {
            botao.disabled = false;
            botao.textContent = 'Confirmar cancelamento';
        }
    }
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
// SOLICITAÇÃO E ACOMPANHAMENTO DE ENCOMENDAS AGENDADAS
// ============================================================
function gerarChaveIdempotenciaEncomenda() {
    if (window.crypto?.randomUUID)
        return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues)
        window.crypto.getRandomValues(bytes);
    else
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function salvarTokensEncomendasCliente() {
    try {
        const dadosMinimos = acompanhamentosEncomendasCliente.slice(-10).map(item => ({
                encomenda_id: Number(item.encomenda_id),
                token: item.token,
                status: item.status || 'AGUARDANDO'
            }));
        localStorage.setItem(CHAVE_TOKENS_ENCOMENDAS, JSON.stringify(dadosMinimos));
    } catch (err) {
        console.warn('Não foi possível salvar o acompanhamento das encomendas neste navegador.', err);
    }
}

function escaparHTMLCardapio(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, caractere => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[caractere]));
}

async function finalizarEncomenda(event) {
    if (event)
        event.preventDefault();

    if (!lojaOnlineAceitaPedidosAgora()) {
        alert(mensagemLojaOnlineFechada());
        return;
    }
    if (configLoja.encomendas_ativas === false) {
        alert('A loja desativou temporariamente as encomendas. Sua solicitação não foi enviada.');
        return;
    }

    if (!_supabase) {
        alert('Não foi possível conectar ao sistema. Tente novamente.');
        return;
    }
    if (!Array.isArray(carrinhoEncomenda) || carrinhoEncomenda.length === 0) {
        alert('Sua lista de encomendas está vazia.');
        return;
    }

    const nome = document.getElementById('cli_nome')?.value.trim() || '';
    const telefoneFormatado = document.getElementById('cli_telefone')?.value.trim() || '';
    const telefone = telefoneFormatado.replace(/\D/g, '');
    const tipo = document.getElementById('tipo_pedido')?.value || '';
    const dataEncomenda = document.getElementById('data_encomenda')?.value || '';
    const horaEncomenda = document.getElementById('hora_encomenda')?.value || '';
    const formaPagamento = document.getElementById('forma_pagamento')?.value || 'PIX';
    const trocoInput = document.getElementById('troco_para')?.value.trim() || '';
    const observacao = document.getElementById('observacao')?.value.trim() || null;

    if (nome.length < 2) {
        alert('Informe seu nome completo.');
        document.getElementById('cli_nome')?.focus();
        return;
    }
    if (!/^\d{10,11}$/.test(telefone)) {
        alert('Informe um telefone válido com DDD.');
        document.getElementById('cli_telefone')?.focus();
        return;
    }
    if (!['DELIVERY', 'RETIRADA'].includes(tipo)) {
        alert('Selecione entrega ou retirada.');
        return;
    }
    if (!dataEncomenda || !horaEncomenda) {
        alert('Informe a data e o horário desejados.');
        return;
    }
    const dataHoraLocal = new Date(`${dataEncomenda}T${horaEncomenda}:00`);
    if (!Number.isFinite(dataHoraLocal.getTime()) || dataHoraLocal <= new Date()) {
        alert('A data e o horário precisam ser futuros.');
        return;
    }
    if (!lojaOnlinePermiteDataHora(dataEncomenda, horaEncomenda)) {
        alert('A data ou o horário escolhido está fora dos dias e horários de funcionamento da loja online. Escolha outro horário.');
        return;
    }

    // Validação local para feedback; o banco repete as regras de forma autoritativa.
    for (const item of carrinhoEncomenda) {
        const produto = produtosList.find(p => Number(p.id) === Number(item.id));
        if (!produto || produto.ativo === false || produto.aceita_encomenda !== true) {
            alert(`O produto "${item.nome}" não aceita mais encomendas. Atualizaremos o cardápio.`);
            await carregarProdutos();
            return;
        }
        const antecedencia = Math.max(0, Number(produto.antecedencia_encomenda_horas ?? 24));
        if (dataHoraLocal.getTime() < Date.now() + antecedencia * 3600000) {
            alert(`O produto "${produto.nome}" precisa de pelo menos ${antecedencia} hora(s) de antecedência.`);
            return;
        }
        const limite = produto.quantidade_max_encomenda ? Number(produto.quantidade_max_encomenda) : null;
        if (limite && Number(item.qtd) > limite) {
            alert(`A quantidade máxima de "${produto.nome}" por encomenda é ${limite}.`);
            return;
        }
    }

    let cidadeId = null;
    let rua = document.getElementById('cli_rua')?.value.trim() || '';
    let numero = document.getElementById('cli_numero')?.value.trim() || '';
    let bairro = document.getElementById('cli_bairro')?.value.trim() || '';
    let complemento = document.getElementById('cli_complemento')?.value.trim() || '';
    let referencia = document.getElementById('cli_referencia')?.value.trim() || '';

    if (tipo === 'DELIVERY') {
        if (!rua || !numero || !bairro) {
            alert('Preencha rua, número e bairro para a entrega.');
            return;
        }
        if (cidadeEntregaSelecionada && typeof cidadeEntregaSelecionada === 'object') {
            cidadeId = cidadeEntregaSelecionada.id;
        } else {
            cidadeId = cidadeEntregaSelecionada;
        }
        if (!cidadeId) {
            cidadeId = document.getElementById('cli_cidade')?.value || null;
        }
        cidadeId = cidadeId ? Number(cidadeId) : null;
        if (!Number.isInteger(cidadeId) || cidadeId <= 0) {
            alert('Selecione uma cidade válida para entrega.');
            return;
        }
    } else {
        rua = numero = bairro = complemento = referencia = '';
    }

    if (!['PIX', 'DINHEIRO', 'CARTAO_DEBITO', 'CARTAO_CREDITO'].includes(formaPagamento)) {
        alert('Selecione uma forma de pagamento pretendida.');
        return;
    }
    let trocoPara = null;
    if (formaPagamento === 'DINHEIRO' && trocoInput !== '') {
        const n = Number(trocoInput.replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) {
            alert('Informe um valor de troco válido.');
            return;
        }
        trocoPara = n;
    }

    const subtotal = carrinhoEncomenda.reduce((s, i) => s + Number(i.preco || 0) * Number(i.qtd || 0), 0);
    const minimo = Number(configLoja.valor_minimo_pedido || 0);
    if (subtotal < minimo) {
        alert(`O valor mínimo do pedido é R$ ${minimo.toFixed(2).replace('.', ',')}.`);
        return;
    }

    const btn = document.getElementById('btn-submit');
    const textoOriginal = btn ? btn.textContent : 'Solicitar encomenda';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Enviando solicitação...';
    }

    if (!chaveIdempotenciaEncomenda)
        chaveIdempotenciaEncomenda = gerarChaveIdempotenciaEncomenda();
    const itensRPC = carrinhoEncomenda.map(item => ({
            produto_id: Number(item.id),
            quantidade: Number(item.qtd)
        }));

    try {
        const {data, error} = await _supabase.rpc('solicitar_encomenda_agendada_online', {
            p_chave_idempotencia: chaveIdempotenciaEncomenda,
            p_nome_cliente: nome,
            p_telefone: telefone,
            p_tipo: tipo,
            p_cidade_id: cidadeId,
            p_rua: tipo === 'DELIVERY' ? rua : null,
            p_numero: tipo === 'DELIVERY' ? numero : null,
            p_bairro: tipo === 'DELIVERY' ? bairro : null,
            p_complemento: tipo === 'DELIVERY' ? (complemento || null) : null,
            p_ponto_referencia: tipo === 'DELIVERY' ? (referencia || null) : null,
            p_data_encomenda: dataEncomenda,
            p_hora_encomenda: horaEncomenda,
            p_forma_pagamento: formaPagamento,
            p_troco_para: trocoPara,
            p_observacao: observacao,
            p_itens: itensRPC
        });
        if (error)
            throw error;
        if (!data || !data.encomenda_id || !data.token_acompanhamento) {
            throw new Error('O banco não retornou os dados de acompanhamento da encomenda.');
        }

        acompanhamentosEncomendasCliente = acompanhamentosEncomendasCliente.filter(x => Number(x.encomenda_id) !== Number(data.encomenda_id));
        acompanhamentosEncomendasCliente.push({
            encomenda_id: Number(data.encomenda_id),
            token: data.token_acompanhamento,
            status: data.status || 'AGUARDANDO'
        });
        salvarTokensEncomendasCliente();

        await atualizarAcompanhamentosEncomendas();
        carrinhoEncomenda = [];
        chaveIdempotenciaEncomenda = null;
        atualizarCarrinho();
        const modal = document.getElementById('cart-modal');
        if (modal)
            modal.style.display = 'none';

        const total = Number(data.valor_total || 0).toFixed(2).replace('.', ',');
        alert(`✅ Solicitação de encomenda #${data.encomenda_id} enviada!\n\nData: ${dataEncomenda}\nHorário: ${horaEncomenda}\nValor solicitado: R$ ${total}\n\nA encomenda ainda aguarda a confirmação da loja. Nenhum estoque foi baixado e nenhum pagamento foi processado nesta etapa.`);
    } catch (err) {
        console.error('Erro ao solicitar encomenda:', err);
        let msg = err?.message || 'Não foi possível enviar a solicitação.';
        const regras = [
            ['LOJA_FECHADA', 'A loja está fechada ou fora do horário de funcionamento e não está aceitando novos pedidos.'],
            ['FORA_HORARIO_FUNCIONAMENTO', 'A data ou o horário escolhido está fora dos dias e horários de funcionamento da loja. Escolha outro horário.'],
            ['ENCOMENDAS_DESATIVADAS', 'A loja desativou temporariamente as encomendas. Sua solicitação não foi enviada.'],
            ['PRODUTO_NAO_ACEITA_ENCOMENDA', 'Um dos produtos não aceita mais encomendas. Atualize o cardápio.'],
            ['PRODUTO_INATIVO', 'Um dos produtos foi pausado. Atualizamos o cardápio.'],
            ['PRAZO_MINIMO_ENCOMENDA', 'A data escolhida não respeita a antecedência mínima de um dos produtos.'],
            ['DATA_HORA_INVALIDA', 'Escolha uma data e um horário futuros.'],
            ['HORARIO_ENCOMENDA_FORA_ATENDIMENTO', 'O horário escolhido está fora da faixa permitida para encomendas. Escolha outro horário.'],
            ['LIMITE_ENCOMENDAS_HORARIO', 'A loja já atingiu o limite de encomendas para esse horário. Escolha outro horário.'],
            ['LIMITE_ENCOMENDAS_DIA', 'A loja já atingiu o limite de encomendas para essa data. Escolha outro dia.'],
            ['LIMITE_UNIDADES_ENCOMENDA', 'A quantidade total de unidades desta encomenda ultrapassa o limite permitido pela loja. Reduza as quantidades e tente novamente.'],
            ['LIMITE_UNIDADES_DIA', 'A capacidade total de produção para essa data foi atingida. Escolha outra data ou reduza as quantidades.'],
            ['CIDADE_NAO_DISPONIVEL', 'A cidade selecionada não está disponível para entrega.'],
            ['ENDERECO_INCOMPLETO', 'Preencha todos os dados obrigatórios de entrega.'],
            ['TELEFONE_INVALIDO', 'Informe um telefone válido com DDD.'],
            ['PEDIDO_ABAIXO_DO_MINIMO', 'O valor solicitado está abaixo do mínimo permitido.'],
            ['QUANTIDADE_MAXIMA_ENCOMENDA', 'A quantidade solicitada excede o limite de um dos produtos.'],
            ['TROCO_INSUFICIENTE', 'O valor informado para troco precisa ser igual ou maior que o total solicitado.']
        ];
        const regra = regras.find(([codigo]) => msg.includes(codigo));
        if (regra)
            msg = regra[1];
        alert('❌ ' + msg);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    }
}

async function recuperarAcompanhamentoEncomendas() {
    try {
        const salvos = JSON.parse(localStorage.getItem(CHAVE_TOKENS_ENCOMENDAS) || '[]');
        acompanhamentosEncomendasCliente = Array.isArray(salvos)
                ? salvos.filter(x => x && x.token && x.encomenda_id).slice(-10)
                : [];
    } catch (_) {
        acompanhamentosEncomendasCliente = [];
    }
    await atualizarAcompanhamentosEncomendas();
}

async function atualizarAcompanhamentosEncomendas() {
    if (!_supabase || !Array.isArray(acompanhamentosEncomendasCliente) || !acompanhamentosEncomendasCliente.length) {
        renderizarAcompanhamentosEncomendas([]);
        return;
    }
    const resultados = [];
    for (const item of acompanhamentosEncomendasCliente.slice(-10)) {
        try {
            const {data, error} = await _supabase.rpc('consultar_encomenda_agendada_online', {p_token: item.token});
            if (error)
                throw error;
            if (data) {
                item.status = data.status || item.status;
                item.dados = data;
                resultados.push(item);
            }
        } catch (err) {
            console.warn('Não foi possível atualizar o status da encomenda #' + item.encomenda_id, err?.message || err);
        }
    }
    salvarTokensEncomendasCliente();
    renderizarAcompanhamentosEncomendas(resultados);
}

async function cancelarEncomendaClienteUI(token) {
    const item = acompanhamentosEncomendasCliente.find(x => x && x.token === token);
    if (!item || !_supabase) {
        alert('Não foi possível localizar esta encomenda. Atualize a página e tente novamente.');
        return;
    }

    const statusAtual = item.dados?.status || item.status || 'AGUARDANDO';
    if (statusAtual !== 'AGUARDANDO') {
        alert('Só é possível cancelar a encomenda enquanto ela estiver aguardando confirmação da loja.');
        await atualizarAcompanhamentosEncomendas();
        return;
    }

    if (!confirm(`Deseja cancelar a encomenda #${Number(item.encomenda_id)}? Essa ação não pode ser desfeita.`))
        return;

    const motivo = prompt('Informe o motivo do cancelamento (mínimo 5 caracteres):');
    if (motivo === null)
        return;
    const motivoLimpo = motivo.trim();
    if (motivoLimpo.length < 5 || motivoLimpo.length > 500) {
        alert('Informe um motivo entre 5 e 500 caracteres.');
        return;
    }

    try {
        const {data, error} = await _supabase.rpc('cancelar_encomenda_agendada_online', {
            p_token: token,
            p_motivo: motivoLimpo
        });
        if (error)
            throw error;
        if (!data || data.status !== 'CANCELADA') {
            throw new Error('Não foi possível confirmar o cancelamento no sistema.');
        }

        item.status = data.status;
        item.dados = {
            ...(item.dados || {}),
            status: data.status,
            motivo_cancelamento: data.motivo_cancelamento || motivoLimpo
        };
        salvarTokensEncomendasCliente();
        await atualizarAcompanhamentosEncomendas();
        alert(`Encomenda #${Number(item.encomenda_id)} cancelada com sucesso.`);
    } catch (err) {
        console.error('Erro ao cancelar encomenda pelo catálogo:', err);
        const mensagem = String(err?.message || err || 'Erro desconhecido');
        if (mensagem.includes('ENCOMENDA_CANCELAMENTO_FORA_PRAZO')) {
            alert('A loja já confirmou ou iniciou o atendimento desta encomenda. O cancelamento pelo catálogo não está mais disponível.');
        } else if (mensagem.includes('MOTIVO_CANCELAMENTO_OBRIGATORIO')) {
            alert('Informe o motivo do cancelamento com pelo menos 5 caracteres.');
        } else if (mensagem.includes('ENCOMENDA_NAO_ENCONTRADA')) {
            alert('Não encontramos a encomenda associada a este acompanhamento.');
        } else {
            alert('Não foi possível cancelar a encomenda. Atualize o acompanhamento e tente novamente.');
        }
        await atualizarAcompanhamentosEncomendas();
    }
}

function renderizarAcompanhamentosEncomendas(lista) {
    const painel = document.getElementById('painel-acompanhamento-encomendas');
    const container = document.getElementById('lista-acompanhamento-encomendas');
    if (!painel || !container)
        return;
    if (!lista.length) {
        painel.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    painel.style.display = 'block';
    const statusTexto = {AGUARDANDO: 'Aguardando confirmação da loja', ACEITA: 'Encomenda confirmada · aguardando programação da produção', EM_PRODUCAO: 'Em produção', PRONTA: 'Pronta para retirada/entrega', CONCLUIDA: 'Concluída', RECUSADA: 'Encomenda recusada', CANCELADA: 'Encomenda cancelada'};
    container.innerHTML = lista.slice().reverse().map(item => {
        const d = item.dados || {};
        const itens = Array.isArray(d.itens) ? d.itens.map(i => `${Number(i.quantidade)} × ${escaparHTMLCardapio(i.nome_produto)}`).join('<br>') : '';
        const status = d.status || item.status || 'AGUARDANDO';
        const motivoRecusa = d.motivo_recusa ? `<p style="margin:7px 0 0;color:#9d2335;"><strong>Motivo da recusa:</strong> ${escaparHTMLCardapio(d.motivo_recusa)}</p>` : '';
        const motivoCancelamento = d.motivo_cancelamento ? `<p style="margin:7px 0 0;color:#9d2335;"><strong>Motivo do cancelamento:</strong> ${escaparHTMLCardapio(d.motivo_cancelamento)}</p>` : '';
        const motivo = motivoRecusa + motivoCancelamento;
        const botaoCancelar = status === 'AGUARDANDO'
                ? `<button type="button" onclick="cancelarEncomendaClienteUI('${escaparHTMLCardapio(item.token)}')" style="margin-top:12px;padding:9px 13px;border:1px solid #bd3542;border-radius:8px;background:#fff;color:#a52834;font-weight:700;cursor:pointer;">Cancelar encomenda</button>`
                : '';
        const cores = ['ACEITA', 'EM_PRODUCAO', 'PRONTA', 'CONCLUIDA'].includes(status) ? '#176b45' : (status === 'RECUSADA' || status === 'CANCELADA' ? '#a52834' : '#8a6100');
        return `<article style="border:1px solid #ead7e0;border-radius:12px;padding:14px;background:#fff;">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
                <strong>Encomenda #${Number(item.encomenda_id)}</strong>
                <span style="color:${cores};font-weight:700;">${escaparHTMLCardapio(statusTexto[status] || status)}</span>
            </div>
            <p style="margin:7px 0;color:#66585d;">Data: ${escaparHTMLCardapio(String(d.data_encomenda || '').split('-').reverse().join('/'))} às ${escaparHTMLCardapio(d.hora_encomenda || '')}</p>
            <div style="color:#4a3e3d;">${itens}</div>
            <p style="margin:8px 0 0;font-weight:700;">Total solicitado: R$ ${Number(d.valor_total || 0).toFixed(2).replace('.', ',')}</p>${motivo}${botaoCancelar}
        </article>`;
    }).join('');
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
    if (MODO_CONSULTA_SALAO) {
        alert('Este QR Code é somente para consulta do cardápio. Chame o garçom para registrar o pedido na comanda.');
        return;
    }

    if (modoCardapioAtual === 'ENCOMENDA') {
        return finalizarEncomenda(event);
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
    if (!lojaOnlineAceitaPedidosAgora()) {
        alert(mensagemLojaOnlineFechada());
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

        if (produto.disponivel_pronta_entrega === false) {
            alert(`O produto "${produto.nome}" foi desativado para pronta entrega. Remova-o do carrinho ou escolha a aba Encomendas se ele aceitar essa modalidade.`);
            await carregarProdutos();
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
        } else if (mensagemErro.includes('FORA_HORARIO_FUNCIONAMENTO')) {
            mensagemErro = 'A loja está fora dos dias ou horários de funcionamento configurados e não está aceitando novos pedidos.';
        } else if (mensagemErro.includes('ESTOQUE_RESERVADO_ENCOMENDAS')) {
            mensagemErro = 'Parte do estoque está reservada para uma encomenda. Atualize o cardápio e reduza a quantidade solicitada.';
            await carregarProdutos();
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

const DIAS_SEMANA_ONLINE = [0, 1, 2, 3, 4, 5, 6]; // 0=domingo, 6=sábado (padrão de PostgreSQL)
const NOMES_DIAS_ONLINE = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

let configLoja = {
    loja_aberta: false,
    valor_minimo_pedido: 0,
    whatsapp_notificacoes_ativas: false,
    dias_funcionamento_online: [...DIAS_SEMANA_ONLINE],
    hora_abertura_online: null,
    hora_fechamento_online: null,
    horarios_funcionamento_online: {},
    telefone_contato_online: '',
    whatsapp_contato_online: '',
    email_contato_online: '',
    endereco_contato_online: '',
    configuracoes_carregadas: false,
    // Mantém encomendas ocultas até confirmar a configuração persistida no banco.
    encomendas_ativas: false
};

function obterRelogioLojaOnline(instante = new Date()) {
    const partes = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(instante);
    const mapa = Object.fromEntries(partes.map(p => [p.type, p.value]));
    const diaMap = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6};
    return {dia: diaMap[mapa.weekday], minuto: Number(mapa.hour) * 60 + Number(mapa.minute)};
}

function horaParaMinutosLojaOnline(hora) {
    if (!hora)
        return null;
    const m = String(hora).match(/^(\d{1,2}):(\d{2})/);
    if (!m)
        return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59)
        return null;
    return h * 60 + min;
}

function lojaOnlineDentroDaProgramacao(dia, minuto) {
    const schedules = configLoja.horarios_funcionamento_online;
    if (schedules && typeof schedules === 'object' && !Array.isArray(schedules) && Object.keys(schedules).length) {
        const lerRegra = d => {
            const r = schedules[String(d)];
            if (!r || r.aberto !== true)
                return null;
            const inicio = horaParaMinutosLojaOnline(r.inicio);
            const fim = horaParaMinutosLojaOnline(r.fim);
            if ((r.inicio && inicio === null) || (r.fim && fim === null))
                return {invalida: true};
            if ((inicio === null) !== (fim === null))
                return {invalida: true};
            return {inicio, fim};
        };
        const hoje = lerRegra(dia);
        if (hoje && !hoje.invalida) {
            if (hoje.inicio === null && hoje.fim === null)
                return true; // Dia inteiro
            if (hoje.inicio < hoje.fim && minuto >= hoje.inicio && minuto < hoje.fim)
                return true;
            if (hoje.inicio > hoje.fim && minuto >= hoje.inicio)
                return true; // Início de faixa noturna
        }
        // A parte depois da meia-noite pertence à faixa do dia anterior.
        const diaAnterior = (dia + 6) % 7;
        const ontem = lerRegra(diaAnterior);
        if (ontem && !ontem.invalida && ontem.inicio !== null && ontem.fim !== null && ontem.inicio > ontem.fim && minuto < ontem.fim)
            return true;
        return false;
    }

    // Compatibilidade com configuração legada enquanto uma instalação não migrada é identificada.
    const dias = Array.isArray(configLoja.dias_funcionamento_online)
            ? configLoja.dias_funcionamento_online.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
            : [...DIAS_SEMANA_ONLINE];
    const inicio = horaParaMinutosLojaOnline(configLoja.hora_abertura_online);
    const fim = horaParaMinutosLojaOnline(configLoja.hora_fechamento_online);
    if (Boolean(configLoja.hora_abertura_online) !== Boolean(configLoja.hora_fechamento_online))
        return false;
    if (inicio === null && fim === null)
        return dias.includes(dia);
    if (inicio === null || fim === null || inicio === fim)
        return false;
    if (inicio < fim)
        return dias.includes(dia) && minuto >= inicio && minuto < fim;
    const diaAnterior = (dia + 6) % 7;
    return (dias.includes(dia) && minuto >= inicio) || (dias.includes(diaAnterior) && minuto < fim);
}

function lojaOnlineAceitaPedidosAgora() {
    if (!configLoja.configuracoes_carregadas || configLoja.loja_aberta !== true)
        return false;
    const agora = obterRelogioLojaOnline(new Date());
    return lojaOnlineDentroDaProgramacao(agora.dia, agora.minuto);
}

function lojaOnlinePermiteDataHora(dataISO, hora) {
    if (!configLoja.configuracoes_carregadas || configLoja.loja_aberta !== true || !/^\d{4}-\d{2}-\d{2}$/.test(String(dataISO || '')))
        return false;
    // Meio-dia UTC mantém o mesmo dia civil para calcular o dia da semana; a hora é uma hora local da loja.
    const data = new Date(`${dataISO}T12:00:00Z`);
    if (!Number.isFinite(data.getTime()))
        return false;
    const dia = data.getUTCDay();
    const minuto = horaParaMinutosLojaOnline(hora);
    return minuto !== null && lojaOnlineDentroDaProgramacao(dia, minuto);
}

function mensagemLojaOnlineFechada() {
    if (!configLoja.configuracoes_carregadas)
        return 'Não foi possível confirmar o horário de funcionamento da loja. Atualize o catálogo e tente novamente.';
    if (configLoja.loja_aberta !== true)
        return '🔴 A loja está fechada manualmente e não está aceitando novos pedidos.';
    return '🔴 A loja está fora dos dias ou horários de funcionamento configurados e não está aceitando novos pedidos.';
}

// --- CARREGA E ESCUTA CONFIGURAÇÕES DA LOJA ---
async function carregarConfiguracoesLoja() {
    if (!_supabase) {
        configLoja = {...configLoja, configuracoes_carregadas: false, loja_aberta: false, encomendas_ativas: false};
        atualizarBannerStatus();
        aplicarDisponibilidadeEncomendasUI();
        atualizarInformacoesPublicasLoja();
        return;
    }

    const {data, error} = await _supabase
            .from('configuracoes')
            .select(`
            nome_loja,
            loja_aberta,
            valor_minimo_pedido,
            whatsapp_notificacoes_ativas,
            encomendas_ativas,
            dias_funcionamento_online,
            hora_abertura_online,
            hora_fechamento_online,
            horarios_funcionamento_online,
            telefone_contato_online,
            whatsapp_contato_online,
            email_contato_online,
            endereco_contato_online
        `)
            .eq('id', 1)
            .single();

    if (error || !data) {
        console.error('Erro ao buscar configurações da loja; novos pedidos permanecerão bloqueados:', error?.message || 'Registro de configuração não encontrado.');
        configLoja = {...configLoja, configuracoes_carregadas: false, loja_aberta: false, encomendas_ativas: false};
        atualizarBannerStatus();
        aplicarDisponibilidadeEncomendasUI();
        atualizarInformacoesPublicasLoja();
        return;
    }

    configLoja = {
        ...data,
        dias_funcionamento_online: Array.isArray(data.dias_funcionamento_online) ? data.dias_funcionamento_online.map(Number) : [...DIAS_SEMANA_ONLINE],
        hora_abertura_online: data.hora_abertura_online || null,
        hora_fechamento_online: data.hora_fechamento_online || null,
        horarios_funcionamento_online: data.horarios_funcionamento_online && typeof data.horarios_funcionamento_online === 'object' ? data.horarios_funcionamento_online : {},
        telefone_contato_online: data.telefone_contato_online || '',
        whatsapp_contato_online: data.whatsapp_contato_online || '',
        email_contato_online: data.email_contato_online || '',
        endereco_contato_online: data.endereco_contato_online || '',
        configuracoes_carregadas: true,
        // Só habilita se o banco confirmar explicitamente true.
        encomendas_ativas: data.encomendas_ativas === true
    };
    atualizarBannerStatus();
    atualizarOpcaoWhatsApp();
    aplicarDisponibilidadeEncomendasUI();
    atualizarInformacoesPublicasLoja();
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

                if (!dados || (
                        typeof dados.loja_aberta === 'undefined' &&
                        typeof dados.encomendas_ativas === 'undefined' &&
                        typeof dados.valor_minimo_pedido === 'undefined' &&
                        typeof dados.whatsapp_notificacoes_ativas === 'undefined' &&
                        typeof dados.dias_funcionamento_online === 'undefined' &&
                        typeof dados.hora_abertura_online === 'undefined' &&
                        typeof dados.hora_fechamento_online === 'undefined' &&
                        typeof dados.horarios_funcionamento_online === 'undefined' &&
                        typeof dados.telefone_contato_online === 'undefined' &&
                        typeof dados.whatsapp_contato_online === 'undefined' &&
                        typeof dados.email_contato_online === 'undefined' &&
                        typeof dados.endereco_contato_online === 'undefined'
                        )) {
                    console.warn('⚠️ Payload de configuração inválido:', payload);
                    return;
                }

                configLoja = {
                    ...configLoja,
                    nome_loja: dados.nome_loja ?? configLoja.nome_loja,
                    loja_aberta: typeof dados.loja_aberta === 'boolean' ? dados.loja_aberta : configLoja.loja_aberta,
                    taxa_entrega_padrao: Number(dados.taxa_entrega_padrao ?? configLoja.taxa_entrega_padrao ?? 0),
                    valor_minimo_pedido: Number(dados.valor_minimo_pedido ?? configLoja.valor_minimo_pedido ?? 0),
                    encomendas_ativas: typeof dados.encomendas_ativas === 'boolean'
                            ? dados.encomendas_ativas
                            : configLoja.encomendas_ativas === true,
                    dias_funcionamento_online: Array.isArray(dados.dias_funcionamento_online)
                            ? dados.dias_funcionamento_online.map(Number)
                            : configLoja.dias_funcionamento_online,
                    hora_abertura_online: typeof dados.hora_abertura_online !== 'undefined' ? (dados.hora_abertura_online || null) : configLoja.hora_abertura_online,
                    hora_fechamento_online: typeof dados.hora_fechamento_online !== 'undefined' ? (dados.hora_fechamento_online || null) : configLoja.hora_fechamento_online,
                    horarios_funcionamento_online: dados.horarios_funcionamento_online && typeof dados.horarios_funcionamento_online === 'object' ? dados.horarios_funcionamento_online : configLoja.horarios_funcionamento_online,
                    telefone_contato_online: dados.telefone_contato_online ?? configLoja.telefone_contato_online,
                    whatsapp_contato_online: dados.whatsapp_contato_online ?? configLoja.whatsapp_contato_online,
                    email_contato_online: dados.email_contato_online ?? configLoja.email_contato_online,
                    endereco_contato_online: dados.endereco_contato_online ?? configLoja.endereco_contato_online,
                    configuracoes_carregadas: true
                };

                atualizarBannerStatus();
                aplicarDisponibilidadeEncomendasUI();
                atualizarInformacoesPublicasLoja();
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

    if (!configLoja.configuracoes_carregadas) {
        banner.className = 'status-banner fechada';
        banner.innerHTML = '🟠 <strong>VERIFICANDO FUNCIONAMENTO</strong><br>Não foi possível confirmar o horário da loja. Atualize a página para tentar novamente.';
        return;
    }
    if (configLoja.loja_aberta !== true) {
        banner.className = 'status-banner fechada';
        banner.innerHTML = '🔴 <strong>LOJA FECHADA</strong><br>O estabelecimento bloqueou novos pedidos no site.';
        return;
    }
    if (!lojaOnlineAceitaPedidosAgora()) {
        banner.className = 'status-banner fechada';
        banner.innerHTML = '🔴 <strong>LOJA FECHADA FORA DO HORÁRIO</strong><br>Consulte os dias e horários de funcionamento para enviar seu pedido.';
        return;
    }
    banner.className = 'status-banner aberta';
    let texto = '🟢 <strong>LOJA ABERTA — RECEBENDO PEDIDOS</strong>';
    banner.innerHTML = texto;
}

function aplicarDisponibilidadeEncomendasUI() {
    const ativas = configLoja.encomendas_ativas !== false;
    const botaoEncomendas = document.getElementById('btn-modo-encomenda');
    const gradeModalidades = botaoEncomendas?.parentElement;
    const aviso = document.getElementById('aviso-modo-cardapio');

    if (botaoEncomendas) {
        botaoEncomendas.style.display = ativas ? '' : 'none';
        botaoEncomendas.setAttribute('aria-hidden', String(!ativas));
    }
    if (gradeModalidades) {
        gradeModalidades.style.gridTemplateColumns = ativas
                ? 'repeat(2,minmax(0,1fr))'
                : 'minmax(0,1fr)';
    }

    if (!ativas && modoCardapioAtual === 'ENCOMENDA') {
        modoCardapioAtual = 'PRONTA_ENTREGA';
    }
    // Atualiza estado visual, catálogo e carrinho se o gerente desativar encomendas com o cardápio aberto.
    selecionarModoCardapio(modoCardapioAtual);

    if (!ativas && aviso) {
        aviso.textContent = 'Encomendas temporariamente desativadas pela loja. Os produtos disponíveis para pronta entrega continuam sendo exibidos conforme o estoque.';
    }
}

// ============================================================
// INFORMAÇÕES PÚBLICAS DA LOJA: HORÁRIOS E CONTATOS
// ============================================================
const NOMES_DIAS_LOJA_INFO = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function horarioCurtoLojaInfo(valor) {
    if (!valor)
        return null;
    const m = String(valor).match(/^(\d{1,2}:\d{2})/);
    return m ? m[1] : null;
}

function textoHorarioDiaLojaInfo(dia) {
    const mapa = configLoja.horarios_funcionamento_online;
    const regra = mapa && typeof mapa === 'object' ? mapa[String(dia)] : null;
    if (regra && typeof regra === 'object') {
        if (regra.aberto !== true)
            return 'Fechado';
        const inicio = horarioCurtoLojaInfo(regra.inicio);
        const fim = horarioCurtoLojaInfo(regra.fim);
        if (!inicio && !fim)
            return 'Aberto o dia todo';
        if (inicio && fim)
            return `${inicio} às ${fim}`;
        return 'Horário não configurado';
    }
    const dias = Array.isArray(configLoja.dias_funcionamento_online) ? configLoja.dias_funcionamento_online.map(Number) : DIAS_SEMANA_ONLINE;
    if (!dias.includes(Number(dia)))
        return 'Fechado';
    const inicio = horarioCurtoLojaInfo(configLoja.hora_abertura_online);
    const fim = horarioCurtoLojaInfo(configLoja.hora_fechamento_online);
    return inicio && fim ? `${inicio} às ${fim}` : 'Aberto o dia todo';
}

function atualizarInformacoesPublicasLoja() {
    const title = document.getElementById('store-info-title');
    const status = document.getElementById('store-info-status');
    const hours = document.getElementById('store-info-hours');
    const contacts = document.getElementById('store-info-contacts');
    if (!title || !status || !hours || !contacts)
        return;

    title.textContent = configLoja.nome_loja || 'Horários e contato da loja';
    if (!configLoja.configuracoes_carregadas) {
        status.textContent = 'Não foi possível consultar os dados da loja. Atualize a página e tente novamente.';
        hours.innerHTML = '<p style="margin:0;color:#777;">Horários indisponíveis no momento.</p>';
    } else {
        status.textContent = lojaOnlineAceitaPedidosAgora()
                ? '🟢 Loja aberta — recebendo pedidos.'
                : (configLoja.loja_aberta !== true ? '🔴 Loja fechada manualmente — não recebe pedidos pelo site.' : '🔴 Loja fechada neste horário. Confira a programação abaixo.');
        hours.innerHTML = NOMES_DIAS_LOJA_INFO.map((nome, dia) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 11px;border-radius:8px;background:#fff7fa;border:1px solid #f5e4ea;"><span style="font-weight:700;">${nome}</span><span style="text-align:right;color:${textoHorarioDiaLojaInfo(dia) === 'Fechado' ? '#9b243d' : '#4a3e3d'};">${escaparHTMLCardapio(textoHorarioDiaLojaInfo(dia))}</span></div>`).join('');
    }

    const linhas = [];
    const telefone = String(configLoja.telefone_contato_online || '').trim();
    const whatsapp = String(configLoja.whatsapp_contato_online || '').trim();
    const email = String(configLoja.email_contato_online || '').trim();
    const endereco = String(configLoja.endereco_contato_online || '').trim();
    if (telefone) {
        const href = telefone.replace(/[^0-9+]/g, '');
        linhas.push(`<div>☎️ <strong>Telefone:</strong> <a style="color:#a5164a;" href="tel:${escaparHTMLCardapio(href)}">${escaparHTMLCardapio(telefone)}</a></div>`);
    }
    if (whatsapp) {
        const numeros = whatsapp.replace(/\D/g, '');
        const href = numeros ? `https://wa.me/${numeros}` : '';
        linhas.push(`<div>💬 <strong>WhatsApp:</strong> ${href ? `<a style="color:#a5164a;" href="${href}" target="_blank" rel="noopener noreferrer">${escaparHTMLCardapio(whatsapp)}</a>` : escaparHTMLCardapio(whatsapp)}</div>`);
    }
    if (email)
        linhas.push(`<div>✉️ <strong>E-mail:</strong> <a style="color:#a5164a;" href="mailto:${escaparHTMLCardapio(email)}">${escaparHTMLCardapio(email)}</a></div>`);
    if (endereco)
        linhas.push(`<div>📍 <strong>Endereço:</strong> ${escaparHTMLCardapio(endereco)}</div>`);
    contacts.innerHTML = linhas.length ? linhas.map(l => `<div style="padding:8px 2px;line-height:1.5;overflow-wrap:anywhere;">${l}</div>`).join('') : '<p style="margin:0;color:#777;">A loja ainda não cadastrou informações de contato.</p>';
}

function abrirInformacoesLoja() {
    atualizarInformacoesPublicasLoja();
    const modal = document.getElementById('store-info-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        const close = modal.querySelector('button[aria-label="Fechar informações da loja"]');
        close?.focus();
    }
}

function fecharInformacoesLoja() {
    const modal = document.getElementById('store-info-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('store-info-modal')?.style.display === 'flex')
        fecharInformacoesLoja();
});

// ============================================================
// PREENCHIMENTO DE ENDEREÇO POR CEP (ViaCEP)
// ============================================================
let buscaCepEmAndamento = false;
let ultimoCepConsultadoComSucesso = '';

function formatarCepEntrega(input) {
    if (!input)
        return;
    const numeros = String(input.value || '').replace(/\D/g, '').slice(0, 8);
    input.value = numeros.length > 5
            ? `${numeros.slice(0, 5)}-${numeros.slice(5)}`
            : numeros;
    input.setCustomValidity('');
    const status = document.getElementById('cli_cep_status');
    if (status && numeros.replace(/\D/g, '') !== ultimoCepConsultadoComSucesso) {
        status.textContent = '';
    }
}

function normalizarNomeCidadeCep(valor) {
    return String(valor || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLocaleLowerCase('pt-BR');
}

async function buscarCepEntrega() {
    const input = document.getElementById('cli_cep');
    const status = document.getElementById('cli_cep_status');
    const botao = document.getElementById('btn-buscar-cep');
    if (!input)
        return false;

    const cep = String(input.value || '').replace(/\D/g, '');
    if (!cep) {
        if (status)
            status.textContent = '';
        return false;
    }
    if (!/^\d{8}$/.test(cep)) {
        if (status) {
            status.textContent = 'Digite um CEP válido com 8 números ou preencha o endereço manualmente.';
            status.style.color = '#a52834';
        }
        // CEP é opcional; um CEP incompleto não deve impedir o preenchimento manual.
        input.setCustomValidity('');
        return false;
    }

    input.value = `${cep.slice(0, 5)}-${cep.slice(5)}`;
    input.setCustomValidity('');
    if (cep === ultimoCepConsultadoComSucesso)
        return true;
    if (buscaCepEmAndamento)
        return false;

    buscaCepEmAndamento = true;
    if (botao) {
        botao.disabled = true;
        botao.textContent = 'Buscando...';
        botao.style.opacity = '0.7';
    }
    if (status) {
        status.textContent = 'Consultando CEP...';
        status.style.color = '#777';
    }

    try {
        const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
            method: 'GET',
            headers: {'Accept': 'application/json'}
        });
        if (!resposta.ok)
            throw new Error('Não foi possível consultar o serviço de CEP.');
        const endereco = await resposta.json();
        if (endereco.erro) {
            if (status) {
                status.textContent = 'CEP não encontrado. Confira os números ou preencha o endereço manualmente.';
                status.style.color = '#a52834';
            }
            return false;
        }

        const rua = document.getElementById('cli_rua');
        const bairro = document.getElementById('cli_bairro');
        const selectCidade = document.getElementById('cli_cidade');
        if (rua)
            rua.value = endereco.logradouro || '';
        if (bairro)
            bairro.value = endereco.bairro || '';

        const cidadeApi = normalizarNomeCidadeCep(endereco.localidade);
        const ufApi = String(endereco.uf || '').trim().toLocaleUpperCase('pt-BR');
        const cidadeCorrespondente = cidadesEntregaList.find(cidade =>
            normalizarNomeCidadeCep(cidade.nome) === cidadeApi &&
                    String(cidade.uf || '').trim().toLocaleUpperCase('pt-BR') === ufApi
        );

        if (cidadeCorrespondente && selectCidade) {
            selectCidade.value = String(cidadeCorrespondente.id);
            selecionarCidadeEntrega();
            if (status) {
                status.textContent = `Endereço preenchido para ${endereco.localidade}/${ufApi}. Confira o número e o complemento.`;
                status.style.color = '#176b45';
            }
        } else {
            // Não seleciona cidade fora da área de entrega configurada pela loja.
            if (selectCidade)
                selectCidade.value = '';
            selecionarCidadeEntrega();
            if (status) {
                status.textContent = `CEP localizado em ${endereco.localidade}/${ufApi}, mas essa cidade não está habilitada para entrega. Selecione uma cidade disponível ou escolha retirada.`;
                status.style.color = '#a16207';
            }
        }

        ultimoCepConsultadoComSucesso = cep;
        return true;
    } catch (erro) {
        console.error('Erro ao consultar CEP:', erro);
        if (status) {
            status.textContent = 'Não foi possível consultar o CEP agora. Você pode preencher o endereço manualmente.';
            status.style.color = '#a52834';
        }
        return false;
    } finally {
        buscaCepEmAndamento = false;
        if (botao) {
            botao.disabled = false;
            botao.textContent = 'Buscar CEP';
            botao.style.opacity = '1';
        }
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