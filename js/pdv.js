// 1. Configuração das credenciais do Supabase
const SUPABASE_URL = 'https://pznuqeqtytyjtupxnzqk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6bnVxZXF0eXR5anR1cHhuenFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MDIyMTAsImV4cCI6MjEwMzk3ODIxMH0.ZadwdTr-pERj7mBYQGnIRpg7M4RhN9K3xNCpcG_GOqQ'; // Insira sua chave anon publica aqui

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let listaPedidosGlobal = [];
let somAtivado = false;

let arquivoImagemSelecionado = null;
let arquivoImagemProdutoEdicao = null;
let produtoEdicaoAtual = null;

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

// ============================================================
// CONTAS A RECEBER - CARREGAMENTO E LISTAGEM
// ============================================================
async function carregarContasReceberUI() {

    const tbody =
            document.getElementById(
                    'contas-receber-table-body'
                    );

    if (!tbody) {
        return;
    }

    const busca =
            document.getElementById(
                    'fin-ar-busca'
                    )?.value
            ?.trim()
            || '';

    const status =
            document.getElementById(
                    'fin-ar-status'
                    )?.value
            || 'TODOS';

    tbody.innerHTML = `
        <tr>
            <td
                colspan="8"
                style="
                    text-align:center;
                    color:#aaa;
                    padding:20px;
                "
            >
                ⏳ Carregando contas a receber...
            </td>
        </tr>
    `;

    try {

        // ----------------------------------------------------
        // LISTAGEM
        // ----------------------------------------------------
        const {
            data: contas,
            error: erroContas
        } = await _supabase.rpc(
                'listar_contas_receber_admin',
                {
                    p_busca: busca || null,
                    p_status: status
                }
        );

        if (erroContas) {
            throw erroContas;
        }

        // ----------------------------------------------------
        // RESUMO
        // ----------------------------------------------------
        const {
            data: resumo,
            error: erroResumo
        } = await _supabase.rpc(
                'resumo_contas_receber_admin'
                );

        if (erroResumo) {
            throw erroResumo;
        }

// ----------------------------------------------------
// ATUALIZA INDICADORES
// O RPC retorna uma lista com uma única linha.
// ----------------------------------------------------
        const resumoLinha =
                Array.isArray(resumo)
                ? (resumo[0] || {})
                : (resumo || {});

        const quantidadeContasAbertas =
                Number(
                        resumoLinha.quantidade_contas_abertas || 0
                        );

        const valorAberto =
                Number(
                        resumoLinha.total_em_aberto || 0
                        );

        const valorVencido =
                Number(
                        resumoLinha.total_vencido || 0
                        );

        // ----------------------------------------------------
// TOTAL RECEBIDO
// Considera também contas parcialmente pagas.
// ----------------------------------------------------
        let valorRecebido = 0;

        try {

            const {
                data: contasRecebidas,
                error: erroContasRecebidas
            } = await _supabase.rpc(
                    'listar_contas_receber_admin',
                    {
                        p_busca: null,
                        p_status: 'TODOS'
                    }
            );

            if (erroContasRecebidas) {

                console.error(
                        'Erro ao calcular total recebido:',
                        erroContasRecebidas
                        );

                // Mantém o valor antigo como fallback.
                valorRecebido =
                        Number(
                                resumoLinha.total_recebido || 0
                                );

            } else {

                valorRecebido =
                        (contasRecebidas || []).reduce(
                        (
                                total,
                                conta
                                ) =>
                    total +
                            Number(
                                    conta.valor_pago || 0
                                    ),
                        0
                        );
            }

        } catch (erroTotalRecebido) {

            console.error(
                    'Exceção ao calcular total recebido:',
                    erroTotalRecebido
                    );

            valorRecebido =
                    Number(
                            resumoLinha.total_recebido || 0
                            );
        }

        const elemAberto =
                document.getElementById(
                        'fin-ar-total-aberto'
                        );

        const elemVencido =
                document.getElementById(
                        'fin-ar-total-vencido'
                        );

        const elemRecebido =
                document.getElementById(
                        'fin-ar-total-recebido'
                        );

        if (elemAberto) {
            elemAberto.innerText =
                    `R$ ${valorAberto.toFixed(2).replace('.', ',')}`;
        }

        if (elemVencido) {
            elemVencido.innerText =
                    `R$ ${valorVencido.toFixed(2).replace('.', ',')}`;
        }

        if (elemRecebido) {
            elemRecebido.innerText =
                    `R$ ${valorRecebido.toFixed(2).replace('.', ',')}`;
        }

        // ----------------------------------------------------
        // NENHUMA CONTA
        // ----------------------------------------------------
        if (!contas || contas.length === 0) {

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="8"
                        style="
                            text-align:center;
                            color:#aaa;
                            padding:25px;
                        "
                    >
                        📭 Nenhuma conta encontrada.
                    </td>
                </tr>
            `;

            return;
        }

        // ----------------------------------------------------
        // FORMATAÇÃO
        // ----------------------------------------------------
        const dinheiro = valor =>
                `R$ ${Number(valor || 0)
                    .toFixed(2)
                    .replace('.', ',')}`;

        const dataBR = valor => {

            if (!valor) {
                return '-';
            }

            const partes =
                    String(valor)
                    .substring(0, 10)
                    .split('-');

            if (partes.length !== 3) {
                return valor;
            }

            return `${partes[2]}/${partes[1]}/${partes[0]}`;
        };

        const escaparHTML = valor =>
            String(valor ?? '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');

        // ----------------------------------------------------
        // RENDERIZA TABELA
        // ----------------------------------------------------
        tbody.innerHTML = contas.map(conta => {

            const cliente =
                    escaparHTML(
                            conta.cliente_nome || 'Sem nome'
                            );

            const pedido =
                    Number(conta.pedido_id || 0);

            const valorTotal =
                    dinheiro(conta.valor_total);

            const valorPago =
                    dinheiro(conta.valor_pago);

            const saldo =
                    dinheiro(conta.saldo_aberto);

            const vencimento =
                    dataBR(conta.data_vencimento);

            const statusAtual =
                    String(conta.status || '')
                    .toUpperCase();

            let statusTexto = statusAtual;
            let statusCor = '#aaa';

            if (statusAtual === 'PENDENTE') {
                statusTexto = 'PENDENTE';
                statusCor = '#ffa502';
            } else if (statusAtual === 'VENCIDA') {
                statusTexto = 'VENCIDA';
                statusCor = '#ff4757';
            } else if (statusAtual === 'PAGA') {
                statusTexto = 'PAGA';
                statusCor = '#2ed573';
            } else if (statusAtual === 'CANCELADA') {
                statusTexto = 'CANCELADA';
                statusCor = '#777';
            }

            let acao = `
    <div
        style="
            display:flex;
            flex-wrap:wrap;
            gap:6px;
            align-items:center;
        "
    >

        <button
            type="button"
            onclick="abrirDetalhesPedidoContaUI(${Number(conta.pedido_id || 0)})"
            style="
                border:1px solid #1e90ff;
                background:#1e90ff22;
                color:#1e90ff;
                border-radius:5px;
                padding:6px 10px;
                cursor:pointer;
                font-weight:bold;
            "
        >
            👁️ Detalhes
        </button>

        ${
                    (
                            statusAtual === 'PENDENTE' ||
                            statusAtual === 'VENCIDA'
                            )
                    ? `
            <button
                type="button"
                onclick="abrirRecebimentoContaUI(${Number(conta.id)})"
                style="
                    border:1px solid #2ed573;
                    background:#2ed57322;
                    color:#2ed573;
                    border-radius:5px;
                    padding:6px 10px;
                    cursor:pointer;
                    font-weight:bold;
                "
            >
                💰 Receber
            </button>
        `
                    : ''
                    }

    </div>
`;

            return `
                <tr>

                    <td>
                        <strong>
                            ${cliente}
                        </strong>
                    </td>

                    <td>
                        #${pedido}
                    </td>

                    <td>
                        ${valorTotal}
                    </td>

                    <td>
                        ${valorPago}
                    </td>

                    <td
                        style="
                            font-weight:bold;
                            color:${
                    Number(conta.saldo_aberto || 0) > 0
                    ? '#ffa502'
                    : '#2ed573'
                    };
                        "
                    >
                        ${saldo}
                    </td>

                    <td>
                        ${vencimento}
                    </td>

                    <td>
                        <span
                            style="
                                color:${statusCor};
                                font-weight:bold;
                            "
                        >
                            ${statusTexto}
                        </span>
                    </td>

                    <td>
                        ${acao}
                    </td>
                </tr>
            `;

        }).join('');

    } catch (err) {

        console.error(
                'Erro ao carregar contas a receber:',
                err
                );

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="8"
                    style="
                        text-align:center;
                        color:#ff4757;
                        padding:20px;
                    "
                >
                    ❌ Erro ao carregar Contas a Receber:
                    ${escaparTextoSeguro(err?.message || err)}
                </td>
            </tr>
        `;
    }
}

// ============================================================
// LIMPA FILTROS
// ============================================================
function limparFiltrosContasReceberUI() {

    const busca =
            document.getElementById(
                    'fin-ar-busca'
                    );

    const status =
            document.getElementById(
                    'fin-ar-status'
                    );

    if (busca) {
        busca.value = '';
    }

    if (status) {
        status.value = 'TODOS';
    }

    carregarContasReceberUI();
}

// ============================================================
// AUXILIAR DE SEGURANÇA PARA MENSAGENS DE ERRO
// ============================================================
function escaparTextoSeguro(valor) {

    return String(valor ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

// ============================================================
// DETALHES DO PEDIDO DA CONTA A RECEBER
// ============================================================
async function abrirDetalhesPedidoContaUI(pedidoId) {

    const id = Number(pedidoId);

    if (!Number.isInteger(id) || id <= 0) {
        alert('❌ Pedido inválido.');
        return;
    }

    try {

        const {
            data,
            error
        } = await _supabase.rpc(
                'obter_detalhes_pedido_admin',
                {
                    p_pedido_id: id
                }
        );

        if (error) {
            throw error;
        }

        const detalhes =
                data && typeof data === 'object'
                ? data
                : null;

        if (!detalhes || !detalhes.pedido) {
            alert(
                    '⚠️ Não foi possível encontrar os detalhes deste pedido.'
                    );
            return;
        }

        const pedido = detalhes.pedido || {};
        const cliente = detalhes.cliente || {};

        const itens =
                Array.isArray(detalhes.itens)
                ? detalhes.itens
                : [];

        const dinheiro = valor =>
                `R$ ${Number(valor || 0)
                    .toFixed(2)
                    .replace('.', ',')}`;

        const escapar =
                valor =>
            escaparTextoSeguro(valor ?? '-');

        const dataHora =
                pedido.criado_em
                ? new Date(
                        pedido.criado_em
                        ).toLocaleString('pt-BR')
                : '-';

        const modalAntigo =
                document.getElementById(
                        'modal-detalhes-pedido-conta'
                        );

        if (modalAntigo) {
            modalAntigo.remove();
        }

        const modal =
                document.createElement('div');

        modal.id =
                'modal-detalhes-pedido-conta';

        modal.className =
                'login-overlay';

        modal.style.display =
                'flex';

        modal.innerHTML = `

            <div
                class="login-card"
                style="
                    width:100%;
                    max-width:720px;
                    max-height:90vh;
                    overflow-y:auto;
                "
            >

                <div
                    style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                        gap:15px;
                        margin-bottom:20px;
                    "
                >

                    <h2
                        style="
                            margin:0;
                            color:#fff;
                        "
                    >
                        📄 Detalhes do Pedido #${id}
                    </h2>

                    <button
                        type="button"
                        onclick="fecharDetalhesPedidoContaUI()"
                        style="
                            background:none;
                            border:none;
                            color:#aaa;
                            font-size:1.4rem;
                            cursor:pointer;
                        "
                    >
                        ✖
                    </button>

                </div>

                <!-- CLIENTE -->

                <div
                    style="
                        display:grid;
                        grid-template-columns:
                            repeat(2,minmax(0,1fr));
                        gap:10px;
                        margin-bottom:15px;
                    "
                >

                    <div style="
                        background:#1e1e24;
                        border:1px solid #3d3d4e;
                        border-radius:8px;
                        padding:12px;
                    ">
                        <span style="
                            display:block;
                            color:#aaa;
                            font-size:.8rem;
                        ">
                            Cliente
                        </span>

                        <strong style="
                            display:block;
                            margin-top:4px;
                            color:#fff;
                        ">
                            ${escapar(
                cliente.nome ||
                'Sem nome'
                )}
                        </strong>
                    </div>

                    <div style="
                        background:#1e1e24;
                        border:1px solid #3d3d4e;
                        border-radius:8px;
                        padding:12px;
                    ">
                        <span style="
                            display:block;
                            color:#aaa;
                            font-size:.8rem;
                        ">
                            Data / Hora
                        </span>

                        <strong style="
                            display:block;
                            margin-top:4px;
                            color:#fff;
                        ">
                            ${escapar(dataHora)}
                        </strong>
                    </div>

                    <div style="
                        background:#1e1e24;
                        border:1px solid #3d3d4e;
                        border-radius:8px;
                        padding:12px;
                    ">
                        <span style="
                            display:block;
                            color:#aaa;
                            font-size:.8rem;
                        ">
                            Telefone
                        </span>

                        <strong style="
                            display:block;
                            margin-top:4px;
                            color:#fff;
                        ">
                            ${escapar(
                cliente.telefone ||
                pedido.telefone_cliente ||
                '-'
                )}
                        </strong>
                    </div>

                    <div style="
                        background:#1e1e24;
                        border:1px solid #3d3d4e;
                        border-radius:8px;
                        padding:12px;
                    ">
                        <span style="
                            display:block;
                            color:#aaa;
                            font-size:.8rem;
                        ">
                            Forma de pagamento
                        </span>

                        <strong style="
                            display:block;
                            margin-top:4px;
                            color:#fff;
                        ">
                            ${escapar(
                pedido.forma_pagamento ||
                '-'
                )}
                        </strong>
                    </div>

                </div>

                <!-- ITENS -->

                <div
                    style="
                        background:#2a2a35;
                        border:1px solid #3d3d4e;
                        border-radius:8px;
                        padding:15px;
                        margin-bottom:18px;
                    "
                >

                    <strong style="color:#fff;">
                        Itens do pedido
                    </strong>

                    <div
                        style="
                            overflow-x:auto;
                            margin-top:10px;
                        "
                    >

                        <table
                            class="products-table"
                            style="
                                width:100%;
                                font-size:.88rem;
                            "
                        >

                            <thead>
                                <tr>
                                    <th>Produto</th>
                                    <th>Qtd.</th>
                                    <th>Unitário</th>
                                    <th>Subtotal</th>
                                </tr>
                            </thead>

                            <tbody>

                                ${
                itens.length
                ? itens.map(item => `
                                        <tr>

                                            <td>
                                                <strong>
                                                    ${escapar(
                            item.produto_nome ||
                            'Produto'
                            )}
                                                </strong>
                                            </td>

                                            <td>
                                                ${Number(
                            item.quantidade || 0
                            )}
                                            </td>

                                            <td>
                                                ${dinheiro(
                            item.preco_unitario
                            )}
                                            </td>

                                            <td>
                                                ${dinheiro(
                            item.subtotal
                            )}
                                            </td>

                                        </tr>
                                    `).join('')
                : `
                                        <tr>
                                            <td
                                                colspan="4"
                                                style="
                                                    text-align:center;
                                                    color:#aaa;
                                                    padding:18px;
                                                "
                                            >
                                                Nenhum item encontrado.
                                            </td>
                                        </tr>
                                    `
                }

                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- TOTAL -->
                <div
                    style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                        background:#1e1e24;
                        border:1px solid #3d3d4e;
                        border-radius:8px;
                        padding:14px;
                        margin-bottom:18px;
                    "
                >

                    <strong style="
                        color:#fff;
                        font-size:1.05rem;
                    ">
                        Total do pedido
                    </strong>

                    <strong style="
                        color:#2ed573;
                        font-size:1.25rem;
                    ">
                        ${dinheiro(pedido.valor_total)}
                    </strong>
                </div>

                <div
                    style="
                        display:flex;
                        justify-content:flex-end;
                    "
                >

                    <button
                        type="button"
                        onclick="fecharDetalhesPedidoContaUI()"
                        style="
                            padding:11px 18px;
                            background:#555;
                            color:#fff;
                            border:none;
                            border-radius:6px;
                            cursor:pointer;
                        ">
                        Fechar
                    </button>
                </div>
            </div>

        `;

        document.body.appendChild(modal);

        modal.addEventListener(
                'click',
                event => {

                    if (event.target === modal) {
                        fecharDetalhesPedidoContaUI();
                    }

                }
        );

    } catch (err) {

        console.error(
                'Erro ao abrir detalhes do pedido:',
                err
                );

        alert(
                '❌ Não foi possível abrir os detalhes do pedido:\n\n' +
                (err?.message || err)
                );
    }
}

// ============================================================
// FECHA DETALHES
// ============================================================
function fecharDetalhesPedidoContaUI() {

    const modal =
            document.getElementById(
                    'modal-detalhes-pedido-conta'
                    );

    if (modal) {
        modal.remove();
    }
}

// ============================================================
// PLACEHOLDER DO PRÓXIMO PASSO
// ============================================================
async function abrirRecebimentoContaUI(contaId) {

    const id = Number(contaId);

    if (!Number.isInteger(id) || id <= 0) {
        alert('❌ Conta a receber inválida.');
        return;
    }

    try {

        // ====================================================
        // BUSCA A CONTA ATUALIZADA NO BANCO
        // ====================================================
        const {
            data: contas,
            error
        } = await _supabase.rpc(
                'listar_contas_receber_admin',
                {
                    p_busca: null,
                    p_status: 'TODOS'
                }
        );

        if (error) {
            throw error;
        }

        const conta =
                (contas || []).find(
                c => Number(c.id) === id
        );

        if (!conta) {
            alert(
                    '⚠️ Esta conta não foi encontrada ou já não está disponível.'
                    );

            return;
        }

        const saldo =
                Number(
                        conta.saldo_aberto || 0
                        );

        if (saldo <= 0 || conta.status === 'PAGA') {
            alert('ℹ️ Esta conta já está paga.');
            return;
        }

        // ====================================================
        // REMOVE MODAL ANTERIOR
        // ====================================================
        const modalAntigo =
                document.getElementById(
                        'modal-recebimento-conta'
                        );

        if (modalAntigo) {
            modalAntigo.remove();
        }

        // ====================================================
        // FORMATAÇÃO
        // ====================================================
        const dinheiro =
                Number(saldo)
                .toFixed(2)
                .replace('.', ',');

        const valorTotal =
                Number(conta.valor_total || 0)
                .toFixed(2)
                .replace('.', ',');

        const valorPago =
                Number(conta.valor_pago || 0)
                .toFixed(2)
                .replace('.', ',');

        const vencimento =
                conta.data_vencimento
                ? String(conta.data_vencimento)
                .substring(0, 10)
                .split('-')
                .reverse()
                .join('/')
                : '-';

        // ====================================================
        // CRIA MODAL
        // ====================================================
        const modal =
                document.createElement('div');

        modal.id =
                'modal-recebimento-conta';

        modal.className =
                'login-overlay';

        modal.style.display =
                'flex';

        modal.innerHTML = `

            <div
                class="login-card"
                style="
                    width: 100%;
                    max-width: 520px;
                    max-height: 90vh;
                    overflow-y: auto;
                "
            >

                <!-- CABEÇALHO -->

                <div
                    style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                        gap:15px;
                        margin-bottom:20px;
                    "
                >

                    <h2
                        style="
                            margin:0;
                            color:#fff;
                        "
                    >
                        💰 Receber Conta
                    </h2>

                    <button
                        type="button"
                        onclick="fecharRecebimentoContaUI()"
                        style="
                            background:none;
                            border:none;
                            color:#aaa;
                            font-size:1.4rem;
                            cursor:pointer;
                        "
                    >
                        ✖
                    </button>

                </div>

                <!-- CLIENTE -->

                <div
                    style="
                        background:#1e1e24;
                        border:1px solid #3d3d4e;
                        border-radius:8px;
                        padding:15px;
                        margin-bottom:15px;
                    "
                >

                    <div
                        style="
                            color:#aaa;
                            font-size:0.8rem;
                            margin-bottom:4px;
                        "
                    >
                        CLIENTE
                    </div>

                    <strong
                        style="
                            color:#fff;
                            font-size:1.1rem;
                        "
                    >
                        ${escaparTextoSeguro(conta.cliente_nome || 'Sem nome')}
                    </strong>

                    <div
                        style="
                            color:#aaa;
                            margin-top:6px;
                            font-size:0.85rem;
                        "
                    >
                        ${conta.cliente_documento
                ? 'CPF: ' + escaparTextoSeguro(conta.cliente_documento)
                : ''
                }

                        ${conta.cliente_telefone
                ? (
                        conta.cliente_documento
                        ? ' • '
                        : ''
                        ) +
                'Tel: ' +
                escaparTextoSeguro(conta.cliente_telefone)
                : ''
                }
                    </div>

                </div>

                <!-- DADOS DA CONTA -->

                <div
                    style="
                        display:grid;
                        grid-template-columns:repeat(2, 1fr);
                        gap:10px;
                        margin-bottom:18px;
                    "
                >

                    <div
                        style="
                            background:#1e1e24;
                            border:1px solid #3d3d4e;
                            border-radius:8px;
                            padding:12px;
                        "
                    >
                        <span
                            style="
                                display:block;
                                color:#aaa;
                                font-size:0.8rem;
                            "
                        >
                            Pedido
                        </span>

                        <strong
                            style="
                                display:block;
                                margin-top:4px;
                                color:#fff;
                            "
                        >
                            #${Number(conta.pedido_id || 0)}
                        </strong>
                    </div>

                    <div
                        style="
                            background:#1e1e24;
                            border:1px solid #3d3d4e;
                            border-radius:8px;
                            padding:12px;
                        "
                    >
                        <span
                            style="
                                display:block;
                                color:#aaa;
                                font-size:0.8rem;
                            "
                        >
                            Vencimento
                        </span>

                        <strong
                            style="
                                display:block;
                                margin-top:4px;
                                color:#fff;
                            "
                        >
                            ${vencimento}
                        </strong>
                    </div>

                </div>

                <!-- RESUMO FINANCEIRO -->

                <div
                    style="
                        background:#2a2a35;
                        border:1px solid #3d3d4e;
                        border-radius:8px;
                        padding:15px;
                        margin-bottom:18px;
                    "
                >

                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            margin-bottom:8px;
                        "
                    >
                        <span style="color:#aaa;">
                            Valor da conta
                        </span>

                        <strong style="color:#fff;">
                            R$ ${valorTotal}
                        </strong>
                    </div>

                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            margin-bottom:10px;
                        "
                    >
                        <span style="color:#aaa;">
                            Já pago
                        </span>

                        <strong style="color:#2ed573;">
                            R$ ${valorPago}
                        </strong>
                    </div>

                    <hr
                        style="
                            border:0;
                            border-top:1px solid #3d3d4e;
                            margin:10px 0;
                        "
                    >

                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            font-size:1.15rem;
                        "
                    >

                        <strong style="color:#fff;">
                            Saldo a receber
                        </strong>

                        <strong style="color:#ffa502;">
                            R$ ${dinheiro}
                        </strong>

                    </div>

                </div>

                <!-- VALOR -->

                <div
                    style="
                        margin-bottom:15px;
                    "
                >

                    <label
                        style="
                            display:block;
                            color:#aaa;
                            font-size:0.85rem;
                            margin-bottom:6px;
                        "
                    >
                        Valor do recebimento
                    </label>

                    <input
                        type="text"
                        id="fin-ar-valor-recebimento"
                        value="R$ ${dinheiro}"
                        style="
                            width:100%;
                            box-sizing:border-box;
                            padding:12px;
                            font-size:1.15rem;
                            font-weight:bold;
                            color:#ffa502;
                            background:#1e1e24;
                            border:1px solid #3d3d4e;
                            border-radius:6px;
                        "
                    >

                </div>

                <!-- FORMA DE PAGAMENTO -->

                <div
                    style="
                        margin-bottom:20px;
                    "
                >

                    <label
                        style="
                            display:block;
                            color:#aaa;
                            font-size:0.85rem;
                            margin-bottom:6px;
                        "
                    >
                        Forma de pagamento
                    </label>

                    <select
                        id="fin-ar-forma-recebimento"
                        class="input-table"
                        style="
                            width:100%;
                            box-sizing:border-box;
                        "
                    >

                        <option value="DINHEIRO">
                            💵 Dinheiro
                        </option>

                        <option value="PIX">
                            📱 PIX
                        </option>

                   <!--     <option value="CARTAO_DEBITO">
                            💳 Cartão de Débito
                        </option>

                        <option value="CARTAO_CREDITO">
                            💳 Cartão de Crédito
                        </option>     -->

                    </select>

                </div>

                <!-- AVISO -->

                <div
                    style="
                        background:#ffa50215;
                        border:1px solid #ffa50255;
                        border-radius:8px;
                        padding:12px;
                        margin-bottom:20px;
                        color:#ffd166;
                        font-size:0.85rem;
                    "
                >
                    ⚠️ Nesta etapa nenhum valor foi alterado.
                    O recebimento será confirmado somente ao clicar
                    em <strong>Confirmar Recebimento</strong>.
                </div>

                <!-- BOTÕES -->

                <div
                    style="
                        display:flex;
                        justify-content:flex-end;
                        gap:10px;
                    "
                >

                    <button
                        type="button"
                        onclick="fecharRecebimentoContaUI()"
                        style="
                            padding:11px 18px;
                            background:#555;
                            color:#fff;
                            border:none;
                            border-radius:6px;
                            cursor:pointer;
                        "
                    >
                        Cancelar
                    </button>

                    <button
    type="button"
    id="btn-confirmar-recebimento"
    onclick="confirmarRecebimentoContaUI(${id})"
    style="
        padding:11px 18px;
        background:#2ed573;
        color:#fff;
        border:none;
        border-radius:6px;
        font-weight:bold;
        opacity:1;
        cursor:pointer;
    "
>
    ✅ Confirmar Recebimento
</button>

                </div>

            </div>

        `;

        document.body.appendChild(modal);

        // ====================================================
        // FECHAR CLICANDO FORA
        // ====================================================
        modal.addEventListener(
                'click',
                function (event) {

                    if (event.target === modal) {
                        fecharRecebimentoContaUI();
                    }

                }
        );

    } catch (err) {

        console.error(
                'Erro ao abrir recebimento:',
                err
                );

        alert(
                '❌ Não foi possível abrir o recebimento:\\n\\n' +
                (err?.message || err)
                );
    }
}

// ============================================================
// FECHA MODAL
// ============================================================
function fecharRecebimentoContaUI() {

    const modal =
            document.getElementById(
                    'modal-recebimento-conta'
                    );

    if (modal) {
        modal.remove();
    }
}

// ============================================================
// RECEBIMENTO DE CONTA A RECEBER
// ============================================================
async function confirmarRecebimentoContaUI(contaId) {

    const id = Number(contaId);

    if (!Number.isInteger(id) || id <= 0) {
        alert('❌ Conta inválida.');
        return;
    }

    const campoValor =
            document.getElementById('fin-ar-valor-recebimento');

    const campoForma =
            document.getElementById('fin-ar-forma-recebimento');

    if (!campoValor || !campoForma) {
        alert('❌ Dados do recebimento não encontrados.');
        return;
    }

    const textoValor =
            String(campoValor.value || '')
            .replace(/R\$/gi, '')
            .replace(/\s/g, '')
            .trim();

    let textoValorNormalizado = textoValor;

    if (textoValor.includes(',')) {

        textoValorNormalizado =
                textoValor
                .replace(/\./g, '')
                .replace(',', '.');
    }

    const valor = Number(textoValorNormalizado);

    const saldoMaximo = Number(campoValor.dataset.saldoMaximo || 0);

    if (
            !Number.isFinite(valor) ||
            valor <= 0
            ) {
        alert(
                '⚠️ Valor de recebimento inválido.'
                );

        campoValor.focus();
        return;
    }

    if (
            Number.isFinite(saldoMaximo) &&
            saldoMaximo > 0 &&
            valor > saldoMaximo + 0.000001
            ) {

        alert(
                `⚠️ O valor informado não pode ser maior que o saldo da conta.\n\n` +
                `Saldo disponível: R$ ${saldoMaximo
                .toFixed(2)
                .replace('.', ',')}`
                );

        campoValor.focus();
        return;
    }

    const formaPagamento =
            String(campoForma.value || '')
            .toUpperCase()
            .trim();

    if (!Number.isFinite(valor) || valor <= 0) {
        alert('⚠️ Valor de recebimento inválido.');
        return;
    }

    if (
            ![
                'DINHEIRO',
                'PIX',
                'CARTAO_DEBITO',
                'CARTAO_CREDITO'
            ].includes(formaPagamento)
            ) {
        alert('⚠️ Selecione uma forma de pagamento válida.');
        return;
    }

    const confirmar = confirm(
            `💰 Confirmar recebimento da conta #${id}?\n\n` +
            `Valor: R$ ${valor.toFixed(2).replace('.', ',')}\n` +
            `Forma: ${formaPagamento}`
            );

    if (!confirmar) {
        return;
    }

    const botao =
            document.getElementById('btn-confirmar-recebimento');

    if (botao) {
        botao.disabled = true;
        botao.style.opacity = '0.6';
        botao.style.cursor = 'wait';
        botao.innerText = '⏳ Processando...';
    }

    try {

        const {
            data,
            error
        } = await _supabase.rpc(
                'receber_conta_receber_admin',
                {
                    p_conta_id: id,
                    p_valor: valor,
                    p_forma_pagamento: formaPagamento
                }
        );

        if (error) {
            console.error(
                    'Erro ao receber conta:',
                    error
                    );

            const mensagem =
                    error.message || '';

            if (mensagem.includes('CAIXA_NAO_ABERTO')) {

                alert(
                        '⚠️ Para recebimento em DINHEIRO, é necessário existir um caixa aberto.'
                        );

            } else if (
                    mensagem.includes('VALOR_INVALIDO')
                    ) {

                alert(
                        '⚠️ O valor informado não confere com o saldo da conta.'
                        );

            } else if (
                    mensagem.includes('ALREADY_PAGA')
                    ) {

                alert(
                        '⚠️ Esta conta já foi paga.'
                        );

            } else if (
                    mensagem.includes('CANCELADA')
                    ) {

                alert(
                        '⚠️ Esta conta está cancelada.'
                        );

            } else {

                alert(
                        '❌ Não foi possível receber a conta:\n\n' +
                        mensagem
                        );
            }

            return;
        }

        if (!data?.sucesso) {
            throw new Error(
                    'O banco não confirmou o recebimento.'
                    );
        }

        fecharRecebimentoContaUI();

        alert(
                `✅ Conta #${id} recebida com sucesso!\n\n` +
                `Valor: R$ ${valor.toFixed(2).replace('.', ',')}\n` +
                `Forma: ${formaPagamento}`
                );

        await carregarContasReceberUI();

        if (
                typeof caixaAtual !== 'undefined' &&
                caixaAtual &&
                caixaAtual.status === 'ABERTO'
                ) {
            await exibirPainelCaixaAberto();
        }

    } catch (err) {

        console.error(
                'Exceção ao receber conta:',
                err
                );

        alert(
                '❌ Erro ao receber conta:\n\n' +
                (err.message || err)
                );

    } finally {

        if (botao) {
            botao.disabled = false;
            botao.style.opacity = '1';
            botao.style.cursor = 'pointer';
            botao.innerText = '✅ Confirmar Recebimento';
        }
    }
}

// ============================================================
// CENTRAL DE AJUDA DO PDV
// ============================================================

const AJUDA_PDV_ETAPAS = [
    {
        categoria: 'Primeiros passos',
        titulo: 'Faça o login',
        icone: '🔐',
        texto: `Informe seu e-mail e sua senha para entrar no PDV.<br><br>
                Depois do login, o sistema identifica seu usuário, cargo e permissões.<br><br>
                <strong>Importante:</strong> não compartilhe sua senha ou seu acesso com outra pessoa.`,
        aba: null
    },
    {
        categoria: 'Primeiros passos',
        titulo: 'Entenda seu acesso',
        icone: '👤',
        texto: `O PDV possui diferentes níveis de acesso.<br><br>
                <strong>Gerente/Admin:</strong> possui acesso administrativo às áreas protegidas.<br>
                <strong>Operador/Atendente:</strong> trabalha nas funções liberadas para sua função.<br><br>
                Algumas operações podem exigir autorização de gerente.`,
        aba: 'config',
        subaba: 'sub-permissoes'
    },
    {
        categoria: 'Preparação inicial',
        titulo: 'Configure o caixa',
        icone: '💵',
        texto: `Antes de vender, confira o caixa do dia.<br><br>
                Em <strong>Configurações → Operação de Caixa</strong>, você encontra o status do caixa, saldo inicial e movimentações.<br><br>
                No uso diário, a operação começa com a <strong>abertura do caixa</strong>.`,
        aba: 'config',
        subaba: 'sub-caixa'
    },
    {
        categoria: 'Preparação inicial',
        titulo: 'Configure a loja virtual',
        icone: '🌐',
        texto: `Em <strong>Configurações → Loja Virtual & Delivery</strong>, o gerente pode ajustar o funcionamento da loja online.<br><br>
                Confira nome da loja, status aberta/fechada, valor mínimo do pedido e notificações.`,
        aba: 'config',
        subaba: 'sub-loja'
    },
    {
        categoria: 'Cadastros',
        titulo: 'Cadastre os insumos',
        icone: '🧪',
        texto: `Insumos são matérias-primas usadas nas fichas técnicas e produções.<br><br>
                Cadastre os itens com suas unidades e informações de controle antes de montar fichas técnicas.`,
        aba: 'cadastros',
        subaba: 'insumos'
    },
    {
        categoria: 'Cadastros',
        titulo: 'Cadastre os fornecedores',
        icone: '🏭',
        texto: `Cadastre os fornecedores que entregam mercadorias e matérias-primas.<br><br>
                Essas informações facilitam o registro de compras e a organização administrativa.`,
        aba: 'cadastros',
        subaba: 'fornecedores'
    },
    {
        categoria: 'Cadastros',
        titulo: 'Cadastre os clientes',
        icone: '👤',
        texto: `Cadastre os clientes para usar identificação nas vendas e, quando necessário, no FIADO e no financeiro.<br><br>
                Mantenha telefone e dados de contato atualizados.`,
        aba: 'cadastros',
        subaba: 'clientes'
    },
    {
        categoria: 'Cadastros',
        titulo: 'Cadastre as cidades',
        icone: '🏙️',
        texto: `As cidades organizam as áreas de entrega e suas taxas.<br><br>
                Confira o nome, UF, taxa de entrega e se a cidade está ativa.`,
        aba: 'cadastros',
        subaba: 'cidades'
    },
    {
        categoria: 'Produtos',
        titulo: 'Cadastre os produtos',
        icone: '📦',
        texto: `Em <strong>Produtos & Estoque → Novo Produto</strong>, cadastre nome, código de barras, descrição, categoria, estoque, custo, margem, preço de venda e imagem.<br><br>
                <strong>Dica:</strong> o código de barras deve conter somente números e ter no máximo 14 dígitos.`,
        aba: 'produtos'
    },
    {
        categoria: 'Produtos',
        titulo: 'Mantenha estoque e preços',
        icone: '📊',
        texto: `Na tabela de produtos você pode acompanhar estoque, custo, margem, preço e status.<br><br>
                Gerente/Admin também pode editar rapidamente os dados do produto e trocar a imagem.`,
        aba: 'produtos'
    },
    {
        categoria: 'Produção',
        titulo: 'Monte a Ficha Técnica',
        icone: '📋',
        texto: `A Ficha Técnica define quais insumos entram na fabricação de cada produto e em quais quantidades.<br><br>
                Ela é a base para calcular custos e permitir o consumo automático dos insumos na produção.`,
        aba: 'ficha-tecnica'
    },
    {
        categoria: 'Compras',
        titulo: 'Registre as compras',
        icone: '🛒',
        texto: `Em <strong>Compras</strong>, registre fornecedor, itens, quantidades e custos.<br><br>
                Depois, confira os detalhes da compra e registre a <strong>entrada</strong> quando a mercadoria for recebida.`,
        aba: 'compras'
    },
    {
        categoria: 'Produção',
        titulo: 'Registre a produção',
        icone: '🏭',
        texto: `Em <strong>Produtos & Estoque → Produção</strong>, escolha o produto, informe a quantidade e confirme a produção.<br><br>
                O sistema usa a ficha técnica para consumir os insumos e registrar a produção e seus custos.`,
        aba: 'produtos'
    },
    {
        categoria: 'Vendas',
        titulo: 'Venda no balcão',
        icone: '🛒',
        texto: `<strong>Fluxo recomendado:</strong><br><br>
                1. Confirme que o caixa está aberto.<br>
                2. Adicione os produtos.<br>
                3. Ajuste as quantidades.<br>
                4. Confira o subtotal.<br>
                5. Informe desconto, quando aplicável.<br>
                6. Escolha a forma de pagamento.<br>
                7. No dinheiro, informe o valor recebido e confira o troco.<br>
                8. Finalize a venda.`,
        aba: 'balcao'
    },
    {
        categoria: 'Pedidos',
        titulo: 'Acompanhe os pedidos',
        icone: '📋',
        texto: `A aba <strong>Pedidos</strong> usa um quadro de acompanhamento.<br><br>
                Os pedidos avançam por etapas como <strong>Novos → Em Preparo → A Caminho/Pronto → Concluídos</strong>.<br><br>
                Use essa tela para acompanhar o que precisa ser preparado e concluído.`,
        aba: 'pedidos'
    },
    {
        categoria: 'Consulta',
        titulo: 'Consulte histórico e estoque',
        icone: '📜',
        texto: `Use <strong>Histórico de Pedidos</strong> para consultar vendas e reimprimir pedidos.<br><br>
                Em <strong>Mov. Estoque</strong>, consulte as entradas e saídas registradas no estoque.`,
        aba: 'historico'
    },
    {
        categoria: 'Financeiro',
        titulo: 'Acompanhe o financeiro',
        icone: '📊',
        texto: `Em <strong>Finanças</strong>, acompanhe faturamento, caixa, despesas e contas a receber.<br><br>
                Quando uma conta for recebida, use a função de recebimento e confira a forma de pagamento e os valores do caixa.`,
        aba: 'financas'
    },
    {
        categoria: 'Controle',
        titulo: 'Feche o dia e confira a auditoria',
        icone: '🔎',
        texto: `No fim do dia, confira as vendas, recebimentos, sangrias, suprimentos e o saldo esperado do caixa.<br><br>
                Depois, use <strong>Auditoria</strong> para conferir vendas, caixa, estoque, despesas e eventos por período, usuário, caixa e cliente.<br><br>
                <strong>✅ Objetivo:</strong> encerrar o dia sabendo que os valores e movimentações conferem.`,
        aba: 'auditoria'
    }
];

const AJUDA_PDV_TELAS = {
    pedidos: {
        titulo: 'Pedidos',
        icone: '📋',
        texto: `Use esta tela para acompanhar os pedidos recebidos e o andamento da produção/entrega.<br><br>
                As colunas indicam em qual etapa cada pedido está.`,
        passos: ['Novos pedidos', 'Em preparo', 'A caminho/pronto', 'Concluídos']
    },

    balcao: {
        titulo: 'Venda de Balcão',
        icone: '🛒',
        texto: `Esta é a tela para vendas presenciais.<br><br>
                Adicione os produtos, ajuste quantidades, confira o total e escolha o pagamento. No dinheiro, informe o valor recebido para calcular o troco.`,
        passos: ['Adicionar produtos', 'Conferir total', 'Desconto', 'Pagamento e troco', 'Finalizar']
    },

    produtos: {
        titulo: 'Produtos & Estoque',
        icone: '📦',
        texto: `Aqui você cadastra produtos, controla preços e estoque e acessa produção/histórico de produção.<br><br>
                Gerente/Admin também pode editar produtos e a imagem.`,
        passos: ['Novo Produto', 'Produção', 'Histórico de Produções', 'Atualizar Lista']
    },

    'ficha-tecnica': {
        titulo: 'Ficha Técnica',
        icone: '📋',
        texto: `A Ficha Técnica define os ingredientes/insumos necessários para produzir cada produto e ajuda no controle de custos.`,
        passos: ['Escolher produto', 'Adicionar insumos', 'Definir quantidades', 'Salvar ficha']
    },

    cadastros: {
        titulo: 'Cadastros',
        icone: '📚',
        texto: `Central administrativa dos cadastros do sistema. Use as subabas para manter a base de insumos, fornecedores, clientes e cidades.`,
        passos: ['Insumos', 'Fornecedores', 'Clientes', 'Cidades']
    },

    compras: {
        titulo: 'Compras',
        icone: '🛒',
        texto: `Use esta tela para registrar compras e depois registrar a entrada da mercadoria recebida.`,
        passos: ['Criar compra', 'Adicionar itens', 'Conferir custos', 'Receber entrada']
    },

    historico: {
        titulo: 'Histórico de Pedidos',
        icone: '📜',
        texto: `Consulte vendas realizadas por período, veja os pedidos e use a reimpressão quando necessário.`,
        passos: ['Escolher período', 'Consultar pedidos', 'Ver detalhes', 'Reimprimir']
    },

    'mov-estoque': {
        titulo: 'Movimentações de Estoque',
        icone: '📦',
        texto: `Use esta tela para conferir o histórico das movimentações do estoque e investigar entradas e saídas.`,
        passos: ['Atualizar', 'Consultar movimentos', 'Conferir quantidades']
    },

    pix: {
        titulo: 'Pagamento via PIX',
        icone: '❖',
        texto: `Use esta área para gerar a placa/QR Code de PIX e imprimir ou salvar o material conforme o fluxo do sistema.`,
        passos: ['Informar dados', 'Gerar QR Code', 'Conferir valor', 'Imprimir']
    },

    financas: {
        titulo: 'Finanças',
        icone: '📊',
        texto: `Área para acompanhar faturamento, resultados, despesas, contas a receber e recebimentos.`,
        passos: ['Escolher período', 'Conferir vendas', 'Conferir despesas', 'Receber contas']
    },

    auditoria: {
        titulo: 'Auditoria',
        icone: '🔎',
        texto: `A Auditoria consolida informações para conferência administrativa e rastreabilidade.`,
        passos: ['Período', 'Usuário', 'Caixa', 'Cliente', 'Vendas/caixa/estoque/financeiro/eventos']
    },

    config: {
        titulo: 'Configurações',
        icone: '⚙️',
        texto: `Aqui ficam as configurações administrativas do caixa, loja virtual/delivery e permissões da equipe.`,
        passos: ['Operação de Caixa', 'Loja Virtual & Delivery', 'Permissões']
    }
};

let ajudaPDVModo = 'completo';
let ajudaPDVIndice = 0;
let ajudaPDVAtual = null;

function obterAbaAtualAjuda() {

    const abas = [
        'pedidos',
        'balcao',
        'produtos',
        'ficha-tecnica',
        'cadastros',
        'compras',
        'historico',
        'mov-estoque',
        'pix',
        'financas',
        'auditoria',
        'config'
    ];

    for (const nome of abas) {

        const el =
                document.getElementById(`aba-${nome}`);
        if (!el)
            continue;

        const estilo =
                window.getComputedStyle(el);

        if (estilo.display !== 'none') {
            return nome;
        }
    }

    return 'pedidos';
}

function atualizarBotoesModoAjuda() {

    const completo =
            document.getElementById(
                    'btn-ajuda-modo-completo'
                    );

    const tela =
            document.getElementById(
                    'btn-ajuda-modo-tela'
                    );

    if (completo) {

        completo.style.background =
                ajudaPDVModo === 'completo'
                ? '#2a2a35'
                : '#1e1e24';

        completo.style.color =
                ajudaPDVModo === 'completo'
                ? '#fff'
                : '#aaa';
    }

    if (tela) {

        tela.style.background =
                ajudaPDVModo === 'tela'
                ? '#2a2a35'
                : '#1e1e24';

        tela.style.color =
                ajudaPDVModo === 'tela'
                ? '#fff'
                : '#aaa';
    }
}

function abrirCentralAjuda(modo = 'completo') {

    const modal =
            document.getElementById(
                    'modal-central-ajuda'
                    );

    if (!modal)
        return;

    ajudaPDVModo =
            modo === 'tela'
            ? 'tela'
            : 'completo';

    if (ajudaPDVModo === 'completo') {

        ajudaPDVIndice = 0;
        ajudaPDVAtual = null;

    } else {

        ajudaPDVAtual =
                obterAbaAtualAjuda();
    }

    modal.style.display = 'flex';

    atualizarBotoesModoAjuda();

    renderizarCentralAjuda();
}

function fecharCentralAjuda() {

    const modal =
            document.getElementById(
                    'modal-central-ajuda'
                    );

    if (modal) {
        modal.style.display = 'none';
    }
}

function obterAjudaAtual() {

    if (ajudaPDVModo === 'completo') {

        return AJUDA_PDV_ETAPAS[
                ajudaPDVIndice
        ];
    }

    return AJUDA_PDV_TELAS[
            ajudaPDVAtual
    ] || AJUDA_PDV_TELAS.pedidos;
}

function renderizarCentralAjuda() {

    const subtitulo =
            document.getElementById('ajuda-subtitulo');

    const conteudo =
            document.getElementById('ajuda-conteudo');

    const progresso =
            document.getElementById('ajuda-progresso');

    const progressoTexto =
            document.getElementById(
                    'ajuda-progresso-texto'
                    );

    const categoria =
            document.getElementById(
                    'ajuda-categoria'
                    );

    const barra =
            document.getElementById(
                    'ajuda-progresso-barra'
                    );

    const btnAnterior =
            document.getElementById(
                    'btn-ajuda-anterior'
                    );

    const btnProxima =
            document.getElementById(
                    'btn-ajuda-proxima'
                    );

    const btnAbrirTela =
            document.getElementById(
                    'btn-ajuda-ir-tela'
                    );

    const ajuda =
            obterAjudaAtual();

    if (!ajuda || !conteudo)
        return;

    if (ajudaPDVModo === 'completo') {

        const total =
                AJUDA_PDV_ETAPAS.length;

        const atual =
                ajudaPDVIndice + 1;

        const percentual =
                Math.max(
                        5.5,
                        (atual / total) * 100
                        );

        if (progresso) {
            progresso.style.display = 'block';
        }

        if (progressoTexto) {
            progressoTexto.textContent =
                    `${atual} de ${total}`;
        }

        if (categoria) {
            categoria.textContent =
                    ajuda.categoria;
        }

        if (barra) {
            barra.style.width =
                    `${percentual}%`;
        }

        if (subtitulo) {
            subtitulo.textContent =
                    'Aprenda a usar o sistema do começo ao fim.';
        }

        if (btnAnterior) {

            btnAnterior.disabled =
                    ajudaPDVIndice === 0;

            btnAnterior.style.opacity =
                    ajudaPDVIndice === 0
                    ? '.45'
                    : '1';

            btnAnterior.style.cursor =
                    ajudaPDVIndice === 0
                    ? 'not-allowed'
                    : 'pointer';
        }

        if (btnProxima) {

            btnProxima.textContent =
                    ajudaPDVIndice === total - 1
                    ? '✅ Concluir'
                    : 'Próximo →';
        }

    } else {

        if (progresso) {
            progresso.style.display = 'none';
        }

        if (subtitulo) {
            subtitulo.textContent =
                    'Orientações rápidas para a tela que está aberta.';
        }

        if (btnAnterior) {
            btnAnterior.style.display = 'none';
        }

        if (btnProxima) {
            btnProxima.style.display = 'none';
        }
    }

    const listaPassos =
            ajuda.passos
            ? `
                <div style="
                    margin-top:18px;
                    padding:14px;
                    border-radius:8px;
                    background:#1e1e24;
                    border:1px solid #3d3d4e;
                ">
                    <strong style="color:#fff;">
                        Passos principais
                    </strong>

                    <ol style="
                        margin:10px 0 0 20px;
                        color:#ccc;
                        line-height:1.65;
                    ">
                        ${ajuda.passos
            .map(p => `<li>${p}</li>`)
            .join('')}
                    </ol>
                </div>
            `
            : '';

    conteudo.innerHTML = `
        <div style="
            font-size:2.2rem;
            line-height:1;
            margin-bottom:12px;
        ">
            ${ajuda.icone || '💡'}
        </div>

        <h3 style="
            margin:0 0 10px;
            color:#fff;
            font-size:1.35rem;
        ">
            ${ajuda.titulo}
        </h3>

        <div style="
            color:#ccc;
            line-height:1.65;
            font-size:.95rem;
        ">
            ${ajuda.texto}
        </div>

        ${listaPassos}
    `;

    if (ajuda.aba) {

        if (btnAbrirTela) {

            btnAbrirTela.style.display =
                    'inline-block';

            btnAbrirTela.textContent =
                    ajuda.aba === 'config'
                    ? '👉 Abrir configurações'
                    : `👉 Abrir ${
                    AJUDA_PDV_TELAS[
                            ajuda.aba
                    ]?.titulo ||
                    ajuda.aba
                    }`;
        }

    } else if (btnAbrirTela) {

        btnAbrirTela.style.display =
                'none';
    }

    if (ajudaPDVModo === 'tela') {

        if (btnAnterior) {
            btnAnterior.style.display = 'none';
        }

        if (btnProxima) {
            btnProxima.style.display = 'none';
        }
    }

    atualizarBotoesModoAjuda();
}

function navegarAjuda(direcao) {

    if (ajudaPDVModo !== 'completo') {
        return;
    }

    const novoIndice =
            ajudaPDVIndice + direcao;

    if (novoIndice < 0) {
        return;
    }

    if (
            novoIndice >=
            AJUDA_PDV_ETAPAS.length
            ) {

        fecharCentralAjuda();

        localStorage.setItem(
                'pdv_ajuda_concluida',
                'true'
                );

        return;
    }

    ajudaPDVIndice =
            novoIndice;

    renderizarCentralAjuda();
}

function abrirSubAbaPorAjuda(idSubAba) {

    if (
            !idSubAba ||
            typeof window.alternarSubAba !== 'function'
            ) {
        return;
    }

    const botao =
            Array.from(
                    document.querySelectorAll(
                            '.btn-sub-tab'
                            )
                    )
            .find(
                    btn =>
                btn.getAttribute('onclick')
                        ?.includes(
                                `'${idSubAba}'`
                                )
            );

    if (botao) {
        window.alternarSubAba(
                idSubAba,
                botao
                );
    }
}

function abrirTelaAjuda(nomeAba, subaba = null) {

    if (!nomeAba) {
        return;
    }

    fecharCentralAjuda();

    try {

        if (
                typeof alternarAba ===
                'function'
                ) {

            alternarAba(nomeAba);
        }

    } catch (err) {

        console.error(
                'Erro ao abrir tela pela ajuda:',
                err
                );
    }

    if (subaba) {

        setTimeout(() => {

            if (nomeAba === 'cadastros') {

                const mapa = {

                    insumos:
                            'abrirCadastroInsumosUI',

                    fornecedores:
                            'abrirCadastroFornecedoresUI',

                    clientes:
                            'abrirCadastroClientesUI',

                    cidades:
                            'abrirCadastroCidadesUI'
                };

                const funcao =
                        mapa[subaba];

                if (
                        funcao &&
                        typeof window[funcao] === 'function'
                        ) {

                    window[funcao]();

                    return;
                }
            }

            abrirSubAbaPorAjuda(
                    subaba
                    );

        }, 250);
}
}

function irParaTelaDaAjuda() {

    const ajuda =
            obterAjudaAtual();

    if (!ajuda?.aba) {
        return;
    }

    abrirTelaAjuda(
            ajuda.aba,
            ajuda.subaba || null
            );
}

// Mostra automaticamente o primeiro treinamento somente no primeiro uso
function verificarPrimeiraAjudaPDV() {

    if (
            localStorage.getItem(
                    'pdv_ajuda_concluida'
                    ) === 'true'
            ) {
        return;
    }

    if (
            localStorage.getItem(
                    'pdv_ajuda_apresentada'
                    ) === 'true'
            ) {
        return;
    }

    localStorage.setItem(
            'pdv_ajuda_apresentada',
            'true'
            );

    setTimeout(() => {

        abrirCentralAjuda(
                'completo'
                );

    }, 700);
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

        verificarPrimeiraAjudaPDV();
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

        pinGerente =
                await solicitarPinGerenteSeguro(
                        'Digite o PIN do Gerente para cancelar este pedido:'
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
    const abaCadastros = document.getElementById('aba-cadastros');
    const abaCompras = document.getElementById('aba-compras');
    const abaHistorico = document.getElementById('aba-historico');
    const abaMovEstoque = document.getElementById('aba-mov-estoque');
    const abaConfig = document.getElementById('aba-config');
    const abaFinancas = document.getElementById('aba-financas');
    const abaAuditoria = document.getElementById('aba-auditoria');
    const abaPix = document.getElementById('aba-pix');

    const btnPedidos = document.getElementById('btn-tab-pedidos');
    const btnBalcao = document.getElementById('btn-tab-balcao');
    const btnProdutos = document.getElementById('btn-tab-produtos');
    const btnFichaTecnica = document.getElementById('btn-tab-ficha-tecnica');
    const btnCadastros = document.getElementById('btn-tab-cadastros');
    const btnCompras = document.getElementById('btn-tab-compras');
    const btnHistorico = document.getElementById('btn-tab-historico');
    const btnMovEstoque = document.getElementById('btn-tab-mov-estoque');
    const btnConfig = document.getElementById('btn-tab-config');
    const btnFinancas = document.getElementById('btn-tab-financas');
    const btnAuditoria = document.getElementById('btn-tab-auditoria');
    const btnPix = document.getElementById('btn-tab-pix');

    // Oculta todas
    abaPedidos.style.display = 'none';
    abaBalcao.style.display = 'none';
    abaProdutos.style.display = 'none';
    abaCompras.style.display = 'none';
    abaFichaTecnica.style.display = 'none';
    abaCadastros.style.display = 'none';
    abaHistorico.style.display = 'none';
    abaMovEstoque.style.display = 'none';
    abaConfig.style.display = 'none';
    abaFinancas.style.display = 'none';
    abaAuditoria.style.display = 'none';
    abaPix.style.display = 'none';

    btnPedidos.classList.remove('active');
    btnBalcao.classList.remove('active');
    btnProdutos.classList.remove('active');
    btnCompras.classList.remove('active');
    btnFichaTecnica.classList.remove('active');
    btnCadastros.classList.remove('active');
    btnHistorico.classList.remove('active');
    btnMovEstoque.classList.remove('active');
    btnConfig.classList.remove('active');
    btnFinancas.classList.remove('active');
    btnAuditoria.classList.remove('active');
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

        // Mantém o leitor de código pronto para uso
        setTimeout(() => {
            const campoCodigo = document.getElementById('balcao-input-codigo');
            if (campoCodigo) {
                campoCodigo.focus();
                campoCodigo.select();
            }
        }, 250);
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
    } else if (nomeAba === 'cadastros') {
        const cargo = String(
                window.usuarioAtual?.cargo || ''
                ).toUpperCase();

        const ehGerente =
                cargo === 'GERENTE' ||
                cargo === 'ADMIN';
        if (!ehGerente) {
            alert(
                    '⛔ Apenas GERENTE ou ADMIN podem acessar os Cadastros.'
                    );
            return;
        }

        abaCadastros.style.display = 'block';
        btnCadastros.classList.add('active');

        //await carregarCadastroInsumosUI();

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
    } else if (nomeAba === 'auditoria') {
        const cargo = String(window.usuarioAtual?.cargo || '').toUpperCase();
        const ehGerente = cargo === 'GERENTE' || cargo === 'ADMIN';
        if (!ehGerente) {
            alert('⛔ Apenas GERENTE ou ADMIN podem acessar a Auditoria.');
            return;
        }

        document.querySelectorAll('main[id^="aba-"]').forEach(aba => {
            aba.style.display = 'none';
        });
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

        const abaAuditoria = document.getElementById('aba-auditoria');
        const btnAuditoria = document.getElementById('btn-tab-auditoria');
        if (abaAuditoria)
            abaAuditoria.style.display = 'block';
        if (btnAuditoria)
            btnAuditoria.classList.add('active');

        await inicializarAuditoria();
        return;
    } else if (nomeAba === 'config') {
        abaConfig.style.display = 'block';
        btnConfig.classList.add('active');
        carregarConfiguracoesPDV();
    }
}

//
// ============================================================
// CADASTRO DE INSUMOS
// CARREGAMENTO DA LISTA
// ============================================================
async function carregarCadastroInsumosUI() {

    const tbody =
            document.getElementById(
                    'insumos-table-body'
                    );

    if (!tbody) {

        console.error(
                '⛔ Tabela de Insumos não encontrada.'
                );

        return;
    }

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
                ⏳ Carregando insumos...
            </td>
        </tr>
    `;

    try {

        // ----------------------------------------------------
        // 1. INSUMOS
        // ----------------------------------------------------

        const {
            data: insumos,
            error: erroInsumos
        } = await _supabase
                .from('insumos')
                .select(`
                    id,
                    nome,
                    produto_id,
                    unidade_base_id,
                    unidade_compra_id,
                    fator_compra_base,
                    estoque_minimo_base,
                    ativo,
                    observacao
                `)
                .order('nome');

        if (erroInsumos) {
            throw erroInsumos;
        }

        // ----------------------------------------------------
        // 2. UNIDADES DE MEDIDA
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
                    fator_base,
                    ativa
                `)
                .order('nome');

        if (erroUnidades) {
            throw erroUnidades;
        }

        // ----------------------------------------------------
        // 3. PRODUTOS
        // ----------------------------------------------------
        const {
            data: produtos,
            error: erroProdutos
        } = await _supabase
                .from('produtos')
                .select(`
                    id,
                    nome,
                    ativo
                `)
                .order('nome');

        if (erroProdutos) {
            throw erroProdutos;
        }

        // ----------------------------------------------------
// 4. ESTOQUE DOS INSUMOS
// ----------------------------------------------------
        const {
            data: estoques,
            error: erroEstoques
        } = await _supabase
                .from('estoque_insumos')
                .select(`
            insumo_id,
            quantidade_base
        `);

        if (erroEstoques) {
            throw erroEstoques;
        }

        const listaInsumos =
                Array.isArray(insumos)
                ? insumos
                : [];

        const listaUnidades =
                Array.isArray(unidades)
                ? unidades
                : [];

        const listaProdutos =
                Array.isArray(produtos)
                ? produtos
                : [];

        const listaEstoques =
                Array.isArray(estoques)
                ? estoques
                : [];

        // ----------------------------------------------------
        // NENHUM INSUMO
        // ----------------------------------------------------
        if (listaInsumos.length === 0) {

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="7"
                        style="
                            text-align:center;
                            color:#aaa;
                            padding:30px;
                        "
                    >
                        🧪 Nenhum insumo cadastrado.
                    </td>
                </tr>
            `;

            return;
        }

        // ----------------------------------------------------
        // RENDERIZA A TABELA
        // ----------------------------------------------------
        tbody.innerHTML = '';

        listaInsumos.forEach(insumo => {

            const unidadeCompra =
                    listaUnidades.find(
                            unidade =>
                        Number(unidade.id) ===
                                Number(insumo.unidade_compra_id)
                    );

            const unidadeBase =
                    listaUnidades.find(
                            unidade =>
                        Number(unidade.id) ===
                                Number(insumo.unidade_base_id)
                    );

            const produtoRelacionado =
                    listaProdutos.find(
                            produto =>
                        Number(produto.id) ===
                                Number(insumo.produto_id)
                    );

            const estoqueAtual =
                    listaEstoques.find(
                            estoque =>
                        Number(estoque.insumo_id) ===
                                Number(insumo.id)
                    );

            const quantidadeEstoqueAtual =
                    Number(
                            estoqueAtual?.quantidade_base || 0
                            );

            const fator =
                    Number(
                            insumo.fator_compra_base || 0
                            );

            const estoqueMinimo =
                    Number(
                            insumo.estoque_minimo_base || 0
                            );

            const tr =
                    document.createElement('tr');

            // ------------------------------------------------
            // INSUMO
            // ------------------------------------------------
            const tdNome =
                    document.createElement('td');

            const nome =
                    document.createElement('strong');

            nome.textContent =
                    insumo.nome || '-';

            tdNome.appendChild(nome);

            // Mostra produto relacionado, quando existir.
            if (produtoRelacionado) {

                const detalhe =
                        document.createElement('div');

                detalhe.style.cssText =
                        'color:#888;font-size:0.8rem;margin-top:4px;';

                detalhe.textContent =
                        `Produto: ${produtoRelacionado.nome}`;

                tdNome.appendChild(detalhe);
            }

            tr.appendChild(tdNome);

            // ------------------------------------------------
            // UNIDADE DE COMPRA
            // ------------------------------------------------
            const tdCompra =
                    document.createElement('td');

            tdCompra.textContent =
                    unidadeCompra
                    ? `${unidadeCompra.codigo} — ${unidadeCompra.nome}`
                    : '—';

            tr.appendChild(tdCompra);

            // ------------------------------------------------
            // UNIDADE BASE
            // ------------------------------------------------
            const tdBase =
                    document.createElement('td');

            tdBase.textContent =
                    unidadeBase
                    ? `${unidadeBase.codigo} — ${unidadeBase.nome}`
                    : '—';

            tr.appendChild(tdBase);

            // ------------------------------------------------
            // FATOR
            // ------------------------------------------------
            const tdFator =
                    document.createElement('td');

            tdFator.style.textAlign =
                    'center';

            tdFator.textContent =
                    fator
                    .toLocaleString(
                            'pt-BR',
                            {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 6
                            }
                    );

            tr.appendChild(tdFator);

            // ------------------------------------------------
            // ESTOQUE MÍNIMO
            // ------------------------------------------------
            const tdMinimo =
                    document.createElement('td');

            tdMinimo.style.textAlign =
                    'right';

            tdMinimo.textContent =
                    estoqueMinimo
                    .toLocaleString(
                            'pt-BR',
                            {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 3
                            }
                    );

            if (unidadeBase) {

                tdMinimo.title =
                        `Unidade-base: ${unidadeBase.nome}`;
            }

            tr.appendChild(tdMinimo);

            // ------------------------------------------------
// ESTOQUE ATUAL
// ------------------------------------------------
            const tdEstoqueAtual =
                    document.createElement('td');

            tdEstoqueAtual.style.textAlign =
                    'right';

            tdEstoqueAtual.style.fontWeight =
                    'bold';

            const estoqueAtualValor =
                    quantidadeEstoqueAtual;

            const estoqueMinimoValor =
                    estoqueMinimo;

// ------------------------------------------------
// DEFINIÇÃO DA COR
// ------------------------------------------------
            let corEstoque;
            let fundoEstoque;

// SEM ESTOQUE
            if (estoqueAtualValor <= 0) {

                corEstoque = '#ff4757';

                fundoEstoque =
                        'rgba(255,71,87,0.15)';

            }
// ABAIXO OU NO MÍNIMO
            else if (
                    estoqueMinimoValor > 0 &&
                    estoqueAtualValor <= estoqueMinimoValor
                    ) {

                corEstoque = '#ff4757';

                fundoEstoque =
                        'rgba(255,71,87,0.15)';

            }
// ATÉ 2 VEZES O MÍNIMO
            else if (
                    estoqueMinimoValor > 0 &&
                    estoqueAtualValor <=
                    (estoqueMinimoValor * 2)
                    ) {

                corEstoque = '#ffa502';

                fundoEstoque =
                        'rgba(255,165,2,0.15)';

            }
// ACIMA DE 2 VEZES O MÍNIMO
            else {

                corEstoque = '#2ed573';

                fundoEstoque =
                        'rgba(46,213,115,0.15)';
            }

// ------------------------------------------------
// FORMATAÇÃO VISUAL
// ------------------------------------------------
            tdEstoqueAtual.innerHTML = '';

            const badgeEstoque =
                    document.createElement('span');

            badgeEstoque.textContent =
                    estoqueAtualValor.toLocaleString(
                            'pt-BR',
                            {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 3
                            }
                    );

            badgeEstoque.style.cssText = `
    display:inline-block;
    min-width:70px;
    padding:5px 10px;
    border-radius:15px;
    background:${fundoEstoque};
    color:${corEstoque};
    font-weight:bold;
    text-align:center;
`;
            if (unidadeBase) {

                badgeEstoque.title =
                        `Estoque atual na unidade-base: ${unidadeBase.nome}`;
            }

            tdEstoqueAtual.appendChild(
                    badgeEstoque
                    );

            tr.appendChild(tdEstoqueAtual);

            // ------------------------------------------------
            // STATUS
            // ------------------------------------------------
            const tdStatus =
                    document.createElement('td');

            tdStatus.style.textAlign =
                    'center';

            const status =
                    document.createElement('span');

            status.textContent =
                    insumo.ativo
                    ? 'Ativo'
                    : 'Inativo';

            status.style.cssText =
                    insumo.ativo
                    ? `
                        display:inline-block;
                        padding:5px 10px;
                        border-radius:15px;
                        background:rgba(46,213,115,0.15);
                        color:#2ed573;
                        font-weight:bold;
                      `
                    : `
                        display:inline-block;
                        padding:5px 10px;
                        border-radius:15px;
                        background:rgba(255,71,87,0.15);
                        color:#ff4757;
                        font-weight:bold;
                      `;

            tdStatus.appendChild(status);

            tr.appendChild(tdStatus);


            // ------------------------------------------------
            // AÇÕES
            // ------------------------------------------------
            const tdAcoes =
                    document.createElement('td');

            tdAcoes.style.textAlign = 'center';

            const containerAcoes =
                    document.createElement('div');

            containerAcoes.style.cssText = `
    display:flex;
    flex-direction:row;
    align-items:center;
    justify-content:center;
    gap:6px;
`;

            // ------------------------------------------------
            // EDITAR
            // ------------------------------------------------
            const btnEditar =
                    document.createElement('button');

            btnEditar.type =
                    'button';

            btnEditar.className =
                    'btn-qty';

            btnEditar.textContent =
                    '✏️';

            btnEditar.title =
                    'Editar insumo';

            btnEditar.disabled =
                    false;

            btnEditar.style.cssText = `
    width:40px;
    height:36px;
    padding:0;
    display:flex;
    align-items:center;
    justify-content:center;
    white-space:nowrap;
`;

            btnEditar.onclick =
                    function () {
                        editarInsumoUI(
                                insumo.id
                                );
                    };


            containerAcoes.appendChild(
                    btnEditar
                    );


            // ------------------------------------------------
            // ATIVAR / DESATIVAR
            // ------------------------------------------------

            const btnStatus =
                    document.createElement('button');

            btnStatus.type =
                    'button';

            btnStatus.className =
                    'btn-qty';

            btnStatus.textContent =
                    insumo.ativo
                    ? '🚫 '
                    : '✅ ';

            btnStatus.title =
                    insumo.ativo
                    ? 'Desativar insumo'
                    : 'Ativar insumo';

            btnStatus.style.cssText = `
    width:40px;
    height:36px;
    padding:0;
    display:flex;
    align-items:center;
    justify-content:center;
    white-space:nowrap;
`;

            btnStatus.onclick =
                    function () {
                        alterarStatusInsumoUI(
                                insumo.id,
                                insumo.ativo
                                );
                    };


            containerAcoes.appendChild(
                    btnStatus
                    );


            tdAcoes.appendChild(
                    containerAcoes
                    );

            tr.appendChild(tdAcoes);
            tbody.appendChild(tr);
        });

    } catch (erro) {

        console.error(
                '⛔ Erro ao carregar cadastro de insumos:',
                erro
                );

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="7"
                    style="
                        text-align:center;
                        color:#ff4757;
                        padding:25px;
                    "
                >
                    ❌ Erro ao carregar os insumos.
                    <br>
                    <small style="color:#aaa;">
                        ${erro?.message || 'Erro desconhecido.'}
                    </small>
                </td>
            </tr>
        `;
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

    configurarTipoItemCompraUI();

    await carregarFornecedoresCompras();
    await carregarProdutosCompras();
    await carregarInsumosCompras();

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
                        insumo_id,
                        produto_nome,
                        quantidade,
                        custo_unitario,
                        total_item,
                insumos (
                       id,
                       nome
                )
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

        const nomeItem =
                item.insumos?.nome ||
                item.produto_nome ||
                'Item não identificado';

        itensHTML += `
            <tr>

                <td>
                    ${nomeItem}
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

// Atualiza imediatamente as duas listas.
        await carregarComprasAbertasUI();
        await carregarHistoricoComprasUI();

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
    const select =
            document.getElementById('compra-produto');

    if (!select) {
        return;
    }

    select.innerHTML = `
        <option value="">
            Carregando produtos...
        </option>
    `;

    try {
        const [
            resultadoProdutos,
            resultadoFichas
        ] = await Promise.all([

            _supabase
                    .from('produtos')
                    .select(`
                    id,
                    nome,
                    preco_custo,
                    ativo
                `)
                    .eq('ativo', true)
                    .order('nome'),

            _supabase
                    .from('fichas_tecnicas')
                    .select(`
                    produto_id
                `)
                    .eq('ativa', true)

        ]);

        const {
            data: produtos,
            error: erroProdutos
        } = resultadoProdutos;

        const {
            data: fichas,
            error: erroFichas
        } = resultadoFichas;

        if (erroProdutos) {
            throw erroProdutos;
        }

        if (erroFichas) {
            throw erroFichas;
        }

        /*
         * Produtos com Ficha Técnica ativa
         * são produzidos internamente.
         * Portanto, não entram como compra.
         */
        const produtosProduzidos =
                new Set(
                        (fichas || []).map(
                        ficha => Number(ficha.produto_id)
                )
                        );

        const produtosCompraveis =
                (produtos || []).filter(
                produto =>
            !produtosProduzidos.has(
                    Number(produto.id)
                    )
        );

        select.innerHTML = `
            <option value="">
                Selecione o produto
            </option>
        `;

        produtosCompraveis.forEach(produto => {
            select.innerHTML += `
                <option
                    value="${produto.id}"
                    data-custo="${produto.preco_custo || 0}"
                >
                    ${produto.nome}
                </option>
            `;
        });

        /*
         * Caso não exista nenhum produto de revenda,
         * deixa isso explícito na lista.
         */
        if (produtosCompraveis.length === 0) {
            select.innerHTML = `
                <option value="">
                    Nenhum produto comprável cadastrado
                </option>
            `;
        }

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

    } catch (error) {

        console.error(
                'Erro ao carregar produtos para compra:',
                error
                );

        select.innerHTML = `
            <option value="">
                Erro ao carregar produtos
            </option>
        `;
    }
}

async function carregarInsumosCompras() {
    const select = document.getElementById('compra-insumo');

    if (!select) {
        return;
    }

    select.innerHTML = `
        <option value="">Carregando insumos...</option>
    `;

    const {data, error} = await _supabase
            .from('insumos')
            .select(`
            id,
            nome,
            unidade_compra_id,
            unidade_base_id,
            fator_compra_base,
            ativo
        `)
            .eq('ativo', true)
            .order('nome');

    if (error) {
        console.error(
                'Erro ao carregar insumos para compra:',
                error
                );

        select.innerHTML = `
            <option value="">Erro ao carregar insumos</option>
        `;

        return;
    }

    select.innerHTML = `
        <option value="">Selecione o insumo</option>
    `;

    (data || []).forEach(insumo => {
        select.innerHTML += `
            <option
                value="${insumo.id}"
                data-unidade-compra-id="${insumo.unidade_compra_id || ''}"
                data-unidade-base-id="${insumo.unidade_base_id || ''}"
                data-fator="${insumo.fator_compra_base || 1}"
            >
                ${insumo.nome}
            </option>
        `;
    });
}


function configurarTipoItemCompraUI() {
    const tipoSelect = document.getElementById('compra-tipo-item');

    const containerProduto =
            document.getElementById('compra-container-produto');

    const containerInsumo =
            document.getElementById('compra-container-insumo');

    const produtoSelect =
            document.getElementById('compra-produto');

    const insumoSelect =
            document.getElementById('compra-insumo');

    if (
            !tipoSelect ||
            !containerProduto ||
            !containerInsumo
            ) {
        return;
    }

    function atualizarVisibilidade() {
        const tipo = tipoSelect.value;

        const comprandoInsumo = tipo === 'insumo';

        containerProduto.style.display =
                comprandoInsumo ? 'none' : '';

        containerInsumo.style.display =
                comprandoInsumo ? '' : 'none';

        if (comprandoInsumo) {
            if (produtoSelect) {
                produtoSelect.value = '';
            }
        } else {
            if (insumoSelect) {
                insumoSelect.value = '';
            }
        }
    }

    tipoSelect.onchange = atualizarVisibilidade;

    atualizarVisibilidade();
}

function adicionarItemCompraUI() {
    const tipoSelect =
            document.getElementById('compra-tipo-item');

    const produtoSelect =
            document.getElementById('compra-produto');

    const insumoSelect =
            document.getElementById('compra-insumo');

    const quantidadeInput =
            document.getElementById('compra-quantidade');

    const custoInput =
            document.getElementById('compra-custo');

    if (
            !tipoSelect ||
            !produtoSelect ||
            !insumoSelect ||
            !quantidadeInput ||
            !custoInput
            ) {
        return;
    }

    const tipo = tipoSelect.value;

    const quantidade =
            parseInt(quantidadeInput.value, 10);

    const custoUnitario =
            parseFloat(custoInput.value);

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

    let produtoId = null;
    let insumoId = null;
    let itemNome = '';

    if (tipo === 'produto') {

        produtoId = Number(produtoSelect.value);

        if (!produtoId) {
            alert('Selecione um produto.');
            return;
        }

        const optionSelecionada =
                produtoSelect.options[
                        produtoSelect.selectedIndex
                ];

        itemNome =
                optionSelecionada?.textContent?.trim() ||
                'Produto';

    } else if (tipo === 'insumo') {

        insumoId = Number(insumoSelect.value);

        if (!insumoId) {
            alert('Selecione um insumo.');
            return;
        }

        const optionSelecionada =
                insumoSelect.options[
                        insumoSelect.selectedIndex
                ];

        itemNome =
                optionSelecionada?.textContent?.trim() ||
                'Insumo';

    } else {
        alert('Tipo de item inválido.');
        return;
    }

    const itemExistente =
            itensCompraRascunho.find(item =>
                tipo === 'produto'
                        ? item.produto_id === produtoId
                        : item.insumo_id === insumoId
            );

    if (itemExistente) {

        itemExistente.quantidade += quantidade;

        itemExistente.custo_unitario =
                custoUnitario;

    } else {

        itensCompraRascunho.push({
            tipo,
            produto_id: produtoId,
            insumo_id: insumoId,
            produto_nome: itemNome,
            quantidade,
            custo_unitario: custoUnitario
        });
    }

    renderizarItensCompraUI();
    recalcularCompraUI();

    produtoSelect.value = '';
    insumoSelect.value = '';

    quantidadeInput.value = '1';
    custoInput.value = '0.00';

    // Volta para Produto após adicionar.
    tipoSelect.value = 'produto';

    const evento =
            new Event('change');

    tipoSelect.dispatchEvent(evento);
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
                    produto_id:
                            item.produto_id != null
                            ? Number(item.produto_id)
                            : null,

                    insumo_id:
                            item.insumo_id != null
                            ? Number(item.insumo_id)
                            : null,

                    quantidade:
                            Number(item.quantidade),

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

    const tbody =
            document.getElementById(
                    'produtos-table-body'
                    );

    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Carregando produtos...</td></tr>';

    const {
        data: produtos,
        error
    } = await _supabase
            .from('produtos')
            .select('*')
            .order('nome');

    if (error) {

        alert(
                'Erro ao carregar produtos: ' +
                error.message
                );

        return;
    }

    tbody.innerHTML = '';

    const cargoAtual =
            String(
                    window.usuarioAtual?.cargo || ''
                    )
            .toUpperCase();

    const ehGerente =
            cargoAtual === 'GERENTE' ||
            cargoAtual === 'ADMIN';


    produtos.forEach(p => {

        const tr =
                document.createElement('tr');

        const img =
                p.imagem_url ||
                'https://via.placeholder.com/40';

        const custo =
                Number(
                        p.preco_custo || 0
                        );

        const precoVenda =
                Number(
                        p.preco || 0
                        );

        const margem =
                custo > 0
                ? ((precoVenda - custo) / custo) * 100
                : 0;

        // ====================================================
        // IMAGEM DO PRODUTO
        // GERENTE/ADMIN = CLICÁVEL
        // OPERADOR = SOMENTE VISUALIZAÇÃO
        // ====================================================
        let imagemProdutoHTML;

        if (ehGerente) {

            imagemProdutoHTML = `
                <div
                    onclick="abrirEdicaoProduto(${p.id})"
                    title="Clique para editar o produto"
                    style="
                        position:relative;
                        width:48px;
                        height:48px;
                        display:inline-flex;
                        cursor:pointer;
                        margin-right:8px;
                        vertical-align:middle;
                    "
                >

                    <img
                        src="${img}"
                        class="product-row-img"
                        alt="${p.nome}"
                        style="
                            width:48px;
                            height:48px;
                            object-fit:cover;
                            border-radius:6px;
                        "
                    >

                    <span
                        style="
                            position:absolute;
                            right:-3px;
                            bottom:-3px;
                            background:#1565c0;
                            color:#fff;
                            border-radius:50%;
                            width:20px;
                            height:20px;
                            display:flex;
                            align-items:center;
                            justify-content:center;
                            font-size:11px;
                            border:2px solid #1e1e24;
                        "
                    >
                        ✏️
                    </span>
                </div>
            `;

        } else {

            imagemProdutoHTML = `
                <img
                    src="${img}"
                    class="product-row-img"
                    alt="${p.nome}"
                    style="
                        width:48px;
                        height:48px;
                        object-fit:cover;
                        border-radius:6px;
                        margin-right:8px;
                        vertical-align:middle;
                    "
                >
            `;
        }


        tr.innerHTML = `

            <td>

                ${imagemProdutoHTML}

                <strong>
                    ${p.nome}
                </strong>

            </td>


            <td>

                <input
                    type="number"
                    step="0.10"
                    min="0"
                    value="${custo}"
                    id="custo-${p.id}"
                    class="input-table"
                    style="width:80px;"
                    oninput="calcularPrecoPeloCusto(${p.id})"
                >

            </td>


            <td>

                <input
                    type="number"
                    step="1"
                    min="0"
                    value="${margem}"
                    id="margem-${p.id}"
                    class="input-table"
                    style="width:70px;"
                    oninput="calcularPrecoPeloCusto(${p.id})"
                >

            </td>


            <td>

                <input
                    type="number"
                    step="0.50"
                    min="0"
                    value="${precoVenda}"
                    id="preco-${p.id}"
                    class="input-table"
                    style="width:80px;"
                    oninput="calcularMargemPeloPreco(${p.id})"
                >

            </td>


            <td>

                <input
                    type="number"
                    min="0"
                    value="${p.estoque || 0}"
                    id="estoque-${p.id}"
                    class="input-table"
                    style="width:70px;"
                    readonly
                    title="Use os botões para movimentar o estoque."
                >

            </td>


            <td>

                <div class="qty-controls">

                    <button
                        class="btn-qty"
                        onclick="ajustarEstoqueInput(${p.id}, -5)"
                    >
                        -5
                    </button>

                    <button
                        class="btn-qty"
                        onclick="ajustarEstoqueInput(${p.id}, -1)"
                    >
                        -1
                    </button>

                    <button
                        class="btn-qty"
                        onclick="ajustarEstoqueInput(${p.id}, 1)"
                    >
                        +1
                    </button>

                    <button
                        class="btn-qty"
                        onclick="ajustarEstoqueInput(${p.id}, 5)"
                    >
                        +5
                    </button>
                </div>
            </td>

            <td>
                <select
                    id="ativo-${p.id}"
                    class="input-table"
                    style="width:100px;"
                >

                    <option
                        value="true"
                        ${p.ativo ? 'selected' : ''}
                    >
                        Ativo
                    </option>

                    <option
                        value="false"
                        ${!p.ativo ? 'selected' : ''}
                    >
                        Pausado
                    </option>
                </select>
            </td>

            <td>
                <button
                    class="btn-save-prod"
                    id="btn-save-${p.id}"
                    onclick="salvarProduto(${p.id})"
                >
                    💾 Salvar
                </button>
            </td>
        `;

        tbody.appendChild(tr);

    });

    aplicarPermissoes();
}

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
            ),

            lotes_producao (
                numero_lote,
                data_fabricacao,
                data_validade,
                quantidade_inicial,
                quantidade_disponivel,
                status
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

    if (
            !producoes ||
            producoes.length === 0
            ) {

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

        /*
         * A relação pode retornar objeto ou array.
         */
        const lote =
                Array.isArray(
                        producao.lotes_producao
                        )
                ? producao.lotes_producao[0]
                : producao.lotes_producao;

        let loteHTML = '';

        if (lote) {

            const dataFabricacao =
                    lote.data_fabricacao
                    ? lote.data_fabricacao
                    .split('-')
                    .reverse()
                    .join('/')
                    : '-';

            const dataValidade =
                    lote.data_validade
                    ? lote.data_validade
                    .split('-')
                    .reverse()
                    .join('/')
                    : '-';

            let validadeHTML =
                    `<span>${dataValidade}</span>`;

            if (lote.data_validade) {

                const hoje =
                        new Date();

                hoje.setHours(
                        0,
                        0,
                        0,
                        0
                        );

                const validade =
                        new Date(
                                lote.data_validade +
                                'T00:00:00'
                                );

                const diferencaMs =
                        validade.getTime() -
                        hoje.getTime();

                const diasRestantes =
                        Math.ceil(
                                diferencaMs /
                                (
                                        1000 *
                                        60 *
                                        60 *
                                        24
                                        )
                                );

                if (diasRestantes < 0) {

                    validadeHTML =
                            `<span style="color:#ff4757;font-weight:bold;">
                            ❌ Vencido
                        </span>`;

                } else if (
                        diasRestantes === 0
                        ) {

                    validadeHTML =
                            `<span style="color:#ff4757;font-weight:bold;">
                            ⚠️ Vence hoje
                        </span>`;

                } else if (
                        diasRestantes <= 7
                        ) {

                    validadeHTML =
                            `<span style="color:#ffa502;font-weight:bold;">
                            ⚠️ ${dataValidade}
                        </span>`;

                } else {

                    validadeHTML =
                            `<span>
                            ${dataValidade}
                        </span>`;
                }
            }

            loteHTML = `
                <div style="
                    margin-top:6px;
                    padding-top:6px;
                    border-top:1px solid #ddd;
                    font-size:0.82rem;
                    color:#666;
                    line-height:1.6;
                ">

                    <div>
                        <strong>🏷️ Lote:</strong>
                        ${lote.numero_lote || '-'}
                    </div>

                    <div>
                        <strong>🗓️ Fabricação:</strong>
                        ${dataFabricacao}
                    </div>

                    <div>
                        <strong>⏳ Validade:</strong>
                        ${validadeHTML}
                    </div>

                    <div>
                        <strong>📦 Lote disponível:</strong>
                        ${Number(
                    lote.quantidade_disponivel || 0
                    )}
                        /
                        ${Number(
                    lote.quantidade_inicial || 0
                    )}
                    </div>

                    <div>
                        <strong>Status:</strong>
                        ${
                    lote.status === 'ATIVO'
                    ? '🟢 ATIVO'
                    : lote.status === 'ESGOTADO'
                    ? '⚪ ESGOTADO'
                    : '🔴 VENCIDO'
                    }
                    </div>

                </div>
            `;
        }

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
                <strong>
                    ${nomeProduto}
                </strong>

                ${loteHTML}
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

    configurarDatasLoteProducao();

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


// ============================================================
// PRODUÇÃO - DATAS E VALIDADE DO LOTE
// ============================================================

function configurarDatasLoteProducao() {

    const campoFabricacao =
            document.getElementById(
                    'producao-data-fabricacao'
                    );

    const campoValidade =
            document.getElementById(
                    'producao-data-validade'
                    );

    if (!campoFabricacao || !campoValidade) {
        return;
    }

    // --------------------------------------------------------
    // DATA DE FABRICAÇÃO
    // --------------------------------------------------------

    const hoje =
            new Date();

    const ano =
            hoje.getFullYear();

    const mes =
            String(
                    hoje.getMonth() + 1
                    ).padStart(2, '0');

    const dia =
            String(
                    hoje.getDate()
                    ).padStart(2, '0');

    const dataHoje =
            `${ano}-${mes}-${dia}`;

    // Preenche somente se estiver vazia
    if (!campoFabricacao.value) {
        campoFabricacao.value =
                dataHoje;
    }

    // --------------------------------------------------------
    // VALIDADE NÃO PODE SER ANTERIOR À FABRICAÇÃO
    // --------------------------------------------------------

    campoValidade.min =
            campoFabricacao.value;


    // --------------------------------------------------------
    // EVENTO: FABRICAÇÃO ALTERADA
    // --------------------------------------------------------

    campoFabricacao.onchange =
            function () {

                campoValidade.min =
                        campoFabricacao.value;

                validarValidadeLoteProducao();
            };


    // --------------------------------------------------------
    // EVENTO: VALIDADE ALTERADA
    // --------------------------------------------------------

    campoValidade.onchange =
            function () {

                validarValidadeLoteProducao();
            };

    campoValidade.oninput =
            function () {

                validarValidadeLoteProducao();
            };


    // --------------------------------------------------------
    // VALIDAÇÃO INICIAL
    // --------------------------------------------------------

    validarValidadeLoteProducao();
}


// ============================================================
// VALIDA DATA DE VALIDADE + ALERTA
// ============================================================

function validarValidadeLoteProducao() {

    const campoFabricacao =
            document.getElementById(
                    'producao-data-fabricacao'
                    );

    const campoValidade =
            document.getElementById(
                    'producao-data-validade'
                    );

    const alerta =
            document.getElementById(
                    'producao-alerta-validade'
                    );

    if (
            !campoFabricacao ||
            !campoValidade ||
            !alerta
            ) {
        return false;
    }

    const dataFabricacao =
            campoFabricacao.value;

    const dataValidade =
            campoValidade.value;


    // --------------------------------------------------------
    // SEM DATA DE VALIDADE
    // --------------------------------------------------------

    if (!dataValidade) {

        alerta.style.display =
                'none';

        alerta.innerHTML = '';

        campoValidade.setCustomValidity('');

        return false;
    }


    // --------------------------------------------------------
    // VALIDADE ANTERIOR À FABRICAÇÃO
    // --------------------------------------------------------

    if (
            dataFabricacao &&
            dataValidade < dataFabricacao
            ) {

        // Remove imediatamente a data inválida
        campoValidade.value = '';

        alerta.innerHTML =
                '❌ A data de validade não pode ser anterior à data de fabricação.';

        alerta.style.display =
                'block';

        alerta.style.background =
                '#f8d7da';

        alerta.style.color =
                '#842029';

        campoValidade.setCustomValidity(
                'Informe uma data de validade igual ou posterior à fabricação.'
                );

        return false;
    }


    // --------------------------------------------------------
    // DATA VÁLIDA
    // --------------------------------------------------------

    campoValidade.setCustomValidity('');


    // --------------------------------------------------------
    // CALCULA DIAS ENTRE FABRICAÇÃO E VALIDADE
    // --------------------------------------------------------

    const inicio =
            new Date(
                    `${dataFabricacao || dataHojeLocalProducao()}T00:00:00`
                    );

    const fim =
            new Date(
                    `${dataValidade}T00:00:00`
                    );

    const diferencaMs =
            fim.getTime() -
            inicio.getTime();

    const diasRestantes =
            Math.ceil(
                    diferencaMs /
                    (1000 * 60 * 60 * 24)
                    );


    // --------------------------------------------------------
    // BUSCA CONFIGURAÇÃO DO ALERTA
    // --------------------------------------------------------

    obterDiasAlertaValidadeProducao()
            .then(
                    diasAlerta => {

                        if (
                                diasRestantes <= diasAlerta
                                ) {

                            alerta.innerHTML =
                                    `⚠️ Validade próxima: faltam ${diasRestantes} dia${diasRestantes === 1 ? '' : 's'} para vencer.`;

                            alerta.style.display =
                                    'block';

                            alerta.style.background =
                                    '#fff3cd';

                            alerta.style.color =
                                    '#856404';

                        } else {

                            alerta.innerHTML =
                                    `✅ Validade do lote: ${diasRestantes} dias restantes.`;

                            alerta.style.display =
                                    'block';

                            alerta.style.background =
                                    '#d1e7dd';

                            alerta.style.color =
                                    '#0f5132';
                        }
                    }
            )
            .catch(
                    erro => {

                        console.error(
                                'Erro ao consultar configuração de validade:',
                                erro
                                );

                    }
            );

    return true;
}


// ============================================================
// BUSCA DIAS DE ALERTA CONFIGURADOS NO BANCO
// ============================================================

async function obterDiasAlertaValidadeProducao() {

    const {
        data,
        error
    } = await _supabase
            .from('configuracoes')
            .select(
                    'dias_alerta_validade'
                    )
            .limit(1)
            .maybeSingle();

    if (error) {

        console.error(
                'Erro ao carregar dias de alerta de validade:',
                error
                );

        // Segurança: usa 7 como padrão
        return 7;
    }

    return Number(
            data?.dias_alerta_validade ?? 7
            );
}


// ============================================================
// DATA LOCAL YYYY-MM-DD
// ============================================================

function dataHojeLocalProducao() {

    const hoje =
            new Date();

    return (
            hoje.getFullYear() +
            '-' +
            String(
                    hoje.getMonth() + 1
                    ).padStart(2, '0') +
            '-' +
            String(
                    hoje.getDate()
                    ).padStart(2, '0')
            );
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

    const dataFabricacaoInput =
            document.getElementById(
                    'producao-data-fabricacao'
                    );

    const dataValidadeInput =
            document.getElementById(
                    'producao-data-validade'
                    );

    const observacaoInput =
            document.getElementById(
                    'producao-observacao'
                    );


    // ========================================================
    // 1. ELEMENTOS OBRIGATÓRIOS
    // ========================================================

    if (
            !select ||
            !quantidadeInput ||
            !dataFabricacaoInput ||
            !dataValidadeInput
            ) {

        alert(
                '❌ Elementos da produção não encontrados.'
                );

        return;
    }


    // ========================================================
    // 2. DADOS DA PRODUÇÃO
    // ========================================================

    const produtoId =
            Number(
                    select.value || 0
                    );

    const quantidade =
            Number(
                    quantidadeInput.value || 0
                    );

    const dataFabricacao =
            dataFabricacaoInput.value;

    const dataValidade =
            dataValidadeInput.value;

    const observacao =
            observacaoInput?.value.trim() || null;


    // ========================================================
    // 3. VALIDA PRODUTO
    // ========================================================

    if (!produtoId) {

        alert(
                '⚠️ Selecione o produto.'
                );

        return;
    }


    // ========================================================
    // 4. VALIDA QUANTIDADE
    // ========================================================

    if (
            !Number.isInteger(quantidade) ||
            quantidade <= 0
            ) {

        alert(
                '⚠️ Informe uma quantidade válida.'
                );

        return;
    }


    // ========================================================
    // 5. VALIDA DATA DE FABRICAÇÃO
    // ========================================================

    if (!dataFabricacao) {

        alert(
                '⚠️ Informe a data de fabricação.'
                );

        dataFabricacaoInput.focus();

        return;
    }


    // ========================================================
    // 6. VALIDA DATA DE VALIDADE
    // ========================================================

    if (!dataValidade) {

        alert(
                '⚠️ Informe a data de validade.'
                );

        dataValidadeInput.focus();

        return;
    }


    // ========================================================
    // 7. VALIDADE NÃO PODE SER ANTERIOR À FABRICAÇÃO
    // ========================================================

    if (
            dataValidade < dataFabricacao
            ) {

        alert(
                '❌ A data de validade não pode ser anterior à data de fabricação.'
                );

        dataValidadeInput.value = '';

        validarValidadeLoteProducao();

        dataValidadeInput.focus();

        return;
    }


    // ========================================================
    // 8. PRODUTO E FICHA
    // ========================================================

    const produto =
            producaoUI.produtos.find(
                    p =>
                Number(p.id) === produtoId
            );

    const ficha =
            producaoUI.fichas.find(
                    f =>
                Number(f.produto_id) === produtoId
            );


    if (!produto || !ficha) {
        alert(
                '❌ Produto ou Ficha Técnica não encontrada.'
                );
        return;
    }

    /*
     * ========================================================
     * TRAVA DE ESTOQUE ANTES DA CONFIRMAÇÃO
     * ========================================================
     *
     * A interface já calcula o estoque necessário.
     * Aqui repetimos a mesma regra antes de abrir
     * a confirmação, evitando que o usuário confirme
     * uma produção que certamente será recusada.
     */

    const rendimento =
            Number(ficha.rendimento || 0);

    if (
            !Number.isFinite(rendimento) ||
            rendimento <= 0
            ) {
        alert(
                '❌ Rendimento da Ficha Técnica inválido.'
                );
        return;
    }

    const fatorProducao =
            quantidade / rendimento;

    let estoqueInsuficienteAntesConfirmar = false;
    let detalhesFaltaEstoque = '';

    (producaoUI.itens || []).forEach(item => {

        const insumo =
                producaoUI.insumos.find(
                        i =>
                    Number(i.id) ===
                            Number(item.insumo_id)
                );

        const unidadeItem =
                producaoUI.unidades.find(
                        u =>
                    Number(u.id) ===
                            Number(item.unidade_id)
                );

        const unidadeBase =
                producaoUI.unidades.find(
                        u =>
                    Number(u.id) ===
                            Number(insumo?.unidade_base_id)
                );

        const estoque =
                producaoUI.estoques.find(
                        e =>
                    Number(e.insumo_id) ===
                            Number(item.insumo_id)
                );

        if (
                !insumo ||
                !unidadeItem ||
                !unidadeBase
                ) {
            return;
        }

        const quantidadeNecessariaBase =
                Number(item.quantidade_bruta || 0) *
                fatorProducao *
                Number(unidadeItem.fator_base || 0) /
                Number(unidadeBase.fator_base || 1);

        const estoqueAtualBase =
                Number(
                        estoque?.quantidade_base || 0
                        );

        if (
                estoqueAtualBase <
                quantidadeNecessariaBase
                ) {

            estoqueInsuficienteAntesConfirmar = true;

            const falta =
                    quantidadeNecessariaBase -
                    estoqueAtualBase;

            detalhesFaltaEstoque +=
                    `• ${insumo.nome}: ` +
                    `necessário ${quantidadeNecessariaBase.toFixed(3).replace('.', ',')} ${unidadeBase.codigo}, ` +
                    `disponível ${estoqueAtualBase.toFixed(3).replace('.', ',')} ${unidadeBase.codigo}, ` +
                    `falta ${falta.toFixed(3).replace('.', ',')} ${unidadeBase.codigo}\n`;
        }
    });

    if (estoqueInsuficienteAntesConfirmar) {

        alert(
                '⚠️ Produção não permitida por falta de estoque.\n\n' +
                detalhesFaltaEstoque +
                '\nAbasteça os insumos necessários e tente novamente.'
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

    // ========================================================
    // 10. BOTÃO
    // ========================================================
    const btn =
            document.querySelector(
                    '#modal-producao button[onclick="registrarProducaoUI()"]'
                    );

    const textoOriginal =
            btn?.innerHTML ||
            '🏭 Produzir';


    try {

        // ----------------------------------------------------
        // FEEDBACK IMEDIATO
        // ----------------------------------------------------

        if (btn) {

            btn.disabled = true;

            btn.innerHTML =
                    '⏳ Produzindo...';
        }


        // ====================================================
        // 11. REGISTRA PRODUÇÃO + LOTE
        // ====================================================

        const {
            data,
            error
        } = await _supabase.rpc(
                'registrar_producao_com_lote',
                {
                    p_produto_id:
                            produtoId,

                    p_quantidade_produzida:
                            quantidade,

                    p_data_fabricacao:
                            dataFabricacao,

                    p_data_validade:
                            dataValidade,

                    p_observacao:
                            observacao
                }
        );


        if (error) {
            throw error;
        }


        // ====================================================
        // 12. TENTA RECUPERAR O LOTE CRIADO
        // ====================================================

        let lote = null;

        const {
            data: dadosLote,
            error: erroLote
        } = await _supabase
                .from('lotes_producao')
                .select(`
                    id,
                    numero_lote,
                    data_fabricacao,
                    data_validade,
                    quantidade_inicial,
                    quantidade_disponivel,
                    status
                `)
                .eq(
                        'producao_id',
                        Number(data)
                        )
                .maybeSingle();


        if (erroLote) {

            console.warn(
                    'Produção registrada, mas não foi possível consultar o lote:',
                    erroLote
                    );

        } else {

            lote =
                    dadosLote || null;
        }


        // ====================================================
        // 13. MENSAGEM DE SUCESSO
        // ====================================================

        let mensagemSucesso =
                '✅ Produção registrada com sucesso!\n\n' +
                `Produção #${data}\n` +
                `Produto: ${produto.nome}\n` +
                `Quantidade: ${quantidade}\n` +
                `Fabricação: ${dataFabricacao.split('-').reverse().join('/')}\n` +
                `Validade: ${dataValidade.split('-').reverse().join('/')}`;


        if (lote) {

            mensagemSucesso +=
                    '\n\n' +
                    `Lote: ${lote.numero_lote}`;
        }


        alert(
                mensagemSucesso
                );


        // ====================================================
        // 14. FECHA MODAL
        // ====================================================

        fecharModalProducao();


        // ====================================================
        // 15. ATUALIZA PRODUTOS
        // ====================================================

        await carregarProdutosGerenciador();


    } catch (err) {

        console.error(
                'Erro ao registrar produção com lote:',
                err
                );

        alert(
                '❌ Não foi possível registrar a produção:\n\n' +
                (err.message || err)
                );


    } finally {

        if (btn) {

            btn.disabled = false;

            btn.innerHTML =
                    textoOriginal;
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
            <h2 style="text-align: center; margin: 0; color: #000;">🍨 Doces e Travessuras</h2>
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
            produtos (nome),
            consumos_lotes (
                id,
                quantidade,
                lote:lotes_producao (
                    id,
                    numero_lote,
                    data_fabricacao,
                    data_validade
                )
            )
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

        const dataHora =
                new Date(p.criado_em).toLocaleString('pt-BR');

        const badgeClasse =
                p.status === 'CONCLUIDO'
                ? 'status-concluido'
                : (
                        p.status === 'CANCELADO'
                        ? 'status-cancelado'
                        : 'status-concluido'
                        );

        // ========================================================
        // LOTES CONSUMIDOS PELOS ITENS DO PEDIDO
        // ========================================================

        const itensPedido =
                Array.isArray(p.itens_pedido)
                ? p.itens_pedido
                : [];

        const listaLotes = [];

        itensPedido.forEach(item => {

            const consumos =
                    Array.isArray(item.consumos_lotes)
                    ? item.consumos_lotes
                    : [];

            consumos.forEach(consumo => {

                const lote =
                        consumo.lote || {};

                const numeroLote =
                        lote.numero_lote || '-';

                const validade =
                        lote.data_validade
                        ? new Date(
                                lote.data_validade + 'T00:00:00'
                                ).toLocaleDateString('pt-BR')
                        : '-';

                const quantidade =
                        Number(
                                consumo.quantidade || 0
                                );

                listaLotes.push(`
                <div style="
                    margin-bottom:4px;
                    line-height:1.25;
                ">
                    <strong>${numeroLote}</strong>
                    <br>
                    <span style="color:#aaa;">
                        Val.: ${validade}
                        &nbsp;|&nbsp;
                        Qtd.: ${quantidade}
                    </span>
                </div>
            `);
            });
        });

        const lotesHTML =
                listaLotes.length > 0
                ? listaLotes.join('')
                : '<span style="color:#777;">—</span>';

        // ========================================================
        // LINHA
        // ========================================================

        tr.innerHTML = `
        <td style="text-align: center;">
            <input
                type="checkbox"
                class="chk-pedido"
                value="${p.id}"
                style="
                    cursor:pointer;
                    transform:scale(1.2);
                "
            >
        </td>

        <td>
            <strong>#${p.id}</strong>
        </td>

        <td>
            ${dataHora}
        </td>

        <td>
            ${p.tipo || 'PDV'}
            /
            ${p.forma_pagamento || '-'}
        </td>

        <td>
            ${p.endereco_snapshot || 'Balcão'}
        </td>

        <td style="
            min-width:190px;
            font-size:0.82rem;
        ">
            ${lotesHTML}
        </td>

        <td>
            <strong>
                R$ ${(p.valor_total || 0)
                .toFixed(2)
                .replace('.', ',')}
            </strong>
        </td>

        <td>
            <span class="status-badge-table ${badgeClasse}">
                ${p.status}
            </span>
        </td>
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
    // CADASTROS
    // GERENTE/ADMIN: pode acessar
    // OPERADOR: não exibe a aba
    // ========================================================
    const btnMenuCadastros =
            document.getElementById('btn-tab-cadastros');

    if (btnMenuCadastros) {
        btnMenuCadastros.style.display =
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

// ============================================================
// EDIÇÃO RÁPIDA DE PRODUTO - GERENTE / ADMIN
// ============================================================

async function abrirEdicaoProduto(produtoId) {

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    )
            .toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';


    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem editar as informações do produto.'
                );

        return;
    }


    if (!produtoId) {

        alert(
                '⚠️ Produto inválido.'
                );

        return;
    }


    try {

        // ----------------------------------------------------
        // 1. BUSCA O PRODUTO ATUAL NO BANCO
        // ----------------------------------------------------

        const {
            data: produto,
            error
        } = await _supabase
                .from('produtos')
                .select(`
                    id,
                    nome,
                    descricao,
                    categoria_id,
                    codigo_barras,
                    imagem_url
                `)
                .eq(
                        'id',
                        produtoId
                        )
                .single();


        if (error) {

            throw new Error(
                    'Erro ao carregar produto: ' +
                    error.message
                    );
        }


        if (!produto) {

            throw new Error(
                    'Produto não encontrado.'
                    );
        }


        // ----------------------------------------------------
        // 2. GUARDA O PRODUTO EM EDIÇÃO
        // ----------------------------------------------------

        produtoEdicaoAtual =
                produto;

        arquivoImagemProdutoEdicao =
                null;


        // ----------------------------------------------------
        // 3. CARREGA CATEGORIAS
        // ----------------------------------------------------

        await carregarCategoriasEdicaoProduto();


        // ----------------------------------------------------
        // 4. PREENCHE OS CAMPOS
        // ----------------------------------------------------

        const campoNome =
                document.getElementById(
                        'edit-produto-nome'
                        );

        const campoDescricao =
                document.getElementById(
                        'edit-produto-descricao'
                        );

        const campoCodigo =
                document.getElementById(
                        'edit-produto-codigo'
                        );

        const campoCategoria =
                document.getElementById(
                        'edit-produto-categoria'
                        );

        const preview =
                document.getElementById(
                        'edit-produto-imagem-preview'
                        );

        const arquivo =
                document.getElementById(
                        'edit-produto-file'
                        );

        const statusImagem =
                document.getElementById(
                        'edit-produto-status-imagem'
                        );


        if (campoNome) {

            campoNome.value =
                    produto.nome || '';

        }


        if (campoDescricao) {

            campoDescricao.value =
                    produto.descricao || '';

        }


        if (campoCodigo) {

            campoCodigo.value =
                    produto.codigo_barras || '';

        }


        if (campoCategoria) {

            campoCategoria.value =
                    produto.categoria_id != null
                    ? String(produto.categoria_id)
                    : '';

        }


        if (preview) {

            preview.src =
                    produto.imagem_url ||
                    'https://via.placeholder.com/130';

        }


        if (arquivo) {

            arquivo.value = '';

        }


        if (statusImagem) {

            statusImagem.innerText =
                    'Nenhuma imagem nova selecionada.';

            statusImagem.style.color =
                    '#aaa';

        }


        // ----------------------------------------------------
        // 5. ABRE O MODAL
        // ----------------------------------------------------

        const modal =
                document.getElementById(
                        'modal-edicao-produto'
                        );

        if (modal) {

            modal.style.display =
                    'flex';

        }

    } catch (err) {

        console.error(
                'Erro ao abrir edição do produto:',
                err
                );

        alert(
                '❌ Não foi possível abrir a edição:\n\n' +
                (err.message || err)
                );
    }
}


// ============================================================
// CARREGA CATEGORIAS NO MODAL DE EDIÇÃO
// ============================================================

async function carregarCategoriasEdicaoProduto() {

    const select =
            document.getElementById(
                    'edit-produto-categoria'
                    );

    if (!select) {

        return;
    }


    select.innerHTML =
            '<option value="">Selecione</option>';


    const {
        data: categorias,
        error
    } = await _supabase
            .from('categorias')
            .select('id,nome')
            .order('nome');


    if (error) {

        console.error(
                'Erro ao carregar categorias:',
                error
                );

        select.innerHTML =
                '<option value="">Erro ao carregar categorias</option>';

        return;
    }


    if (!categorias) {

        return;
    }


    categorias.forEach(categoria => {

        const option =
                document.createElement(
                        'option'
                        );

        option.value =
                String(
                        categoria.id
                        );

        option.textContent =
                categoria.nome;

        select.appendChild(
                option
                );

    });
}


// ============================================================
// SELECIONA UMA NOVA IMAGEM
// ============================================================

function selecionarFotoEdicaoProduto(event) {

    const file =
            event?.target?.files?.[0];


    if (!file) {

        return;
    }


    if (!file.type.startsWith('image/')) {

        alert(
                '⚠️ Selecione um arquivo de imagem válido.'
                );

        event.target.value = '';

        return;
    }


    // Limite de 5 MB
    if (file.size > 5 * 1024 * 1024) {

        alert(
                '⚠️ A imagem não pode ter mais de 5 MB.'
                );

        event.target.value = '';

        return;
    }


    arquivoImagemProdutoEdicao =
            file;


    // --------------------------------------------------------
    // PRÉ-VISUALIZAÇÃO
    // --------------------------------------------------------

    const preview =
            document.getElementById(
                    'edit-produto-imagem-preview'
                    );


    if (preview) {

        const reader =
                new FileReader();


        reader.onload =
                function (e) {

                    preview.src =
                            e.target.result;

                };


        reader.readAsDataURL(
                file
                );
    }


    const status =
            document.getElementById(
                    'edit-produto-status-imagem'
                    );


    if (status) {

        status.style.color =
                '#2ed573';

        status.innerText =
                '📷 Nova imagem selecionada: ' +
                file.name;
    }
}


// ============================================================
// FECHA MODAL DE EDIÇÃO
// ============================================================

function fecharEdicaoProduto() {

    produtoEdicaoAtual =
            null;

    arquivoImagemProdutoEdicao =
            null;


    const modal =
            document.getElementById(
                    'modal-edicao-produto'
                    );


    if (modal) {

        modal.style.display =
                'none';

    }


    const arquivo =
            document.getElementById(
                    'edit-produto-file'
                    );


    if (arquivo) {

        arquivo.value =
                '';

    }


    const status =
            document.getElementById(
                    'edit-produto-status-imagem'
                    );


    if (status) {

        status.innerText =
                'Nenhuma imagem nova selecionada.';

        status.style.color =
                '#aaa';

    }
}


// ============================================================
// SALVA NOME, DESCRIÇÃO, CATEGORIA, CÓDIGO E IMAGEM
// ============================================================

async function salvarEdicaoProduto() {

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    )
            .toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';


    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem editar produtos.'
                );

        return;
    }


    if (!produtoEdicaoAtual?.id) {

        alert(
                '⚠️ Nenhum produto selecionado para edição.'
                );

        return;
    }


    const btn =
            document.getElementById(
                    'btn-salvar-edicao-produto'
                    );


    if (!btn) {

        return;
    }


    const textoOriginal =
            btn.innerHTML;


    try {

        btn.disabled =
                true;

        btn.innerHTML =
                '⏳ Salvando...';


        // ----------------------------------------------------
        // 1. COLETA DOS CAMPOS
        // ----------------------------------------------------

        const campoNome =
                document.getElementById(
                        'edit-produto-nome'
                        );

        const campoDescricao =
                document.getElementById(
                        'edit-produto-descricao'
                        );

        const campoCodigo =
                document.getElementById(
                        'edit-produto-codigo'
                        );

        const campoCategoria =
                document.getElementById(
                        'edit-produto-categoria'
                        );


        const nome =
                campoNome?.value.trim() || '';

        const descricao =
                campoDescricao?.value.trim() || '';

        const codigoBarras =
                campoCodigo?.value.trim() || '';

        const categoriaId =
                campoCategoria?.value || null;


        // ----------------------------------------------------
        // 2. VALIDAÇÕES
        // ----------------------------------------------------

        if (!nome) {

            throw new Error(
                    'Informe o nome do produto.'
                    );
        }


        if (!codigoBarras) {

            throw new Error(
                    'Informe o código de barras.'
                    );
        }


        if (!/^\d+$/.test(codigoBarras)) {

            throw new Error(
                    'O código de barras deve conter somente números.'
                    );
        }


        if (codigoBarras.length > 14) {

            throw new Error(
                    'O código de barras pode ter no máximo 14 dígitos.'
                    );
        }


        // ----------------------------------------------------
        // 3. MANTÉM A IMAGEM ATUAL
        // ----------------------------------------------------

        let urlFinalImagem =
                produtoEdicaoAtual.imagem_url || '';


        // ----------------------------------------------------
        // 4. SE ESCOLHEU NOVA IMAGEM, ENVIA PARA STORAGE
        // ----------------------------------------------------

        if (arquivoImagemProdutoEdicao) {

            btn.innerHTML =
                    '⏳ Enviando imagem...';


            const nomeOriginal =
                    arquivoImagemProdutoEdicao.name
                    || 'imagem.jpg';


            const extensao =
                    nomeOriginal.includes('.')
                    ? nomeOriginal
                    .split('.')
                    .pop()
                    .toLowerCase()
                    : 'jpg';


            const nomeArquivo =
                    `prod_edit_${produtoEdicaoAtual.id}_${Date.now()}.${extensao}`;


            const {
                data: uploadData,
                error: uploadError
            } = await _supabase.storage
                    .from('produtos')
                    .upload(
                            nomeArquivo,
                            arquivoImagemProdutoEdicao
                            );


            if (uploadError) {

                throw new Error(
                        'Erro ao enviar a nova imagem: ' +
                        uploadError.message
                        );
            }


            const {
                data: publicData
            } = _supabase.storage
                    .from('produtos')
                    .getPublicUrl(
                            nomeArquivo
                            );


            urlFinalImagem =
                    publicData?.publicUrl ||
                    urlFinalImagem;
        }


        // ----------------------------------------------------
        // 5. ATUALIZA PRODUTO NO BANCO
        // ----------------------------------------------------

        btn.innerHTML =
                '⏳ Atualizando produto...';


        const {
            data: produtoAtualizado,
            error
        } = await _supabase
                .from('produtos')
                .update({
                    nome: nome,
                    descricao:
                            descricao || null,
                    codigo_barras:
                            codigoBarras,
                    categoria_id:
                            categoriaId
                            ? Number(categoriaId)
                            : null,
                    imagem_url:
                            urlFinalImagem
                            || null
                })
                .eq(
                        'id',
                        produtoEdicaoAtual.id
                        )
                .select(`
                    id,
                    nome,
                    descricao,
                    categoria_id,
                    codigo_barras,
                    imagem_url
                `)
                .single();


        if (error) {

            if (error.code === '23505') {

                throw new Error(
                        'Este código de barras já está cadastrado em outro produto.'
                        );
            }


            throw new Error(
                    'Erro ao atualizar produto: ' +
                    error.message
                    );
        }


        if (!produtoAtualizado) {

            throw new Error(
                    'O banco não retornou o produto atualizado.'
                    );
        }


        // ----------------------------------------------------
        // 6. FECHA E ATUALIZA A TABELA
        // ----------------------------------------------------

        fecharEdicaoProduto();

        await carregarProdutosGerenciador();


        alert(
                '✅ Produto atualizado com sucesso!'
                );


    } catch (err) {

        console.error(
                'Erro ao salvar edição do produto:',
                err
                );

        alert(
                '❌ Não foi possível salvar:\n\n' +
                (err.message || err)
                );

    } finally {

        btn.disabled =
                false;

        btn.innerHTML =
                textoOriginal;
    }
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
        const campoCodigo = document.getElementById('np-codigo');
        const codigoBarra = campoCodigo?.value.trim() || '';

        if (!/^\d+$/.test(codigoBarra)) {
            alert('⚠️ O código de barras deve conter somente números.');
            campoCodigo?.focus();
            return;
        }
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

function somenteNumerosCodigoBarras(input) {
    input.value =
            String(input.value || '')
            .replace(/\D/g, '')
            .slice(0, 14);
}

let carrinhoBalcao = [];
let listaProdutosBalcao = [];

// ============================================================
// ESTOQUE VENDÁVEL DO BALCÃO
// ============================================================
// Regra:
// 1. Se o produto possui lote(s), considera somente lotes:
//    - ATIVO
//    - quantidade_disponivel > 0
//    - data_validade >= hoje
//
// 2. Se o produto NÃO possui lote, usa produtos.estoque.
//
// Isso mantém a tela do PDV alinhada com a baixa por lote.
// ============================================================
async function carregarEstoqueVendavelBalcao(produtos) {

    const idsProdutos =
            (produtos || [])
            .map(p => Number(p.id))
            .filter(Number.isInteger);

    const mapaLotes = new Map();

    if (idsProdutos.length > 0) {

        const {
            data: lotes,
            error: erroLotes
        } = await _supabase
                .from('lotes_producao')
                .select(`
                id,
                produto_id,
                quantidade_disponivel,
                data_validade,
                status
            `)
                .in('produto_id', idsProdutos);

        if (erroLotes) {

            console.error(
                    'Erro ao carregar lotes do balcão:',
                    erroLotes
                    );

        } else {

            (lotes || []).forEach(lote => {

                const produtoId =
                        Number(lote.produto_id);

                if (!Number.isInteger(produtoId)) {
                    return;
                }

                if (!mapaLotes.has(produtoId)) {

                    mapaLotes.set(
                            produtoId,
                            {
                                temLote: true,
                                estoqueVendavel: 0
                            }
                    );
                }

                const quantidade =
                        Number(
                                lote.quantidade_disponivel || 0
                                );

                const dataValidade =
                        lote.data_validade
                        ? String(lote.data_validade)
                        : null;

                const status =
                        String(
                                lote.status || ''
                                )
                        .trim()
                        .toUpperCase();

                const hoje =
                        new Date();

                hoje.setHours(
                        0,
                        0,
                        0,
                        0
                        );

                const validade =
                        dataValidade
                        ? new Date(
                                dataValidade + 'T00:00:00'
                                )
                        : null;

                const loteValido =
                        status === 'ATIVO' &&
                        quantidade > 0 &&
                        validade &&
                        !Number.isNaN(
                                validade.getTime()
                                ) &&
                        validade >= hoje;

                if (loteValido) {

                    const registro =
                            mapaLotes.get(
                                    produtoId
                                    );

                    registro.estoqueVendavel +=
                            quantidade;
                }

            });
        }
    }

    return (produtos || []).map(produto => {

        const produtoId =
                Number(produto.id);

        const infoLote =
                mapaLotes.get(
                        produtoId
                        );

        const temLote =
                !!infoLote?.temLote;

        const estoqueFisico =
                Number(
                        produto.estoque || 0
                        );

        const estoqueVendavel =
                temLote
                ? Number(
                        infoLote.estoqueVendavel || 0
                        )
                : estoqueFisico;

        return {
            ...produto,

            estoqueFisico,

            estoqueVendavel,

            temLote
        };
    });
}

// --- INICIALIZAÇÃO DA ABA BALCÃO ---
async function carregarBalcao() {

    const {
        data: produtos,
        error
    } = await _supabase
            .from('produtos')
            .select('*')
            .eq('ativo', true)
            .order('nome');

    if (error) {

        console.error(
                'Erro ao carregar produtos do balcão:',
                error.message
                );

        return;
    }

    listaProdutosBalcao =
            await carregarEstoqueVendavelBalcao(
                    produtos || []
                    );

    renderizarProdutosBalcao([]);

    verificarStatusCaixa();
}

// ============================================================
// RENDERIZAÇÃO DOS PRODUTOS
// ============================================================
function renderizarProdutosBalcao(produtos) {

    const grid =
            document.getElementById(
                    'grid-balcao-produtos'
                    );

    if (!grid) {
        return;
    }

    grid.innerHTML = '';

    (produtos || []).forEach(p => {

        const estoqueFisico =
                Number(
                        p.estoqueFisico ?? p.estoque ?? 0
                        );

        const estoqueVendavel =
                Number(
                        p.estoqueVendavel ?? p.estoque ?? 0
                        );

        const indisponivel =
                estoqueVendavel <= 0;

        let textoEstoque = '';

        if (p.temLote) {

            if (indisponivel) {

                textoEstoque = `
                    <small style="
                        display:block;
                        color:#ff6b6b;
                        margin-bottom:4px;
                    ">
                        Estoque físico: ${estoqueFisico}
                    </small>

                    <small style="
                        display:block;
                        color:#ff4757;
                        font-weight:bold;
                        margin-bottom:8px;
                    ">
                        ⚠️ Vendável: 0
                    </small>
                `;

            } else {

                textoEstoque = `
                    <small style="
                        display:block;
                        color:#aaa;
                        margin-bottom:4px;
                    ">
                        Estoque físico: ${estoqueFisico}
                    </small>

                    <small style="
                        display:block;
                        color:#2ed573;
                        font-weight:bold;
                        margin-bottom:8px;
                    ">
                        ✅ Vendável: ${estoqueVendavel}
                    </small>
                `;
            }

        } else {

            textoEstoque = `
                <small style="
                    display:block;
                    color:#aaa;
                    margin-bottom:8px;
                ">
                    Estoque: ${estoqueVendavel}
                </small>
            `;
        }

        const textoBotao =
                indisponivel
                ? (
                        p.temLote
                        ? 'Sem lote válido'
                        : 'Esgotado'
                        )
                : '➕ Adicionar';

        const corBotao =
                indisponivel
                ? '#555'
                : '#ff4757';

        grid.innerHTML += `

            <div
                style="
                    background:#2a2a32;
                    padding:12px;
                    border-radius:8px;
                    border:1px solid #3d3d4a;
                    opacity:${indisponivel ? '0.5' : '1'};
                    text-align:center;
                "
            >

                <div>
                    <img
                        src="${p.imagem_url || ''}"
                        class="product-row-img"
                        alt="${p.nome}"
                    >
                </div>

                <strong
                    style="
                        display:block;
                        font-size:0.95rem;
                        margin-bottom:5px;
                    "
                >
                    ${p.nome}
                </strong>

                <div
                    style="
                        color:#2ed573;
                        font-weight:bold;
                        margin-bottom:5px;
                    "
                >
                    R$
                    ${parseFloat(p.preco || 0)
                .toFixed(2)
                .replace('.', ',')}
                </div>

                ${textoEstoque}

                <button
                    class="btn-qty"
                    style="
                        width:100%;
                        background:${corBotao};
                        height:32px;
                    "
                    onclick="
                        adicionarAoCarrinhoBalcao('${p.id}')
                    "
                    ${indisponivel ? 'disabled' : ''}
                >
                    ${textoBotao}
                </button>

            </div>
        `;
    });
}

// ============================================================
// FILTRO DE PRODUTOS
// ============================================================
function filtrarProdutosBalcao(termo) {

    const busca =
            termo
            ? termo.toLowerCase().trim()
            : '';

    if (!busca) {

        renderizarProdutosBalcao([]);

        return;
    }

    const filtrados =
            listaProdutosBalcao.filter(p =>
                p.nome
                        .toLowerCase()
                        .includes(busca)

                        ||
                        (
                                p.codigo_barras &&
                                String(
                                        p.codigo_barras
                                        )
                                .toLowerCase()
                                .includes(busca)
                                )

                        ||
                        String(p.id) === busca
            );

    renderizarProdutosBalcao(
            filtrados
            );
}

// ============================================================
// ATALHO PARA CENTRALIZAR A COMANDA DO BALCÃO
// ============================================================

function irParaComandaBalcao() {

    const comanda =
            document.getElementById(
                    'balcao-comanda'
                    );

    if (!comanda) {
        return;
    }

    comanda.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });

    // Retorna o foco para o leitor/campo de código
    setTimeout(() => {

        const campoCodigo =
                document.getElementById(
                        'balcao-input-codigo'
                        );

        if (campoCodigo) {

            campoCodigo.focus();

            campoCodigo.select();
        }

    }, 450);
}

// ============================================================
// ADICIONAR AO CARRINHO
// ============================================================
window.adicionarAoCarrinhoBalcao = function (produtoId) {

    if (
            !caixaAtual ||
            caixaAtual.status !== 'ABERTO'
            ) {

        alert(
                '⚠️ O caixa está FECHADO! Abra o caixa para iniciar o atendimento.'
                );

        return;
    }

    const prod =
            listaProdutosBalcao.find(
                    p =>
                String(p.id) ===
                        String(produtoId)
            );

    if (!prod) {

        console.error(
                'Produto não encontrado:',
                produtoId
                );

        return;
    }

    const estoqueVendavel =
            Number(
                    prod.estoqueVendavel ??
                    prod.estoque ??
                    0
                    );

    if (estoqueVendavel <= 0) {

        if (prod.temLote) {

            alert(
                    `⚠️ "${prod.nome}" não possui lote válido para venda.`
                    );

        } else {

            alert(
                    `⚠️ Estoque insuficiente para "${prod.nome}".`
                    );
        }

        return;
    }

    const itemExistente =
            carrinhoBalcao.find(
                    i =>
                String(i.id) ===
                        String(produtoId)
            );

    const qtdAtual =
            itemExistente
            ? Number(itemExistente.qtd || 0)
            : 0;

    if (
            qtdAtual + 1 >
            estoqueVendavel
            ) {

        alert(
                `Estoque insuficiente para "${prod.nome}".\n\n` +
                `Disponível para venda: ${estoqueVendavel} unidade(s).`
                );

        return;
    }

    if (itemExistente) {

        itemExistente.qtd += 1;

    } else {

        carrinhoBalcao.push({

            id:
                    prod.id,

            nome:
                    prod.nome,

            preco:
                    prod.preco,

            qtd:
                    1

        });
    }

    atualizarCarrinhoBalcaoUI();
};

// ============================================================
// ALTERAR QUANTIDADE NO CARRINHO
// ============================================================
window.alterarQtdBalcao = function (produtoId, delta) {

    const item =
            carrinhoBalcao.find(
                    i =>
                String(i.id) ===
                        String(produtoId)
            );

    if (!item) {
        return;
    }

    const prodOriginal =
            listaProdutosBalcao.find(
                    p =>
                String(p.id) ===
                        String(produtoId)
            );

    const estoqueVendavel =
            Number(
                    prodOriginal?.estoqueVendavel ??
                    prodOriginal?.estoque ??
                    0
                    );

    if (
            delta > 0 &&
            item.qtd + delta >
            estoqueVendavel
            ) {

        alert(
                `Limite de estoque vendável atingido.\n\n` +
                `Disponível: ${estoqueVendavel} unidade(s).`
                );

        return;
    }

    item.qtd += delta;

    if (item.qtd <= 0) {

        carrinhoBalcao =
                carrinhoBalcao.filter(
                        i =>
                    String(i.id) !==
                            String(produtoId)
                );
    }

    atualizarCarrinhoBalcaoUI();
};

function moedaBalcaoUI(valor) {
    return `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
}

function numeroBalcaoUI(valor) {
    const texto = String(valor ?? '').trim().replace(/\s/g, '');

    if (!texto)
        return 0;

    // Aceita:
    // 12.34
    // 12,34
    // 1.234,56
    const normalizado = texto.includes(',')
            ? texto.replace(/\./g, '').replace(',', '.')
            : texto;

    const numero = Number(normalizado);

    return Number.isFinite(numero) ? numero : 0;
}

function recalcularTotaisBalcaoUI() {

    const subtotal = carrinhoBalcao.reduce((total, item) => {

        return total +
                (
                        Number(item.preco || 0) *
                        Number(item.qtd || 0)
                        );

    }, 0);

    const campoDesconto =
            document.getElementById('balcao-desconto');

    let desconto =
            numeroBalcaoUI(
                    campoDesconto?.value
                    );

    // Nunca permitir desconto negativo
    if (desconto < 0) {
        desconto = 0;
    }

    // Nunca permitir desconto maior que o subtotal
    if (desconto > subtotal) {

        desconto = subtotal;

        if (campoDesconto) {
            campoDesconto.value =
                    desconto.toFixed(2);
        }
    }

    const total =
            Math.max(
                    0,
                    subtotal - desconto
                    );

    const subtotalEl =
            document.getElementById(
                    'balcao-subtotal-val'
                    );

    const totalEl =
            document.getElementById(
                    'balcao-total-val'
                    );

    if (subtotalEl) {
        subtotalEl.textContent =
                moedaBalcaoUI(subtotal);
    }

    if (totalEl) {
        totalEl.textContent =
                moedaBalcaoUI(total);
    }

    // ==========================
    // CÁLCULO DO TROCO
    // ==========================

    const forma =
            String(
                    document.getElementById(
                            'balcao-pagamento'
                            )?.value || ''
                    )
            .toUpperCase()
            .trim();

    const recebidoEl =
            document.getElementById(
                    'balcao-valor-recebido'
                    );

    const trocoEl =
            document.getElementById(
                    'balcao-troco'
                    );

    if (
            forma === 'DINHEIRO' &&
            recebidoEl &&
            trocoEl
            ) {

        const recebido =
                numeroBalcaoUI(
                        recebidoEl.value
                        );

        const diferenca =
                recebido - total;

        if (recebido <= 0) {

            trocoEl.value =
                    'R$ 0,00';

            trocoEl.style.color =
                    '#2ed573';

        } else if (diferenca < 0) {

            trocoEl.value =
                    `Falta ${moedaBalcaoUI(
                            Math.abs(diferenca)
                            )}`;

            trocoEl.style.color =
                    '#ff4757';

        } else {

            trocoEl.value =
                    moedaBalcaoUI(
                            diferenca
                            );

            trocoEl.style.color =
                    '#2ed573';
        }
    }

    return {
        subtotal,
        desconto,
        total
    };
}

function atualizarCarrinhoBalcaoUI() {

    const conteiner =
            document.getElementById(
                    'lista-carrinho-balcao'
                    );

    if (!conteiner)
        return;

    conteiner.innerHTML = '';

    if (carrinhoBalcao.length === 0) {

        conteiner.innerHTML =
                '<p style="color: #888; text-align: center; margin-top: 30px;">Nenhum item selecionado.</p>';

    } else {

        carrinhoBalcao.forEach(i => {

            const subtotal =
                    Number(i.preco || 0) *
                    Number(i.qtd || 0);

            conteiner.innerHTML += `
                <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    padding:8px 0;
                    border-bottom:1px solid #2a2a32;
                ">

                    <div>
                        <div style="
                            font-weight:bold;
                            font-size:0.9rem;
                        ">
                            ${i.nome}
                        </div>

                        <small style="color:#aaa;">
                            ${moedaBalcaoUI(i.preco)}
                        </small>
                    </div>

                    <div style="
                        display:flex;
                        align-items:center;
                        gap:6px;
                    ">

                        <button
                            class="btn-qty"
                            style="
                                width:24px;
                                height:24px;
                                padding:0;
                            "
                            onclick="alterarQtdBalcao('${i.id}', -1)"
                        >
                            -
                        </button>

                        <span>${i.qtd}</span>

                        <button
                            class="btn-qty"
                            style="
                                width:24px;
                                height:24px;
                                padding:0;
                            "
                            onclick="alterarQtdBalcao('${i.id}', 1)"
                        >
                            +
                        </button>

                    </div>

                </div>
            `;
        });
    }

    recalcularTotaisBalcaoUI();
}

// --- FINALIZAÇÃO DA VENDA, BAIXA NO ESTOQUE E COMPROVANTE ---
// PIX / DINHEIRO / FIADO
// ============================================================

async function finalizarVendaBalcao() {
    // --------------------------------------------------------
    // 1. CAIXA
    // --------------------------------------------------------
    if (
            !caixaAtual ||
            caixaAtual.status !== 'ABERTO'
            ) {

        alert(
                '⚠️ O caixa está FECHADO! Abra o caixa no painel para poder realizar vendas.'
                );

        return;
    }

    // --------------------------------------------------------
    // 2. CARRINHO
    // --------------------------------------------------------
    if (
            !Array.isArray(carrinhoBalcao) ||
            carrinhoBalcao.length === 0
            ) {

        alert(
                'Adicione ao menos um produto no carrinho do balcão.'
                );

        return;
    }

    // --------------------------------------------------------
    // 3. BOTÃO
    // --------------------------------------------------------
    const btn =
            document.getElementById(
                    'btn-finalizar-balcao'
                    );

    if (!btn) {

        console.error(
                'Botão btn-finalizar-balcao não encontrado.'
                );

        return;
    }

    const textoOriginal =
            btn.textContent;

    btn.textContent =
            '⏳ Processando Venda...';

    btn.disabled = true;

    try {
        // ----------------------------------------------------
        // 4. DADOS DA VENDA
        // ----------------------------------------------------
        const formaPagamento =
                document
                .getElementById(
                        'balcao-pagamento'
                        )
                ?.value
                ?.trim()
                ?.toUpperCase() || '';


        const nomeCliente =
                document
                .getElementById(
                        'balcao-cliente'
                        )
                ?.value
                ?.trim() || '';


        const itensRPC =
                carrinhoBalcao.map(item => ({
                        produto_id:
                                Number(item.id),

                        quantidade:
                                Number(item.qtd)
                    }));

        // ====================================================
        // 5. FIADO
        // ====================================================
        if (
                formaPagamento === 'FIADO'
                ) {

            // ------------------------------------------------
            // Cliente selecionado
            // ------------------------------------------------
            const selectClienteFiado =
                    document.getElementById(
                            'balcao-cliente-id'
                            );

            const clienteId =
                    selectClienteFiado?.value
                    ? Number(
                            selectClienteFiado.value
                            )
                    : null;

            if (
                    !Number.isInteger(clienteId) ||
                    clienteId <= 0
                    ) {

                alert(
                        '⚠️ Para venda FIADO, selecione um cliente cadastrado.'
                        );

                document
                        .getElementById(
                                'balcao-cliente'
                                )
                        ?.focus();

                return;
            }

            // ------------------------------------------------
            // Data de vencimento
            // ------------------------------------------------
            const dataVencimento =
                    document
                    .getElementById(
                            'balcao-data-vencimento'
                            )
                    ?.value || '';

            if (!dataVencimento) {

                alert(
                        '⚠️ Informe a data de vencimento do FIADO.'
                        );

                document
                        .getElementById(
                                'balcao-data-vencimento'
                                )
                        ?.focus();

                return;
            }

            // ------------------------------------------------
            // Validação de data
            // ------------------------------------------------
            const dataHoje =
                    new Date();

            dataHoje.setHours(
                    0,
                    0,
                    0,
                    0
                    );

            const partesData =
                    dataVencimento
                    .split('-')
                    .map(Number);

            if (
                    partesData.length !== 3
                    ) {

                alert(
                        '⚠️ Data de vencimento inválida.'
                        );

                return;
            }

            const dataVenc =
                    new Date(
                            partesData[0],
                            partesData[1] - 1,
                            partesData[2]
                            );

            dataVenc.setHours(
                    0,
                    0,
                    0,
                    0
                    );

            if (
                    Number.isNaN(
                            dataVenc.getTime()
                            ) ||
                    dataVenc < dataHoje
                    ) {

                alert(
                        '⚠️ A data de vencimento não pode ser anterior a hoje.'
                        );

                return;
            }

            // ------------------------------------------------
            // Confirmação do FIADO
            // ------------------------------------------------
            const confirmarFiado =
                    confirm(
                            '📒 VENDA FIADO\n\n' +
                            'Esta venda será registrada na Conta a Receber do cliente.\n\n' +
                            'O estoque será baixado normalmente.\n\n' +
                            'Deseja continuar?'
                            );

            if (!confirmarFiado) {
                return;
            }

            // ------------------------------------------------
// AUTORIZAÇÃO DO FIADO
// ------------------------------------------------
// GERENTE e ADMIN não precisam informar PIN.
// OPERADOR e demais cargos precisam informar
// o PIN de um gerente/admin.
// ------------------------------------------------
            const cargoAtual =
                    String(
                            window.usuarioAtual?.cargo || ''
                            )
                    .toUpperCase()
                    .trim();

            const ehGerente =
                    cargoAtual === 'GERENTE' ||
                    cargoAtual === 'ADMIN';

            let pinGerente = null;

// ------------------------------------------------
// SOMENTE OPERADOR / OUTROS CARGOS
// ------------------------------------------------
            if (!ehGerente) {

                pinGerente =
                        await solicitarPinGerenteSeguro(
                                'Informe o PIN do GERENTE ou ADMIN para autorizar esta venda FIADO:'
                                );

                if (
                        pinGerente === null
                        ) {

                    alert(
                            '⚠️ Venda FIADO cancelada. A autorização é obrigatória.'
                            );

                    return;
                }

                pinGerente = pinGerente.trim();


                // ------------------------------------------------
                // VALIDA FORMATO
                // ------------------------------------------------
                if (
                        !/^\d{4,6}$/.test(
                                pinGerente
                                )
                        ) {

                    alert(
                            '⚠️ O PIN deve ter de 4 a 6 números.'
                            );

                    return;
                }
            }

            // ------------------------------------------------
            // RPC FIADO
            // ------------------------------------------------
            const {
                data,
                error
            } = await _supabase.rpc(
                    'registrar_venda_balcao_fiado',
                    {
                        p_caixa_id:
                                Number(
                                        caixaAtual.id
                                        ),

                        p_cliente_id:
                                clienteId,

                        p_pin_gerente:
                                pinGerente,

                        p_data_vencimento:
                                dataVencimento,

                        p_itens:
                                itensRPC
                    }
            );


            if (error) {

                console.error(
                        'Erro na RPC registrar_venda_balcao_fiado:',
                        error
                        );

                const mensagem =
                        error?.message || '';


                if (
                        mensagem.includes(
                                'CLIENTE_OBRIGATORIO_FIADO'
                                )
                        ) {

                    alert(
                            '⚠️ Selecione um cliente cadastrado para o FIADO.'
                            );

                } else if (
                        mensagem.includes(
                                'CLIENTE_NAO_ENCONTRADO'
                                )
                        ) {

                    alert(
                            '⚠️ O cliente selecionado não foi encontrado.'
                            );

                } else if (
                        mensagem.includes(
                                'AUTORIZACAO_GERENTE_NECESSARIA'
                                )
                        ) {

                    alert(
                            '🔐 A autorização do gerente é obrigatória para o FIADO.'
                            );

                } else if (
                        mensagem.includes(
                                'PIN_GERENTE_INVALIDO'
                                )
                        ) {

                    alert(
                            '❌ PIN do GERENTE ou ADMIN inválido.'
                            );

                } else if (
                        mensagem.includes(
                                'DATA_VENCIMENTO_INVALIDA'
                                )
                        ) {

                    alert(
                            '⚠️ A data de vencimento informada é inválida.'
                            );

                } else if (
                        mensagem.includes(
                                'ESTOQUE_INSUFICIENTE'
                                )
                        ) {

                    alert(
                            '⚠️ Estoque insuficiente para um ou mais produtos.'
                            );

                } else if (
                        mensagem.includes(
                                'CAIXA_FECHADO'
                                )
                        ) {

                    alert(
                            '🔒 O caixa está fechado.'
                            );

                } else if (
                        mensagem.includes(
                                'ACESSO_RESTRITO'
                                )
                        ) {

                    alert(
                            '🔒 Usuário sem autorização para realizar esta operação.'
                            );

                } else {

                    alert(
                            '❌ Não foi possível registrar o FIADO:\n\n' +
                            mensagem
                            );
                }

                return;
            }

            if (
                    !data ||
                    !data.sucesso ||
                    !data.pedido_id ||
                    !data.conta_receber_id
                    ) {

                throw new Error(
                        'O banco não retornou corretamente os dados da venda FIADO.'
                        );
            }

            const pedidoId =
                    Number(
                            data.pedido_id
                            );

            const contaReceberId =
                    Number(
                            data.conta_receber_id
                            );

            // ------------------------------------------------
            // Recarrega pedido
            // ------------------------------------------------
            const {
                data: novoPedido,
                error: erroBuscaPedido
            } = await _supabase
                    .from('pedidos')
                    .select(`
                    *,
                    itens_pedido (
                        *,
                        produtos (nome),
                        consumos_lotes (
                            id,
                            quantidade,
                            lote:lotes_producao (
                                id,
                                numero_lote,
                                data_fabricacao,
                                data_validade
                            )
                        )
                    ),
                    clientes (
                        id,
                        nome,
                        documento,
                        telefone,
                        rua,
                        numero,
                        bairro,
                        complemento,
                        ponto_referencia
                    )
                `)
                    .eq(
                            'id',
                            pedidoId
                            )
                    .single();

            if (erroBuscaPedido) {
                throw erroBuscaPedido;
            }

            // ------------------------------------------------
            // Atualiza lista global
            // ------------------------------------------------
            if (
                    !Array.isArray(
                            listaPedidosGlobal
                            )
                    ) {

                listaPedidosGlobal = [];
            }

            listaPedidosGlobal.push(
                    novoPedido
                    );

            // ------------------------------------------------
            // Imprime
            // ------------------------------------------------
            if (
                    typeof window.imprimirPedido === 'function'
                    ) {

                window.imprimirPedido(
                        pedidoId
                        );
            }

            // ------------------------------------------------
            // Limpa seleção FIADO
            // ------------------------------------------------
            clienteFiadoSelecionadoId =
                    null;

            // ------------------------------------------------
            // Limpa carrinho
            // ------------------------------------------------
            carrinhoBalcao = [];

            const campoCliente =
                    document.getElementById(
                            'balcao-cliente'
                            );

            if (campoCliente) {
                campoCliente.value = '';
            }

            const seletorCliente =
                    document.getElementById(
                            'balcao-cliente-id'
                            );

            if (seletorCliente) {

                seletorCliente.innerHTML = `
                    <option value="">
                        Selecione o cliente...
                    </option>
                `;
            }

            const vencimento =
                    document.getElementById(
                            'balcao-data-vencimento'
                            );

            if (vencimento) {
                vencimento.value = '';
            }

            // Volta para uma forma normal
            // para esconder os campos do FIADO.
            const pagamento =
                    document.getElementById(
                            'balcao-pagamento'
                            );

            if (pagamento) {
                pagamento.value = 'PIX';

                alterarFormaPagamentoBalcaoUI(
                        'PIX'
                        );
            }

            atualizarCarrinhoBalcaoUI();

            await carregarBalcao();

            await exibirPainelCaixaAberto();

            alert(
                    `✅ Venda FIADO #${pedidoId} realizada com sucesso!\n\n` +
                    `📒 Conta a Receber #${contaReceberId} criada.\n` +
                    `💰 Valor: R$ ${Number(data.valor_total || 0).toFixed(2).replace('.', ',')}\n` +
                    `📅 Vencimento: ${dataVencimento.split('-').reverse().join('/')}`
                    );

            return;
        }

        // ====================================================
// 6. VENDA NORMAL
// ====================================================

        const totaisBalcao =
                recalcularTotaisBalcaoUI();

        const descontoBalcao =
                Number(
                        totaisBalcao?.desconto || 0
                        );

        const totalBalcao =
                Number(
                        totaisBalcao?.total || 0
                        );

        let valorRecebido = null;

// ================================================
// DINHEIRO
// ================================================

        if (formaPagamento === 'DINHEIRO') {

            valorRecebido =
                    numeroBalcaoUI(
                            document.getElementById(
                                    'balcao-valor-recebido'
                                    )?.value
                            );

            if (
                    !Number.isFinite(valorRecebido) ||
                    valorRecebido < totalBalcao
                    ) {

                alert(
                        `⚠️ Valor recebido insuficiente.\n\n` +
                        `Total: ${moedaBalcaoUI(totalBalcao)}\n` +
                        `Recebido: ${moedaBalcaoUI(valorRecebido)}`
                        );

                document
                        .getElementById(
                                'balcao-valor-recebido'
                                )
                        ?.focus();

                return;
            }
        }

// ================================================
// REGISTRA VENDA
// ================================================

        const {
            data: pedidoId,
            error: erroVenda
        } = await _supabase.rpc(
                'registrar_venda_balcao_com_desconto',
                {
                    p_caixa_id:
                            Number(caixaAtual.id),

                    p_forma_pagamento:
                            formaPagamento,

                    p_nome_cliente:
                            nomeCliente || null,

                    p_desconto:
                            descontoBalcao,

                    p_valor_recebido:
                            valorRecebido,

                    p_itens:
                            itensRPC
                }
        );

// ================================================
// ERROS
// ================================================

        if (erroVenda) {

            console.error(
                    'Erro na RPC registrar_venda_balcao_com_desconto:',
                    erroVenda
                    );

            if (
                    erroVenda.message?.includes(
                            'CAIXA_FECHADO'
                            )
                    ) {

                alert(
                        '🔒 O caixa está fechado.'
                        );

            } else if (
                    erroVenda.message?.includes(
                            'ESTOQUE_INSUFICIENTE'
                            )
                    ) {

                alert(
                        '⚠️ Estoque insuficiente para um ou mais produtos.'
                        );

            } else if (
                    erroVenda.message?.includes(
                            'PRODUTO_NAO_ENCONTRADO'
                            )
                    ) {

                alert(
                        '⚠️ Um dos produtos não está mais disponível.'
                        );

            } else if (
                    erroVenda.message?.includes(
                            'FORMA_PAGAMENTO_INVALIDA'
                            )
                    ) {

                alert(
                        '⚠️ Forma de pagamento inválida.'
                        );

            } else if (
                    erroVenda.message?.includes(
                            'DESCONTO_MAIOR_QUE_TOTAL'
                            )
                    ) {

                alert(
                        '⚠️ O desconto não pode ser maior que o valor da venda.'
                        );

            } else if (
                    erroVenda.message?.includes(
                            'VALOR_RECEBIDO_INSUFICIENTE'
                            )
                    ) {

                alert(
                        '⚠️ O valor recebido em dinheiro é menor que o total da venda.'
                        );

            } else {

                alert(
                        '❌ Erro ao registrar a venda:\n\n' +
                        erroVenda.message
                        );
            }

            return;
        }

        if (!pedidoId) {

            throw new Error(
                    'A venda foi processada, mas nenhum ID de pedido foi retornado.'
                    );
        }

        // ----------------------------------------------------
        // Recarrega pedido
        // ----------------------------------------------------
        const {
            data: novoPedido,
            error: erroBuscaPedido
        } = await _supabase
                .from('pedidos')
                .select(`
                *,
                itens_pedido (
                    *,
                    produtos (nome)
                )
            `)
                .eq(
                        'id',
                        pedidoId
                        )
                .single();

        if (erroBuscaPedido) {
            throw erroBuscaPedido;
        }

        // ----------------------------------------------------
        // Atualiza lista global
        // ----------------------------------------------------
        if (
                !Array.isArray(
                        listaPedidosGlobal
                        )
                ) {

            listaPedidosGlobal = [];
        }

        listaPedidosGlobal.push(
                novoPedido
                );

        // ----------------------------------------------------
        // Imprime
        // ----------------------------------------------------
        if (
                typeof window.imprimirPedido === 'function'
                ) {

            window.imprimirPedido(
                    pedidoId
                    );
        }

        // ----------------------------------------------------
        // Limpa carrinho
        // ----------------------------------------------------
        carrinhoBalcao = [];

        const campoClienteNormal =
                document.getElementById(
                        'balcao-cliente'
                        );

        if (campoClienteNormal) {
            campoClienteNormal.value = '';
        }

        atualizarCarrinhoBalcaoUI();

        // ----------------------------------------------------
        // Atualiza estoque
        // ----------------------------------------------------
        await carregarBalcao();

        // ----------------------------------------------------
        // Atualiza caixa
        // ----------------------------------------------------
        await exibirPainelCaixaAberto();

        alert(
                `✅ Venda #${pedidoId} realizada com sucesso!`
                );

        const campoDesconto =
                document.getElementById(
                        'balcao-desconto'
                        );

        const campoValorRecebido =
                document.getElementById(
                        'balcao-valor-recebido'
                        );

        const campoTroco =
                document.getElementById(
                        'balcao-troco'
                        );

        if (campoDesconto) {
            campoDesconto.value = '0.00';
        }

        if (campoValorRecebido) {
            campoValorRecebido.value = '';
        }

        if (campoTroco) {
            campoTroco.value = 'R$ 0,00';
        }

    } catch (err) {

        console.error(
                'Exceção ao finalizar venda:',
                err
                );


        alert(
                '❌ Erro ao finalizar venda: ' +
                (err.message || err)
                );


    } finally {

        btn.textContent =
                textoOriginal;

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

// Margens sobre o faturamento
    const margemBruta = faturamento > 0
            ? (lucroBruto / faturamento) * 100
            : 0;

    const margemLiquida = faturamento > 0
            ? (lucroLiquido / faturamento) * 100
            : 0;

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

    const elemLucroBrutoPercentual =
            document.getElementById('fin-lucro-bruto-percentual');

    if (elemLucroBrutoPercentual) {
        elemLucroBrutoPercentual.innerText =
                `${margemBruta.toFixed(2).replace('.', ',')}%`;
    }

    document.getElementById('fin-despesas').innerText =
            `R$ ${totalDespesas.toFixed(2).replace('.', ',')}`;

    document.getElementById('fin-despesas').innerText = `R$ ${totalDespesas.toFixed(2).replace('.', ',')}`;

    const elemLucro = document.getElementById('fin-lucro');
    elemLucro.innerText = `R$ ${lucroLiquido.toFixed(2).replace('.', ',')}`;
    elemLucro.style.color = lucroLiquido >= 0 ? '#2ed573' : '#ff4757';

    const elemLucroPercentual =
            document.getElementById('fin-lucro-percentual');

    if (elemLucroPercentual) {
        elemLucroPercentual.innerText =
                `${margemLiquida.toFixed(2).replace('.', ',')}%`;
    }

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

    const {data: vendas, error: erroVendas} = await query;

    let totalDinheiro = 0;
    let totalOutros = 0;

    if (vendas) {
        vendas.forEach(v => {
            const val = parseFloat(v.valor_total || 0);
            const pgto = String(v.forma_pagamento || '').toUpperCase().trim();

            if (pgto === 'DINHEIRO') {
                totalDinheiro += val;

            } else if (
                    pgto === 'PIX' ||
                    pgto === 'CARTAO_DEBITO' ||
                    pgto === 'CARTAO_CREDITO'
                    ) {
                totalOutros += val;

            } else if (pgto === 'FIADO') {
                // FIADO não entra no caixa no momento da venda.
            }
        });
    }

    /* ============================================================
     RECEBIMENTOS DE CONTAS A RECEBER
     ============================================================ */

    let totalRecebimentosOutros = 0;

    if (caixaAtual.id) {

        const {
            data: recebimentos,
            error: erroRecebimentos
        } = await _supabase
                .from('contas_receber')
                .select(`
            valor_pago,
            forma_pagamento_recebimento
        `)
                .eq('caixa_id_recebimento', caixaAtual.id)
                .eq('status', 'PAGA')
                .in('forma_pagamento_recebimento', [
                    'PIX',
                    'CARTAO_DEBITO',
                    'CARTAO_CREDITO'
                ]);

        if (erroRecebimentos) {
            console.error(
                    'Erro ao carregar recebimentos de contas a receber:',
                    erroRecebimentos
                    );
        }

        if (recebimentos) {
            recebimentos.forEach(r => {
                const val = parseFloat(r.valor_pago || 0);

                totalRecebimentosOutros += val;
            });
        }

        totalOutros += totalRecebimentosOutros;
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
function criarPayloadPix(chave, nome, valor, cidade = 'TARUMÃ') {
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

// ============================================================
// PIX — CHAVES SALVAS
// ============================================================

let pixChavesDisponiveis = [];
let pixCidadeSelecionada = 'TARUMÃ';


// ============================================================
// CARREGA AS CHAVES PIX SALVAS
// ============================================================

async function carregarChavesPix() {

    const select =
            document.getElementById(
                    'select-pix-chave-salva'
                    );

    if (!select) {
        return;
    }

    select.innerHTML =
            '<option value="">Selecione uma chave salva...</option>';

    const {
        data,
        error
    } = await _supabase
            .from('pix_chaves')
            .select(`
                id,
                chave,
                nome_beneficiario,
                cidade,
                principal,
                ativo
            `)
            .eq('ativo', true)
            .order(
                    'principal',
                    {
                        ascending: false
                    }
            )
            .order(
                    'nome_beneficiario',
                    {
                        ascending: true
                    }
            );

    if (error) {

        console.error(
                'Erro ao carregar chaves PIX:',
                error
                );

        select.innerHTML =
                '<option value="">Não foi possível carregar as chaves</option>';

        return;
    }

    pixChavesDisponiveis =
            Array.isArray(data)
            ? data
            : [];

    pixChavesDisponiveis.forEach(item => {

        const option =
                document.createElement(
                        'option'
                        );

        option.value =
                String(item.id);

        option.textContent =
                item.principal
                ? `⭐ ${item.nome_beneficiario} — ${item.chave}`
                : `${item.nome_beneficiario} — ${item.chave}`;

        select.appendChild(option);

    });

    const principal =
            pixChavesDisponiveis.find(
                    item =>
                item.principal === true
            )
            ||
            pixChavesDisponiveis[0];

    if (principal) {

        select.value =
                String(principal.id);

        preencherChavePixSelecionada(
                principal
                );
    }
}


// ============================================================
// PREENCHE OS CAMPOS COM A CHAVE SELECIONADA
// ============================================================

function preencherChavePixSelecionada(item) {

    if (!item) {
        return;
    }

    const campoChave =
            document.getElementById(
                    'input-pix-chave'
                    );

    const campoNome =
            document.getElementById(
                    'input-pix-nome'
                    );

    if (campoChave) {

        campoChave.value =
                item.chave || '';
    }

    if (campoNome) {

        campoNome.value =
                item.nome_beneficiario || '';
    }

    pixCidadeSelecionada =
            String(
                    item.cidade
                    ||
                    'TARUMÃ'
                    )
            .trim()
            ||
            'TARUMÃ';
}


// ============================================================
// QUANDO O USUÁRIO ESCOLHE UMA CHAVE NO SELECT
// ============================================================

function selecionarChavePixSalva() {

    const select =
            document.getElementById(
                    'select-pix-chave-salva'
                    );

    if (
            !select ||
            !select.value
            ) {

        return;
    }

    const item =
            pixChavesDisponiveis.find(
                    chave =>
                String(chave.id) ===
                        String(select.value)
            );

    preencherChavePixSelecionada(
            item
            );
}


// ============================================================
// SALVA UMA NOVA CHAVE PIX
// ============================================================

async function salvarChavePix() {

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    )
            .toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem salvar chaves PIX.'
                );

        return;
    }

    const campoChave =
            document.getElementById(
                    'input-pix-chave'
                    );

    const campoNome =
            document.getElementById(
                    'input-pix-nome'
                    );

    const select =
            document.getElementById(
                    'select-pix-chave-salva'
                    );

    const chave =
            campoChave?.value.trim()
            ||
            '';

    const nome =
            campoNome?.value.trim()
            ||
            '';

    const cidade =
            String(
                    pixCidadeSelecionada
                    ||
                    'TARUMÃ'
                    )
            .trim()
            .toUpperCase();

    if (!chave) {

        alert(
                '⚠️ Informe a chave PIX antes de salvar.'
                );

        campoChave?.focus();

        return;
    }

    if (!nome) {

        alert(
                '⚠️ Informe o nome do beneficiário antes de salvar.'
                );

        campoNome?.focus();

        return;
    }

    const usuarioAuthId =
            window.usuarioAtual?.auth_user_id
            ||
            null;

    const {
        data,
        error
    } = await _supabase
            .from('pix_chaves')
            .insert([{
                    chave: chave,
                    nome_beneficiario: nome,
                    cidade: cidade,
                    principal:
                            pixChavesDisponiveis.length === 0,
                    ativo: true,
                    usuario_auth_id:
                            usuarioAuthId
                }])
            .select(`
                id,
                chave,
                nome_beneficiario,
                cidade,
                principal,
                ativo
            `)
            .single();

    if (error) {

        console.error(
                'Erro ao salvar chave PIX:',
                error
                );

        if (
                error.code === '23505'
                ) {

            alert(
                    '⚠️ Esta chave PIX já está cadastrada.'
                    );

        } else {

            alert(
                    '❌ Não foi possível salvar a chave PIX: ' +
                    error.message
                    );
        }

        return;
    }

    await carregarChavesPix();

    if (
            select &&
            data?.id
            ) {

        select.value =
                String(data.id);
    }

    alert(
            '✅ Chave PIX salva com sucesso!'
            );
}

// Função acionada ao clicar em "Gerar Placa PIX"
function processarEExibirPix() {

    // Esconde o cupom de fundo para não vazar na impressão
    const cupom =
            document.getElementById(
                    'comprovante-venda'
                    );

    if (cupom) {

        cupom.style.display =
                'none';
    }

    // Campos
    const chave =
            document.getElementById(
                    'input-pix-chave'
                    )
            .value
            .trim();

    const nome =
            document.getElementById(
                    'input-pix-nome'
                    )
            .value
            .trim();

    const valor =
            parseFloat(
                    document.getElementById(
                            'input-pix-valor'
                            )
                    .value
                    );

    // Validação
    if (
            !chave ||
            !nome ||
            isNaN(valor) ||
            valor <= 0
            ) {

        alert(
                '⚠️ Preencha a chave PIX, o nome do beneficiário e um valor válido!'
                );

        return;
    }

    // Gera o código oficial do PIX
    const payloadPix =
            criarPayloadPix(
                    chave,
                    nome,
                    valor,
                    pixCidadeSelecionada
                    );

    // Gera a imagem do QR Code
    const urlQrCodeImg =
            `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(payloadPix)}`;

    // Atualiza os dados da placa
    document.getElementById(
            'pix-img-qrcode'
            )
            .src =
            urlQrCodeImg;

    document.getElementById(
            'pix-exibir-chave'
            )
            .innerText =
            chave;

    document.getElementById(
            'pix-exibir-nome'
            )
            .innerText =
            nome;

    document.getElementById(
            'pix-exibir-valor'
            )
            .innerText =
            `R$ ${valor.toFixed(2).replace('.', ',')}`;

    // Mostra a placa
    document.getElementById(
            'box-form-pix'
            )
            .style.display =
            'none';

    document.getElementById(
            'box-resultado-pix'
            )
            .style.display =
            'block';
}

// Abre o modal na etapa de formulário
function abrirPlacaPix(valorSugerido = null) {

    const abaPix =
            document.getElementById(
                    'aba-pix'
                    );

    if (abaPix) {

        abaPix.style.display =
                'block';
    }

    if (valorSugerido) {

        document.getElementById(
                'input-pix-valor'
                )
                .value =
                parseFloat(
                        valorSugerido
                        )
                .toFixed(2);
    }

    // Volta para o formulário
    voltarParaFormularioPix();

    // Carrega as chaves salvas no banco
    carregarChavesPix();
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

    if (!['GERENTE', 'ADMIN', 'OPERADOR', 'ATENDENTE', 'ENTREGADOR'].includes(cargo.toUpperCase())) {
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

//
// ============================================================
// INSUMOS — ABRIR MODAL DE NOVO INSUMO
// ============================================================

async function abrirModalNovoInsumo() {

    const modal =
            document.getElementById(
                    'modal-insumo'
                    );

    if (!modal) {

        console.error(
                '⛔ Modal de Insumo não encontrado.'
                );

        return;
    }

    const campoNome =
            document.getElementById(
                    'insumo-nome'
                    );

    const selectProduto =
            document.getElementById(
                    'insumo-produto'
                    );

    const selectUnidadeCompra =
            document.getElementById(
                    'insumo-unidade-compra'
                    );

    const selectUnidadeBase =
            document.getElementById(
                    'insumo-unidade-base'
                    );

    const campoFator =
            document.getElementById(
                    'insumo-fator'
                    );

    const campoEstoqueMinimo =
            document.getElementById(
                    'insumo-estoque-minimo'
                    );

    const campoObservacao =
            document.getElementById(
                    'insumo-observacao'
                    );

    // --------------------------------------------------------
    // LIMPA O FORMULÁRIO
    // --------------------------------------------------------

    if (campoNome) {
        campoNome.value = '';
    }

    if (campoFator) {
        campoFator.value = '1';
    }

    if (campoEstoqueMinimo) {
        campoEstoqueMinimo.value = '0';
    }

    if (campoObservacao) {
        campoObservacao.value = '';
    }

    // --------------------------------------------------------
    // CARREGA PRODUTOS
    // --------------------------------------------------------

    if (selectProduto) {

        selectProduto.innerHTML = `
            <option value="">
                Nenhum produto relacionado
            </option>
        `;

        const {
            data: produtos,
            error
        } = await _supabase
                .from('produtos')
                .select(`
                    id,
                    nome,
                    ativo
                `)
                .eq('ativo', true)
                .order('nome');

        if (error) {

            console.error(
                    'Erro ao carregar produtos:',
                    error
                    );

        } else {

            (produtos || []).forEach(produto => {

                const option =
                        document.createElement(
                                'option'
                                );

                option.value =
                        produto.id;

                option.textContent =
                        produto.nome;

                selectProduto.appendChild(
                        option
                        );
            });
        }
    }

    // --------------------------------------------------------
    // CARREGA UNIDADES
    // --------------------------------------------------------

    let unidades = [];

    const {
        data: unidadesBanco,
        error: erroUnidades
    } = await _supabase
            .from('unidades_medida')
            .select(`
            id,
            codigo,
            nome,
            fator_base,
            categoria,
            ativa
        `)
            .eq('ativa', true)
            .order('nome');

    if (erroUnidades) {

        console.error(
                'Erro ao carregar unidades:',
                erroUnidades
                );

        alert(
                '❌ Não foi possível carregar as unidades de medida.'
                );

        return;
    }

    unidades =
            Array.isArray(unidadesBanco)
            ? unidadesBanco
            : [];

    // --------------------------------------------------------
    // PREENCHIMENTO DAS UNIDADES
    // --------------------------------------------------------
    function preencherUnidades(select) {

        if (!select) {
            return;
        }

        select.innerHTML = `
            <option value="">
                Selecione...
            </option>
        `;

        unidades.forEach(unidade => {
            const option =
                    document.createElement(
                            'option'
                            );

            option.value =
                    unidade.id;

            option.textContent =
                    `${unidade.codigo} — ${unidade.nome}`;

            option.dataset.fatorBase =
                    unidade.fator_base;

            option.dataset.categoria =
                    unidade.categoria || '';

            select.appendChild(
                    option
                    );
        });
    }

    preencherUnidades(
            selectUnidadeCompra
            );

// --------------------------------------------------------
// FILTRO DE UNIDADE-BASE COMPATÍVEL
// --------------------------------------------------------

    function preencherUnidadesBaseCompativeis() {

        if (!selectUnidadeBase) {
            return;
        }

        const unidadeCompraId =
                Number(
                        selectUnidadeCompra?.value || 0
                        );

        // Sem unidade de compra selecionada.
        if (
                !Number.isInteger(unidadeCompraId) ||
                unidadeCompraId <= 0
                ) {

            selectUnidadeBase.innerHTML = `
            <option value="">
                Selecione primeiro a unidade de compra
            </option>
        `;

            selectUnidadeBase.value = '';
            selectUnidadeBase.disabled = true;

            return;
        }

        const unidadeCompra =
                unidades.find(
                        unidade =>
                    Number(unidade.id) ===
                            unidadeCompraId
                );

        if (!unidadeCompra) {

            selectUnidadeBase.innerHTML = `
            <option value="">
                Unidade de compra inválida
            </option>
        `;

            selectUnidadeBase.value = '';
            selectUnidadeBase.disabled = true;

            return;
        }

        const categoriaCompra =
                String(
                        unidadeCompra.categoria || ''
                        ).toUpperCase();

        const codigoCompra =
                String(
                        unidadeCompra.codigo || ''
                        ).toUpperCase();

        const unidadesCompativeis =
                unidades.filter(unidadeBase => {

                    const categoriaBase =
                            String(
                                    unidadeBase.categoria || ''
                                    ).toUpperCase();

                    const codigoBase =
                            String(
                                    unidadeBase.codigo || ''
                                    ).toUpperCase();

                    // Mesma categoria:
                    // G  ↔ KG
                    // KG ↔ G
                    // ML ↔ L
                    // L  ↔ ML
                    // UN ↔ UN
                    if (
                            categoriaCompra &&
                            categoriaCompra === categoriaBase
                            ) {
                        return true;
                    }

                    // Regra especial:
                    // compra em UN pode ter base em:
                    // UN, G ou ML
                    if (
                            codigoCompra === 'UN' &&
                            ['UN', 'G', 'ML'].includes(codigoBase)
                            ) {
                        return true;
                    }

                    return false;
                });

        selectUnidadeBase.innerHTML = `
        <option value="">
            Selecione a unidade-base
        </option>
    `;

        unidadesCompativeis.forEach(unidade => {

            const option =
                    document.createElement(
                            'option'
                            );

            option.value =
                    unidade.id;

            option.textContent =
                    `${unidade.codigo} — ${unidade.nome}`;

            option.dataset.fatorBase =
                    unidade.fator_base;

            option.dataset.categoria =
                    unidade.categoria || '';

            selectUnidadeBase.appendChild(
                    option
                    );
        });

        selectUnidadeBase.disabled =
                unidadesCompativeis.length === 0;

        selectUnidadeBase.value = '';
    }

// --------------------------------------------------------
// EVENTO DA UNIDADE DE COMPRA
// --------------------------------------------------------
    if (selectUnidadeCompra) {

        selectUnidadeCompra.onchange =
                preencherUnidadesBaseCompativeis;
    }

// Estado inicial
    preencherUnidadesBaseCompativeis();

    // --------------------------------------------------------
    // ATIVA O MODAL
    // --------------------------------------------------------
    modal.style.display = 'flex';
    if (campoNome) {
        setTimeout(
                function () {
                    campoNome.focus();
                },
                50
                );
    }
}

//
// ============================================================
// INSUMOS — FECHAR MODAL
// ============================================================

function fecharModalNovoInsumo() {

    const modal =
            document.getElementById(
                    'modal-insumo'
                    );

    if (modal) {
        modal.style.display = 'none';
    }

    // --------------------------------------------------------
    // LIMPA O ESTADO DE EDIÇÃO
    // --------------------------------------------------------

    window.insumoEditandoId = null;

    // --------------------------------------------------------
    // RESTAURA O BOTÃO DE CADASTRO
    // --------------------------------------------------------

    const btnSalvar =
            document.getElementById(
                    'btn-salvar-insumo'
                    );

    if (btnSalvar) {
        btnSalvar.innerHTML =
                '💾 Cadastrar Insumo';

        btnSalvar.disabled = false;
    }
}

//
// ============================================================
// INSUMOS — CÁLCULO DO FATOR DE CONVERSÃO
// ============================================================

function atualizarFatorInsumoUI() {

    const selectCompra =
            document.getElementById(
                    'insumo-unidade-compra'
                    );

    const selectBase =
            document.getElementById(
                    'insumo-unidade-base'
                    );

    const campoFator =
            document.getElementById(
                    'insumo-fator'
                    );

    const labelMinimo =
            document.getElementById(
                    'insumo-estoque-minimo-unidade'
                    );

    if (!selectCompra || !selectBase) {
        return;
    }

    const opcaoCompra =
            selectCompra.options[
                    selectCompra.selectedIndex
            ];

    const opcaoBase =
            selectBase.options[
                    selectBase.selectedIndex
            ];

    const fatorCompra =
            Number(
                    opcaoCompra?.dataset?.fatorBase || 0
                    );

    const fatorBase =
            Number(
                    opcaoBase?.dataset?.fatorBase || 0
                    );

    const categoriaCompra =
            opcaoCompra?.dataset?.categoria || '';

    const categoriaBase =
            opcaoBase?.dataset?.categoria || '';

    // Atualiza a unidade exibida no estoque mínimo.
    if (labelMinimo) {

        const codigoBase =
                opcaoBase?.textContent
                ?.split('—')[0]
                ?.trim() || '';

        labelMinimo.textContent =
                codigoBase
                ? `Unidade-base: ${codigoBase}`
                : 'Unidade-base';
    }

    if (
            fatorCompra <= 0 ||
            fatorBase <= 0
            ) {
        return;
    }

// Conversão automática somente entre unidades
// da mesma categoria.
//
// Exemplo:
// KG -> G = 1000
// L  -> ML = 1000
// UN -> UN = 1
//
// Quando a compra é uma embalagem (UN) e a
// unidade-base é peso ou volume, o fator depende
// do conteúdo da embalagem e deve ser informado
// manualmente.
//
// Exemplo:
// 1 UN de leite condensado = 295 ML
    if (
            categoriaCompra !== categoriaBase
            ) {

        if (campoFator) {

            campoFator.value = '';

            campoFator.placeholder =
                    'Informe manualmente';

            campoFator.title =
                    'Informe quantas unidades-base existem em uma unidade de compra.';
        }

        return;
    }

    const fator =
            fatorCompra / fatorBase;

    if (campoFator) {

        campoFator.placeholder =
                '';

        campoFator.title =
                '';

        campoFator.value =
                Number(fator.toFixed(6))
                .toString();
    }
}

//
// ============================================================
// INSUMOS — SALVAR NOVO INSUMO
// ============================================================

async function salvarNovoInsumo() {

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    ).toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem cadastrar ou editar insumos.'
                );

        return;
    }

    const btn =
            document.getElementById(
                    'btn-salvar-insumo'
                    );

    if (!btn) {

        console.error(
                '⛔ Botão de salvar insumo não encontrado.'
                );

        return;
    }

    if (btn.disabled) {
        return;
    }

    const textoOriginal =
            btn.innerHTML;

    try {

        // ----------------------------------------------------
        // CAMPOS
        // ----------------------------------------------------

        const campoNome =
                document.getElementById(
                        'insumo-nome'
                        );

        const selectProduto =
                document.getElementById(
                        'insumo-produto'
                        );

        const selectUnidadeCompra =
                document.getElementById(
                        'insumo-unidade-compra'
                        );

        const selectUnidadeBase =
                document.getElementById(
                        'insumo-unidade-base'
                        );

        const campoFator =
                document.getElementById(
                        'insumo-fator'
                        );

        const campoEstoqueMinimo =
                document.getElementById(
                        'insumo-estoque-minimo'
                        );

        const campoObservacao =
                document.getElementById(
                        'insumo-observacao'
                        );


        // ----------------------------------------------------
        // DADOS
        // ----------------------------------------------------

        const nome =
                campoNome?.value
                ?.trim() || '';

        const produtoId =
                selectProduto?.value
                ? Number(selectProduto.value)
                : null;

        const unidadeCompraId =
                Number(
                        selectUnidadeCompra?.value || 0
                        );

        const unidadeBaseId =
                Number(
                        selectUnidadeBase?.value || 0
                        );

        const fator =
                Number(
                        campoFator?.value || 0
                        );

        const estoqueMinimo =
                Number(
                        campoEstoqueMinimo?.value || 0
                        );

        const observacao =
                campoObservacao?.value
                ?.trim() || null;


        // ----------------------------------------------------
        // ID DO INSUMO EM EDIÇÃO
        // ----------------------------------------------------

        const insumoEditandoId =
                Number(
                        window.insumoEditandoId || 0
                        );

        const editando =
                Number.isInteger(insumoEditandoId) &&
                insumoEditandoId > 0;


        // ----------------------------------------------------
        // VALIDAÇÕES
        // ----------------------------------------------------

        if (!nome) {

            alert(
                    '⚠️ Informe o nome do insumo.'
                    );

            campoNome?.focus();

            return;
        }

        if (nome.length > 150) {

            alert(
                    '⚠️ O nome do insumo pode ter no máximo 150 caracteres.'
                    );

            campoNome?.focus();

            return;
        }

        if (
                !Number.isInteger(unidadeCompraId) ||
                unidadeCompraId <= 0
                ) {

            alert(
                    '⚠️ Selecione a unidade de compra.'
                    );

            selectUnidadeCompra?.focus();

            return;
        }

        if (
                !Number.isInteger(unidadeBaseId) ||
                unidadeBaseId <= 0
                ) {

            alert(
                    '⚠️ Selecione a unidade-base.'
                    );

            selectUnidadeBase?.focus();

            return;
        }

        if (
                !Number.isFinite(fator) ||
                fator <= 0
                ) {

            alert(
                    '⚠️ O fator de conversão deve ser maior que zero.'
                    );

            campoFator?.focus();

            return;
        }

        if (
                !Number.isFinite(estoqueMinimo) ||
                estoqueMinimo < 0
                ) {

            alert(
                    '⚠️ O estoque mínimo não pode ser negativo.'
                    );

            campoEstoqueMinimo?.focus();

            return;
        }


        // ----------------------------------------------------
        // USUÁRIO
        // ----------------------------------------------------

        const usuarioAuthId =
                window.usuarioAtual?.auth_user_id || null;

        if (!usuarioAuthId) {

            alert(
                    '❌ Não foi possível identificar o usuário autenticado.'
                    );

            return;
        }


        // ----------------------------------------------------
        // BOTÃO
        // ----------------------------------------------------

        btn.disabled = true;

        btn.innerHTML =
                editando
                ? '⏳ Salvando alterações...'
                : '⏳ Cadastrando...';


        // ====================================================
        // EDIÇÃO
        // ====================================================

        if (editando) {

            const {
                data,
                error
            } = await _supabase
                    .from('insumos')
                    .update({
                        nome: nome,
                        produto_id: produtoId,
                        unidade_base_id: unidadeBaseId,
                        unidade_compra_id: unidadeCompraId,
                        fator_compra_base: fator,
                        estoque_minimo_base: estoqueMinimo,
                        observacao: observacao,
                        usuario_auth_id: usuarioAuthId,
                        atualizado_em: new Date().toISOString()
                    })
                    .eq('id', insumoEditandoId)
                    .select(`
                        id,
                        nome
                    `)
                    .single();

            if (error) {

                console.error(
                        '⛔ Erro ao editar insumo:',
                        error
                        );

                throw error;
            }

            if (!data) {

                throw new Error(
                        'O banco não retornou o insumo editado.'
                        );
            }

            console.log(
                    '✅ Insumo editado:',
                    data
                    );

            alert(
                    `✅ Insumo "${data.nome}" atualizado com sucesso!`
                    );


            // ====================================================
            // NOVO CADASTRO
            // ====================================================

        } else {

            const {
                data,
                error
            } = await _supabase
                    .from('insumos')
                    .insert([{
                            nome: nome,
                            produto_id: produtoId,
                            unidade_base_id: unidadeBaseId,
                            unidade_compra_id: unidadeCompraId,
                            fator_compra_base: fator,
                            estoque_minimo_base: estoqueMinimo,
                            ativo: true,
                            observacao: observacao,
                            usuario_auth_id: usuarioAuthId
                        }])
                    .select(`
                        id,
                        nome
                    `)
                    .single();

            if (error) {

                console.error(
                        '⛔ Erro ao cadastrar insumo:',
                        error
                        );

                throw error;
            }

            if (!data) {

                throw new Error(
                        'O banco não retornou o insumo cadastrado.'
                        );
            }

            console.log(
                    '✅ Insumo cadastrado:',
                    data
                    );

            alert(
                    `✅ Insumo "${data.nome}" cadastrado com sucesso!`
                    );
        }


        // ----------------------------------------------------
        // LIMPA E FECHA
        // ----------------------------------------------------

        fecharModalNovoInsumo();


        // ----------------------------------------------------
        // ATUALIZA A LISTA
        // ----------------------------------------------------

        await carregarCadastroInsumosUI();


    } catch (erro) {

        console.error(
                '⛔ Erro ao salvar insumo:',
                erro
                );

        alert(
                '❌ Não foi possível salvar o insumo:\n\n' +
                (
                        erro?.message ||
                        'Erro desconhecido.'
                        )
                );

    } finally {

        btn.disabled = false;

        btn.innerHTML =
                '💾 Cadastrar Insumo';
    }
}

// ============================================================
// CADASTROS — ALTERNÂNCIA ENTRE INSUMOS E FORNECEDORES
// ============================================================

// ============================================================
// CADASTROS — ALTERNÂNCIA ENTRE ABAS
// ============================================================

function atualizarBotoesCadastrosUI(abaAtiva) {

    const botoes =
            document.querySelectorAll(
                    '#aba-cadastros .sub-tabs-nav .btn-sub-tab'
                    );

    botoes.forEach(botao => {

        const texto =
                botao.textContent
                .trim()
                .toLowerCase();


        const ativo =
                (
                        abaAtiva === 'insumos' &&
                        texto.includes('insumos')
                        ) ||
                (
                        abaAtiva === 'fornecedores' &&
                        texto.includes('fornecedores')
                        ) ||
                (
                        abaAtiva === 'clientes' &&
                        texto.includes('clientes')
                        ) ||
                (
                        abaAtiva === 'cidades' &&
                        texto.includes('cidades')
                        );


        botao.style.background =
                ativo
                ? '#2a2a35'
                : '#1e1e24';


        botao.style.color =
                ativo
                ? '#fff'
                : '#aaa';

    });
}

async function abrirCadastroInsumosUI() {

    const cadastroInsumos =
            document.getElementById(
                    'cadastro-insumos'
                    );

    const cadastroFornecedores =
            document.getElementById(
                    'cadastro-fornecedores'
                    );

    const cadastroClientes =
            document.getElementById(
                    'cadastro-clientes'
                    );

    if (!cadastroInsumos) {
        console.error(
                '⛔ Conteúdo de Insumos não encontrado.'
                );
        return;
    }

    // Mostra somente INSUMOS
    cadastroInsumos.style.display = 'block';

    // Esconde os demais
    if (cadastroFornecedores) {
        cadastroFornecedores.style.display = 'none';
    }

    if (cadastroClientes) {
        cadastroClientes.style.display = 'none';
    }

    atualizarBotoesCadastrosUI('insumos');

    await carregarCadastroInsumosUI();
}

// ============================================================
// FORNECEDORES
// ============================================================
async function abrirCadastroFornecedoresUI() {

    const cadastroInsumos =
            document.getElementById(
                    'cadastro-insumos'
                    );

    const cadastroFornecedores =
            document.getElementById(
                    'cadastro-fornecedores'
                    );

    const cadastroClientes =
            document.getElementById(
                    'cadastro-clientes'
                    );

    if (!cadastroFornecedores) {
        console.error(
                '⛔ Conteúdo de Fornecedores não encontrado.'
                );
        return;
    }

    // Esconde os demais
    if (cadastroInsumos) {
        cadastroInsumos.style.display = 'none';
    }

    if (cadastroClientes) {
        cadastroClientes.style.display = 'none';
    }

    // Mostra somente FORNECEDORES
    cadastroFornecedores.style.display = 'block';

    atualizarBotoesCadastrosUI('fornecedores');

    await carregarCadastroFornecedoresUI();
}

async function carregarCadastroFornecedoresUI() {

    const tbody =
            document.getElementById(
                    'fornecedores-table-body'
                    );

    if (!tbody) {
        console.error(
                '⛔ Tabela de Fornecedores não encontrada.'
                );
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td
                colspan="6"
                style="
                    text-align:center;
                    color:#aaa;
                    padding:25px;
                "
            >
                ⏳ Carregando fornecedores...
            </td>
        </tr>
    `;

    try {

        const {
            data: fornecedores,
            error
        } = await _supabase
                .from('fornecedores')
                .select(`
                id,
                nome,
                documento,
                telefone,
                email,
                observacao,
                ativo,
                criado_em
            `)
                .order('nome');

        if (error) {
            throw error;
        }

        const lista =
                Array.isArray(fornecedores)
                ? fornecedores
                : [];

        if (lista.length === 0) {

            tbody.innerHTML = `
                <tr>
                    <td
                        colspan="6"
                        style="
                            text-align:center;
                            color:#aaa;
                            padding:30px;
                        "
                    >
                        🏭 Nenhum fornecedor cadastrado.
                    </td>
                </tr>
            `;

            return;
        }

        tbody.innerHTML = '';

        lista.forEach(fornecedor => {

            const tr =
                    document.createElement('tr');

            // FORNECEDOR
            const tdNome =
                    document.createElement('td');

            const nome =
                    document.createElement('strong');

            nome.textContent =
                    fornecedor.nome || '-';

            tdNome.appendChild(nome);

            tr.appendChild(tdNome);

            // DOCUMENTO
            const tdDocumento =
                    document.createElement('td');

            tdDocumento.textContent =
                    fornecedor.documento || '—';

            tr.appendChild(tdDocumento);

            // TELEFONE
            const tdTelefone =
                    document.createElement('td');

            tdTelefone.textContent =
                    fornecedor.telefone || '—';

            tr.appendChild(tdTelefone);

            // E-MAIL
            const tdEmail =
                    document.createElement('td');

            tdEmail.textContent =
                    fornecedor.email || '—';

            tr.appendChild(tdEmail);

            // STATUS
            const tdStatus =
                    document.createElement('td');

            tdStatus.style.textAlign =
                    'center';

            tdStatus.textContent =
                    fornecedor.ativo
                    ? '🟢 Ativo'
                    : '⚪ Inativo';

            tr.appendChild(tdStatus);

            // AÇÕES
            const tdAcoes =
                    document.createElement('td');

            tdAcoes.style.textAlign =
                    'center';

            tdAcoes.innerHTML = `
                <button
                    type="button"
                    class="btn-qty"
                    title="Editar fornecedor"
                    onclick="editarFornecedorUI(${Number(fornecedor.id)})"
                >
                    ✏️
                </button>

                <button
                    type="button"
                    class="btn-qty"
                    title="${
                    fornecedor.ativo
                    ? 'Inativar fornecedor'
                    : 'Ativar fornecedor'
                    }"
                    onclick="alternarStatusFornecedorUI(
                        ${Number(fornecedor.id)},
                        ${fornecedor.ativo ? 'true' : 'false'}
                    )"
                >
                    ${
                    fornecedor.ativo
                    ? '🚫'
                    : '✅'
                    }
                </button>
            `;

            tr.appendChild(tdAcoes);

            tbody.appendChild(tr);
        });

    } catch (error) {

        console.error(
                '⛔ Erro ao carregar fornecedores:',
                error
                );

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="6"
                    style="
                        text-align:center;
                        color:#ff6b6b;
                        padding:30px;
                    "
                >
                    ❌ Não foi possível carregar os fornecedores.
                </td>
            </tr>
        `;
    }
}

// ============================================================
// FORNECEDORES — CONTROLE DE EDIÇÃO
// ============================================================
let fornecedorEditandoId = null;

// ============================================================
// FORNECEDORES — ABRIR MODAL
// ============================================================
function abrirModalNovoFornecedor() {

    fornecedorEditandoId = null;

    const modal =
            document.getElementById(
                    'modal-fornecedor'
                    );

    if (!modal) {
        console.error(
                '⛔ Modal de Fornecedor não encontrado.'
                );
        return;
    }

    const campoNome =
            document.getElementById(
                    'fornecedor-nome'
                    );

    const campoDocumento =
            document.getElementById(
                    'fornecedor-documento'
                    );

    const campoTelefone =
            document.getElementById(
                    'fornecedor-telefone'
                    );

    const campoEmail =
            document.getElementById(
                    'fornecedor-email'
                    );

    const campoObservacao =
            document.getElementById(
                    'fornecedor-observacao'
                    );

    // --------------------------------------------------------
// CONFIGURAÇÃO DOS CAMPOS DE TELEFONE E DOCUMENTO
// --------------------------------------------------------

    if (campoTelefone) {

        campoTelefone.setAttribute(
                'inputmode',
                'numeric'
                );

        campoTelefone.setAttribute(
                'maxlength',
                '15'
                );

        campoTelefone.oninput =
                function () {
                    formatarTelefoneFornecedorInput(this);
                };
    }

    if (campoDocumento) {

        campoDocumento.setAttribute(
                'inputmode',
                'numeric'
                );

        campoDocumento.setAttribute(
                'maxlength',
                '18'
                );

        campoDocumento.oninput =
                function () {
                    formatarDocumentoFornecedorInput(this);
                };
    }

    if (campoNome)
        campoNome.value = '';
    if (campoDocumento)
        campoDocumento.value = '';
    if (campoTelefone)
        campoTelefone.value = '';
    if (campoEmail)
        campoEmail.value = '';
    if (campoObservacao)
        campoObservacao.value = '';

    const titulo =
            modal.querySelector('h2');

    if (titulo) {
        titulo.textContent =
                '🏭 Novo Fornecedor';
    }

    const btn =
            document.getElementById(
                    'btn-salvar-fornecedor'
                    );

    if (btn) {
        btn.innerHTML =
                '💾 Cadastrar Fornecedor';
    }

    modal.style.display = 'flex';

    setTimeout(() => {

        if (campoNome) {
            campoNome.focus();
        }

    }, 50);
}

// ============================================================
// FORNECEDORES — EDITAR
// ============================================================
async function editarFornecedorUI(id) {

    const fornecedorId =
            Number(id);

    if (!fornecedorId) {
        alert(
                'Fornecedor inválido.'
                );
        return;
    }

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    ).toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {
        alert(
                '⛔ Apenas GERENTE ou ADMIN podem editar fornecedores.'
                );
        return;
    }

    try {

        const {
            data,
            error
        } = await _supabase
                .from('fornecedores')
                .select(`
                id,
                nome,
                documento,
                telefone,
                email,
                observacao,
                ativo
            `)
                .eq('id', fornecedorId)
                .single();

        if (error) {
            throw error;
        }

        if (!data) {
            alert(
                    'Fornecedor não encontrado.'
                    );
            return;
        }

        fornecedorEditandoId =
                Number(data.id);

        const modal =
                document.getElementById(
                        'modal-fornecedor'
                        );

        if (!modal) {
            return;
        }

        document.getElementById(
                'fornecedor-nome'
                ).value =
                data.nome || '';

        document.getElementById(
                'fornecedor-documento'
                ).value =
                data.documento || '';

        document.getElementById(
                'fornecedor-telefone'
                ).value =
                data.telefone || '';

        document.getElementById(
                'fornecedor-email'
                ).value =
                data.email || '';

        document.getElementById(
                'fornecedor-observacao'
                ).value =
                data.observacao || '';

        const titulo =
                modal.querySelector('h2');

        if (titulo) {
            titulo.textContent =
                    '🏭 Editar Fornecedor';
        }

        const btn =
                document.getElementById(
                        'btn-salvar-fornecedor'
                        );

        if (btn) {
            btn.innerHTML =
                    '💾 Salvar Alterações';
        }

        modal.style.display =
                'flex';

        setTimeout(() => {

            document.getElementById(
                    'fornecedor-nome'
                    )?.focus();

        }, 50);

    } catch (erro) {

        console.error(
                '⛔ Erro ao carregar fornecedor para edição:',
                erro
                );

        alert(
                '❌ Não foi possível carregar o fornecedor.'
                );
    }
}

// ============================================================
// FORNECEDORES — SALVAR NOVO / EDITADO
// ============================================================
async function salvarNovoFornecedor() {

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    ).toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem cadastrar fornecedores.'
                );

        return;
    }

    const btn =
            document.getElementById(
                    'btn-salvar-fornecedor'
                    );

    const nome =
            document.getElementById(
                    'fornecedor-nome'
                    )?.value.trim() || '';

    const documento =
            document.getElementById(
                    'fornecedor-documento'
                    )?.value.trim() || null;

    const telefone =
            document.getElementById(
                    'fornecedor-telefone'
                    )?.value.trim() || null;

    const email =
            document.getElementById(
                    'fornecedor-email'
                    )?.value.trim() || null;

    const observacao =
            document.getElementById(
                    'fornecedor-observacao'
                    )?.value.trim() || null;

    if (!nome) {

        alert(
                'Informe o nome do fornecedor.'
                );

        return;
    }

    if (email) {

        const emailValido =
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(email);

        if (!emailValido) {

            alert(
                    'Informe um e-mail válido.'
                    );

            return;
        }
    }

    const textoOriginal =
            btn?.innerHTML || '';

    if (btn) {
        btn.disabled = true;
        btn.innerHTML =
                fornecedorEditandoId
                ? '⏳ Salvando...'
                : '⏳ Cadastrando...';
    }

    try {

        let data;
        let error;

        if (fornecedorEditandoId) {

            const resultado =
                    await _supabase
                    .from('fornecedores')
                    .update({
                        nome,
                        documento,
                        telefone,
                        email,
                        observacao
                    })
                    .eq(
                            'id',
                            fornecedorEditandoId
                            )
                    .select(`
                        id,
                        nome,
                        documento,
                        telefone,
                        email,
                        observacao,
                        ativo,
                        criado_em
                    `)
                    .single();

            data = resultado.data;
            error = resultado.error;

        } else {

            const resultado =
                    await _supabase
                    .from('fornecedores')
                    .insert({
                        nome,
                        documento,
                        telefone,
                        email,
                        observacao,
                        ativo: true
                    })
                    .select(`
                        id,
                        nome,
                        documento,
                        telefone,
                        email,
                        observacao,
                        ativo,
                        criado_em
                    `)
                    .single();

            data = resultado.data;
            error = resultado.error;
        }

        if (error) {
            throw error;
        }

        console.log(
                fornecedorEditandoId
                ? '✅ Fornecedor atualizado:'
                : '✅ Fornecedor cadastrado:',
                data
                );

        alert(
                fornecedorEditandoId
                ? `✅ Fornecedor atualizado com sucesso!\n\nNome: ${data.nome}`
                : `✅ Fornecedor cadastrado com sucesso!\n\nNome: ${data.nome}`
                );

        fornecedorEditandoId = null;

        fecharModalNovoFornecedor();

        await carregarCadastroFornecedoresUI();

        await carregarFornecedoresCompras();

    } catch (erro) {

        console.error(
                '⛔ Erro ao salvar fornecedor:',
                erro
                );

        alert(
                '❌ Não foi possível salvar o fornecedor:\n\n' +
                (
                        erro?.message ||
                        'Erro desconhecido.'
                        )
                );

    } finally {

        if (btn) {
            btn.disabled = false;

            btn.innerHTML =
                    textoOriginal ||
                    '💾 Cadastrar Fornecedor';
        }
    }
}

