// public/js/relatorio.js

const urlParams = new URLSearchParams(window.location.search);
const reportId = urlParams.get('id');
const reportType = urlParams.get('type') || 'avaria';

function toLocalYYYYMMDD(date) {
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function hoursToHHmm(decimalHours) {
    if (decimalHours === null || decimalHours === undefined || decimalHours === '') return '-';
    const totalMins = Math.round(parseFloat(decimalHours) * 60);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}


async function loadReport() {
    const container = document.getElementById('report-content');
    if (!reportId) {
        container.innerHTML = '<div class="loader">Erro: ID da intervenção não fornecido na URL.</div>';
        return;
    }

    try {
        const token = localStorage.getItem('maclau_token');
        if (!token) {
            container.innerHTML = '<div class="loader">Erro: Sessão expirada ou não autenticado. Por favor, faça login novamente.</div>';
            return;
        }

        const endpoint = reportType === 'servico' ? `/api/servicos/${reportId}/detalhes-relatorio` : (reportType === 'manutencao' ? `/api/manutencoes/${reportId}/detalhes-relatorio` : `/api/avarias/${reportId}/detalhes-relatorio`);
        const res = await fetch(endpoint, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            let serverError = "";
            try {
                const errorData = await res.json();
                serverError = errorData.error || errorData.message || "";
            } catch (e) { }

            const errorMsg = serverError || (res.status === 404 ? "Intervenção não encontrada." : `Erro ${res.status}: Problema no servidor.`);
            throw new Error(errorMsg);
        }

        const data = await res.json();
        renderReport(data);
    } catch (err) {
        console.error("Erro no Relatório:", err);
        container.innerHTML = `
            <div style="text-align:center; padding: 50px; color: #ef4444;">
                <i class="ph ph-warning-circle" style="font-size: 48px;"></i>
                <p style="margin-top:15px; font-weight:600;">Ocorreu um erro</p>
                <p style="font-size:14px; opacity:0.8;">${err.message}</p>
            </div>
        `;
    }
}

function renderReport(data) {
    const dateObj = new Date(data.data_hora_fim || data.data_hora);
    const dateStr = dateObj.toLocaleDateString('pt-PT');

    let interventionInfo = '';
    if (reportType === 'avaria') {
        interventionInfo = `
            <p><strong>Máquina:</strong> ${data.maquina_nome}</p>
            <p><strong>Nº de Série:</strong> ${data.maquina_serie || '---'}</p>
            <p><strong>Tipo:</strong> ${data.tipo_avaria === 1 ? 'Elétrica' : (data.tipo_avaria === 3 ? 'Mecânica' : 'Outra')}</p>
        `;
    } else if (reportType === 'manutencao') {
        interventionInfo = `
            <p><strong>Tipo:</strong> Manutenção Preventiva/Geral</p>
            <p><strong>Parque de Máquinas:</strong> ${data.maquinas && data.maquinas.length > 0 ? 'Parcial' : 'Completo'}</p>
        `;
    } else {
        interventionInfo = `
            <p><strong>Serviço:</strong> ${data.tipo_servico}</p>
            <p><strong>Transporte:</strong> ${data.tipo_camiao}</p>
            ${data.maquinas && data.maquinas.length > 0 ? `<p><strong>Máquinas Associadas:</strong> ${data.maquinas.length}</p>` : ''}
        `;
    }

    const html = `
        <header>
            <div class="logo-section" style="max-width: 480px; text-align: left; display: flex; align-items: center; gap: 15px;">
                <img src="/img/logo.png" alt="Maclau Logo" style="width: 80px; height: auto; flex-shrink: 0; margin: 0;">
                <div>
                    <p style="font-size: 11px; line-height: 1.3; font-weight: 700; color: #1e293b; margin: 0;">MACLAU – Indústria e Comércio de Máquinas Industriais, Unipessoal Lda.</p>
                    <!-- <p style="font-size: 10px; line-height: 1.3; color: #64748b; margin: 0; margin-top: 2px;">Sistema de Gestão da Qualidade – ISO 9001:2015</p> -->
                </div>
            </div>
            <div class="report-meta">
                <h2 style="font-size: 18px;">${data.relatorio_submetido === 1 ? 'Relatório de Intervenção' : '<span style="color: #ca8a04;">Relatório (Rascunho)</span>'}</h2>
                <p>ID: #${data.id.toString().padStart(5, '0')}</p>
                <p>Data: ${dateStr}</p>
            </div>
        </header>


        <div class="section-grid" style="margin-bottom: 20px; gap: 20px;">
            <div class="info-block">
                <h3><i class="ph ph-user"></i> Cliente</h3>
                <p><strong>Nome:</strong> ${data.cliente_nome}</p>
                <p><strong>Email:</strong> ${data.cliente_email || '---'}</p>
                <p><strong>Contacto:</strong> ${data.cliente_contato || '---'}</p>
                <p><strong>NIF:</strong> ${data.cliente_nif || '---'}</p>
            </div>
            <div class="info-block">
                <h3><i class="ph ph-wrench"></i> Intervenção</h3>
                <p><strong>Técnico:</strong> ${data.tecnico_nome}</p>
                ${interventionInfo}
                <p><strong>Horas de Trabalho:</strong> ${hoursToHHmm(data.horas_trabalho)}</p>
                <p><strong>Deslocações:</strong> ${data.deslocacoes !== null && data.deslocacoes !== undefined ? data.deslocacoes : 1}</p>
            </div>
        </div>

        ${data.maquinas && data.maquinas.length > 0 ? `
        <div class="section" style="margin-top: 20px; margin-bottom: 20px;">
            <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--primary-color); display: flex; align-items: center; gap: 8px;">
                <i class="ph-bold ph-washing-machine" style="color: var(--accent);"></i> Máquinas Intervencionadas
            </h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px;">
                ${data.maquinas.map(m => `
                    <div style="font-size: 12px; background: #f8fafc; padding: 10px 14px; border-radius: 10px; border: 1px solid #e2e8f0; display: flex; align-items: center; gap: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
                        <i class="ph-fill ph-check-circle" style="color: #10b981; font-size: 16px;"></i>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span style="font-weight: 700; color: #1e293b; font-size: 13px;">${m.marca} ${m.modelo}</span>
                            <span style="color: #64748b; font-family: 'Inter', monospace; font-size: 11px;"> - SN: ${m.numero_serie || '---'}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        ${data.notas ? `
        <div class="content-section" style="margin-bottom: 30px;">
            <h3><i class="ph ph-warning-circle"></i> Notas de Reporte (Admin)</h3>
            <div class="content-box" style="min-height: 50px;">${data.notas}</div>
        </div>
        ` : ''}

        <div class="content-section" style="margin-bottom: 30px;">
            <h3><i class="ph ph-clipboard-text"></i> Descrição da Intervenção</h3>
            <div class="content-box" style="min-height: 80px;">${data.relatorio || 'Nenhuma descrição detalhada fornecida.'}</div>
        </div>

        ${(data.pecas_substituidas || (data.preparativos && data.preparativos.length > 0)) ? `
        <div class="section">
            <h3><i class="ph ph-package"></i> Peças / Consumíveis</h3>
            ${data.preparativos && data.preparativos.length > 0 ? `
            <div style="margin-bottom: 15px;">
                <h4 style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Peças do Stock Utilizadas:</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; margin-bottom: 15px;">
                    <thead>
                        <tr style="border-bottom: 2px solid #e2e8f0; color: #64748b;">
                            <th style="padding: 6px 12px; font-weight: 600;">Produto</th>
                            <th style="padding: 6px 12px; font-weight: 600; text-align: right;">Quantidade Utilizada</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.preparativos.map(p => {
                            const usedVal = Number(Number(p.quantidade_usada).toFixed(2).replace(/\.00$/, ''));
                            return `
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 8px 12px; font-weight: 500;">${p.nome_produto}</td>
                                <td style="padding: 8px 12px; text-align: right; font-weight: 700;">${usedVal} ${p.unidade || 'un'}</td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            ` : ''}
            ${data.pecas_substituidas ? `
            <div>
                ${data.preparativos && data.preparativos.length > 0 ? `<h4 style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">Outras Peças/Descrição:</h4>` : ''}
                <div style="white-space: pre-wrap; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 14px; line-height: 1.6;">${data.pecas_substituidas}</div>
            </div>
            ` : ''}
        </div>
        ` : ''}


        ${data.fotos && data.fotos.length > 0 ? `
        <div style="page-break-before: always; padding-top: 20px;">
            <div class="header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--primary); padding-bottom: 20px; margin-bottom: 30px;">
                <div class="logo-section" style="max-width: 480px; text-align: left; display: flex; align-items: center; gap: 15px;">
                    <img src="/img/logo.png" alt="Maclau Logo" style="width: 80px; height: auto; flex-shrink: 0; margin: 0;">
                    <div>
                        <p style="font-size: 11px; line-height: 1.3; font-weight: 700; color: #1e293b; margin: 0;">MACLAU – Indústria e Comércio de Máquinas Industriais, Unipessoal Lda.</p>
                        <!-- <p style="font-size: 10px; line-height: 1.3; color: #64748b; margin: 0; margin-top: 2px;">Sistema de Gestão da Qualidade – ISO 9001:2015</p> -->
                    </div>
                </div>
                <div class="report-meta" style="text-align: right;">
                    <h2 style="font-size: 18px;">Fotos da Intervenção</h2>
                    <p>ID: #${data.id.toString().padStart(5, '0')}</p>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                ${data.fotos.map(f => `
                    <div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: white; break-inside: avoid; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        <img src="${f.caminho}?token=${localStorage.getItem('maclau_token')}&v=${Date.now()}" style="width: 100%; height: 350px; object-fit: cover; display: block;">
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <footer style="margin-top: 50px;">
            <div class="signature-block">
                ${data.assinatura_tecnico 
                    ? `<img src="${data.assinatura_tecnico}" alt="Assinatura do Técnico" style="display:block; margin:0 auto; max-width:200px; max-height:80px;">` 
                    : `<div style="height:50px;"></div>`}
                <div class="signature-line"${data.assinatura_tecnico ? ' style="margin-top:5px; border-top-color:#94a3b8;"' : ''}>Técnico Responsável</div>
            </div>
            <div class="signature-block">
                ${data.assinatura_cliente 
                    ? `<img src="${data.assinatura_cliente}" alt="Assinatura do Cliente" style="display:block; margin:0 auto; max-width:200px; max-height:80px;">` 
                    : `<div style="height:50px;"></div>`}
                <div class="signature-line"${data.assinatura_cliente ? ' style="margin-top:5px; border-top-color:#94a3b8;"' : ''}>Assinatura do Cliente</div>
            </div>
        </footer>
    `;

    document.getElementById('report-content').innerHTML = html;
}

window.onload = () => {
    loadReport();

    document.getElementById('btn-print').addEventListener('click', () => window.print());
    document.getElementById('btn-close').addEventListener('click', () => {
        if (window.parent && window.parent !== window) {
            try {
                // Tentar encontrar o modal no documento pai
                const modal = window.parent.document.getElementById('modal-relatorio');
                if (modal) {
                    modal.classList.add('hidden');
                    // Opcional: Limpar o src do iframe no pai para libertar memória
                    const iframe = window.parent.document.getElementById('pdf-iframe');
                    if (iframe) iframe.src = '';
                    return;
                }
            } catch (e) {
                console.error("Erro ao fechar modal pai via iframe:", e);
            }
        }
        // Fallback para fechar janela se não estiver em iframe ou se falhar
        window.close();
    });
};