// ============================================================
// FORNECEDORES — ATIVAR / INATIVAR
// ============================================================
async function alternarStatusFornecedorUI(id, statusAtual) {

    const fornecedorId =
            Number(id);

    if (!fornecedorId) {
        alert(
                'Fornecedor inválido.'
                );
        return;
    }

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    ).toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {
        alert(
                '⛔ Apenas GERENTE ou ADMIN podem alterar o status de fornecedores.'
                );
        return;
    }

    const estaAtivo =
            statusAtual === true ||
            statusAtual === 'true';

    const novoStatus =
            !estaAtivo;

    const mensagem =
            novoStatus
            ? 'Deseja ativar este fornecedor?'
            : 'Deseja inativar este fornecedor?';

    if (!confirm(mensagem)) {
        return;
    }

    try {

        const {
            data,
            error
        } = await _supabase
                .from('fornecedores')
                .update({
                    ativo: novoStatus
                })
                .eq(
                        'id',
                        fornecedorId
                        )
                .select(`
                id,
                nome,
                ativo
            `)
                .single();

        if (error) {
            throw error;
        }

        alert(
                novoStatus
                ? `✅ Fornecedor "${data.nome}" ativado.`
                : `✅ Fornecedor "${data.nome}" inativado.`
                );

        await carregarCadastroFornecedoresUI();

        await carregarFornecedoresCompras();

    } catch (erro) {

        console.error(
                '⛔ Erro ao alterar status do fornecedor:',
                erro
                );

        alert(
                '❌ Não foi possível alterar o status do fornecedor:\n\n' +
                (
                        erro?.message ||
                        'Erro desconhecido.'
                        )
                );
    }
}
// ============================================================
// FORNECEDORES — FECHAR MODAL
// ============================================================
function fecharModalNovoFornecedor() {

    const modal =
            document.getElementById(
                    'modal-fornecedor'
                    );

    if (modal) {
        modal.style.display = 'none';
    }
}

// ============================================================
// CADASTRO DE CIDADES DE ENTREGA
// ============================================================
let cidadeEntregaEditandoId = null;
let cidadesEntregaCadastroCache = [];

// ============================================================
// CADASTRO DE CIDADES DE ENTREGA
// ============================================================
// ============================================================
// ABRIR ABA CIDADES
// ============================================================
async function abrirCadastroCidadesUI() {

    const cadastroInsumos =
            document.getElementById(
                    'cadastro-insumos'
                    );

    const cadastroFornecedores =
            document.getElementById(
                    'cadastro-fornecedores'
                    );

    const cadastroClientes =
            document.getElementById(
                    'cadastro-clientes'
                    );

    const cadastroCidades =
            document.getElementById(
                    'cadastro-cidades'
                    );

    if (!cadastroCidades) {

        console.error(
                '⛔ Conteúdo de Cidades não encontrado.'
                );

        return;
    }

    // --------------------------------------------------------
    // ESCONDE AS OUTRAS ABAS
    // --------------------------------------------------------
    if (cadastroInsumos) {

        cadastroInsumos.style.display =
                'none';
    }

    if (cadastroFornecedores) {

        cadastroFornecedores.style.display =
                'none';
    }

    if (cadastroClientes) {

        cadastroClientes.style.display =
                'none';

    }

    cadastroCidades.style.display =
            'block';

    atualizarBotoesCadastrosUI(
            'cidades'
            );

    await carregarCadastroCidadesUI();
}

// ============================================================
// CARREGAR CIDADES
// ============================================================
async function carregarCadastroCidadesUI() {

    const tbody =
            document.getElementById(
                    'cidades-table-body'
                    );

    if (!tbody) {

        console.error(
                '⛔ Tabela de cidades não encontrada.'
                );

        return;
    }

    tbody.innerHTML = `
        <tr>

            <td
                colspan="5"
                style="
                text-align:center;
                color:#aaa;
                padding:25px;
                "
            >
                ⏳ Carregando cidades...
            </td>

        </tr>
    `;

    try {

        const {
            data: cidades,
            error
        } = await _supabase
                .from('cidades_entrega')
                .select(`
                    id,
                    nome,
                    uf,
                    taxa_entrega,
                    ativa,
                    criado_em
                `)
                .order(
                        'nome',
                        {
                            ascending: true
                        }
                );

        if (error) {

            throw error;

        }

        cidadesEntregaCadastroCache =
                Array.isArray(cidades)
                ? cidades
                : [];

        renderizarTabelaCidadesUI(
                cidadesEntregaCadastroCache
                );

    } catch (erro) {

        console.error(
                '⛔ Erro ao carregar cidades:',
                erro
                );

        tbody.innerHTML = `
            <tr>

                <td
                    colspan="5"
                    style="
                    text-align:center;
                    color:#ff6b6b;
                    padding:25px;
                    "
                >
                    ❌ Não foi possível carregar as cidades.
                </td>

            </tr>
        `;

    }
}

// ============================================================
// ESCAPAR HTML
// ============================================================
function escaparHTMLCidadeUI(valor) {

    return String(
            valor ?? ''
            )
            .replace(
                    /&/g,
                    '&amp;'
                    )
            .replace(
                    /</g,
                    '&lt;'
                    )
            .replace(
                    />/g,
                    '&gt;'
                    )
            .replace(
                    /"/g,
                    '&quot;'
                    )
            .replace(
                    /'/g,
                    '&#039;'
                    );
}

// ============================================================
// RENDERIZAR CIDADES
// ============================================================
function renderizarTabelaCidadesUI(cidades) {

    const tbody =
            document.getElementById(
                    'cidades-table-body'
                    );

    if (!tbody) {

        return;
    }

    if (
            !Array.isArray(cidades) ||
            cidades.length === 0
            ) {

        tbody.innerHTML = `
            <tr>

                <td
                    colspan="5"
                    style="
                    text-align:center;
                    color:#aaa;
                    padding:25px;
                    "
                >
                    Nenhuma cidade cadastrada.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML =
            cidades.map(cidade => {

                const id =
                        Number(
                                cidade.id
                                );

                const nome =
                        escaparHTMLCidadeUI(
                                cidade.nome
                                );

                const uf =
                        escaparHTMLCidadeUI(
                                cidade.uf
                                );

                const taxa =
                        Number(
                                cidade.taxa_entrega || 0
                                );

                const ativa =
                        cidade.ativa === true ||
                        cidade.ativa === 'true';

                const statusHTML =
                        ativa
                        ? `
                            <span
                                style="
                                display:inline-block;
                                padding:5px 10px;
                                border-radius:15px;
                                background:#1b5e20;
                                color:#fff;
                                font-size:0.8rem;
                                "
                            >
                                Ativa
                            </span>
                        `
                        : `
                            <span
                                style="
                                display:inline-block;
                                padding:5px 10px;
                                border-radius:15px;
                                background:#555;
                                color:#ddd;
                                font-size:0.8rem;
                                "
                            >
                                Inativa
                            </span>
                        `;

                return `
                    <tr>

                        <td>
                            <strong>
                                ${nome}
                            </strong>
                        </td>

                        <td style="text-align:center;">
                            ${uf}
                        </td>

                        <td style="text-align:right;">
                            <strong>
                                R$ ${
                        taxa
                        .toFixed(2)
                        .replace('.', ',')
                        }
                            </strong>
                        </td>

                        <td style="text-align:center;">
                            ${statusHTML}
                        </td>

                        <td style="text-align:center;">

                            <button
                                type="button"
                                class="btn-qty"
                                onclick="editarCidadeUI(${id})"
                                style="margin-right:5px;"
                            >
                                ✏️
                            </button>

                            <button
                                type="button"
                                class="btn-qty"
                                onclick="alternarStatusCidadeUI(${id}, ${ativa})"
                                style="margin-right:5px;"
                            >
                                ${
                        ativa
                        ? '⏸️'
                        : '▶️'
                        }
                            </button>

                            <button
                                type="button"
                                class="btn-qty"
                                onclick="excluirCidadeUI(${id})"
                                style="
                                background:#7f1d1d;
                                color:#fff;
                                "
                            >
                                🗑️
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
}

// ============================================================
// NOVA CIDADE
// ============================================================
function abrirModalNovaCidade() {

    cidadeEntregaEditandoId =
            null;

    const campoNome =
            document.getElementById(
                    'cidade-entrega-nome'
                    );

    const campoUF =
            document.getElementById(
                    'cidade-entrega-uf'
                    );

    const campoTaxa =
            document.getElementById(
                    'cidade-entrega-taxa'
                    );

    const campoAtiva =
            document.getElementById(
                    'cidade-entrega-ativa'
                    );

    const titulo =
            document.getElementById(
                    'modal-cidade-entrega-titulo'
                    );

    const btn =
            document.getElementById(
                    'btn-salvar-cidade-entrega'
                    );

    if (campoNome) {

        campoNome.value =
                '';

    }

    if (campoUF) {

        campoUF.value =
                '';

    }

    if (campoTaxa) {

        campoTaxa.value =
                '0.00';

    }

    if (campoAtiva) {

        campoAtiva.checked =
                true;

    }

    if (titulo) {

        titulo.textContent =
                '🏙️ Nova Cidade';

    }

    if (btn) {

        btn.innerHTML =
                '💾 Cadastrar Cidade';

    }

    const modal =
            document.getElementById(
                    'modal-cidade-entrega'
                    );

    if (modal) {

        modal.style.display =
                'flex';

    }

    setTimeout(() => {

        campoNome?.focus();

    }, 50);
}

// ============================================================
// EDITAR CIDADE
// ============================================================
async function editarCidadeUI(cidadeId) {

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    )
            .toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem editar cidades.'
                );

        return;
    }

    try {

        const {
            data,
            error
        } = await _supabase
                .from('cidades_entrega')
                .select(`
                    id,
                    nome,
                    uf,
                    taxa_entrega,
                    ativa
                `)
                .eq(
                        'id',
                        Number(cidadeId)
                        )
                .single();

        if (error) {

            throw error;

        }

        if (!data) {

            throw new Error(
                    'Cidade não encontrada.'
                    );
        }

        cidadeEntregaEditandoId =
                Number(
                        data.id
                        );

        document.getElementById(
                'cidade-entrega-nome'
                ).value =
                data.nome || '';

        document.getElementById(
                'cidade-entrega-uf'
                ).value =
                data.uf || '';

        document.getElementById(
                'cidade-entrega-taxa'
                ).value =
                Number(
                        data.taxa_entrega || 0
                        )
                .toFixed(2);

        document.getElementById(
                'cidade-entrega-ativa'
                ).checked =
                data.ativa === true ||
                data.ativa === 'true';

        document.getElementById(
                'modal-cidade-entrega-titulo'
                ).textContent =
                '✏️ Editar Cidade';

        document.getElementById(
                'btn-salvar-cidade-entrega'
                ).innerHTML =
                '💾 Salvar Alterações';

        document.getElementById(
                'modal-cidade-entrega'
                ).style.display =
                'flex';

        setTimeout(() => {

            document.getElementById(
                    'cidade-entrega-nome'
                    )?.focus();

        }, 50);

    } catch (erro) {

        console.error(
                '⛔ Erro ao editar cidade:',
                erro
                );

        alert(
                '❌ Não foi possível carregar a cidade:\n\n' +
                (
                        erro?.message ||
                        'Erro desconhecido.'
                        )
                );
    }
}

// ============================================================
// SALVAR NOVA / EDITAR CIDADE
// ============================================================
async function salvarCidadeEntregaUI() {

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    )
            .toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem cadastrar ou editar cidades.'
                );

        return;
    }

    const btn =
            document.getElementById(
                    'btn-salvar-cidade-entrega'
                    );

    const nome =
            document.getElementById(
                    'cidade-entrega-nome'
                    )
            ?.value
            .trim() || '';

    const uf =
            document.getElementById(
                    'cidade-entrega-uf'
                    )
            ?.value
            .trim()
            .toUpperCase() || '';

    const taxa =
            parseFloat(
                    document.getElementById(
                            'cidade-entrega-taxa'
                            )?.value
                    );

    const ativa =
            document.getElementById(
                    'cidade-entrega-ativa'
                    )?.checked !== false;

    if (!nome) {

        alert(
                '⚠️ Informe o nome da cidade.'
                );

        return;
    }

    if (!uf || uf.length !== 2) {

        alert(
                '⚠️ Selecione uma UF válida.'
                );

        return;
    }

    if (
            isNaN(taxa) ||
            taxa < 0
            ) {

        alert(
                '⚠️ Informe uma taxa de entrega válida.'
                );

        return;
    }

    const textoOriginal =
            btn?.innerHTML || '';

    if (btn) {

        btn.disabled =
                true;

        btn.innerHTML =
                cidadeEntregaEditandoId
                ? '⏳ Salvando...'
                : '⏳ Cadastrando...';
    }

    try {

        // ----------------------------------------------------
        // VERIFICA DUPLICIDADE
        // ----------------------------------------------------
        let consulta =
                _supabase
                .from('cidades_entrega')
                .select(`
                    id,
                    nome,
                    uf
                `)
                .ilike(
                        'nome',
                        nome
                        )
                .eq(
                        'uf',
                        uf
                        );

        const {
            data: existentes,
            error: erroConsulta
        } = await consulta;

        if (erroConsulta) {

            throw erroConsulta;

        }

        const existeOutra =
                (existentes || [])
                .some(item =>
                    Number(item.id) !==
                            Number(cidadeEntregaEditandoId)
                );

        if (existeOutra) {

            throw new Error(
                    'Esta cidade já está cadastrada para esta UF.'
                    );
        }

        // ----------------------------------------------------
        // NOVO
        // ----------------------------------------------------
        if (!cidadeEntregaEditandoId) {

            const {
                data,
                error
            } = await _supabase
                    .from('cidades_entrega')
                    .insert({
                        nome,
                        uf,
                        taxa_entrega:
                                Number(
                                        taxa.toFixed(2)
                                        ),
                        ativa
                    })
                    .select(`
                        id,
                        nome,
                        uf,
                        taxa_entrega,
                        ativa,
                        criado_em
                    `)
                    .single();

            if (error) {

                throw error;

            }

            alert(
                    `✅ Cidade "${data.nome}" cadastrada com sucesso!`
                    );

        } else {

            // ------------------------------------------------
            // EDITAR
            // ------------------------------------------------
            const {
                data,
                error
            } = await _supabase
                    .from('cidades_entrega')
                    .update({
                        nome,
                        uf,
                        taxa_entrega:
                                Number(
                                        taxa.toFixed(2)
                                        ),
                        ativa
                    })
                    .eq(
                            'id',
                            cidadeEntregaEditandoId
                            )
                    .select(`
                        id,
                        nome,
                        uf,
                        taxa_entrega,
                        ativa,
                        criado_em
                    `)
                    .single();

            if (error) {

                throw error;

            }

            alert(
                    `✅ Cidade "${data.nome}" atualizada com sucesso!`
                    );
        }

        cidadeEntregaEditandoId =
                null;

        fecharModalCidadeEntrega();

        await carregarCadastroCidadesUI();

    } catch (erro) {

        console.error(
                '⛔ Erro ao salvar cidade:',
                erro
                );

        alert(
                '❌ Não foi possível salvar a cidade:\n\n' +
                (
                        erro?.message ||
                        'Erro desconhecido.'
                        )
                );

    } finally {

        if (btn) {

            btn.disabled =
                    false;

            btn.innerHTML =
                    textoOriginal ||
                    '💾 Cadastrar Cidade';

        }
    }
}

// ============================================================
// ATIVAR / INATIVAR
// ============================================================
async function alternarStatusCidadeUI(
        cidadeId,
        statusAtual
        ) {

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    )
            .toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem alterar o status das cidades.'
                );

        return;
    }

    const estaAtiva =
            statusAtual === true ||
            statusAtual === 'true';

    const novoStatus =
            !estaAtiva;

    const mensagem =
            novoStatus
            ? 'Deseja ativar esta cidade?'
            : 'Deseja inativar esta cidade?';

    if (!confirm(mensagem)) {

        return;

    }

    try {

        const {
            data,
            error
        } = await _supabase
                .from('cidades_entrega')
                .update({
                    ativa:
                            novoStatus
                })
                .eq(
                        'id',
                        Number(cidadeId)
                        )
                .select(`
                    id,
                    nome,
                    ativa
                `)
                .single();

        if (error) {

            throw error;

        }

        alert(
                novoStatus
                ? `✅ Cidade "${data.nome}" ativada.`
                : `✅ Cidade "${data.nome}" inativada.`
                );

        await carregarCadastroCidadesUI();

    } catch (erro) {

        console.error(
                '⛔ Erro ao alterar status da cidade:',
                erro
                );

        alert(
                '❌ Não foi possível alterar o status da cidade:\n\n' +
                (
                        erro?.message ||
                        'Erro desconhecido.'
                        )
                );
    }
}

// ============================================================
// EXCLUIR CIDADE
// ============================================================
async function excluirCidadeUI(cidadeId) {

    const cargo =
            String(
                    window.usuarioAtual?.cargo || ''
                    )
            .toUpperCase();

    const ehGerente =
            cargo === 'GERENTE' ||
            cargo === 'ADMIN';

    if (!ehGerente) {

        alert(
                '⛔ Apenas GERENTE ou ADMIN podem excluir cidades.'
                );

        return;
    }

    const cidade =
            cidadesEntregaCadastroCache.find(
                    item =>
                Number(item.id) ===
                        Number(cidadeId)
            );

    const nome =
            cidade?.nome ||
            'esta cidade';

    const confirmar =
            confirm(
                    `⚠️ Deseja realmente excluir "${nome}"?\n\n` +
                    'Use "Inativar" quando quiser manter o cadastro para histórico.'
                    );

    if (!confirmar) {

        return;

    }

    try {

        const {
            error
        } = await _supabase
                .from('cidades_entrega')
                .delete()
                .eq(
                        'id',
                        Number(cidadeId)
                        );

        if (error) {

            // Normalmente ocorre quando a cidade está sendo
            // usada por outro registro através de chave estrangeira.

            if (
                    String(error.message || '')
                    .toLowerCase()
                    .includes('foreign key')
                    ) {

                throw new Error(
                        'Esta cidade está sendo utilizada por outro cadastro ou pedido e não pode ser excluída. Inative a cidade em vez de excluir.'
                        );
            }

            throw error;
        }

        alert(
                `✅ Cidade "${nome}" excluída com sucesso.`
                );

        await carregarCadastroCidadesUI();

    } catch (erro) {

        console.error(
                '⛔ Erro ao excluir cidade:',
                erro
                );


        alert(
                '❌ Não foi possível excluir a cidade:\n\n' +
                (
                        erro?.message ||
                        'Erro desconhecido.'
                        )
                );
    }
}

// ============================================================
// FECHAR MODAL
// ============================================================

function fecharModalCidadeEntrega() {

    cidadeEntregaEditandoId =
            null;


    const modal =
            document.getElementById(
                    'modal-cidade-entrega'
                    );


    if (modal) {

        modal.style.display =
                'none';

    }
}

// ============================================================
// CADASTRO DE CLIENTES
// ============================================================
let clienteEditandoId = null;
let clientesCadastroCache = [];
let timerBuscaClientesCadastro = null;

// ============================================================
// ABRIR ABA CLIENTES
// ============================================================
async function abrirCadastroClientesUI() {

    const cadastroInsumos =
            document.getElementById(
                    'cadastro-insumos'
                    );

    const cadastroFornecedores =
            document.getElementById(
                    'cadastro-fornecedores'
                    );

    const cadastroClientes =
            document.getElementById(
                    'cadastro-clientes'
                    );

    const cadastroCidades =
            document.getElementById(
                    'cadastro-cidades'
                    );

    if (cadastroInsumos) {

        cadastroInsumos.style.display =
                'none';

    }

    if (cadastroFornecedores) {

        cadastroFornecedores.style.display =
                'none';

    }

    if (cadastroCidades) {

        cadastroCidades.style.display =
                'none';

    }

    if (cadastroClientes) {

        cadastroClientes.style.display =
                'block';

    }

    atualizarBotoesCadastrosUI(
            'clientes'
            );

    await carregarCadastroClientesUI();
}

// ============================================================
// CARREGAR CLIENTES
// ============================================================
async function carregarCadastroClientesUI(busca = '') {

    const tbody = document.getElementById('clientes-table-body');

    if (!tbody) {
        console.error(
                'Tabela de clientes não encontrada.'
                );
        return;
    }

    tbody.innerHTML = `
        <tr>
            <td
                colspan="5"
                style="
                text-align:center;
                color:#aaa;
                padding:25px;
                "
            >
                ⏳ Carregando clientes...
            </td>
        </tr>
    `;

    try {

        const {data, error} =
                await _supabase.rpc(
                        'listar_clientes_admin',
                        {
                            p_busca:
                                    busca?.trim() || null
                        }
                );

        if (error) {
            throw error;
        }

        clientesCadastroCache =
                Array.isArray(data)
                ? data
                : [];

        renderizarTabelaClientesUI(
                clientesCadastroCache
                );

    } catch (erro) {

        console.error(
                'Erro ao carregar clientes:',
                erro
                );

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="5"
                    style="
                    text-align:center;
                    color:#ff6b6b;
                    padding:25px;
                    "
                >
                    ❌ Não foi possível carregar os clientes.
                </td>
            </tr>
        `;
}
}

// ============================================================
// RENDERIZAR CLIENTES
// ============================================================
function renderizarTabelaClientesUI(clientes) {

    const tbody =
            document.getElementById(
                    'clientes-table-body'
                    );

    if (!tbody) {
        return;
    }

    if (
            !Array.isArray(clientes) ||
            clientes.length === 0
            ) {

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="5"
                    style="
                    text-align:center;
                    color:#aaa;
                    padding:25px;
                    "
                >
                    Nenhum cliente encontrado.
                </td>
            </tr>
        `;

        return;
    }

    tbody.innerHTML =
            clientes.map(cliente => {

                const nome =
                        escaparHTMLClienteUI(
                                cliente.nome || ''
                                );

                const documento =
                        cliente.documento
                        ? escaparHTMLClienteUI(
                                formatarDocumentoClienteUI(
                                        cliente.documento
                                        )
                                )
                        : '—';

                const telefone =
                        cliente.telefone
                        ? escaparHTMLClienteUI(
                                formatarTelefoneClienteUI(
                                        cliente.telefone
                                        )
                                )
                        : '—';

                const endereco =
                        montarEnderecoClienteUI(
                                cliente
                                );

                return `
                <tr>

                    <td>
                        <strong>
                            ${nome}
                        </strong>
                    </td>

                    <td>
                        ${documento}
                    </td>

                    <td>
                        ${telefone}
                    </td>

                    <td>
                        ${endereco}
                    </td>

                    <td style="text-align:center;">

                        <button
                            type="button"
                            class="btn-qty"
                            onclick="editarClienteUI(${Number(cliente.id)})"
                            style="
                            margin-right:5px;
                            "
                        >
                            ✏️ Editar
                        </button>
                    </td>
                </tr>
            `;

            }).join('');
}

// ============================================================
// BUSCA
// ============================================================
function filtrarCadastroClientesUI(valor) {

    clearTimeout(
            timerBuscaClientesCadastro
            );

    timerBuscaClientesCadastro =
            setTimeout(() => {

                carregarCadastroClientesUI(
                        valor || ''
                        );

            }, 250);
}

// ============================================================
// NOVO CLIENTE
// ============================================================
function abrirModalNovoCliente() {

    clienteEditandoId = null;

    const modal =
            document.getElementById(
                    'modal-cliente'
                    );

    const titulo =
            document.getElementById(
                    'modal-cliente-titulo'
                    );

    const botao =
            document.getElementById(
                    'btn-salvar-cliente'
                    );

    if (titulo) {
        titulo.textContent =
                '👤 Novo Cliente';
    }

    if (botao) {
        botao.textContent =
                '💾 Cadastrar Cliente';
    }

    limparFormularioClienteUI();

    if (modal) {
        modal.style.display = 'flex';
    }

    setTimeout(() => {

        document
                .getElementById('cliente-nome')
                ?.focus();

    }, 50);
}

// ============================================================
// FECHAR MODAL
// ============================================================
function fecharModalCliente() {

    const modal =
            document.getElementById(
                    'modal-cliente'
                    );

    if (modal) {
        modal.style.display = 'none';
    }

    clienteEditandoId = null;

    limparFormularioClienteUI();
}

// ============================================================
// LIMPAR FORMULÁRIO
// ============================================================
function limparFormularioClienteUI() {

    const campos = [
        'cliente-nome',
        'cliente-documento',
        'cliente-telefone',
        'cliente-rua',
        'cliente-numero',
        'cliente-bairro',
        'cliente-complemento',
        'cliente-ponto-referencia'
    ];

    campos.forEach(id => {

        const campo =
                document.getElementById(id);

        if (campo) {
            campo.value = '';
        }

    });
}

// ============================================================
// EDITAR CLIENTE
// ============================================================
function editarClienteUI(id) {

    const cliente =
            clientesCadastroCache.find(
                    item =>
                Number(item.id) === Number(id)
            );

    if (!cliente) {

        alert(
                '❌ Cliente não encontrado na lista atual.'
                );

        return;
    }

    clienteEditandoId =
            Number(cliente.id);

    document.getElementById(
            'cliente-nome'
            ).value =
            cliente.nome || '';

    document.getElementById(
            'cliente-documento'
            ).value =
            cliente.documento || '';

    document.getElementById(
            'cliente-telefone'
            ).value =
            formatarTelefoneClienteUI(
                    cliente.telefone || ''
                    );

    document.getElementById(
            'cliente-rua'
            ).value =
            cliente.rua || '';

    document.getElementById(
            'cliente-numero'
            ).value =
            cliente.numero || '';

    document.getElementById(
            'cliente-bairro'
            ).value =
            cliente.bairro || '';

    document.getElementById(
            'cliente-complemento'
            ).value =
            cliente.complemento || '';

    document.getElementById(
            'cliente-ponto-referencia'
            ).value =
            cliente.ponto_referencia || '';


    const titulo =
            document.getElementById(
                    'modal-cliente-titulo'
                    );

    const botao =
            document.getElementById(
                    'btn-salvar-cliente'
                    );

    if (titulo) {
        titulo.textContent =
                '✏️ Editar Cliente';
    }

    if (botao) {
        botao.textContent =
                '💾 Salvar Alterações';
    }


    const modal =
            document.getElementById(
                    'modal-cliente'
                    );

    if (modal) {
        modal.style.display = 'flex';
    }
}

// ============================================================
// SALVAR CLIENTE
// ============================================================
async function salvarClienteUI() {

    const nome =
            document
            .getElementById('cliente-nome')
            ?.value
            .trim() || '';

    const documentoFormatado =
            document
            .getElementById('cliente-documento')
            ?.value
            .trim() || '';

    const documento =
            documentoFormatado.replace(/\D/g, '');

    const telefoneFormatado =
            document
            .getElementById('cliente-telefone')
            ?.value
            .trim() || '';

    const telefone =
            telefoneFormatado.replace(/\D/g, '');

    const rua =
            document
            .getElementById('cliente-rua')
            ?.value
            .trim() || '';

    const numero =
            document
            .getElementById('cliente-numero')
            ?.value
            .trim() || '';

    const bairro =
            document
            .getElementById('cliente-bairro')
            ?.value
            .trim() || '';

    const complemento =
            document
            .getElementById('cliente-complemento')
            ?.value
            .trim() || '';

    const pontoReferencia =
            document
            .getElementById('cliente-ponto-referencia')
            ?.value
            .trim() || '';

    /* --------------------------------------------------------
     NOME
     -------------------------------------------------------- */
    if (!nome) {

        alert(
                '⚠️ Informe o nome do cliente.'
                );

        document
                .getElementById('cliente-nome')
                ?.focus();

        return;
    }

    /* --------------------------------------------------------
     CPF — SE INFORMADO, DEVE TER EXATAMENTE 11 DÍGITOS
     -------------------------------------------------------- */
    if (
            documento !== '' &&
            !/^\d{11}$/.test(documento)
            ) {

        alert(
                '⚠️ O CPF deve conter exatamente 11 dígitos.'
                );

        document
                .getElementById('cliente-documento')
                ?.focus();

        return;
    }

    /* --------------------------------------------------------
     TELEFONE — EXATAMENTE 10 OU 11 DÍGITOS
     -------------------------------------------------------- */
    if (!/^\d{10,11}$/.test(telefone)) {

        alert(
                '⚠️ O telefone deve conter 10 ou 11 dígitos com DDD.'
                );

        document
                .getElementById('cliente-telefone')
                ?.focus();

        return;
    }

    /* --------------------------------------------------------
     NÚMERO — SOMENTE DÍGITOS
     -------------------------------------------------------- */
    if (!/^\d+$/.test(numero)) {

        alert(
                '⚠️ O número do endereço deve conter somente números.'
                );

        document
                .getElementById('cliente-numero')
                ?.focus();

        return;
    }

    // --------------------------------------------------------
    // BOTÃO
    // --------------------------------------------------------
    const botao =
            document.getElementById(
                    'btn-salvar-cliente'
                    );

    const textoOriginal =
            botao
            ? botao.textContent
            : '💾 Salvar Cliente';

    if (botao) {
        botao.disabled = true;
        botao.textContent =
                '⏳ Salvando...';
    }

    try {

        const {data, error} =
                await _supabase.rpc(
                        'salvar_cliente_admin',
                        {
                            p_id:
                                    clienteEditandoId !== null
                                    ? Number(clienteEditandoId)
                                    : null,

                            p_nome: nome,

                            p_documento:
                                    documento || null,

                            p_telefone:
                                    telefone,

                            p_rua: rua,

                            p_numero: numero,

                            p_bairro: bairro,

                            p_complemento:
                                    complemento || null,

                            p_ponto_referencia:
                                    pontoReferencia || null
                        }
                );


        if (error) {
            throw error;
        }


        if (!data) {
            throw new Error(
                    'O banco não retornou o cliente salvo.'
                    );
        }


        const clienteId =
                Array.isArray(data)
                ? data[0]?.id
                : data.id;


        if (!clienteId) {
            throw new Error(
                    'O banco não retornou o ID do cliente.'
                    );
        }


        fecharModalCliente();

        const busca =
                document
                .getElementById(
                        'clientes-busca'
                        )
                ?.value
                .trim() || '';

        await carregarCadastroClientesUI(
                busca
                );


        alert(
                clienteEditandoId === null
                ? '✅ Cliente cadastrado com sucesso!'
                : '✅ Cliente atualizado com sucesso!'
                );


    } catch (erro) {

        console.error(
                'Erro ao salvar cliente:',
                erro
                );

        const mensagem =
                erro?.message || '';

        if (
                mensagem.includes(
                        'TELEFONE_CLIENTE_JA_CADASTRADO'
                        )
                ) {

            alert(
                    '⚠️ Este telefone já está cadastrado para outro cliente.'
                    );

        } else if (
                mensagem.includes(
                        'DOCUMENTO_CLIENTE_JA_CADASTRADO'
                        )
                ) {

            alert(
                    '⚠️ Este CPF já está cadastrado para outro cliente.'
                    );

        } else if (
                mensagem.includes(
                        'DOCUMENTO_CLIENTE_INVALIDO'
                        )
                ) {

            alert(
                    '⚠️ Informe um CPF válido com 11 dígitos ou documento com 14 dígitos.'
                    );

        } else if (
                mensagem.includes(
                        'ACESSO_RESTRITO_GERENCIA'
                        )
                ) {

            alert(
                    '🔒 Apenas GERENTE ou ADMIN podem cadastrar clientes.'
                    );

        } else {

            alert(
                    '❌ Não foi possível salvar o cliente:\n\n' +
                    mensagem
                    );
        }

    } finally {

        if (botao) {
            botao.disabled = false;
            botao.textContent =
                    textoOriginal;
        }

    }
}

// ============================================================
// VENDA DE BALCÃO — CLIENTE FIADO
// ============================================================
let clienteFiadoSelecionadoId = null;
let timerBuscaClienteFiado = null;

// ============================================================
// ALTERA A FORMA DE PAGAMENTO DO BALCÃO
// ============================================================
function alterarFormaPagamentoBalcaoUI(formaPagamento) {

    const forma =
            String(formaPagamento || '')
            .trim()
            .toUpperCase();

    const campoCliente =
            document.getElementById('balcao-cliente');

    const labelCliente =
            document.getElementById(
                    'label-cliente-balcao'
                    );

    const boxClienteFiado =
            document.getElementById(
                    'box-cliente-fiado'
                    );

    const boxVencimento =
            document.getElementById(
                    'box-vencimento-fiado'
                    );

    const boxAutorizacao =
            document.getElementById(
                    'box-autorizacao-fiado'
                    );

    const seletorCliente =
            document.getElementById(
                    'balcao-cliente-id'
                    );

    const boxDinheiro =
            document.getElementById(
                    'box-dinheiro-balcao'
                    );

    const campoDesconto =
            document.getElementById(
                    'balcao-desconto'
                    );

    const campoValorRecebido =
            document.getElementById(
                    'balcao-valor-recebido'
                    );

    const campoTroco =
            document.getElementById(
                    'balcao-troco'
                    );

    // --------------------------------------------------------
    // FIADO
    // --------------------------------------------------------
    if (forma === 'FIADO') {

        clienteFiadoSelecionadoId = null;

        if (labelCliente) {
            labelCliente.textContent =
                    'Buscar Cliente *';
        }

        if (campoCliente) {

            campoCliente.value = '';

            campoCliente.placeholder =
                    '🔎 Nome, CPF ou telefone...';

            campoCliente.removeAttribute(
                    'required'
                    );

            campoCliente.oninput =
                    function () {
                        buscarClienteFiadoUI(
                                this.value
                                );
                    };
        }

        if (boxClienteFiado) {
            boxClienteFiado.style.display =
                    'block';
        }

        if (boxVencimento) {
            boxVencimento.style.display =
                    'block';
        }

        if (boxAutorizacao) {
            boxAutorizacao.style.display =
                    'block';
        }

        if (seletorCliente) {

            seletorCliente.innerHTML = `
                <option value="">
                    🔎 Digite nome, CPF ou telefone para buscar...
                </option>
            `;

            seletorCliente.value = '';
        }

        if (boxDinheiro) {
            boxDinheiro.style.display = 'none';
        }

        if (campoValorRecebido) {
            campoValorRecebido.value = '';
        }

        if (campoTroco) {
            campoTroco.value = 'R$ 0,00';
        }

        if (campoDesconto) {
            campoDesconto.value = '0.00';
            campoDesconto.disabled = true;
        }

        // Data padrão: hoje + 30 dias
        definirVencimentoFiadoPadraoUI();

        return;
    }

    if (campoDesconto) {
        campoDesconto.disabled = false;
    }

    if (boxDinheiro) {

        boxDinheiro.style.display =
                forma === 'DINHEIRO'
                ? 'block'
                : 'none';
    }

    if (forma !== 'DINHEIRO') {

        if (campoValorRecebido) {
            campoValorRecebido.value = '';
        }

        if (campoTroco) {
            campoTroco.value = 'R$ 0,00';
        }
    }

    // --------------------------------------------------------
    // PAGAMENTO NORMAL
    // --------------------------------------------------------
    clienteFiadoSelecionadoId = null;

    if (labelCliente) {
        labelCliente.textContent =
                'Nome do Cliente (Opcional)';
    }

    if (campoCliente) {

        campoCliente.value = '';

        campoCliente.placeholder =
                'Ex: Cliente Balcão';

        campoCliente.removeAttribute(
                'oninput'
                );

        campoCliente.oninput = null;
    }

    if (boxClienteFiado) {
        boxClienteFiado.style.display =
                'none';
    }

    if (boxVencimento) {
        boxVencimento.style.display =
                'none';
    }

    if (boxAutorizacao) {
        boxAutorizacao.style.display =
                'none';
    }

    if (seletorCliente) {

        seletorCliente.innerHTML = `
            <option value="">
                Selecione o cliente...
            </option>
        `;

        seletorCliente.value = '';
    }

    limparVencimentoFiadoUI();
    recalcularTotaisBalcaoUI();
}

// ============================================================
// BUSCA DE CLIENTE FIADO
// ============================================================
function buscarClienteFiadoUI(valor) {

    clearTimeout(
            timerBuscaClienteFiado
            );

    clienteFiadoSelecionadoId = null;

    const select =
            document.getElementById(
                    'balcao-cliente-id'
                    );

    if (!select) {
        return;
    }

    const busca =
            String(valor || '')
            .trim();

    if (!busca) {

        select.innerHTML = `
            <option value="">
                🔎 Digite nome, CPF ou telefone para buscar...
            </option>
        `;

        return;
    }

    select.innerHTML = `
        <option value="">
            ⏳ Buscando clientes...
        </option>
    `;

    timerBuscaClienteFiado =
            setTimeout(async () => {

                try {

                    const {data, error} =
                            await _supabase.rpc(
                                    'buscar_clientes_fiado',
                                    {
                                        p_busca: busca
                                    }
                            );


                    if (error) {
                        throw error;
                    }


                    const clientesRecebidos =
                            Array.isArray(data)
                            ? data
                            : [];

// ------------------------------------------------------------
// FILTRO LOCAL DE SEGURANÇA
// Evita que um RPC muito amplo carregue todos os clientes.
// Pesquisa por nome, CPF ou telefone.
// ------------------------------------------------------------

                    const buscaNormalizada =
                            busca
                            .toLowerCase()
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '');

                    const buscaNumerica =
                            busca.replace(/\D/g, '');

                    const clientes =
                            clientesRecebidos.filter(cliente => {

                                const nome =
                                        String(cliente.nome || '')
                                        .toLowerCase()
                                        .normalize('NFD')
                                        .replace(/[\u0300-\u036f]/g, '');

                                const documento =
                                        String(cliente.documento || '')
                                        .replace(/\D/g, '');

                                const telefone =
                                        String(cliente.telefone || '')
                                        .replace(/\D/g, '');

                                // Busca por nome
                                if (
                                        buscaNormalizada &&
                                        nome.includes(buscaNormalizada)
                                        ) {
                                    return true;
                                }

                                // Busca numérica por CPF/documento
                                if (
                                        buscaNumerica &&
                                        documento.includes(buscaNumerica)
                                        ) {
                                    return true;
                                }

                                // Busca numérica por telefone
                                if (
                                        buscaNumerica &&
                                        telefone.includes(buscaNumerica)
                                        ) {
                                    return true;
                                }

                                return false;
                            });

                    if (
                            clientes.length === 0
                            ) {

                        select.innerHTML = `
        <option value="">
            ❌ Nenhum cliente encontrado
        </option>
    `;

                        return;
                    }


                    select.innerHTML = `
                    <option value="">
                        Selecione o cliente encontrado...
                    </option>
                `;


                    clientes.forEach(
                            cliente => {

                                const option =
                                        document.createElement(
                                                'option'
                                                );

                                option.value =
                                        String(
                                                cliente.id
                                                );

                                const cpf =
                                        cliente.documento
                                        ? formatarDocumentoClienteUI(
                                                cliente.documento
                                                )
                                        : '';

                                const telefone =
                                        cliente.telefone
                                        ? formatarTelefoneClienteUI(
                                                cliente.telefone
                                                )
                                        : '';

                                const detalhes = [];

                                if (cpf) {
                                    detalhes.push(
                                            `CPF: ${cpf}`
                                            );
                                }

                                if (telefone) {
                                    detalhes.push(
                                            `Tel: ${telefone}`
                                            );
                                }

                                option.textContent =
                                        detalhes.length
                                        ? `${cliente.nome} — ${detalhes.join(' · ')}`
                                        : cliente.nome;


                                select.appendChild(
                                        option
                                        );
                            }
                    );


                } catch (erro) {

                    console.error(
                            'Erro ao buscar cliente FIADO:',
                            erro
                            );

                    select.innerHTML = `
                    <option value="">
                        ❌ Erro ao buscar clientes
                    </option>
                `;

                }

            }, 250);
}

// ============================================================
// SELECIONA CLIENTE FIADO
// ============================================================
function selecionarClienteFiadoUI() {

    const select =
            document.getElementById(
                    'balcao-cliente-id'
                    );

    if (!select) {
        clienteFiadoSelecionadoId =
                null;

        return;
    }

    const valor =
            select.value;

    clienteFiadoSelecionadoId =
            valor
            ? Number(valor)
            : null;


    // Se selecionou cliente, mantém o filtro
    // visual no campo de busca.
    if (
            clienteFiadoSelecionadoId
            ) {

        const option =
                select.options[
                        select.selectedIndex
                ];

        if (
                option &&
                option.value
                ) {

            // O nome antes do "—" fica visível
            // como referência do cliente escolhido.
            const nome =
                    option.textContent
                    .split(' — ')[0]
                    .trim();

            const campo =
                    document.getElementById(
                            'balcao-cliente'
                            );

            if (campo) {
                campo.value = nome;
            }
        }
    }
}

// ============================================================
// VENCIMENTO PADRÃO
// ============================================================
function definirVencimentoFiadoPadraoUI() {

    const campo =
            document.getElementById(
                    'balcao-data-vencimento'
                    );

    if (!campo) {
        return;
    }


    const data =
            new Date();

    data.setHours(
            0,
            0,
            0,
            0
            );

    data.setDate(
            data.getDate() + 30
            );


    const ano =
            data.getFullYear();

    const mes =
            String(
                    data.getMonth() + 1
                    ).padStart(2, '0');

    const dia =
            String(
                    data.getDate()
                    ).padStart(2, '0');


    campo.value =
            `${ano}-${mes}-${dia}`;
}

// ============================================================
// LIMPA VENCIMENTO
// ============================================================
function limparVencimentoFiadoUI() {

    const campo =
            document.getElementById(
                    'balcao-data-vencimento'
                    );

    if (campo) {
        campo.value = '';
    }
}

/* ============================================================
 FORMATAÇÃO USADA NA LISTA / EDIÇÃO
 ============================================================ */

function formatarTelefoneClienteUI(valor) {

    const numeros =
            String(valor || '')
            .replace(/\D/g, '')
            .slice(0, 11);

    if (numeros.length === 11) {

        return numeros.replace(
                /^(\d{2})(\d{5})(\d{4})$/,
                '($1) $2-$3'
                );
    }

    if (numeros.length === 10) {

        return numeros.replace(
                /^(\d{2})(\d{4})(\d{4})$/,
                '($1) $2-$3'
                );
    }

    return numeros;
}

function formatarDocumentoClienteUI(valor) {

    const numeros =
            String(valor || '')
            .replace(/\D/g, '')
            .slice(0, 11);

    if (numeros.length === 11) {

        return numeros.replace(
                /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
                '$1.$2.$3-$4'
                );
    }

    return numeros;
}

// ============================================================
// ENDEREÇO
// ============================================================
function montarEnderecoClienteUI(cliente) {

    const partes = [];

    if (cliente.rua) {
        partes.push(
                escaparHTMLClienteUI(
                        cliente.rua
                        )
                );
    }

    if (cliente.numero) {
        partes.push(
                'Nº ' +
                escaparHTMLClienteUI(
                        cliente.numero
                        )
                );
    }

    if (cliente.bairro) {
        partes.push(
                escaparHTMLClienteUI(
                        cliente.bairro
                        )
                );
    }

    if (cliente.complemento) {
        partes.push(
                escaparHTMLClienteUI(
                        cliente.complemento
                        )
                );
    }

    if (cliente.ponto_referencia) {
        partes.push(
                'Ref.: ' +
                escaparHTMLClienteUI(
                        cliente.ponto_referencia
                        )
                );
    }

    return partes.length
            ? partes.join(' · ')
            : '—';
}

// ============================================================
// PROTEÇÃO DE HTML
// ============================================================
function escaparHTMLClienteUI(valor) {

    return String(valor ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

/* ---------- CPF COM MÁSCARA ---------- */
function formatarDocumentoClienteInput(input) {

    let numeros = String(input.value || '')
            .replace(/\D/g, '')
            .slice(0, 11);

    let formatado = numeros;

    if (numeros.length > 9) {

        formatado =
                numeros.replace(
                        /^(\d{3})(\d{3})(\d{3})(\d{0,2}).*$/,
                        '$1.$2.$3-$4'
                        );

    } else if (numeros.length > 6) {

        formatado =
                numeros.replace(
                        /^(\d{3})(\d{3})(\d{0,3}).*$/,
                        '$1.$2.$3'
                        );

    } else if (numeros.length > 3) {

        formatado =
                numeros.replace(
                        /^(\d{3})(\d{0,3}).*$/,
                        '$1.$2'
                        );
    }

    input.value = formatado;
}

/* ---------- TELEFONE COM MÁSCARA ---------- */
function formatarTelefoneClienteInput(input) {

    let numeros = String(input.value || '')
            .replace(/\D/g, '')
            .slice(0, 11);

    let formatado = numeros;

    if (numeros.length >= 11) {

        formatado =
                numeros.replace(
                        /^(\d{2})(\d{5})(\d{0,4}).*$/,
                        '($1) $2-$3'
                        );

    } else if (numeros.length >= 7) {

        formatado =
                numeros.replace(
                        /^(\d{2})(\d{4,5})(\d{0,4}).*$/,
                        '($1) $2-$3'
                        );

    } else if (numeros.length >= 3) {

        formatado =
                numeros.replace(
                        /^(\d{2})(\d*).*$/,
                        '($1) $2'
                        );
    }

    input.value = formatado;
}

/* ---------- SOMENTE NÚMEROS ---------- */
function somenteNumerosClienteInput(input) {

    input.value =
            String(input.value || '')
            .replace(/\D/g, '')
            .slice(0, 10);
}

window.insumoEditandoId = null;

async function editarInsumoUI(id) {

    const insumoId = Number(id);

    if (!Number.isInteger(insumoId) || insumoId <= 0) {
        alert('⚠️ Insumo inválido.');
        return;
    }

    try {

        // ----------------------------------------------------
        // 1. BUSCA O INSUMO
        // ----------------------------------------------------

        const {
            data: insumo,
            error
        } = await _supabase
                .from('insumos')
                .select(`
                    id,
                    nome,
                    produto_id,
                    unidade_base_id,
                    unidade_compra_id,
                    fator_compra_base,
                    estoque_minimo_base,
                    ativo,
                    observacao
                `)
                .eq('id', insumoId)
                .single();

        if (error) {
            throw error;
        }

        if (!insumo) {
            alert('⚠️ Insumo não encontrado.');
            return;
        }

        // ----------------------------------------------------
        // 2. ABRE O MESMO MODAL DE CADASTRO
        // ----------------------------------------------------

        await abrirModalNovoInsumo();

        // ----------------------------------------------------
        // 3. MARCA COMO EDIÇÃO
        // ----------------------------------------------------

        window.insumoEditandoId =
                Number(insumo.id);

        // ----------------------------------------------------
        // 4. CAMPOS
        // ----------------------------------------------------

        const campoNome =
                document.getElementById(
                        'insumo-nome'
                        );

        const selectProduto =
                document.getElementById(
                        'insumo-produto'
                        );

        const selectUnidadeCompra =
                document.getElementById(
                        'insumo-unidade-compra'
                        );

        const selectUnidadeBase =
                document.getElementById(
                        'insumo-unidade-base'
                        );

        const campoFator =
                document.getElementById(
                        'insumo-fator'
                        );

        const campoEstoqueMinimo =
                document.getElementById(
                        'insumo-estoque-minimo'
                        );

        const campoObservacao =
                document.getElementById(
                        'insumo-observacao'
                        );

        // ----------------------------------------------------
        // 5. PREENCHE OS DADOS
        // ----------------------------------------------------

        if (campoNome) {
            campoNome.value =
                    insumo.nome || '';
        }

        if (selectProduto) {
            selectProduto.value =
                    insumo.produto_id != null
                    ? String(insumo.produto_id)
                    : '';
        }

        if (selectUnidadeCompra) {

            selectUnidadeCompra.value =
                    insumo.unidade_compra_id != null
                    ? String(insumo.unidade_compra_id)
                    : '';

            // Recalcula o filtro da unidade-base.
            selectUnidadeCompra.dispatchEvent(
                    new Event('change')
                    );
        }

        if (selectUnidadeBase) {

            selectUnidadeBase.value =
                    insumo.unidade_base_id != null
                    ? String(insumo.unidade_base_id)
                    : '';
        }

        if (campoFator) {
            campoFator.value =
                    Number(
                            insumo.fator_compra_base || 0
                            );
        }

        if (campoEstoqueMinimo) {
            campoEstoqueMinimo.value =
                    Number(
                            insumo.estoque_minimo_base || 0
                            );
        }

        if (campoObservacao) {
            campoObservacao.value =
                    insumo.observacao || '';
        }

        // ----------------------------------------------------
        // 6. ALTERA O BOTÃO PARA EDIÇÃO
        // ----------------------------------------------------

        const btnSalvar =
                document.getElementById(
                        'btn-salvar-insumo'
                        );

        if (btnSalvar) {
            btnSalvar.innerHTML =
                    '💾 Salvar Alterações';
        }

        // ----------------------------------------------------
        // 7. FOCO
        // ----------------------------------------------------

        if (campoNome) {
            setTimeout(() => {
                campoNome.focus();
                campoNome.select();
            }, 50);
        }

    } catch (erro) {

        console.error(
                '⛔ Erro ao abrir edição do insumo:',
                erro
                );

        window.insumoEditandoId = null;

        alert(
                '❌ Não foi possível abrir o insumo para edição:\n\n' +
                (
                        erro?.message ||
                        'Erro desconhecido.'
                        )
                );
    }
}

window.editarInsumoUI = editarInsumoUI;

window.alterarStatusInsumoUI = async function (id, ativoAtual) {

    const insumoId = Number(id);

    if (!Number.isInteger(insumoId) || insumoId <= 0) {
        alert('⚠️ Insumo inválido.');
        return;
    }

    const novoStatus = !Boolean(ativoAtual);

    const acao = novoStatus
            ? 'ativar'
            : 'desativar';

    const confirmacao = confirm(
            novoStatus
            ? 'Deseja ativar este insumo?'
            : 'Deseja desativar este insumo?'
            );

    if (!confirmacao) {
        return;
    }

    try {

        const {
            data,
            error
        } = await _supabase
                .from('insumos')
                .update({
                    ativo: novoStatus,
                    atualizado_em: new Date().toISOString()
                })
                .eq('id', insumoId)
                .select(`
                id,
                nome,
                ativo
            `)
                .single();

        if (error) {
            throw error;
        }

        if (!data) {
            throw new Error(
                    'O banco não retornou o insumo atualizado.'
                    );
        }

        console.log(
                `✅ Insumo ${acao}do:`,
                data
                );

        alert(
                novoStatus
                ? `✅ Insumo "${data.nome}" ativado com sucesso!`
                : `✅ Insumo "${data.nome}" desativado com sucesso!`
                );

        await carregarCadastroInsumosUI();

    } catch (erro) {

        console.error(
                `⛔ Erro ao ${acao} o insumo:`,
                erro
                );

        alert(
                `❌ Não foi possível ${acao} o insumo:\n\n` +
                (
                        erro?.message ||
                        'Erro desconhecido.'
                        )
                );
    }
};

// ========================================================
// MÁSCARA DE TELEFONE - FORNECEDOR
// ========================================================

function formatarTelefoneFornecedorInput(input) {

    if (!input) {
        return;
    }

    // Reaproveita a mesma regra usada nos clientes.
    formatarTelefoneClienteInput(input);
}


// ========================================================
// MÁSCARA DE CPF / CNPJ
// ========================================================

function formatarDocumentoFornecedorInput(input) {

    if (!input) {
        return;
    }

    const numeros =
            String(input.value || '')
            .replace(/\D/g, '')
            .slice(0, 14);

    let formatado = numeros;

    // CNPJ
    if (numeros.length > 11) {

        formatado =
                numeros.replace(
                        /^(\d{2})(\d{3})(\d{3})(\d{0,4})(\d{0,2}).*$/,
                        '$1.$2.$3/$4-$5'
                        );

        // CPF
    } else if (numeros.length > 0) {

        formatado =
                numeros
                .replace(
                        /^(\d{3})(\d{0,3})(\d{0,3})(\d{0,2}).*$/,
                        '$1.$2.$3-$4'
                        );
    }

    input.value = formatado;
}

// ============================================================
// AUDITORIA DO SISTEMA
// ============================================================
let auditoriaInicializada = false;
let auditoriaCarregando = false;
let auditoriaDados = {
    eventos: [],
    vendas: [],
    caixas: [],
    estoque: [],
    despesas: [],
    contas: []
};

function escaparAuditoria(valor) {
    return String(valor ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function dinheiroAuditoria(valor) {
    return `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
}

function dataHoraAuditoria(valor) {
    return valor ? new Date(valor).toLocaleString('pt-BR') : '-';
}

function dataSomenteAuditoria(valor) {
    if (!valor)
        return '-';
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR');
}

function inicioFimAuditoria() {
    const periodo = document.getElementById('auditoria-periodo')?.value || 'hoje';
    const agora = new Date();
    let inicio = null;
    let fim = null;

    if (periodo === 'hoje') {
        inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    } else if (periodo === '7dias') {
        inicio = new Date(agora);
        inicio.setDate(inicio.getDate() - 7);
    } else if (periodo === 'mes') {
        inicio = new Date(agora.getFullYear(), agora.getMonth(), 1);
    } else if (periodo === 'personalizado') {
        const valorInicio = document.getElementById('auditoria-data-inicio')?.value || '';
        const valorFim = document.getElementById('auditoria-data-fim')?.value || '';
        if (valorInicio)
            inicio = new Date(`${valorInicio}T00:00:00`);
        if (valorFim) {
            fim = new Date(`${valorFim}T23:59:59.999`);
        }
    }

    return {
        inicioISO: inicio ? inicio.toISOString() : null,
        fimISO: fim ? fim.toISOString() : null
    };
}

function atualizarVisibilidadeDatasAuditoria() {
    const personalizado = document.getElementById('auditoria-periodo')?.value === 'personalizado';
    document.querySelectorAll('.audit-data-custom').forEach(el => {
        el.style.display = personalizado ? 'block' : 'none';
    });
}

async function carregarFiltrosAuditoria() {
    const selectUsuario = document.getElementById('auditoria-usuario');
    const selectCaixa = document.getElementById('auditoria-caixa');
    const selectCliente = document.getElementById('auditoria-cliente');

    if (selectUsuario && selectUsuario.options.length <= 1) {
        const {data, error} = await _supabase
                .from('usuarios')
                .select('nome, auth_user_id, ativo')
                .order('nome', {ascending: true});

        if (!error && Array.isArray(data)) {
            data.forEach(usuario => {
                const option = document.createElement('option');
                option.value = usuario.auth_user_id || '';
                option.textContent = `${usuario.nome || 'Sem nome'}${usuario.ativo === false ? ' (inativo)' : ''}`;
                if (option.value)
                    selectUsuario.appendChild(option);
            });

        }
    }


    if (selectCaixa && selectCaixa.options.length <= 1) {
        const {data, error} = await _supabase
                .from('caixa_diario')
                .select('id, data_abertura, data_fechamento, status')
                .order('data_abertura', {ascending: false})
                .limit(100);

        if (!error && Array.isArray(data)) {
            data.forEach(caixa => {
                const option = document.createElement('option');
                option.value = String(caixa.id);
                const inicio = dataSomenteAuditoria(caixa.data_abertura);
                const fim = caixa.data_fechamento ? ` → ${dataSomenteAuditoria(caixa.data_fechamento)}` : ' → ABERTO';
                option.textContent = `Caixa #${caixa.id} (${inicio}${fim})`;
                selectCaixa.appendChild(option);
            });
        }
    }

    // ------------------------------------------------------------
// CLIENTES
// ------------------------------------------------------------

    if (
            selectCliente &&
            selectCliente.options.length <= 1
            ) {

        const {
            data,
            error
        } = await _supabase.rpc(
                'listar_clientes_admin',
                {
                    p_busca: null
                }
        );

        if (error) {

            console.error(
                    'Erro ao carregar clientes da Auditoria:',
                    error
                    );

        } else if (
                Array.isArray(data)
                ) {

            data.forEach(cliente => {

                const option =
                        document.createElement(
                                'option'
                                );

                option.value =
                        String(
                                cliente.id
                                );

                option.textContent =
                        cliente.nome ||
                        'Cliente sem nome';

                if (
                        cliente.ativo === false
                        ) {

                    option.textContent +=
                            ' (inativo)';
                }

                selectCliente.appendChild(
                        option
                        );
            });
        }
    }
}

function aplicaFiltroQueryAuditoria(query, campoData, filtros) {
    let q = query;
    if (filtros.inicioISO)
        q = q.gte(campoData, filtros.inicioISO);
    if (filtros.fimISO)
        q = q.lte(campoData, filtros.fimISO);
    return q;
}

function filtrarArrayAuditoria(lista, campoData, filtros) {
    return (lista || []).filter(item => {
        const valor = item?.[campoData];
        // Alguns RPCs podem não expor a data de criação. Mantemos o registro
        // em vez de removê-lo indevidamente quando a data não está disponível.
        if (!valor)
            return true;
        const tempo = new Date(valor).getTime();
        if (Number.isNaN(tempo))
            return true;
        if (filtros.inicioISO && tempo < new Date(filtros.inicioISO).getTime())
            return false;
        if (filtros.fimISO && tempo > new Date(filtros.fimISO).getTime())
            return false;
        return true;
    });
}

async function consultarEventosAuditoria(filtros) {
    let query = _supabase
            .from('auditoria_eventos')
            .select(`
            id,
            criado_em,
            usuario_auth_id,
            usuario_nome,
            acao,
            entidade,
            registro_id,
            descricao,
            dados_anteriores,
            dados_novos,
            caixa_id
        `)
            .order('criado_em', {ascending: false})
            .limit(1000);

    query = aplicaFiltroQueryAuditoria(query, 'criado_em', filtros);

    if (filtros.usuario !== 'TODOS')
        query = query.eq('usuario_auth_id', filtros.usuario);

    if (filtros.caixa !== 'TODOS')
        query = query.eq('caixa_id', Number(filtros.caixa));

    const {data, error} = await query;

    return {
        data: data || [],
        error
    };
}

async function consultarVendasAuditoria(filtros) {
    let query = _supabase
            .from('pedidos')
            .select(`
    id,
    status,
    tipo,
    forma_pagamento,
    valor_total,
    criado_em,
    caixa_id,
    cliente_id,
    endereco_snapshot,

    clientes (
        nome
    ),

    itens_pedido (
        quantidade,
        produtos(nome)
    )
`)
            .order('criado_em', {ascending: false})
            .limit(1000);

    query = aplicaFiltroQueryAuditoria(query, 'criado_em', filtros);

    if (filtros.caixa !== 'TODOS') {
        query = query.eq('caixa_id', Number(filtros.caixa));
    }

    if (filtros.cliente !== 'TODOS') {
        query = query.eq('cliente_id', Number(filtros.cliente));
    }

    const {data, error} = await query;
    return {data: data || [], error};
}

async function consultarCaixasAuditoria(filtros) {
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
            .order('data_abertura', {ascending: false})
            .limit(500);

    query = aplicaFiltroQueryAuditoria(query, 'data_abertura', filtros);
    if (filtros.caixa !== 'TODOS')
        query = query.eq('id', Number(filtros.caixa));

    const {data, error} = await query;
    return {data: data || [], error};
}

async function consultarEstoqueAuditoria(filtros) {
    let query = _supabase
            .from('movimentacoes_estoque')
            .select(`
            id,
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
            .order('criado_em', {ascending: false})
            .limit(1000);

    query = aplicaFiltroQueryAuditoria(query, 'criado_em', filtros);
    if (filtros.usuario !== 'TODOS')
        query = query.eq('usuario_auth_id', filtros.usuario);

    const {data, error} = await query;
    return {data: data || [], error};
}

async function consultarDespesasAuditoria(filtros) {
    let query = _supabase
            .from('despesas')
            .select(`
            id,
            descricao,
            categoria,
            valor,
            pago,
            forma_pagamento,
            caixa_id,
            created_at,
            data_vencimento
        `)
            .order('created_at', {ascending: false})
            .limit(1000);

    query = aplicaFiltroQueryAuditoria(query, 'created_at', filtros);
    if (filtros.caixa !== 'TODOS')
        query = query.eq('caixa_id', Number(filtros.caixa));

    const {data, error} = await query;
    return {data: data || [], error};
}

async function consultarContasAuditoria(filtros) {
    const {data, error} = await _supabase.rpc('listar_contas_receber_admin', {
        p_busca: null,
        p_status: 'TODOS'
    });

    let contas = Array.isArray(data) ? data : [];
    // O RPC atual não expõe obrigatoriamente a data de criação; quando existir, o filtro de período é aplicado.
    contas = filtrarArrayAuditoria(contas, 'created_at', filtros);
    return {data: contas, error};
}

function eventosPorRegistroAuditoria(entidade, registroId) {
    return auditoriaDados.eventos.filter(ev =>
        String(ev.entidade || '').toLowerCase() === entidade.toLowerCase() &&
                Number(ev.registro_id || 0) === Number(registroId || 0)
    );
}

function usuarioVendaAuditoria(pedidoId) {
    const eventos = eventosPorRegistroAuditoria('pedidos', pedidoId);
    const eventoCriacao = eventos.find(ev => ev.acao === 'INSERT') || eventos[0];
    return eventoCriacao?.usuario_nome || '-';
}

function renderizarResumoAuditoria() {
    const resumo = document.getElementById('auditoria-resumo-grid');
    if (!resumo)
        return;

    const vendasValidas = auditoriaDados.vendas.filter(v => v.status === 'CONCLUIDO');
    const faturamento = vendasValidas.reduce((acc, v) => acc + Number(v.valor_total || 0), 0);
    const cancelados = auditoriaDados.vendas.filter(v => v.status === 'CANCELADO').length;
    const diferencas = auditoriaDados.caixas.filter(c => Number(c.diferenca || 0) !== 0).length;
    const movimentosEstoque = auditoriaDados.estoque.length;
    const eventos = auditoriaDados.eventos.length;

    resumo.innerHTML = `
        <div class="audit-card"><span>Vendas concluídas</span><strong>${vendasValidas.length}</strong></div>
        <div class="audit-card"><span>Faturamento</span><strong>${dinheiroAuditoria(faturamento)}</strong></div>
        <div class="audit-card"><span>Cancelamentos</span><strong>${cancelados}</strong></div>
        <div class="audit-card"><span>Diferenças de caixa</span><strong>${diferencas}</strong></div>
        <div class="audit-card"><span>Mov. de estoque</span><strong>${movimentosEstoque}</strong></div>
        <div class="audit-card"><span>Eventos registrados</span><strong>${eventos}</strong></div>
    `;
}

function tabelaAuditoria(titulo, cabecalhos, linhas, vazio = 'Nenhum registro encontrado.') {
    const body = linhas.length ? linhas.join('') : `<tr><td colspan="${cabecalhos.length}" class="audit-empty">${vazio}</td></tr>`;
    return `
        <section class="audit-section">
            <div class="audit-section-title"><h3>${titulo}</h3><span>${linhas.length} registro(s)</span></div>
            <div class="audit-table-wrap">
                <table class="products-table audit-table">
                    <thead><tr>${cabecalhos.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
        </section>
    `;
}

function renderizarAuditoriaAtual() {
    const conteudo = document.getElementById('auditoria-conteudo');
    if (!conteudo)
        return;

    const tipo = document.getElementById('auditoria-tipo')?.value || 'GERAL';
    const eventos = auditoriaDados.eventos || [];

    if (tipo === 'GERAL') {
        const recentes = eventos.slice(0, 20);
        const linhas = recentes.map(ev => `
            <tr>
                <td>${dataHoraAuditoria(ev.criado_em)}</td>
                <td>${escaparAuditoria(ev.usuario_nome || '-')}</td>
                <td>${escaparAuditoria(ev.acao || '-')}</td>
                <td>${escaparAuditoria(ev.entidade || '-')} #${escaparAuditoria(ev.registro_id || '-')}</td>
                <td>${escaparAuditoria(ev.descricao || '-')}</td>
                <td>${ev.caixa_id ? `#${escaparAuditoria(ev.caixa_id)}` : '-'}</td>
            </tr>
        `);
        const vendas = auditoriaDados.vendas.filter(v => v.status === 'CONCLUIDO');
        const faturamento = vendas.reduce((acc, v) => acc + Number(v.valor_total || 0), 0);
        const finance = `
            <section class="audit-section audit-highlight-section">
                <div class="audit-section-title"><h3>Resumo financeiro auditado</h3></div>
                <div class="audit-finance-line">
                    <div><span>Faturamento</span><strong>${dinheiroAuditoria(faturamento)}</strong></div>
                    <div><span>Vendas concluídas</span><strong>${vendas.length}</strong></div>
                    <div><span>Despesas pagas</span><strong>${dinheiroAuditoria(auditoriaDados.despesas.filter(d => d.pago).reduce((a, d) => a + Number(d.valor || 0), 0))}</strong></div>
                    <div><span>Contas em aberto</span><strong>${dinheiroAuditoria(auditoriaDados.contas.reduce((a, c) => a + Number(c.saldo_aberto || 0), 0))}</strong></div>
                </div>
            </section>
        `;
        conteudo.innerHTML = finance + tabelaAuditoria('Últimos eventos', ['Data / Hora', 'Usuário', 'Ação', 'Registro', 'Descrição', 'Caixa'], linhas);
        return;
    }

    if (tipo === 'VENDAS') {
        const linhas =
                auditoriaDados.vendas.map(v => `
    <tr>

        <td>
            #${v.id}
        </td>

        <td>
            ${dataHoraAuditoria(v.criado_em)}
        </td>

        <td>
            ${escaparAuditoria(
                            v.clientes?.nome ||
                            'Cliente não informado'
                            )}
        </td>

        <td>
            ${escaparAuditoria(
                            usuarioVendaAuditoria(v.id)
                            )}
        </td>

        <td>
            ${escaparAuditoria(
                            v.tipo || 'PDV'
                            )}
        </td>

        <td>
            ${escaparAuditoria(
                            v.forma_pagamento || '-'
                            )}
        </td>

        <td>
            ${
                            (v.itens_pedido || [])
                            .reduce(
                                    (a, i) =>
                                a +
                                        Number(
                                                i.quantidade || 0
                                                ),
                                    0
                                    )
                            }
        </td>

        <td>
            ${dinheiroAuditoria(v.valor_total)}
        </td>

        <td>
            ${escaparAuditoria(
                            v.status || '-'
                            )}
        </td>

        <td>
            ${v.caixa_id ? `#${v.caixa_id}` : '-'}
        </td>

    </tr>
`);
        return conteudo.innerHTML =
                tabelaAuditoria(
                        'Vendas',
                        [
                            'Pedido',
                            'Data / Hora',
                            'Cliente',
                            'Operador',
                            'Tipo',
                            'Pagamento',
                            'Itens',
                            'Total',
                            'Status',
                            'Caixa'
                        ],
                        linhas
                        );
    }

    if (tipo === 'CAIXAS') {
        const linhas = auditoriaDados.caixas.map(c => `
            <tr>
                <td>#${c.id}</td>
                <td>${dataHoraAuditoria(c.data_abertura)}</td>
                <td>${dataHoraAuditoria(c.data_fechamento)}</td>
                <td>${dinheiroAuditoria(c.saldo_inicial)}</td>
                <td>${dinheiroAuditoria(c.total_entradas_dinheiro)}</td>
                <td>${dinheiroAuditoria(c.total_outras_formas)}</td>
                <td>${dinheiroAuditoria(c.total_saidas)}</td>
                <td>${dinheiroAuditoria(c.saldo_esperado)}</td>
                <td>${dinheiroAuditoria(c.saldo_informado)}</td>
                <td>${dinheiroAuditoria(c.diferenca)}</td>
            </tr>
        `);
        return conteudo.innerHTML = tabelaAuditoria('Caixas', ['Caixa', 'Abertura', 'Fechamento', 'Inicial', 'Dinheiro', 'Outras', 'Saídas', 'Esperado', 'Informado', 'Diferença'], linhas);
    }

    if (tipo === 'CANCELAMENTOS') {
        const linhas = auditoriaDados.vendas
                .filter(v => v.status === 'CANCELADO')
                .map(v => {
                    const eventos = eventosPorRegistroAuditoria('pedidos', v.id).filter(ev => {
                        const novo = ev.dados_novos || {};
                        return String(novo.status || '').toUpperCase() === 'CANCELADO' || ev.acao === 'DELETE';
                    });
                    const ev = eventos[0] || {};
                    return `
                    <tr>
                        <td>#${v.id}</td>
                        <td>${dataHoraAuditoria(v.criado_em)}</td>
                        <td>${dataHoraAuditoria(ev.criado_em)}</td>
                        <td>${escaparAuditoria(ev.usuario_nome || usuarioVendaAuditoria(v.id))}</td>
                        <td>${dinheiroAuditoria(v.valor_total)}</td>
                        <td>${escaparAuditoria(v.forma_pagamento || '-')}</td>
                        <td>${escaparAuditoria(ev.descricao || 'Pedido cancelado')}</td>
                    </tr>
                `;
                });
        return conteudo.innerHTML = tabelaAuditoria('Cancelamentos', ['Pedido', 'Venda', 'Cancelamento', 'Usuário', 'Valor', 'Pagamento', 'Motivo'], linhas);
    }

    if (tipo === 'ESTOQUE') {
        const linhas = auditoriaDados.estoque.map(m => `
            <tr>
                <td>${dataHoraAuditoria(m.criado_em)}</td>
                <td>${escaparAuditoria(m.produto_nome || '-')}</td>
                <td>${escaparAuditoria(m.tipo || '-')}</td>
                <td>${Number(m.quantidade || 0)}</td>
                <td>${m.estoque_anterior ?? '-'}</td>
                <td>${m.estoque_posterior ?? '-'}</td>
                <td>${escaparAuditoria(m.motivo || '-')}</td>
                <td>${m.pedido_id ? `#${m.pedido_id}` : '-'}</td>
                <td>${escaparAuditoria(m.usuario_nome || '-')}</td>
            </tr>
        `);
        return conteudo.innerHTML = tabelaAuditoria('Movimentações de estoque', ['Data / Hora', 'Produto', 'Tipo', 'Qtd.', 'Anterior', 'Posterior', 'Motivo', 'Pedido', 'Usuário'], linhas);
    }

    if (tipo === 'FINANCEIRO') {
        const faturamento = auditoriaDados.vendas.filter(v => v.status === 'CONCLUIDO').reduce((a, v) => a + Number(v.valor_total || 0), 0);
        const despesas = auditoriaDados.despesas.filter(d => d.pago).reduce((a, d) => a + Number(d.valor || 0), 0);
        const entradasDinheiro = auditoriaDados.caixas.reduce((a, c) => a + Number(c.total_entradas_dinheiro || 0), 0);
        const outras = auditoriaDados.caixas.reduce((a, c) => a + Number(c.total_outras_formas || 0), 0);
        const linhas = [
            `<tr><td>Vendas concluídas</td><td>${dinheiroAuditoria(faturamento)}</td><td>${auditoriaDados.vendas.filter(v => v.status === 'CONCLUIDO').length}</td></tr>`,
            `<tr><td>Despesas pagas</td><td>${dinheiroAuditoria(despesas)}</td><td>${auditoriaDados.despesas.filter(d => d.pago).length}</td></tr>`,
            `<tr><td>Entradas em dinheiro</td><td>${dinheiroAuditoria(entradasDinheiro)}</td><td>${auditoriaDados.caixas.length} caixa(s)</td></tr>`,
            `<tr><td>Entradas outras formas</td><td>${dinheiroAuditoria(outras)}</td><td>${auditoriaDados.caixas.length} caixa(s)</td></tr>`
        ];
        return conteudo.innerHTML = tabelaAuditoria('Resumo financeiro', ['Indicador', 'Valor', 'Referência'], linhas);
    }

    if (tipo === 'CONTAS_RECEBER') {
        const linhas = auditoriaDados.contas.map(c => `
            <tr>
                <td>${escaparAuditoria(c.cliente_nome || 'Sem nome')}</td>
                <td>${c.pedido_id ? `#${c.pedido_id}` : '-'}</td>
                <td>${dinheiroAuditoria(c.valor_total)}</td>
                <td>${dinheiroAuditoria(c.valor_pago)}</td>
                <td>${dinheiroAuditoria(c.saldo_aberto)}</td>
                <td>${dataSomenteAuditoria(c.data_vencimento)}</td>
                <td>${escaparAuditoria(c.status || '-')}</td>
            </tr>
        `);
        return conteudo.innerHTML = tabelaAuditoria('Contas a Receber', ['Cliente', 'Pedido', 'Valor', 'Pago', 'Saldo', 'Vencimento', 'Status'], linhas);
    }

    if (tipo === 'EVENTOS') {
        const linhas = eventos.map(ev => `
            <tr>
                <td>${dataHoraAuditoria(ev.criado_em)}</td>
                <td>${escaparAuditoria(ev.usuario_nome || '-')}</td>
                <td>${escaparAuditoria(ev.acao || '-')}</td>
                <td>${escaparAuditoria(ev.entidade || '-')}</td>
                <td>${escaparAuditoria(ev.registro_id || '-')}</td>
                <td>${ev.caixa_id ? `#${escaparAuditoria(ev.caixa_id)}` : '-'}</td>
                <td>${escaparAuditoria(ev.descricao || '-')}</td>
            </tr>
        `);
        return conteudo.innerHTML = tabelaAuditoria('Eventos de auditoria', ['Data / Hora', 'Usuário', 'Ação', 'Entidade', 'Registro', 'Caixa', 'Descrição'], linhas);
    }
}

async function carregarAuditoria() {
    if (auditoriaCarregando)
        return;
    auditoriaCarregando = true;
    atualizarVisibilidadeDatasAuditoria();

    const statusEl = document.getElementById('auditoria-status');
    const conteudo = document.getElementById('auditoria-conteudo');
    if (statusEl)
        statusEl.textContent = 'Carregando...';
    if (conteudo)
        conteudo.innerHTML = '<div class="audit-empty">⏳ Carregando dados da auditoria...</div>';

    const filtros = {
        ...inicioFimAuditoria(),

        usuario:
                document.getElementById(
                        'auditoria-usuario'
                        )?.value ||
                'TODOS',

        caixa:
                document.getElementById(
                        'auditoria-caixa'
                        )?.value ||
                'TODOS',

        cliente:
                document.getElementById(
                        'auditoria-cliente'
                        )?.value ||
                'TODOS'
    };

    try {
        await carregarFiltrosAuditoria();

        const [eventos, vendas, caixas, estoque, despesas, contas] = await Promise.all([
            consultarEventosAuditoria(filtros),
            consultarVendasAuditoria(filtros),
            consultarCaixasAuditoria(filtros),
            consultarEstoqueAuditoria(filtros),
            consultarDespesasAuditoria(filtros),
            consultarContasAuditoria(filtros)
        ]);

        const erros = [eventos, vendas, caixas, estoque, despesas, contas]
                .filter(r => r?.error)
                .map(r => r.error?.message || 'Erro de consulta');

        auditoriaDados = {
            eventos: eventos.data || [],
            vendas: vendas.data || [],
            caixas: caixas.data || [],
            estoque: estoque.data || [],
            despesas: despesas.data || [],
            contas: contas.data || []
        };

        // ------------------------------------------------------------
// FILTRO POR CLIENTE
// ------------------------------------------------------------

        if (filtros.cliente !== 'TODOS') {

            const pedidosDoCliente =
                    auditoriaDados.vendas.map(
                            venda =>
                        Number(venda.id)
                    );

            // Vendas já vieram filtradas pelo cliente.
            // Agora usamos os IDs dos pedidos para filtrar
            // eventos e movimentações relacionadas.

            auditoriaDados.estoque =
                    auditoriaDados.estoque.filter(
                            movimento =>
                        movimento.pedido_id &&
                                pedidosDoCliente.includes(
                                        Number(
                                                movimento.pedido_id
                                                )
                                        )
                    );

            auditoriaDados.eventos =
                    auditoriaDados.eventos.filter(
                            evento => {

                                if (
                                        String(
                                                evento.entidade ||
                                                ''
                                                )
                                        .toLowerCase() !==
                                        'pedidos'
                                        ) {

                                    return false;
                                }

                                return pedidosDoCliente.includes(
                                        Number(
                                                evento.registro_id
                                                )
                                        );
                            }
                    );
        }

        if (filtros.usuario !== 'TODOS') {
            const eventosAntesDoFiltro = auditoriaDados.eventos.slice();
            auditoriaDados.eventos = auditoriaDados.eventos.filter(ev => ev.usuario_auth_id === filtros.usuario);
            auditoriaDados.estoque = auditoriaDados.estoque.filter(m => m.usuario_auth_id === filtros.usuario);

            if (!eventos.error && eventosAntesDoFiltro.length > 0) {
                auditoriaDados.vendas = auditoriaDados.vendas.filter(v => usuarioVendaAuditoria(v.id) !== '-');
                auditoriaDados.caixas = auditoriaDados.caixas.filter(c =>
                    eventosAntesDoFiltro.some(ev =>
                        String(ev.entidade || '').toUpperCase() === 'CAIXA_DIARIO' &&
                                Number(ev.registro_id || 0) === Number(c.id || 0) &&
                                ev.usuario_auth_id === filtros.usuario
                    )
                );
            }
        }

        renderizarResumoAuditoria();
        renderizarAuditoriaAtual();

        if (statusEl) {
            statusEl.textContent = erros.length
                    ? `Concluído com ${erros.length} alerta(s)`
                    : `Atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
        }

        if (erros.length) {
            console.warn('Auditoria carregada com alertas:', erros);
            if (conteudo) {
                conteudo.insertAdjacentHTML('afterbegin', `
                    <div class="audit-warning">
                        ⚠️ Alguns dados não puderam ser consultados: ${escaparAuditoria(erros.join(' | '))}
                        ${erros.some(e => e.toLowerCase().includes('auditoria_eventos'))
                        ? '<br><small>A tabela de trilha de auditoria ainda não foi criada. Execute o arquivo <strong>auditoria.sql</strong> na base do Supabase.</small>'
                        : ''}
                    </div>
                `);
            }
        }
    } catch (err) {
        console.error('Erro ao carregar Auditoria:', err);
        if (statusEl)
            statusEl.textContent = 'Erro';
        if (conteudo)
            conteudo.innerHTML = `<div class="audit-warning">❌ ${escaparAuditoria(err.message || err)}</div>`;
    } finally {
        auditoriaCarregando = false;
    }
}

async function inicializarAuditoria() {
    atualizarVisibilidadeDatasAuditoria();
    if (!auditoriaInicializada) {
        auditoriaInicializada = true;
        await carregarFiltrosAuditoria();
    }
    await carregarAuditoria();
}

function limparFiltrosAuditoria() {
    const periodo = document.getElementById('auditoria-periodo');
    const usuario = document.getElementById('auditoria-usuario');
    const caixa = document.getElementById('auditoria-caixa');
    const cliente = document.getElementById('auditoria-cliente');
    const tipo = document.getElementById('auditoria-tipo');
    const inicio = document.getElementById('auditoria-data-inicio');
    const fim = document.getElementById('auditoria-data-fim');

    if (periodo)
        periodo.value = 'hoje';
    if (usuario)
        usuario.value = 'TODOS';
    if (caixa)
        caixa.value = 'TODOS';
    if (cliente)
        cliente.value = 'TODOS';
    if (tipo)
        tipo.value = 'GERAL';
    if (inicio)
        inicio.value = '';
    if (fim)
        fim.value = '';

    atualizarVisibilidadeDatasAuditoria();
    carregarAuditoria();
}

function prepararRelatorioAuditoriaImpressao() {
    document.body.classList.add('auditoria-impressao');
}

function restaurarRelatorioAuditoriaImpressao() {
    document.body.classList.remove('auditoria-impressao');
}

async function registrarEventoAuditoriaUI(acao, entidade, descricao) {
    try {
        await _supabase.rpc('registrar_auditoria_evento', {
            p_acao: acao,
            p_entidade: entidade,
            p_registro_id: null,
            p_descricao: descricao,
            p_dados_anteriores: null,
            p_dados_novos: null,
            p_caixa_id: caixaAtual?.id ? Number(caixaAtual.id) : null
        });
    } catch (err) {
        console.warn('Não foi possível registrar evento de auditoria da interface:', err);
    }
}

function imprimirAuditoria() {
    registrarEventoAuditoriaUI('PRINT', 'AUDITORIA', `Impressão do relatório ${document.getElementById('auditoria-tipo')?.value || 'GERAL'}`);
    prepararRelatorioAuditoriaImpressao();
    setTimeout(() => {
        window.print();
        setTimeout(restaurarRelatorioAuditoriaImpressao, 300);
    }, 100);
}

function exportarAuditoriaPDF() {
    registrarEventoAuditoriaUI('EXPORT_PDF', 'AUDITORIA', `Exportação em PDF do relatório ${document.getElementById('auditoria-tipo')?.value || 'GERAL'}`);
    prepararRelatorioAuditoriaImpressao();
    setTimeout(() => {
        window.print();
        setTimeout(restaurarRelatorioAuditoriaImpressao, 300);
    }, 100);
}

function csvEscapeAuditoria(valor) {
    const texto = String(valor ?? '').replace(/\r?\n/g, ' ');
    return `"${texto.replace(/"/g, '""')}"`;
}

function dadosCSVAuditoria() {
    const tipo = document.getElementById('auditoria-tipo')?.value || 'GERAL';
    const linhas = [];

    if (tipo === 'VENDAS') {
        linhas.push(['Pedido', 'Data/Hora', 'Operador', 'Tipo', 'Pagamento', 'Itens', 'Total', 'Status', 'Caixa']);
        auditoriaDados.vendas.forEach(v => linhas.push([
                v.id, dataHoraAuditoria(v.criado_em), usuarioVendaAuditoria(v.id), v.tipo || 'PDV', v.forma_pagamento || '',
                (v.itens_pedido || []).reduce((a, i) => a + Number(i.quantidade || 0), 0), Number(v.valor_total || 0).toFixed(2), v.status || '', v.caixa_id || ''
            ]));
    } else if (tipo === 'CAIXAS') {
        linhas.push(['Caixa', 'Abertura', 'Fechamento', 'Saldo Inicial', 'Entradas Dinheiro', 'Entradas Outras', 'Saídas', 'Esperado', 'Informado', 'Diferença']);
        auditoriaDados.caixas.forEach(c => linhas.push([c.id, dataHoraAuditoria(c.data_abertura), dataHoraAuditoria(c.data_fechamento), c.saldo_inicial, c.total_entradas_dinheiro, c.total_outras_formas, c.total_saidas, c.saldo_esperado, c.saldo_informado, c.diferenca]));
    } else if (tipo === 'CANCELAMENTOS') {
        linhas.push(['Pedido', 'Venda', 'Cancelamento', 'Usuário', 'Valor', 'Pagamento', 'Motivo']);
        auditoriaDados.vendas.filter(v => v.status === 'CANCELADO').forEach(v => {
            const ev = eventosPorRegistroAuditoria('pedidos', v.id).find(e => String(e.dados_novos?.status || '').toUpperCase() === 'CANCELADO') || {};
            linhas.push([v.id, dataHoraAuditoria(v.criado_em), dataHoraAuditoria(ev.criado_em), ev.usuario_nome || usuarioVendaAuditoria(v.id), v.valor_total, v.forma_pagamento || '', ev.descricao || 'Pedido cancelado']);
        });
    } else if (tipo === 'ESTOQUE') {
        linhas.push(['Data/Hora', 'Produto', 'Tipo', 'Quantidade', 'Estoque Anterior', 'Estoque Posterior', 'Motivo', 'Pedido', 'Usuário']);
        auditoriaDados.estoque.forEach(m => linhas.push([dataHoraAuditoria(m.criado_em), m.produto_nome || '', m.tipo || '', m.quantidade, m.estoque_anterior, m.estoque_posterior, m.motivo || '', m.pedido_id || '', m.usuario_nome || '']));
    } else if (tipo === 'EVENTOS') {
        linhas.push(['Data/Hora', 'Usuário', 'Ação', 'Entidade', 'Registro', 'Caixa', 'Descrição']);
        auditoriaDados.eventos.forEach(e => linhas.push([dataHoraAuditoria(e.criado_em), e.usuario_nome || '', e.acao || '', e.entidade || '', e.registro_id || '', e.caixa_id || '', e.descricao || '']));
    } else {
        linhas.push(['Indicador', 'Valor', 'Referência']);
        const faturamento = auditoriaDados.vendas.filter(v => v.status === 'CONCLUIDO').reduce((a, v) => a + Number(v.valor_total || 0), 0);
        const despesas = auditoriaDados.despesas.filter(d => d.pago).reduce((a, d) => a + Number(d.valor || 0), 0);
        linhas.push(['Vendas concluídas', faturamento, auditoriaDados.vendas.filter(v => v.status === 'CONCLUIDO').length]);
        linhas.push(['Despesas pagas', despesas, auditoriaDados.despesas.filter(d => d.pago).length]);
        linhas.push(['Cancelamentos', auditoriaDados.vendas.filter(v => v.status === 'CANCELADO').length, 'pedidos']);
        linhas.push(['Eventos de auditoria', auditoriaDados.eventos.length, 'eventos']);
    }
    return linhas;
}

function exportarAuditoriaCSV() {
    try {
        const linhas = dadosCSVAuditoria();
        const csv = '\ufeff' + linhas.map(linha => linha.map(csvEscapeAuditoria).join(';')).join('\r\n');
        const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const tipo = document.getElementById('auditoria-tipo')?.value || 'GERAL';
        const hoje = new Date().toISOString().slice(0, 10);
        a.download = `auditoria_${tipo.toLowerCase()}_${hoje}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        registrarEventoAuditoriaUI('EXPORT_CSV', 'AUDITORIA', `Exportação CSV do relatório ${tipo}`);
    } catch (err) {
        console.error('Erro ao exportar auditoria:', err);
        alert('❌ Não foi possível exportar a auditoria.');
    }
}

// Reage a mudança do período personalizado sem exigir botão extra.
document.addEventListener('change', event => {
    if (event.target?.id === 'auditoria-periodo') {
        atualizarVisibilidadeDatasAuditoria();
    }
});

// ============================================================
// SOLICITAR PIN DO GERENTE COM CAMPO PROTEGIDO
// ============================================================
function solicitarPinGerenteSeguro(mensagem) {

    return new Promise(function (resolve) {

        // ----------------------------------------------------
        // OVERLAY
        // ----------------------------------------------------
        const overlay =
                document.createElement('div');

        overlay.style.cssText = `
            position:fixed;
            inset:0;
            background:rgba(0,0,0,0.75);
            z-index:99999;
            display:flex;
            justify-content:center;
            align-items:center;
            padding:20px;
        `;

        // ----------------------------------------------------
        // CARD
        // ----------------------------------------------------
        const card =
                document.createElement('div');

        card.style.cssText = `
            width:100%;
            max-width:400px;
            background:#24242f;
            border-radius:10px;
            padding:25px;
            box-shadow:0 10px 40px rgba(0,0,0,0.5);
            color:#fff;
        `;

        // ----------------------------------------------------
        // TÍTULO
        // ----------------------------------------------------
        const titulo =
                document.createElement('h2');

        titulo.textContent =
                '🔐 Autorização do Gerente';

        titulo.style.cssText = `
            margin:0 0 12px 0;
            font-size:1.25rem;
        `;

        // ----------------------------------------------------
        // MENSAGEM
        // ----------------------------------------------------
        const texto =
                document.createElement('div');

        texto.textContent =
                mensagem;

        texto.style.cssText = `
            color:#aaa;
            font-size:0.9rem;
            line-height:1.5;
            margin-bottom:18px;
        `;

        // ----------------------------------------------------
        // CAMPO PIN
        // ----------------------------------------------------
        const input =
                document.createElement('input');

        input.type =
                'password';

        input.inputMode =
                'numeric';

        input.autocomplete =
                'off';

        input.maxLength =
                6;

        input.placeholder =
                'Digite o PIN';

        input.style.cssText = `
            width:100%;
            box-sizing:border-box;
            padding:12px;
            border:1px solid #555;
            border-radius:6px;
            background:#181820;
            color:#fff;
            font-size:1.2rem;
            text-align:center;
            letter-spacing:6px;
            outline:none;
        `;

        // Permite somente números
        input.addEventListener(
                'input',
                function () {

                    this.value =
                            this.value
                            .replace(/\D/g, '')
                            .slice(0, 6);
                }
        );

        // ----------------------------------------------------
        // MENSAGEM DE VALIDAÇÃO
        // ----------------------------------------------------
        const erro =
                document.createElement('div');

        erro.style.cssText = `
            display:none;
            color:#ff4757;
            font-size:0.85rem;
            margin-top:8px;
            text-align:center;
        `;

        // ----------------------------------------------------
        // BOTÕES
        // ----------------------------------------------------
        const botoes =
                document.createElement('div');

        botoes.style.cssText = `
            display:flex;
            gap:10px;
            margin-top:20px;
        `;

        const btnCancelar =
                document.createElement('button');

        btnCancelar.type =
                'button';

        btnCancelar.textContent =
                'Cancelar';

        btnCancelar.style.cssText = `
            flex:1;
            padding:11px;
            border:none;
            border-radius:6px;
            background:#3d3d4e;
            color:#fff;
            cursor:pointer;
        `;

        const btnConfirmar =
                document.createElement('button');

        btnConfirmar.type =
                'button';

        btnConfirmar.textContent =
                'Autorizar';

        btnConfirmar.style.cssText = `
            flex:1;
            padding:11px;
            border:none;
            border-radius:6px;
            background:#2ed573;
            color:#000;
            font-weight:bold;
            cursor:pointer;
        `;

        // ----------------------------------------------------
        // FECHAR
        // ----------------------------------------------------
        function fechar(valor) {

            document.removeEventListener(
                    'keydown',
                    eventoTeclado
                    );

            overlay.remove();

            resolve(valor);
        }

        // ----------------------------------------------------
        // CONFIRMAR
        // ----------------------------------------------------
        function confirmar() {

            const pin =
                    input.value.trim();

            if (!/^\d{4,6}$/.test(pin)) {

                erro.textContent =
                        '⚠️ O PIN deve ter de 4 a 6 números.';

                erro.style.display =
                        'block';

                input.focus();

                return;
            }

            fechar(pin);
        }

        // ----------------------------------------------------
        // CANCELAR
        // ----------------------------------------------------
        btnCancelar.onclick =
                function () {

                    fechar(null);
                };

        // ----------------------------------------------------
        // AUTORIZAR
        // ----------------------------------------------------
        btnConfirmar.onclick =
                confirmar;

        // ----------------------------------------------------
        // ENTER / ESC
        // ----------------------------------------------------
        function eventoTeclado(event) {

            if (event.key === 'Enter') {

                event.preventDefault();

                confirmar();

            } else if (event.key === 'Escape') {

                event.preventDefault();

                fechar(null);
            }
        }

        document.addEventListener(
                'keydown',
                eventoTeclado
                );

        // ----------------------------------------------------
        // MONTA A JANELA
        // ----------------------------------------------------
        botoes.appendChild(
                btnCancelar
                );

        botoes.appendChild(
                btnConfirmar
                );

        card.appendChild(
                titulo
                );

        card.appendChild(
                texto
                );

        card.appendChild(
                input
                );

        card.appendChild(
                erro
                );

        card.appendChild(
                botoes
                );

        overlay.appendChild(
                card
                );

        document.body.appendChild(
                overlay
                );

        // ----------------------------------------------------
        // FOCO AUTOMÁTICO
        // ----------------------------------------------------
        setTimeout(
                function () {
                    input.focus();
                },
                50
                );
    });
}