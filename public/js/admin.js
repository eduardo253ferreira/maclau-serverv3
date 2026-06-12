// public/js/admin.js

const API_BASE = '/api';
let jwtToken = localStorage.getItem('maclau_token');
let currentActiveView = 'dashboard';
let currentMainDashboard = 'todas'; // 'todas', 'avarias', 'servicos' ou 'manutencoes'
let refreshIntervalId = null;
let lastRefreshTime = new Date();
let calendar = null;
let histCurrentPage = 1;
const histItemsPerPage = 10;
let currentFaturacaoRef = null; // Armazena { selectElement, object, oldVal }
let cachedClientes = [];

// Funções Utilitárias
function showNotification(msg, isError = false) {
    const notif = document.getElementById('notification');
    if (!notif) {
        console.error("Notification element not found:", msg);
        if (isError) alert(msg);
        return;
    }
    notif.textContent = msg;
    notif.className = `notification ${isError ? 'error' : ''}`;
    notif.classList.remove('hidden');
    setTimeout(() => notif.classList.add('hidden'), 3000);
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

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



function escapeHTML(str) {
    if (!str) return '';
    const p = document.createElement('p');
    p.textContent = str;
    return p.innerHTML;
}

function updateRefreshStatus() {
    const statusEl = document.getElementById('refresh-status');
    if (!statusEl) return;

    lastRefreshTime = new Date();
    const timeStr = lastRefreshTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    statusEl.innerHTML = `
        <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%;"></span>
        Sincronizado às ${timeStr}
    `;
}

function refreshActiveDashboard() {
    // Agora fazemos refresh sempre que solicitado, mesmo em background,
    // para garantir que os dados estão prontos quando o utilizador mudar de vista.

    if (currentMainDashboard === 'avarias') loadAvarias();
    else if (currentMainDashboard === 'servicos') loadServicos();
    else if (currentMainDashboard === 'manutencoes') loadManutencoes();
    else if (currentMainDashboard === 'todas') loadTodas();

    updateRefreshStatus();
}

function startAutoRefresh() {
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    refreshIntervalId = setInterval(() => {
        // Não fazer refresh se houver modais abertos
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        if (openModals.length > 0) return;

        if (currentActiveView === 'dashboard') {
            refreshActiveDashboard();
        } else if (currentActiveView === 'agendamentos') {
            loadAgendamentos();
        }
    }, 10000); // 10 segundos
}

// --- Funções de Gestão (Globais para onclick) ---
async function arquivarAvaria(id, event) {
    console.log("arquivarAvaria triggered for ID:", id);
    if (event) event.stopPropagation();
    if (!confirm('Deseja limpar esta avaria resolvida do dashboard? Ela continuará registada na base de dados.')) return;
    try {
        await apiFetch(`/avarias/${id}/arquivar`, { method: 'PUT' });
        refreshActiveDashboard();
    } catch (e) { showNotification(e.message, true); }
}

async function deleteCliente(id) {
    console.log("deleteCliente triggered for ID:", id);
    if (!confirm('Tem a certeza que deseja remover este cliente?')) return;
    try {
        await apiFetch(`/clientes/${id}`, { method: 'DELETE' });
        showNotification('Cliente removido.');
        loadClientes();
    } catch (e) { showNotification(e.message, true); }
}

async function deleteMaquina(id) {
    console.log("deleteMaquina triggered for ID:", id);
    if (!confirm('Tem a certeza que deseja remover esta máquina?')) return;
    try {
        await apiFetch(`/maquinas/${id}`, { method: 'DELETE' });
        showNotification('Máquina removida.');
        loadMaquinas();
    } catch (e) { showNotification(e.message, true); }
}

async function deleteTecnico(id) {
    console.log("deleteTecnico triggered for ID:", id);
    if (!confirm('Tem a certeza que deseja remover este técnico?')) return;
    try {
        await apiFetch(`/tecnicos/${id}`, { method: 'DELETE' });
        showNotification('Técnico removido.');
        loadTecnicos();
    } catch (e) { showNotification(e.message, true); }
}

async function deleteAdministrador(id) {
    if (!confirm('Tem a certeza que deseja remover este administrador?')) return;
    try {
        await apiFetch(`/administradores/${id}`, { method: 'DELETE' });
        showNotification('Administrador removido com sucesso.');
        loadAdministradores();
    } catch (e) {
        showNotification(e.message, true);
    }
}

async function loadAdministradores() {
    try {
        const admins = await apiFetch('/administradores');
        const tbody = document.getElementById('table-administradores-body');
        tbody.innerHTML = '';

        admins.forEach(a => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-id"></td>
                <td class="col-username" style="font-weight: 600;"></td>
                <td class="col-email"></td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-edit" title="Editar">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon delete btn-delete" title="Apagar">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tr.querySelector('.col-id').textContent = a.id;
            tr.querySelector('.col-username').textContent = a.username;
            tr.querySelector('.col-email').textContent = a.email || '-';

            tr.querySelector('.btn-edit').onclick = () => openEditAdministradorModal(a);
            tr.querySelector('.btn-delete').onclick = () => deleteAdministrador(a.id);

            tbody.appendChild(tr);
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

function openEditAdministradorModal(admin) {
    document.getElementById('edit-admin-id').value = admin.id;
    document.getElementById('edit-admin-username').value = admin.username;
    document.getElementById('edit-admin-email').value = admin.email || '';
    document.getElementById('edit-admin-password').value = '';
    document.getElementById('edit-admin-password-confirm').value = '';
    openModal('modal-edit-administrador');
}


// Autenticação inicial
async function ensureAuth() {
    if (!jwtToken) {
        window.location.href = 'index.html?expired=1';
    } else {
        const role = localStorage.getItem('maclau_role');
        if (role !== 'admin') {
            alert('Acesso restrito a administradores.');
            localStorage.removeItem('maclau_token');
            localStorage.removeItem('maclau_role');
            window.location.href = 'index.html?expired=1';
        }
    }
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { console.error("Erro ao limpar sessão no servidor", e); }

    localStorage.removeItem('maclau_token');
    localStorage.removeItem('maclau_role');
    window.location.href = 'index.html';
}

// Fetch helper with auth
async function apiFetch(endpoint, options = {}) {
    if (!options.headers) options.headers = {};
    if (jwtToken) options.headers['Authorization'] = `Bearer ${jwtToken}`;

    const res = await fetch(`${API_BASE}${endpoint}`, options);
    // Se o token expirar, limpa e força reload
    if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('maclau_token');
        jwtToken = null;
        await ensureAuth();
        return apiFetch(endpoint, options); // tenta de novo
    }

    if (!res.ok) {
        let errStr = "Erro no servidor";
        try { const d = await res.json(); errStr = d.error || errStr; } catch (e) { }
        throw new Error(errStr);
    }
    return res.json();
}

// Fechar modal de detalhes
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btn-fechar-detalhe') {
        closeModal('modal-detalhe-agendamento');
    }
});

// --- Helper para sincronizar os grupos de submenus ---
function updateSidebarGroups() {
    document.querySelectorAll('.nav-group').forEach(group => {
        const hasActive = group.querySelector('.nav-btn.active') !== null;
        if (hasActive) {
            group.classList.add('open', 'has-active');
        } else {
            group.classList.remove('has-active');
        }
    });
}

// --- Navegação ---
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.currentTarget.getAttribute('data-target');
        if (!target) return;

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        // Atualizar estados dos grupos do menu lateral
        updateSidebarGroups();

        currentActiveView = target;
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        const viewEl = document.getElementById(`view-${target}`);
        if (viewEl) viewEl.classList.remove('hidden');

        if (target === 'dashboard') {
            if (currentMainDashboard === 'avarias') loadAvarias();
            else if (currentMainDashboard === 'servicos') loadServicos();
            else if (currentMainDashboard === 'manutencoes') loadManutencoes();
            else if (currentMainDashboard === 'todas') loadTodas();
            updateRefreshStatus();
            startAutoRefresh();
        } else {
            if (refreshIntervalId) clearInterval(refreshIntervalId);
        }

        if (target === 'historico') {
            loadHistoricoMaquinas();
            loadHistorico();

            // Adicionar listeners para filtros se ainda não tiverem
            const filterIds = ['hist-cliente', 'hist-tipo', 'hist-maquina', 'hist-tecnico', 'hist-faturacao', 'hist-date-start', 'hist-date-end'];
            filterIds.forEach(id => {
                const el = document.getElementById(id);
                if (el && !el.dataset.listenerAdded) {
                    el.addEventListener('change', () => {
                        if (id === 'hist-cliente') loadHistoricoMaquinas();
                        loadHistorico();
                    });
                    el.dataset.listenerAdded = 'true';
                }
            });
        }
        if (target === 'estatisticas') loadEstatisticas();
        if (target === 'clientes') loadClientes();
        if (target === 'manutencoes-recorrentes') loadRecorrentes();
        if (target === 'maquinas') loadMaquinas();
        if (target === 'tecnicos') loadTecnicos();
        if (target === 'administradores') loadAdministradores();
        if (target === 'frota') loadFrota();
        if (target === 'stock') loadStock();
        if (target === 'stock-maquinas') loadStockMaquinas();
        if (target === 'fornecedores') loadSuppliers();
        if (target === 'historico-stock') loadHistoricoStock();
        if (target === 'checklists') { loadChecklistModelos(); loadChecklists(); }
        if (target === 'agendamentos') initCalendar();
        if (target === 'anotacoes') {
            loadAnotacoes();
            const filterCli = document.getElementById('filter-anotacoes-cliente');
            if (filterCli && !filterCli.dataset.listenerAdded) {
                filterCli.addEventListener('change', loadAnotacoes);
                filterCli.dataset.listenerAdded = 'true';
            }
        }
    });
});

// Registrar evento de toggle nos cabeçalhos de grupos
document.querySelectorAll('.nav-group-title').forEach(title => {
    title.addEventListener('click', (e) => {
        const group = e.currentTarget.parentElement;
        group.classList.toggle('open');
    });
});

// Inicializar estado dos grupos no arranque
updateSidebarGroups();

// Filtro de Pesquisa na Gestão de Clientes
const searchClientInput = document.getElementById('search-client');
if (searchClientInput) {
    searchClientInput.addEventListener('input', () => {
        loadClientes(false);
    });
}

// Filtro de Pesquisa nas Manutenções Recorrentes
const searchRecorrenteInput = document.getElementById('search-recorrente');
if (searchRecorrenteInput) {
    searchRecorrenteInput.addEventListener('input', () => {
        loadRecorrentes(false);
    });
}

// Dashboard Toggle Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.toggle-btn-main').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filter = e.currentTarget.getAttribute('data-main-filter');
            if (!filter) return;

            document.querySelectorAll('.toggle-btn-main').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentMainDashboard = filter;

            if (filter === 'avarias') {
                document.getElementById('wrapper-board-avarias').classList.remove('hidden');
                document.getElementById('wrapper-board-servicos').classList.add('hidden');
                document.getElementById('wrapper-board-manutencoes').classList.add('hidden');
                document.getElementById('wrapper-board-todas').classList.add('hidden');
                loadAvarias();
            } else if (filter === 'servicos') {
                document.getElementById('wrapper-board-avarias').classList.add('hidden');
                document.getElementById('wrapper-board-servicos').classList.remove('hidden');
                document.getElementById('wrapper-board-manutencoes').classList.add('hidden');
                document.getElementById('wrapper-board-todas').classList.add('hidden');
                loadServicos();
            } else if (filter === 'manutencoes') {
                document.getElementById('wrapper-board-avarias').classList.add('hidden');
                document.getElementById('wrapper-board-servicos').classList.add('hidden');
                document.getElementById('wrapper-board-manutencoes').classList.remove('hidden');
                document.getElementById('wrapper-board-todas').classList.add('hidden');
                loadManutencoes();
            } else if (filter === 'todas') {
                document.getElementById('wrapper-board-avarias').classList.add('hidden');
                document.getElementById('wrapper-board-servicos').classList.add('hidden');
                document.getElementById('wrapper-board-manutencoes').classList.add('hidden');
                document.getElementById('wrapper-board-todas').classList.remove('hidden');
                loadTodas();
            }
            updateRefreshStatus();
        });
    });

    // Toggle de visibilidade para manutenção automática (Manutenções Recorrentes)
    const recMntCheck = document.getElementById('recorrente-manutencao-automatica');
    if (recMntCheck) {
        recMntCheck.addEventListener('change', (e) => {
            document.getElementById('recorrente-periodo-wrapper').style.display = e.target.checked ? 'block' : 'none';
            const dateInput = document.getElementById('recorrente-manutencao-data-inicio');
            if (e.target.checked && !dateInput.value) {
                dateInput.value = new Date().toISOString().split('T')[0];
            }
        });
    }
});

// --- Agendamentos (Calendário) ---
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    if (calendar) {
        calendar.render();
        calendar.updateSize();
        loadAgendamentos();
        return;
    }

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth',
        locale: 'pt',
        headerToolbar: window.innerWidth < 768 ? {
            left: 'prev,next',
            center: 'title',
            right: 'dayGridMonth,listWeek'
        } : {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,listWeek'
        },
        buttonText: {
            today: 'Hoje',
            month: 'Mês',
            list: 'Lista'
        },
        eventMouseEnter: function (info) {
            const ev = info.event.extendedProps;
            const tooltip = document.getElementById('calendar-tooltip');
            if (!tooltip) return;

            const content = `
                <strong>${ev.rawTitle || info.event.title}</strong>
                <span>Cliente: ${ev.cliente_nome || 'N/A'}</span><br>
                <span>Técnico: ${ev.tecnico_nome || 'N/A'}</span><br>
                <span>Estado: ${ev.estado || 'pendente'}</span>
            `;

            tooltip.innerHTML = content;
            tooltip.style.display = 'block';
            tooltip.style.left = (info.jsEvent.pageX + 10) + 'px';
            tooltip.style.top = (info.jsEvent.pageY + 10) + 'px';
        },
        eventMouseLeave: function () {
            const tooltip = document.getElementById('calendar-tooltip');
            if (tooltip) tooltip.style.display = 'none';
        },
        eventMouseMove: function (info) {
            const tooltip = document.getElementById('calendar-tooltip');
            if (tooltip && tooltip.style.display === 'block') {
                tooltip.style.left = (info.jsEvent.pageX + 10) + 'px';
                tooltip.style.top = (info.jsEvent.pageY + 10) + 'px';
            }
        },
        eventClick: function (info) {
            const ev = info.event.extendedProps;
            const title = info.event.title;
            const dateStr = info.event.start.toLocaleString('pt-PT', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            // Preencher modal
            console.log("Detalhes do evento carregado:", ev);
            document.getElementById('detalhe-title').textContent = ev.rawTitle || 'Sem Título';
            document.getElementById('detalhe-cliente').textContent = ev.cliente_nome || 'Sem Cliente';
            document.getElementById('detalhe-tecnico').textContent = ev.tecnico_nome || 'Não atribuído';
            document.getElementById('detalhe-data').textContent = dateStr;
            document.getElementById('detalhe-estado').textContent = ev.estado || 'pendente';

            const notasBox = document.getElementById('detalhe-notas');
            if (ev.notas && ev.notas.trim() !== "") {
                notasBox.textContent = ev.notas;
                notasBox.style.color = "var(--text-main)";
                notasBox.style.fontStyle = "normal";
            } else {
                notasBox.textContent = "Nenhuma nota adicional registada.";
                notasBox.style.color = "var(--text-secondary)";
                notasBox.style.fontStyle = "italic";
            }

            const badge = document.getElementById('detalhe-badge');
            if (ev.type === 'avaria') {
                badge.textContent = 'Avaria';
                badge.style.background = '#fee2e2';
                badge.style.color = '#ef4444';
            } else if (ev.type === 'servico') {
                badge.textContent = 'Serviço';
                badge.style.background = '#dbeafe';
                badge.style.color = '#3b82f6';
            } else {
                badge.textContent = 'Manutenção';
                badge.style.background = '#f3e8ff';
                badge.style.color = '#7c3aed';
            }

            // Armazenar dados no botão Editar
            const btnEdit = document.getElementById('btn-edit-agendamento');
            if (btnEdit) {
                // info.event.id vem como 'avaria-12', 'servico-34' ou 'manutencao-56'
                const idNum = info.event.id.split('-')[1];
                btnEdit.dataset.id = idNum;
                btnEdit.dataset.type = ev.type;
                btnEdit.dataset.date = info.event.startStr ? info.event.startStr.slice(0, 16) : '';
                btnEdit.dataset.notas = ev.notas || '';
                btnEdit.dataset.tecnico_id = ev.tecnico_id || '';
            }

            openModal('modal-detalhe-agendamento');
        },
        dateClick: function (info) {
            const selectedDate = new Date(info.dateStr + "T09:00");
            const now = new Date();

            // Restrição: Não permitir agendamentos no passado
            if (selectedDate < now && info.dateStr !== now.toISOString().split('T')[0]) {
                showNotification('Não pode agendar intervenções para datas passadas.', true);
                return;
            }

            // Abrir modal de escolha
            document.getElementById('escolha-data-label').textContent = `Data Selecionada: ${info.dateStr}`;
            const choiceAvaria = document.getElementById('choice-avaria');
            const choiceServico = document.getElementById('choice-servico');
            const choiceManutencao = document.getElementById('choice-manutencao');

            choiceAvaria.onclick = () => {
                document.getElementById('report-avaria-agendada').value = info.dateStr + "T09:00";
                loadClientes();
                loadTecnicos();
                closeModal('modal-escolha-agendamento');
                openModal('modal-report-avaria');
            };

            choiceServico.onclick = () => {
                document.getElementById('report-servico-agendada').value = info.dateStr + "T09:00";
                loadClientes();
                loadTecnicos();
                closeModal('modal-escolha-agendamento');
                openModal('modal-report-servico');
            };

            choiceManutencao.onclick = () => {
                document.getElementById('report-manutencao-agendada').value = info.dateStr + "T09:00";
                loadClientes();
                loadTecnicos();
                closeModal('modal-escolha-agendamento');
                openModal('modal-report-manutencao');
            };

            openModal('modal-escolha-agendamento');
        }
    });

    calendar.render();
    loadAgendamentos();
}

async function loadAgendamentos() {
    try {
        const agendamentos = await apiFetch('/agendamentos');
        const events = agendamentos.map(a => {
            const date = new Date(a.data_agendada);
            const hourStr = date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
            const prefix = a.type === 'avaria' ? 'A' : (a.type === 'servico' ? 'S' : 'M');

            let backgroundColor = '#3b82f6';
            let borderColor = '#1d4ed8';
            if (a.type === 'avaria') {
                backgroundColor = '#ef4444';
                borderColor = '#b91c1c';
            } else if (a.type === 'manutencao') {
                backgroundColor = '#7c3aed';
                borderColor = '#6d28d9';
            }

            return {
                id: `${a.type}-${a.id}`,
                title: `${prefix} ${hourStr} - ${a.cliente_nome || 'Sem Cliente'}`,
                start: a.data_agendada,
                backgroundColor: backgroundColor,
                borderColor: borderColor,
                extendedProps: {
                    type: a.type,
                    rawTitle: a.title,
                    cliente_nome: a.cliente_nome,
                    tecnico_nome: a.tecnico_nome,
                    tecnico_id: a.tecnico_id,
                    estado: a.estado,
                    notas: a.notas
                }
            };
        });
        calendar.removeAllEvents();
        calendar.addEventSource(events);
    } catch (e) {
        showNotification(e.message, true);
    }
}

// --- Modals ---
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    if (id === 'modal-report-avaria') resetReportModal('avaria');
    if (id === 'modal-report-servico') resetReportModal('servico');
    if (id === 'modal-report-manutencao') resetReportModal('manutencao');
}

function formatDatetimeLocal(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch(e) {
        return '';
    }
}

function resetReportModal(type) {
    if (type === 'avaria') {
        const form = document.getElementById('form-report-avaria');
        if (form) form.reset();
        const editId = document.getElementById('edit-avaria-id');
        if (editId) editId.value = '';
        const modal = document.getElementById('modal-report-avaria');
        if (modal) {
            const h2 = modal.querySelector('h2');
            if (h2) h2.textContent = 'Reportar Avaria';
            const btn = modal.querySelector('button[type="submit"]');
            if (btn) btn.textContent = 'Criar Reporte';
        }
        const selectMaquina = document.getElementById('report-avaria-maquina');
        if (selectMaquina) {
            selectMaquina.innerHTML = '<option value="">Selecione o Cliente primeiro</option>';
            selectMaquina.disabled = true;
        }
    } else if (type === 'servico') {
        const form = document.getElementById('form-report-servico');
        if (form) form.reset();
        const editId = document.getElementById('edit-servico-id');
        if (editId) editId.value = '';
        const modal = document.getElementById('modal-report-servico');
        if (modal) {
            const h2 = modal.querySelector('h2');
            if (h2) h2.textContent = 'Reportar Serviço';
            const btn = modal.querySelector('button[type="submit"]');
            if (btn) btn.textContent = 'Criar Serviço';
        }
        const customTipoContainer = document.getElementById('report-servico-tipo-outro-container');
        if (customTipoContainer) customTipoContainer.classList.add('hidden');
        const customTipoInput = document.getElementById('report-servico-tipo-outro');
        if (customTipoInput) {
            customTipoInput.required = false;
            customTipoInput.value = '';
        }
        const customCamiaoContainer = document.getElementById('report-servico-camiao-outro-container');
        if (customCamiaoContainer) customCamiaoContainer.classList.add('hidden');
        const customCamiaoInput = document.getElementById('report-servico-camiao-outro');
        if (customCamiaoInput) {
            customCamiaoInput.required = false;
            customCamiaoInput.value = '';
        }
        const mContainer = document.getElementById('report-servico-maquinas-container');
        if (mContainer) mContainer.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center;">Selecione um cliente para carregar as máquinas.</p>';
    } else if (type === 'manutencao') {
        const form = document.getElementById('form-report-manutencao');
        if (form) form.reset();
        const editId = document.getElementById('edit-manutencao-id');
        if (editId) editId.value = '';
        const modal = document.getElementById('modal-report-manutencao');
        if (modal) {
            const h2 = modal.querySelector('h2');
            if (h2) h2.textContent = 'Reportar Manutenção';
            const btn = modal.querySelector('button[type="submit"]');
            if (btn) btn.textContent = 'Criar Manutenção';
        }
        const mContainer = document.getElementById('report-manutencao-maquinas-container');
        if (mContainer) mContainer.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center;">Selecione um cliente para carregar as máquinas.</p>';
    }
}

async function openEditAvariaModal(a) {
    try {
        const maquinas = await apiFetch('/maquinas');
        const machine = maquinas.find(m => m.uuid === a.maquina_id);
        if (!machine) {
            showNotification('Máquina não encontrada para esta avaria.', true);
            return;
        }

        const clienteId = machine.cliente_id;
        
        document.getElementById('edit-avaria-id').value = a.id;
        
        const modal = document.getElementById('modal-report-avaria');
        if (modal) {
            const h2 = modal.querySelector('h2');
            if (h2) h2.textContent = 'Editar Avaria';
            const btn = modal.querySelector('button[type="submit"]');
            if (btn) btn.textContent = 'Guardar Alterações';
        }

        const selectCliente = document.getElementById('report-avaria-cliente');
        selectCliente.value = clienteId;
        
        const selectMaquina = document.getElementById('report-avaria-maquina');
        selectMaquina.innerHTML = '<option value="">Carregando máquinas...</option>';
        selectMaquina.disabled = true;

        const filtradas = maquinas.filter(m => m.cliente_id == clienteId);
        selectMaquina.innerHTML = '<option value="">Selecione a Máquina</option>';
        filtradas.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.uuid;
            opt.textContent = `${m.marca} - ${m.modelo} (${m.numero_serie || 'S/N'})`;
            selectMaquina.appendChild(opt);
        });
        selectMaquina.disabled = false;
        selectMaquina.value = a.maquina_id;

        document.getElementById('report-avaria-tipo').value = a.tipo_avaria;
        document.getElementById('report-avaria-notas').value = a.notas || '';
        document.getElementById('report-avaria-agendada').value = formatDatetimeLocal(a.data_agendada);

        const techIds = a.tecnico_id ? a.tecnico_id.toString().split(',') : [];
        document.querySelectorAll('input[name="report-avaria-tecnico-ids"]').forEach(cb => {
            cb.checked = techIds.includes(cb.value);
        });

        openModal('modal-report-avaria');
    } catch (e) {
        showNotification(e.message, true);
    }
}

async function openEditServicoModal(s) {
    try {
        document.getElementById('edit-servico-id').value = s.id;

        const modal = document.getElementById('modal-report-servico');
        if (modal) {
            const h2 = modal.querySelector('h2');
            if (h2) h2.textContent = 'Editar Serviço';
            const btn = modal.querySelector('button[type="submit"]');
            if (btn) btn.textContent = 'Guardar Alterações';
        }

        document.getElementById('report-servico-cliente').value = s.cliente_id;
        await loadMachinesForService();

        const details = await apiFetch(`/servicos/${s.id}/detalhes-relatorio`);
        const associatedIds = details.maquinas ? details.maquinas.map(m => m.id) : [];

        document.querySelectorAll('.srv-maquina-checkbox').forEach(cb => {
            cb.checked = associatedIds.includes(parseInt(cb.value));
        });

        const selectTipo = document.getElementById('report-servico-tipo');
        const customTipoContainer = document.getElementById('report-servico-tipo-outro-container');
        const customTipoInput = document.getElementById('report-servico-tipo-outro');
        
        const standardTipos = ['Transporte', 'Instalação', 'Transporte/Instalação'];
        if (standardTipos.includes(s.tipo_servico)) {
            selectTipo.value = s.tipo_servico;
            customTipoContainer.classList.add('hidden');
            customTipoInput.required = false;
            customTipoInput.value = '';
        } else {
            selectTipo.value = 'Outros';
            customTipoContainer.classList.remove('hidden');
            customTipoInput.required = true;
            customTipoInput.value = s.tipo_servico || '';
        }

        const selectCamiao = document.getElementById('report-servico-camiao');
        const customCamiaoContainer = document.getElementById('report-servico-camiao-outro-container');
        const customCamiaoInput = document.getElementById('report-servico-camiao-outro');

        const standardCamioes = ['Camião da Empresa Pessoal', 'Empresa Particular'];
        if (standardCamioes.includes(s.tipo_camiao)) {
            selectCamiao.value = s.tipo_camiao;
            customCamiaoContainer.classList.add('hidden');
            customCamiaoInput.required = false;
            customCamiaoInput.value = '';
        } else {
            selectCamiao.value = 'Outros';
            customCamiaoContainer.classList.remove('hidden');
            customCamiaoInput.required = true;
            customCamiaoInput.value = s.tipo_camiao || '';
        }

        document.getElementById('report-servico-notas').value = s.notes || s.notas || '';
        document.getElementById('report-servico-agendada').value = formatDatetimeLocal(s.data_agendada);

        const techIds = s.tecnico_id ? s.tecnico_id.toString().split(',') : [];
        document.querySelectorAll('input[name="report-servico-tecnico-ids"]').forEach(cb => {
            cb.checked = techIds.includes(cb.value);
        });

        openModal('modal-report-servico');
    } catch (e) {
        showNotification(e.message, true);
    }
}

async function openEditManutencaoModal(m) {
    try {
        document.getElementById('edit-manutencao-id').value = m.id;

        const modal = document.getElementById('modal-report-manutencao');
        if (modal) {
            const h2 = modal.querySelector('h2');
            if (h2) h2.textContent = 'Editar Manutenção';
            const btn = modal.querySelector('button[type="submit"]');
            if (btn) btn.textContent = 'Guardar Alterações';
        }

        document.getElementById('report-manutencao-cliente').value = m.cliente_id;
        await loadMachinesForMaintenance();

        const details = await apiFetch(`/manutencoes/${m.id}/detalhes-relatorio`);
        const associatedIds = details.maquinas ? details.maquinas.map(maq => maq.id) : [];

        document.querySelectorAll('.mnt-maquina-checkbox').forEach(cb => {
            cb.checked = associatedIds.includes(parseInt(cb.value));
        });

        document.getElementById('report-manutencao-notas').value = m.notas || '';
        document.getElementById('report-manutencao-agendada').value = formatDatetimeLocal(m.data_agendada);

        const techIds = m.tecnico_id ? m.tecnico_id.toString().split(',') : [];
        document.querySelectorAll('input[name="report-manutencao-tecnico-ids"]').forEach(cb => {
            cb.checked = techIds.includes(cb.value);
        });

        openModal('modal-report-manutencao');
    } catch (e) {
        showNotification(e.message, true);
    }
}
function openFullNoteModal(note) {
    document.getElementById('full-note-content').textContent = note;
    openModal('modal-view-note');
}

window.openTicketDetailsModal = function (task) {
    const content = document.getElementById('ticket-details-content');
    if (!content) return;

    let typeLabel = '';
    let typeColor = '';
    let icon = '';
    let titleStr = '';
    let subTitleStr = '';

    if (task._type === 'avaria') {
        typeLabel = 'Avaria';
        typeColor = 'var(--accent)';
        icon = 'ph-wrench';
        titleStr = task.maquina_nome || 'Máquina Removida';
        subTitleStr = task.tipo_avaria === 1 ? 'Elétrica' : (task.tipo_avaria === 3 ? 'Mecânica' : 'Outra');
    } else if (task._type === 'servico') {
        typeLabel = 'Serviço';
        typeColor = '#1e3a8a';
        icon = 'ph-truck';
        titleStr = task.tipo_servico || task.title || 'Serviço Externo';
        subTitleStr = `Transporte: ${task.tipo_camiao || '---'}`;
    } else {
        typeLabel = 'Manutenção';
        typeColor = '#7c3aed';
        icon = 'ph-washing-machine';
        titleStr = task.cliente_nome || task.title;
        subTitleStr = 'Manutenção Geral';
    }

    const statusMap = {
        'pendente': { label: 'Aguardando Início', color: 'var(--danger)' },
        'em resolução': { label: 'Em Resolução', color: 'var(--warning)' },
        'pausada': { label: 'Pausada', color: '#ca8a04' },
        'resolvida': { label: 'Resolvida', color: '#10b981' }
    };

    const status = statusMap[task.estado] || { label: task.estado ? task.estado.toUpperCase() : 'AGENDADO', color: 'var(--text-secondary)' };

    content.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:15px;">
            <div style="background:${typeColor}; color:white; width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:24px;">
                <i class="ph-bold ${icon}"></i>
            </div>
            <div>
                <h2 style="margin:0; font-size:18px;">Detalhes do Ticket #${task.id ? task.id.toString().padStart(5, '0') : '---'}</h2>
                <span style="font-size:12px; font-weight:700; color:${typeColor}; text-transform:uppercase;">${typeLabel}</span>
            </div>
            <div style="margin-left:auto; text-align:right;">
                <span style="display:inline-block; padding:4px 10px; border-radius:6px; background:${status.color}15; color:${status.color}; font-size:12px; font-weight:700;">${status.label}</span>
            </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
            <div>
                <h3 style="font-size:13px; color:var(--text-secondary); margin-bottom:8px; display:flex; align-items:center; gap:6px;"><i class="ph ph-user"></i> Cliente</h3>
                <p style="margin:0; font-weight:600; font-size:15px;">${escapeHTML(task.cliente_nome)}</p>
                ${task.cliente_morada ? `<p style="margin:4px 0 0 0; font-size:13px; color:var(--accent);"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.cliente_morada)}" target="_blank" style="text-decoration:none; color:inherit;"><i class="ph ph-map-pin"></i> ${escapeHTML(task.cliente_morada)}</a></p>` : ''}
            </div>
            <div>
                <h3 style="font-size:13px; color:var(--text-secondary); margin-bottom:8px; display:flex; align-items:center; gap:6px;"><i class="ph ph-calendar"></i> Datas</h3>
                ${task.data_hora ? `<p style="margin:0; font-size:13px;"><strong>Reportado:</strong> ${new Date(task.data_hora).toLocaleString('pt-PT')}</p>` : ''}
                ${task.data_agendada ? `<p style="margin:4px 0 0 0; font-size:13px; color:var(--primary-color);"><strong>Agendado:</strong> ${new Date(task.data_agendada).toLocaleString('pt-PT')}</p>` : ''}
            </div>
        </div>

        <div style="background:#f8fafc; padding:15px; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:20px;">
            <h3 style="font-size:13px; color:var(--text-secondary); margin-bottom:8px; display:flex; align-items:center; gap:6px;"><i class="ph ph-info"></i> Informação</h3>
            <p style="margin:0; font-weight:600;">${escapeHTML(titleStr)}</p>
            <p style="margin:4px 0 0 0; font-size:12px; color:var(--text-secondary);">${subTitleStr}</p>
            <p style="margin:8px 0 0 0; font-size:13px; color:var(--accent);"><strong>Técnico Atribuído:</strong> ${escapeHTML(task.tecnico_nome || 'Não Atribuído')}</p>
        </div>

        ${task.notas ? `
        <div style="margin-bottom:20px;">
            <h3 style="font-size:13px; color:var(--text-secondary); margin-bottom:8px; display:flex; align-items:center; gap:6px;"><i class="ph ph-note"></i> Notas do Admin</h3>
            <div style="background:#fffbeb; border-left:4px solid #f59e0b; padding:12px; border-radius:4px; font-size:14px; color:#92400e; line-height:1.5; white-space:pre-wrap;">${escapeHTML(task.notas)}</div>
        </div>
        ` : ''}

        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:25px;">
            ${(task.estado === 'pendente' || task.estado === 'pausada') ? `
                <button class="btn-secondary" id="btn-atribuir-from-modal" style="width:auto; padding:8px 20px;">
                    <i class="ph ph-user-plus"></i> Atribuir Técnico
                </button>
            ` : ''}
            <button class="btn-primary" id="btn-close-ticket-details" style="width:auto; padding:8px 25px;">Fechar</button>
        </div>
    `;

    // Listeners para os botões dentro do modal
    const btnFechar = document.getElementById('btn-close-ticket-details');
    if (btnFechar) {
        btnFechar.onclick = () => closeModal('modal-ticket-details');
    }

    // Listener para o botão de atribuir técnico dentro do modal
    const btnAtribuir = document.getElementById('btn-atribuir-from-modal');
    if (btnAtribuir) {
        btnAtribuir.onclick = () => {
            document.getElementById('atribuir-avaria-id').value = task.id;
            document.getElementById('atribuir-type').value = task._type;
            const techIds = (task.tecnico_id || '').split(',').map(id => id.trim()).filter(Boolean);
            document.querySelectorAll('input[name="atribuir-tecnico-ids"]').forEach(cb => {
                cb.checked = techIds.includes(cb.value);
            });
            closeModal('modal-ticket-details');
            openModal('modal-atribuir-tecnico');
        };
    }

    openModal('modal-ticket-details');
};

// Editar Agendamento Listeners
document.addEventListener('DOMContentLoaded', () => {
    const btnEditAgendamento = document.getElementById('btn-edit-agendamento');
    if (btnEditAgendamento) {
        btnEditAgendamento.addEventListener('click', () => {
            const id = btnEditAgendamento.dataset.id;
            const type = btnEditAgendamento.dataset.type;
            const dateStr = btnEditAgendamento.dataset.date;
            const notas = btnEditAgendamento.dataset.notas;
            const tecnicoId = btnEditAgendamento.dataset.tecnico_id;

            document.getElementById('edit-agendamento-id').value = id;
            document.getElementById('edit-agendamento-type').value = type;
            document.getElementById('edit-agendamento-data').value = dateStr;
            document.getElementById('edit-agendamento-notas').value = notas;

            const techIds = (tecnicoId || '').split(',').map(id => id.trim()).filter(Boolean);
            document.querySelectorAll('input[name="edit-agendamento-tecnico-ids"]').forEach(cb => {
                cb.checked = techIds.includes(cb.value);
            });

            closeModal('modal-detalhe-agendamento');
            openModal('modal-edit-agendamento');
        });
    }

    const formEditAgendamento = document.getElementById('form-edit-agendamento');
    if (formEditAgendamento) {
        formEditAgendamento.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-agendamento-id').value;
            const type = document.getElementById('edit-agendamento-type').value;
            const data_agendada = document.getElementById('edit-agendamento-data').value;
            const notas = document.getElementById('edit-agendamento-notas').value;
            const tecnico_ids = Array.from(document.querySelectorAll('input[name="edit-agendamento-tecnico-ids"]:checked')).map(cb => cb.value);

            try {
                let endpoint;
                if (type === 'avaria') endpoint = `/avarias/${id}/agendamento`;
                else if (type === 'servico') endpoint = `/servicos/${id}/agendamento`;
                else if (type === 'manutencao') endpoint = `/manutencoes/${id}/agendamento`;

                await apiFetch(endpoint, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data_agendada, notas, tecnico_ids })
                });

                showNotification('Agendamento atualizado com sucesso!');
                closeModal('modal-edit-agendamento');
                refreshActiveDashboard();
                loadAgendamentos();

            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }
});

async function deleteTask(type, id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Tem a certeza que deseja APAGAR permanentemente esta tarefa? Esta ação não pode ser revertida.')) return;
    try {
        let endpoint;
        if (type === 'avaria') endpoint = `/avarias/${id}`;
        else if (type === 'servico') endpoint = `/servicos/${id}`;
        else if (type === 'manutencao') endpoint = `/manutencoes/${id}`;

        await apiFetch(endpoint, { method: 'DELETE' });
        showNotification('Tarefa apagada com sucesso!');
        refreshActiveDashboard();
    } catch (e) {
        showNotification(e.message, true);
    }
}


// --- Dashboard (Avarias) ---
async function loadAvarias() {
    try {
        const avarias = await apiFetch('/avarias');
        const colPendente = document.querySelector('#col-pendente .cards-wrapper');
        const colResolucao = document.querySelector('#col-resolucao .cards-wrapper');
        const colResolvida = document.querySelector('#col-resolvida .cards-wrapper');

        colPendente.innerHTML = '';
        colResolucao.innerHTML = '';
        colResolvida.innerHTML = '';

        const dateStart = document.getElementById('filter-date-start').value;
        const dateEnd = document.getElementById('filter-date-end').value;
        const techFilter = document.getElementById('filter-tech-dashboard').value;

        avarias.forEach(a => {
            const card = createAvariaCard(a);
            if (!card) return;

            // Apply Tech Filter
            if (techFilter && a.tecnico_id != techFilter) return;

            if (a.estado === 'pendente' || a.estado === 'pausada') colPendente.appendChild(card);
            else if (a.estado === 'em resolução') colResolucao.appendChild(card);
            else {
                // Resolvidas - Apply Data Range Filter
                let addCard = true;
                const dateRef = toLocalYYYYMMDD(a.data_hora_fim || a.data_hora);
                if (dateStart && dateRef < dateStart) addCard = false;
                if (dateEnd && dateRef > dateEnd) addCard = false;
                if (addCard) colResolvida.appendChild(card);
            }
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

function createAvariaCard(a) {
    const card = document.createElement('div');
    card.className = 'avaria-card';

    // 1: Eletrica, 2: Desconhecida, 3: Mecanica
    let tipoStr = a.tipo_avaria === 1 ? 'ELÉTRICA' : (a.tipo_avaria === 3 ? 'MECÂNICA' : 'DESCONHECIDA');
    let tagHTML = `<div class="card-type">${tipoStr}</div>`;
    if (a.estado === 'pausada') {
        tagHTML += ` <div class="card-type" style="background:#fef08a; color:#854d0e; margin-left:5px;"><i class="ph ph-pause"></i> PAUSADA</div>`;
    }

    card.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;">${tagHTML}</div>
        <h4 class="card-machine-name"></h4>
        <p class="card-client-name"></p>
        <div class="assigned-tech" style="margin-top:10px; font-size:13px; font-weight:600; color:var(--accent);">
            <span style="color:var(--text-secondary); font-weight:400;">Técnico:</span> <span class="card-tech-name"></span>
        </div>
        <div class="date">${new Date(a.data_hora).toLocaleString('pt-PT')}</div>
        ${a.notas ? `<div class="card-notes" title="Clique para ver nota completa"><strong>Notas:</strong><br>${escapeHTML(a.notas)}</div>` : ''}
    `;

    if (a.notas) {
        const notesEl = card.querySelector('.card-notes');
        notesEl.onclick = (e) => {
            e.stopPropagation();
            openFullNoteModal(a.notas);
        };
    }

    card.querySelector('.card-machine-name').textContent = a.maquina_nome || 'Máquina Removida';
    card.querySelector('.card-client-name').textContent = a.cliente_nome || 'Sem Cliente';
    card.querySelector('.card-tech-name').textContent = a.tecnico_nome || 'Não Atribuído';

    if (a.estado === 'resolvida') {
        const btnReport = document.createElement('button');
        btnReport.className = 'btn-archive';
        btnReport.title = 'Ver Relatório';
        btnReport.innerHTML = '<i class="ph ph-file-pdf" style="color: #ef4444;"></i>';
        btnReport.style.right = '45px';
        btnReport.onclick = (e) => {
            e.stopPropagation();
            window.open(`/relatorio.html?id=${a.id}&type=avaria`, '_blank');
        };
        card.appendChild(btnReport);

        const btnArchive = document.createElement('button');
        btnArchive.className = 'btn-archive';
        btnArchive.title = 'Limpar do dashboard';
        btnArchive.innerHTML = '<i class="ph ph-x"></i>';
        btnArchive.onclick = (e) => arquivarAvaria(a.id, e);
        card.appendChild(btnArchive);
    }

    if (a.estado !== 'resolvida') {
        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn-delete-card';
        btnDelete.title = 'Apagar tarefa permanentemente';
        btnDelete.innerHTML = '<i class="ph ph-trash"></i>';
        btnDelete.style.cssText = 'position:absolute; top:10px; right:10px; border:none; background:none; color:#ef4444; cursor:pointer; font-size:18px; padding:5px; transition:all 0.2s;';
        btnDelete.onclick = (e) => deleteTask('avaria', a.id, e);
        card.appendChild(btnDelete);

        if (a.estado === 'pendente') {
            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-edit-card';
            btnEdit.title = 'Editar tarefa';
            btnEdit.innerHTML = '<i class="ph ph-pencil-simple"></i>';
            btnEdit.style.cssText = 'position:absolute; top:10px; right:38px; border:none; background:none; color:var(--primary-color, #3b82f6); cursor:pointer; font-size:18px; padding:5px; transition:all 0.2s;';
            btnEdit.onclick = (e) => {
                e.stopPropagation();
                openEditAvariaModal(a);
            };
            card.appendChild(btnEdit);
        }
    }

    card.onclick = () => openTicketDetailsModal({ ...a, _type: 'avaria' });

    return card;
}

async function loadTodas() {
    try {
        const [avarias, servicos, manutencoes] = await Promise.all([
            apiFetch('/avarias'),
            apiFetch('/servicos'),
            apiFetch('/manutencoes')
        ]);

        const colPendente = document.querySelector('#all-col-pendente .cards-wrapper');
        const colResolucao = document.querySelector('#all-col-resolucao .cards-wrapper');
        const colResolvida = document.querySelector('#all-col-resolvida .cards-wrapper');

        if (!colPendente || !colResolucao || !colResolvida) return;

        colPendente.innerHTML = '';
        colResolucao.innerHTML = '';
        colResolvida.innerHTML = '';

        const dateStart = document.getElementById('filter-all-date-start')?.value;
        const dateEnd = document.getElementById('filter-all-date-end')?.value;
        const techFilter = document.getElementById('filter-tech-dashboard')?.value;

        const allItems = [
            ...avarias.map(a => ({ ...a, _type: 'avaria' })),
            ...servicos.map(s => ({ ...s, _type: 'servico' })),
            ...manutencoes.map(m => ({ ...m, _type: 'manutencao' }))
        ];

        allItems.sort((a, b) => new Date(b.data_hora) - new Date(a.data_hora));

        allItems.forEach(item => {
            if (techFilter && item.tecnico_id != techFilter) return;

            let card;
            if (item._type === 'avaria') card = createAvariaCard(item);
            else if (item._type === 'servico') card = createServicoCard(item);
            else if (item._type === 'manutencao') card = createManutencaoCard(item);

            if (!card) return;

            if (item.estado === 'pendente' || item.estado === 'pausada') {
                colPendente.appendChild(card);
            } else if (item.estado === 'em resolução') {
                colResolucao.appendChild(card);
            } else if (item.estado === 'resolvida') {
                let addCard = true;
                const dateRef = toLocalYYYYMMDD(item.data_hora_fim || item.data_hora);
                if (dateStart && dateRef < dateStart) addCard = false;
                if (dateEnd && dateRef > dateEnd) addCard = false;
                if (addCard) colResolvida.appendChild(card);
            }
        });
    } catch (e) {
        console.error("Error in loadTodas:", e);
    }
}

document.getElementById('form-atribuir-tecnico').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('atribuir-avaria-id').value;
    const type = document.getElementById('atribuir-type').value;
    const tecnico_ids = Array.from(document.querySelectorAll('input[name="atribuir-tecnico-ids"]:checked')).map(cb => cb.value);

    if (tecnico_ids.length === 0) {
        showNotification('Selecione pelo menos um técnico.', true);
        return;
    }

    try {
        let endpoint;
        if (type === 'servico') endpoint = `/servicos/${id}/atribuir`;
        else if (type === 'manutencao') endpoint = `/manutencoes/${id}/atribuir`;
        else endpoint = `/avarias/${id}/atribuir`;

        await apiFetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tecnico_ids })
        });
        showNotification('Técnico(s) atribuído(s) com sucesso!');
        closeModal('modal-atribuir-tecnico');
        refreshActiveDashboard();
    } catch (e) {
        showNotification(e.message, true);
    }
});

document.getElementById('form-status-avaria').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('status-avaria-id').value;
    const estado = document.getElementById('status-avaria-select').value;

    try {
        await apiFetch(`/avarias/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado })
        });
        showNotification('Estado atualizado!');
        closeModal('modal-status-avaria');
        refreshActiveDashboard();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// --- Clientes ---
async function loadClientes(forceFetch = true) {
    try {
        if (forceFetch) {
            cachedClientes = await apiFetch('/clientes');
            
            // Popula Select de Clientes nas Abas: Máquinas e Histórico
            const selects = [
                document.getElementById('maquina-cliente_id'),
                document.getElementById('edit-maquina-cliente_id'),
                document.getElementById('hist-cliente'),
                document.getElementById('filter-cliente-maquinas'),
                document.getElementById('report-avaria-cliente'),
                document.getElementById('report-servico-cliente'),
                document.getElementById('report-manutencao-cliente'),
                document.getElementById('filter-anotacoes-cliente'),
                document.getElementById('filter-hist-stock-client')
            ];

            selects.forEach(select => {
                if (!select) return;
                const currentVal = select.value;
                select.innerHTML = '<option value="">Todos / Selecione o Cliente</option>';
                cachedClientes.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.nome;
                    select.appendChild(opt);
                });
                if (currentVal) select.value = currentVal;
            });
        }

        const query = (document.getElementById('search-client')?.value || '').toLowerCase().trim();
        const filteredClientes = cachedClientes.filter(c => {
            if (!query) return true;
            return (c.id && c.id.toString().includes(query)) ||
                   (c.nome && c.nome.toLowerCase().includes(query)) ||
                   (c.telefone && c.telefone.toLowerCase().includes(query)) ||
                   (c.email && c.email.toLowerCase().includes(query)) ||
                   (c.morada && c.morada.toLowerCase().includes(query)) ||
                   (c.NIF && c.NIF.toString().includes(query));
        });

        const tbody = document.getElementById('table-clientes-body');
        tbody.innerHTML = '';

        // Popula Tabela
        filteredClientes.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-id"></td>
                <td class="col-nome"></td>
                <td class="col-contactos"></td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-info-cliente" title="Ver Info Completa">
                            <i class="ph ph-info"></i>
                        </button>
                        <button class="btn-icon btn-view-maquinas" title="Ver Máquinas do Cliente">
                            <i class="ph ph-washing-machine"></i>
                        </button>
                        <button class="btn-icon btn-client-users" title="Gestão de Logins do Cliente" style="color: var(--accent);">
                            <i class="ph ph-key"></i>
                        </button>
                        <button class="btn-icon btn-edit" title="Editar">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon delete btn-delete" title="Apagar">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tr.querySelector('.col-id').textContent = c.id;
            tr.querySelector('.col-nome').textContent = c.nome;
            tr.querySelector('.col-contactos').innerHTML = `
                <div style="font-size:12px; color:var(--text-secondary); font-weight:500;">${c.telefone || '-'}</div>
                <div style="font-size:11px; color:var(--accent);">${c.email || '-'}</div>
            `;
            
            tr.querySelector('.btn-info-cliente').onclick = () => openViewClienteModal(c);

            tr.querySelector('.btn-view-maquinas').onclick = () => {
                const maquinasTabBtn = document.querySelector('.nav-btn[data-target="maquinas"]');
                if (maquinasTabBtn) maquinasTabBtn.click();
                const filterMaquinas = document.getElementById('filter-cliente-maquinas');
                if (filterMaquinas) {
                    filterMaquinas.value = c.id;
                    loadMaquinas();
                }
            };
            tr.querySelector('.btn-client-users').onclick = () => showClientUsersView(c.id, c.nome);
            tr.querySelector('.btn-edit').onclick = () => openEditClientModal(c);
            tr.querySelector('.btn-delete').onclick = () => deleteCliente(c.id);

            tbody.appendChild(tr);
        });

    } catch (e) {
        showNotification(e.message, true);
    }
}

let currentEditingClient = null;
function openEditClientModal(c) {
    currentEditingClient = c;
    document.getElementById('edit-client-id').value = c.id;
    document.getElementById('edit-client-nome').value = c.nome;
    document.getElementById('edit-client-telefone').value = c.telefone || '';
    document.getElementById('edit-client-email').value = c.email || '';
    document.getElementById('edit-client-morada').value = c.morada || '';
    document.getElementById('edit-client-nif').value = c.NIF || '';

    openModal('modal-edit-client');
}

document.getElementById('form-edit-client').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-client-id').value;
    const nome = document.getElementById('edit-client-nome').value;
    const telefone = document.getElementById('edit-client-telefone').value;
    const email = document.getElementById('edit-client-email').value;
    const morada = document.getElementById('edit-client-morada').value;
    const NIF = document.getElementById('edit-client-nif').value;

    const manutencao_automatica = currentEditingClient ? currentEditingClient.manutencao_automatica : 0;
    const manutencao_periodo = currentEditingClient ? currentEditingClient.manutencao_periodo : null;
    const manutencao_data_inicio = currentEditingClient ? currentEditingClient.manutencao_data_inicio : null;

    try {
        await apiFetch(`/clientes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, telefone, email, morada, NIF, manutencao_automatica, manutencao_periodo, manutencao_data_inicio })
        });
        showNotification('Cliente atualizado com sucesso!');
        closeModal('modal-edit-client');
        loadClientes();
        loadMaquinas(); // Caso o nome do cliente tenha mudado na tabela de máquinas
    } catch (e) {
        showNotification(e.message, true);
    }
});

document.getElementById('form-add-client').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('client-nome').value;
    const telefone = document.getElementById('client-telefone').value;
    const email = document.getElementById('client-email').value;
    const morada = document.getElementById('client-morada').value;
    const NIF = document.getElementById('client-nif').value;

    try {
        await apiFetch('/clientes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, telefone, email, morada, NIF, manutencao_automatica: 0, manutencao_periodo: null, manutencao_data_inicio: null })
        });
        showNotification('Cliente adicionado com sucesso!');
        closeModal('modal-add-client');
        document.getElementById('form-add-client').reset();
        loadClientes();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// --- Máquinas ---
async function loadMaquinas() {
    try {
        const maquinas = await apiFetch('/maquinas');
        const tbody = document.getElementById('table-maquinas-body');
        tbody.innerHTML = '';

        const clienteFilter = document.getElementById('filter-cliente-maquinas')?.value;

        maquinas.forEach(m => {
            if (clienteFilter && m.cliente_id != clienteFilter) return;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-id"></td>
                <td class="col-maquina"></td>
                <td class="col-serie"></td>
                <td class="col-cliente"></td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-info" title="Ver Info">
                            <i class="ph ph-info"></i>
                        </button>
                        <button class="btn-icon btn-components" title="Componentes Máquina">
                            <i class="ph ph-wrench"></i>
                        </button>
                        <button class="btn-icon btn-qr" title="Gerar QR Code">
                            <i class="ph ph-qr-code"></i>
                        </button>
                        <button class="btn-icon btn-edit" title="Editar">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon delete btn-delete" title="Apagar">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            const maquinaNome = (m.marca || '') + ((m.marca && m.modelo) ? ' - ' : '') + (m.modelo || '');
            tr.querySelector('.col-id').textContent = m.id;
            tr.querySelector('.col-maquina').textContent = maquinaNome || '-';
            tr.querySelector('.col-serie').textContent = m.numero_serie || '-';
            tr.querySelector('.col-cliente').textContent = m.cliente_nome || '-';

            tr.querySelector('.btn-info').onclick = () => openViewMaquinaModal(m);
            tr.querySelector('.btn-components').onclick = () => openComponentsModal(m);
            tr.querySelector('.btn-qr').onclick = () => generateQR(m.uuid, m.modelo || '');
            tr.querySelector('.btn-edit').onclick = () => openEditMaquinaModal(m);
            tr.querySelector('.btn-delete').onclick = () => deleteMaquina(m.id);

            tbody.appendChild(tr);
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

function openViewMaquinaModal(m) {
    document.getElementById('view-maquina-cliente').textContent = m.cliente_nome || 'N/A';
    document.getElementById('view-maquina-marca').textContent = m.marca || 'N/A';
    document.getElementById('view-maquina-modelo').textContent = m.modelo || 'N/A';
    document.getElementById('view-maquina-serie').textContent = m.numero_serie || 'N/A';
    document.getElementById('view-maquina-instalacao').textContent = m.data_instalacao || 'N/A';
    document.getElementById('view-maquina-iniciogarantia').textContent = m.data_inicio_garantia || 'N/A';
    document.getElementById('view-maquina-fimgarantia').textContent = m.data_fim_garantia || 'N/A';
    openModal('modal-view-maquina');
}

function openViewClienteModal(c) {
    document.getElementById('view-cliente-nome').textContent = c.nome || 'N/A';
    document.getElementById('view-cliente-morada').textContent = c.morada || 'N/A';
    document.getElementById('view-cliente-nif').textContent = c.NIF || 'N/A';
    document.getElementById('view-cliente-telefone').textContent = c.telefone || 'N/A';
    document.getElementById('view-cliente-email').textContent = c.email || 'N/A';

    const isAuto = c.manutencao_automatica === 1;
    const desc = isAuto
        ? `Sim (${c.manutencao_periodo ? c.manutencao_periodo.charAt(0).toUpperCase() + c.manutencao_periodo.slice(1) : 'Trimestral'}) - Início: ${c.manutencao_data_inicio ? c.manutencao_data_inicio : 'N/A'}`
        : 'Não';
    document.getElementById('view-cliente-manutencao').textContent = desc;

    openModal('modal-view-cliente');
}

function openEditMaquinaModal(m) {
    document.getElementById('edit-maquina-id').value = m.id;
    document.getElementById('edit-maquina-cliente_id').value = m.cliente_id;
    document.getElementById('edit-maquina-marca').value = m.marca || '';
    document.getElementById('edit-maquina-modelo').value = m.modelo || '';
    document.getElementById('edit-maquina-numero-serie').value = m.numero_serie || '';
    document.getElementById('edit-maquina-data-instalacao').value = m.data_instalacao || '';
    document.getElementById('edit-maquina-data-inicio-garantia').value = m.data_inicio_garantia || '';
    document.getElementById('edit-maquina-data-fim-garantia').value = m.data_fim_garantia || '';
    openModal('modal-edit-maquina');
}

document.getElementById('form-edit-maquina').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-maquina-id').value;
    const cliente_id = document.getElementById('edit-maquina-cliente_id').value;

    const payload = {
        cliente_id,
        marca: document.getElementById('edit-maquina-marca').value,
        modelo: document.getElementById('edit-maquina-modelo').value,
        numero_serie: document.getElementById('edit-maquina-numero-serie').value,
        data_instalacao: document.getElementById('edit-maquina-data-instalacao').value,
        data_inicio_garantia: document.getElementById('edit-maquina-data-inicio-garantia').value,
        data_fim_garantia: document.getElementById('edit-maquina-data-fim-garantia').value
    };

    try {
        await apiFetch(`/maquinas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showNotification('Máquina atualizada com sucesso!');
        closeModal('modal-edit-maquina');
        loadMaquinas();
    } catch (e) {
        showNotification(e.message, true);
    }
});

document.getElementById('form-add-maquina').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cliente_id = document.getElementById('maquina-cliente_id').value;

    const payload = {
        cliente_id,
        marca: document.getElementById('maquina-marca').value,
        modelo: document.getElementById('maquina-modelo').value,
        numero_serie: document.getElementById('maquina-numero-serie').value,
        data_instalacao: document.getElementById('maquina-data-instalacao').value,
        data_inicio_garantia: document.getElementById('maquina-data-inicio-garantia').value,
        data_fim_garantia: document.getElementById('maquina-data-fim-garantia').value
    };

    try {
        await apiFetch('/maquinas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showNotification('Máquina adicionada com sucesso!');
        closeModal('modal-add-maquina');
        document.getElementById('form-add-maquina').reset();
        loadMaquinas();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// QR Code
async function generateQR(uuid, maquinaNome) {
    try {
        const res = await apiFetch(`/maquinas/${uuid}/qrcode`);
        const container = document.getElementById('qrcode-image-container');
        const machineNameEl = document.getElementById('print-machine-name');

        if (machineNameEl) {
            machineNameEl.textContent = maquinaNome || '';
        }

        if (container) {
            container.innerHTML = `<img src="${res.qrCode}" alt="QR Code" style="width:200px; height:200px;">
                                   <p style="margin-top:10px; font-size:12px; word-break: break-all;">${res.url}</p>`;
        }

        openModal('modal-qrcode');
    } catch (e) {
        showNotification(e.message, true);
    }
}

// QR Code do Produto
async function generateProductQR(id, productNome) {
    try {
        const res = await apiFetch(`/stock/${id}/qrcode`);
        const container = document.getElementById('product-qrcode-image-container');
        const productNameEl = document.getElementById('print-product-name');

        if (productNameEl) {
            productNameEl.textContent = productNome || '';
        }

        if (container) {
            container.innerHTML = `<img src="${res.qrCode}" alt="QR Code" style="width:200px; height:200px;">`;
        }

        openModal('modal-product-qrcode');
    } catch (e) {
        showNotification(e.message, true);
    }
}

// --- Técnicos ---
async function loadTecnicos() {
    try {
        const tecnicos = await apiFetch('/tecnicos');
        const tbody = document.getElementById('table-tecnicos-body');
        tbody.innerHTML = '';

        tecnicos.forEach(t => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-id"></td>
                <td class="col-nome"></td>
                <td class="col-esp"></td>
                <td class="col-contato"></td>

                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-edit" title="Editar">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon delete btn-delete" title="Apagar">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tr.querySelector('.col-id').textContent = t.id;
            tr.querySelector('.col-nome').textContent = t.nome;
            tr.querySelector('.col-esp').textContent = t.especialidade || '-';
            tr.querySelector('.col-contato').textContent = `${t.telefone || '-'} / ${t.email || '-'}`;

            tr.querySelector('.btn-edit').onclick = () => openEditTecnicoModal(t.id, t.nome, t.especialidade, t.telefone, t.email);
            tr.querySelector('.btn-delete').onclick = () => deleteTecnico(t.id);

            tbody.appendChild(tr);
        });

        // Popula select de atribuição e filtros
        const filterDash = document.getElementById('filter-tech-dashboard');
        const statsTech = document.getElementById('stats-tecnico');
        const histTech = document.getElementById('hist-tecnico');

        const cbAtribuir = document.getElementById('atribuir-tecnicos-checkboxes');
        const cbReportAvaria = document.getElementById('report-avaria-tecnicos-checkboxes');
        const cbReportServico = document.getElementById('report-servico-tecnicos-checkboxes');
        const cbReportManutencao = document.getElementById('report-manutencao-tecnicos-checkboxes');
        const cbEditAgendamento = document.getElementById('edit-agendamento-tecnicos-checkboxes');

        if (filterDash) filterDash.innerHTML = '<option value="">Todos</option>';
        if (statsTech) statsTech.innerHTML = '<option value="">Todos</option>';
        if (histTech) histTech.innerHTML = '<option value="">Todos</option>';

        if (cbAtribuir) cbAtribuir.innerHTML = '';
        if (cbReportAvaria) cbReportAvaria.innerHTML = '';
        if (cbReportServico) cbReportServico.innerHTML = '';
        if (cbReportManutencao) cbReportManutencao.innerHTML = '';
        if (cbEditAgendamento) cbEditAgendamento.innerHTML = '';

        tecnicos.forEach(t => {
            const safeName = escapeHTML(t.nome);
            if (filterDash) filterDash.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeName}</option>`);
            if (statsTech) statsTech.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeName}</option>`);
            if (histTech) histTech.insertAdjacentHTML('beforeend', `<option value="${t.id}">${safeName}</option>`);

            const makeCheckbox = (prefix) => `
                <label class="checkbox-item">
                    <input type="checkbox" name="${prefix}-tecnico-ids" value="${t.id}">
                    <span>${safeName}</span>
                </label>
            `;

            if (cbAtribuir) cbAtribuir.insertAdjacentHTML('beforeend', makeCheckbox('atribuir'));
            if (cbReportAvaria) cbReportAvaria.insertAdjacentHTML('beforeend', makeCheckbox('report-avaria'));
            if (cbReportServico) cbReportServico.insertAdjacentHTML('beforeend', makeCheckbox('report-servico'));
            if (cbReportManutencao) cbReportManutencao.insertAdjacentHTML('beforeend', makeCheckbox('report-manutencao'));
            if (cbEditAgendamento) cbEditAgendamento.insertAdjacentHTML('beforeend', makeCheckbox('edit-agendamento'));
        });

    } catch (e) {
        showNotification(e.message, true);
    }
}

function openEditTecnicoModal(id, nome, especialidade, telefone, email) {
    document.getElementById('edit-tecnico-id').value = id;
    document.getElementById('edit-tecnico-nome').value = nome;
    document.getElementById('edit-tecnico-especialidade').value = especialidade || '';
    document.getElementById('edit-tecnico-telefone').value = telefone || '';
    document.getElementById('edit-tecnico-email').value = email || '';
    document.getElementById('edit-tecnico-password').value = '';
    openModal('modal-edit-tecnico');
}

document.getElementById('form-add-tecnico').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        nome: document.getElementById('tecnico-nome').value,
        especialidade: document.getElementById('tecnico-especialidade').value,
        telefone: document.getElementById('tecnico-telefone').value,
        email: document.getElementById('tecnico-email').value,
        // password removido pois é gerado no server
    };

    try {
        const responseData = await apiFetch('/tecnicos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        // Mostrar Modal de sucesso com a password gerada
        document.getElementById('display-temp-password').textContent = responseData.tempPassword;
        openModal('modal-tech-success');

        closeModal('modal-add-tecnico');
        document.getElementById('form-add-tecnico').reset();
        loadTecnicos();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// Listener para copiar password
const btnCopyPwd = document.getElementById('btn-copy-password');
if (btnCopyPwd) {
    btnCopyPwd.addEventListener('click', () => {
        const pwd = document.getElementById('display-temp-password').textContent;
        navigator.clipboard.writeText(pwd).then(() => {
            const icon = btnCopyPwd.querySelector('i');
            icon.className = 'ph ph-check';
            showNotification('Password copiada para a área de transferência!');
            setTimeout(() => {
                icon.className = 'ph ph-copy';
            }, 2000);
        }).catch(err => {
            showNotification('Erro ao copiar password', true);
        });
    });
}

// Fechar modal de sucesso do técnico
const btnTechSuccessOk = document.getElementById('btn-tech-success-ok');
if (btnTechSuccessOk) {
    btnTechSuccessOk.addEventListener('click', () => {
        closeModal('modal-tech-success');
    });
}

document.getElementById('form-edit-tecnico').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-tecnico-id').value;
    const data = {
        nome: document.getElementById('edit-tecnico-nome').value,
        especialidade: document.getElementById('edit-tecnico-especialidade').value,
        telefone: document.getElementById('edit-tecnico-telefone').value,
        email: document.getElementById('edit-tecnico-email').value,
        password: document.getElementById('edit-tecnico-password').value
    };

    try {
        await apiFetch(`/tecnicos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        showNotification('Técnico atualizado!');
        closeModal('modal-edit-tecnico');
        loadTecnicos();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// --- Serviços ---
function updateRefreshStatusServicos() {
    const statusEl = document.getElementById('refresh-status-servicos');
    if (!statusEl) return;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    statusEl.innerHTML = `
        <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%;"></span>
        Sincronizado às ${timeStr}
    `;
}

async function loadServicos() {
    try {
        const servicos = await apiFetch('/servicos');
        const colPendente = document.querySelector('#srv-col-pendente .cards-wrapper');
        const colResolucao = document.querySelector('#srv-col-resolucao .cards-wrapper');
        const colResolvida = document.querySelector('#srv-col-resolvida .cards-wrapper');

        colPendente.innerHTML = '';
        colResolucao.innerHTML = '';
        colResolvida.innerHTML = '';

        const dateStart = document.getElementById('filter-srv-date-start').value;
        const dateEnd = document.getElementById('filter-srv-date-end').value;
        const techFilter = document.getElementById('filter-tech-dashboard').value;

        servicos.forEach(s => {
            const card = createServicoCard(s);
            if (!card) return;

            // Apply Tech Filter
            if (techFilter && s.tecnico_id != techFilter) return;

            if (s.estado === 'pendente' || s.estado === 'pausada') colPendente.appendChild(card);
            else if (s.estado === 'em resolução') colResolucao.appendChild(card);
            else {
                // Resolvidas - Apply Data Range Filter
                let addCard = true;
                const dateRef = toLocalYYYYMMDD(s.data_hora_fim || s.data_hora);
                if (dateStart && dateRef < dateStart) addCard = false;
                if (dateEnd && dateRef > dateEnd) addCard = false;
                if (addCard) colResolvida.appendChild(card);
            }
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

function createServicoCard(s) {
    const card = document.createElement('div');
    card.className = 'avaria-card';

    let tagHTML = `<div class="card-type" style="background:#1e3a8a; color:white;">SERVIÇO</div>`;
    if (s.estado === 'pausada') {
        tagHTML += ` <div class="card-type" style="background:#fef08a; color:#854d0e; margin-left:5px;"><i class="ph ph-pause"></i> PAUSADA</div>`;
    }

    card.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;">${tagHTML}</div>
        <h4 class="card-machine-name"></h4>
        <p class="card-client-name"></p>
        <div class="assigned-tech" style="margin-top:10px; font-size:13px; font-weight:600; color:var(--accent);">
            <span style="color:var(--text-secondary); font-weight:400;">Técnico:</span> <span class="card-tech-name"></span>
        </div>
        <div class="date">${new Date(s.data_hora).toLocaleString('pt-PT')}</div>
        ${s.notas ? `<div class="card-notes" title="Clique para ver nota completa"><strong>Notas:</strong><br>${escapeHTML(s.notas)}</div>` : ''}
    `;

    if (s.notas) {
        const notesEl = card.querySelector('.card-notes');
        notesEl.onclick = (e) => {
            e.stopPropagation();
            openFullNoteModal(s.notas);
        };
    }

    card.querySelector('.card-machine-name').textContent = s.tipo_servico || 'Serviço Externo';
    card.querySelector('.card-client-name').textContent = s.cliente_nome || 'Sem Cliente';
    card.querySelector('.card-tech-name').textContent = s.tecnico_nome || 'Não Atribuído';

    if (s.estado === 'resolvida') {
        const btnReport = document.createElement('button');
        btnReport.className = 'btn-archive';
        btnReport.title = 'Ver Relatório';
        btnReport.innerHTML = '<i class="ph ph-file-pdf" style="color: #ef4444;"></i>';
        btnReport.style.right = '45px';
        btnReport.onclick = (e) => {
            e.stopPropagation();
            window.open(`/relatorio.html?id=${s.id}&type=servico`, '_blank');
        };
        card.appendChild(btnReport);

        const btnArchive = document.createElement('button');
        btnArchive.className = 'btn-archive';
        btnArchive.title = 'Limpar do dashboard';
        btnArchive.innerHTML = '<i class="ph ph-x"></i>';
        btnArchive.onclick = (e) => arquivarServico(s.id, e);
        card.appendChild(btnArchive);
    }

    if (s.estado !== 'resolvida') {
        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn-delete-card';
        btnDelete.title = 'Apagar serviço permanentemente';
        btnDelete.innerHTML = '<i class="ph ph-trash"></i>';
        btnDelete.style.cssText = 'position:absolute; top:10px; right:10px; border:none; background:none; color:#ef4444; cursor:pointer; font-size:18px; padding:5px; transition:all 0.2s;';
        btnDelete.onclick = (e) => deleteTask('servico', s.id, e);
        card.appendChild(btnDelete);

        if (s.estado === 'pendente') {
            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-edit-card';
            btnEdit.title = 'Editar serviço';
            btnEdit.innerHTML = '<i class="ph ph-pencil-simple"></i>';
            btnEdit.style.cssText = 'position:absolute; top:10px; right:38px; border:none; background:none; color:var(--primary-color, #3b82f6); cursor:pointer; font-size:18px; padding:5px; transition:all 0.2s;';
            btnEdit.onclick = (e) => {
                e.stopPropagation();
                openEditServicoModal(s);
            };
            card.appendChild(btnEdit);
        }
    }

    card.onclick = () => openTicketDetailsModal({ ...s, _type: 'servico' });

    return card;
}

async function arquivarServico(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Deseja limpar este serviço resolvido do dashboard?')) return;
    try {
        await apiFetch(`/servicos/${id}/arquivar`, { method: 'PUT' });
        refreshActiveDashboard();
    } catch (e) { showNotification(e.message, true); }
}

async function loadManutencoes() {
    try {
        const manutencoes = await apiFetch('/manutencoes');
        const colPendente = document.querySelector('#mnt-col-pendente .cards-wrapper');
        const colResolucao = document.querySelector('#mnt-col-resolucao .cards-wrapper');
        const colResolvida = document.querySelector('#mnt-col-resolvida .cards-wrapper');

        colPendente.innerHTML = '';
        colResolucao.innerHTML = '';
        colResolvida.innerHTML = '';

        const dateStart = document.getElementById('filter-mnt-date-start').value;
        const dateEnd = document.getElementById('filter-mnt-date-end').value;
        const techFilter = document.getElementById('filter-tech-dashboard').value;

        manutencoes.forEach(m => {
            const card = createManutencaoCard(m);
            if (!card) return;

            // Apply Tech Filter
            if (techFilter && m.tecnico_id != techFilter) return;

            if (m.estado === 'pendente' || m.estado === 'pausada') colPendente.appendChild(card);
            else if (m.estado === 'em resolução') colResolucao.appendChild(card);
            else {
                // Resolvidas - Apply Data Range Filter
                let addCard = true;
                const dateRef = toLocalYYYYMMDD(m.data_hora_fim || m.data_hora);
                if (dateStart && dateRef < dateStart) addCard = false;
                if (dateEnd && dateRef > dateEnd) addCard = false;
                if (addCard) colResolvida.appendChild(card);
            }
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

function createManutencaoCard(m) {
    const card = document.createElement('div');
    card.className = 'avaria-card';

    let tagHTML = `<div class="card-type" style="background:#7c3aed; color:white;">MANUTENÇÃO</div>`;
    if (m.estado === 'pausada') {
        tagHTML += ` <div class="card-type" style="background:#fef08a; color:#854d0e; margin-left:5px;"><i class="ph ph-pause"></i> PAUSADA</div>`;
    }

    card.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:12px;">${tagHTML}</div>
        <h4 class="card-machine-name"></h4>
        <div class="assigned-tech" style="margin-top:10px; font-size:13px; font-weight:600; color:var(--accent);">
            <span style="color:var(--text-secondary); font-weight:400;">Técnico:</span> <span class="card-tech-name"></span>
        </div>
        <div class="date">${m.data_agendada ? `<strong>Agendamento:</strong> ` + new Date(m.data_agendada).toLocaleString('pt-PT') : new Date(m.data_hora).toLocaleString('pt-PT')}</div>
        ${m.notas ? `<div class="card-notes" title="Clique para ver nota completa"><strong>Notas:</strong><br>${escapeHTML(m.notas)}</div>` : ''}
    `;

    if (m.notas) {
        const notesEl = card.querySelector('.card-notes');
        notesEl.onclick = (e) => {
            e.stopPropagation();
            openFullNoteModal(m.notas);
        };
    }

    card.querySelector('.card-machine-name').textContent = m.cliente_nome || 'Sem Cliente';
    card.querySelector('.card-tech-name').textContent = m.tecnico_nome || 'Não Atribuído';

    if (m.estado === 'resolvida') {
        const btnReport = document.createElement('button');
        btnReport.className = 'btn-archive';
        btnReport.title = 'Ver Relatório';
        btnReport.innerHTML = '<i class="ph ph-file-pdf" style="color: #ef4444;"></i>';
        btnReport.style.right = '45px';
        btnReport.onclick = (e) => {
            e.stopPropagation();
            window.open(`/relatorio.html?id=${m.id}&type=manutencao`, '_blank');
        };
        card.appendChild(btnReport);

        const btnArchive = document.createElement('button');
        btnArchive.className = 'btn-archive';
        btnArchive.title = 'Limpar do dashboard';
        btnArchive.innerHTML = '<i class="ph ph-x"></i>';
        btnArchive.onclick = (e) => arquivarManutencao(m.id, e);
        card.appendChild(btnArchive);
    }

    if (m.estado !== 'resolvida') {
        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn-delete-card';
        btnDelete.title = 'Apagar manutenção permanentemente';
        btnDelete.innerHTML = '<i class="ph ph-trash"></i>';
        btnDelete.style.cssText = 'position:absolute; top:10px; right:10px; border:none; background:none; color:#ef4444; cursor:pointer; font-size:18px; padding:5px; transition:all 0.2s;';
        btnDelete.onclick = (e) => deleteTask('manutencao', m.id, e);
        card.appendChild(btnDelete);

        if (m.estado === 'pendente') {
            const btnEdit = document.createElement('button');
            btnEdit.className = 'btn-edit-card';
            btnEdit.title = 'Editar manutenção';
            btnEdit.innerHTML = '<i class="ph ph-pencil-simple"></i>';
            btnEdit.style.cssText = 'position:absolute; top:10px; right:38px; border:none; background:none; color:var(--primary-color, #3b82f6); cursor:pointer; font-size:18px; padding:5px; transition:all 0.2s;';
            btnEdit.onclick = (e) => {
                e.stopPropagation();
                openEditManutencaoModal(m);
            };
            card.appendChild(btnEdit);
        }
    }

    card.onclick = () => openTicketDetailsModal({ ...m, _type: 'manutencao' });

    return card;
}

async function arquivarManutencao(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Deseja limpar esta manutenção resolvida do dashboard?')) return;
    try {
        await apiFetch(`/manutencoes/${id}/arquivar`, { method: 'PUT' });
        loadManutencoes();
    } catch (e) { showNotification(e.message, true); }
}

function toggleDashboardCol(colId) {
    const col = document.getElementById(colId);
    col.classList.toggle('collapsed');
    const states = JSON.parse(localStorage.getItem('maclau_dashboard_cols') || '{}');
    states[colId] = col.classList.contains('collapsed');
    localStorage.setItem('maclau_dashboard_cols', JSON.stringify(states));
}

// --- Estatísticas (Chart.js) ---
let statsChartInstance = null;

function getGroupingKey(dateStr, grouping) {
    const d = new Date(dateStr);
    if (grouping === 'dia') {
        return d.toISOString().split('T')[0]; // YYYY-MM-DD
    } else if (grouping === 'mes') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
    } else if (grouping === 'semana') {
        // Obter início da semana (Segunda-feira)
        const day = d.getDay();
        const diff = d.getDate() - day + (day == 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        return monday.toISOString().split('T')[0];
    }
}

async function loadEstatisticas() {
    try {
        const statsData = await apiFetch('/estatisticas/avarias');
        const techFilter = document.getElementById('stats-tecnico').value;
        const grouping = document.getElementById('stats-agrupamento').value;

        // Apply filters
        let filtered = statsData;
        if (techFilter) {
            filtered = filtered.filter(a => a.tecnico_id == techFilter);
        }

        // Group data
        const grouped = {};
        filtered.forEach(a => {
            const key = getGroupingKey(a.data_hora_fim, grouping);
            if (!grouped[key]) grouped[key] = 0;
            grouped[key]++;
        });

        // Sort keys chronologically
        const labels = Object.keys(grouped).sort();
        const dataPoints = labels.map(l => grouped[l]);

        const ctx = document.getElementById('statsChart').getContext('2d');
        if (statsChartInstance) statsChartInstance.destroy();

        statsChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Avarias Resolvidas',
                    data: dataPoints,
                    backgroundColor: '#007bff',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    } catch (e) {
        showNotification("Erro ao carregar estatísticas: " + e.message, true);
    }
}

// --- Histórico ---
function formatTimeDifference(startStr, endStr) {
    if (!startStr || !endStr) return 'Desconhecido';
    const start = new Date(startStr);
    const end = new Date(endStr);
    const diffMs = end - start;
    if (diffMs < 0) return 'Desconhecido';

    const diffMins = Math.floor(diffMs / 60000);
    const totalHours = Math.floor(diffMins / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const mins = diffMins % 60;

    let res = [];
    if (days > 0) res.push(`${days}d`);
    if (hours > 0) res.push(`${hours}h`);
    if (mins > 0) res.push(`${mins}m`);
    if (res.length === 0) return '< 1m';
    return res.join(' ');
}

async function loadHistoricoMaquinas() {
    const clienteId = document.getElementById('hist-cliente').value;
    const select = document.getElementById('hist-maquina');
    select.innerHTML = '<option value="">Todas</option>';

    if (!clienteId) {
        select.innerHTML = '<option value="">Todas (Selecione Lavandaria primeiro)</option>';
        return;
    }

    try {
        const maquinas = await apiFetch('/maquinas');
        const filtered = maquinas.filter(m => m.cliente_id == clienteId);
        filtered.forEach(m => {
            const maquinaNome = (m.marca || '') + ((m.marca && m.modelo) ? ' - ' : '') + (m.modelo || '');
            select.insertAdjacentHTML('beforeend', `<option value="${m.uuid}">${maquinaNome}</option>`);
        });
    } catch (e) {
        // fail silently
    }
}

async function loadHistorico() {
    try {
        let data = await apiFetch('/historico');
        if (!Array.isArray(data)) {
            console.error("Erro: Dados do histórico não são um array", data);
            data = [];
        }

        const tbody = document.getElementById('table-historico-body');
        if (!tbody) return;

        const filtroCliente = document.getElementById('hist-cliente')?.value || '';
        const filtroTipo = document.getElementById('hist-tipo')?.value || '';
        const filtroMaquina = document.getElementById('hist-maquina')?.value || '';
        const filtroTecnico = document.getElementById('hist-tecnico')?.value || '';
        const filtroFaturacao = document.getElementById('hist-faturacao')?.value || '';
        const filtroDataInicio = document.getElementById('hist-date-start')?.value || '';
        const filtroDataFim = document.getElementById('hist-date-end')?.value || '';

        tbody.innerHTML = '';

        // Filtragem e Ordenação
        const filteredData = data.filter(a => {
            if (filtroCliente && a.cliente_id != filtroCliente) return false;
            if (filtroTipo && a.type !== filtroTipo) return false;
            // Se houver filtro de máquina, apenas filtrar avarias (serviços e manutenções globais não têm UUID de máquina)
            if (filtroMaquina && a.type === 'avaria' && a.maquina_uuid != filtroMaquina) return false;
            
            if (filtroTecnico) {
                const ids = String(a.tecnico_id || '').split(',').map(id => id.trim());
                if (!ids.includes(String(filtroTecnico))) return false;
            }

            if (filtroFaturacao && a.estado_faturacao !== filtroFaturacao) return false;

            const itemDateStr = toLocalYYYYMMDD(a.data_hora_fim || a.data_hora);
            if (filtroDataInicio || filtroDataFim) {
                if (filtroDataInicio && itemDateStr < filtroDataInicio) return false;
                if (filtroDataFim && itemDateStr > filtroDataFim) return false;
            }
            return true;
        });

        // Ordenação Decrescente (Mais recentes primeiro)
        filteredData.sort((a, b) => {
            const dateA = a.data_hora_fim ? new Date(a.data_hora_fim) : new Date(a.data_hora);
            const dateB = b.data_hora_fim ? new Date(b.data_hora_fim) : new Date(b.data_hora);
            return dateB - dateA;
        });

        // Paginação
        const totalItems = filteredData.length;
        const totalPages = Math.ceil(totalItems / histItemsPerPage);
        if (histCurrentPage > totalPages && totalPages > 0) histCurrentPage = totalPages;
        if (histCurrentPage < 1) histCurrentPage = 1;

        const startIndex = (histCurrentPage - 1) * histItemsPerPage;
        const pageItems = filteredData.slice(startIndex, startIndex + histItemsPerPage);

        // Atualizar Controles UI
        const pageInfo = document.getElementById('hist-page-info');
        if (pageInfo) pageInfo.textContent = `Página ${histCurrentPage} de ${totalPages || 1}`;

        const btnPrev = document.getElementById('btn-prev-page');
        const btnNext = document.getElementById('btn-next-page');
        if (btnPrev) btnPrev.disabled = histCurrentPage === 1;
        if (btnNext) btnNext.disabled = histCurrentPage === totalPages || totalPages === 0;

        pageItems.forEach(a => {
            const dateObj = a.data_hora_fim ? new Date(a.data_hora_fim) : new Date(a.data_hora);
            const datePart = dateObj.toLocaleDateString('pt-PT');
            const timePart = dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

            const reportBtnHtml = (a.relatorio || a.relatorio_submetido === 1) ? `` : `<span style="font-size:11px; color:var(--text-secondary);">Sem Relatório</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="white-space: nowrap;">
                    <div style="font-weight: 600; font-size: 13px;">${datePart}</div>
                    <div style="font-size: 11px; color: var(--text-secondary);">${timePart}</div>
                </td>
                <td class="col-tech"></td>
                <td class="col-client"></td>
                <td class="col-machine"></td>
                <td>${hoursToHHmm(a.horas_trabalho)}</td>
                <td style="text-align: center;">
                    <div style="display: inline-block; text-align: left;">
                        <select class="select-faturacao">
                            <option value="Por Faturar">Por Faturar</option>
                            <option value="Para Faturar">Para Faturar</option>
                            <option value="Faturado">Faturado</option>
                            <option value="Oferta">Oferta</option>
                            <option value="Garantia">Garantia</option>
                        </select>
                        <div class="numero-fatura" style="font-size: 12px; margin-top: 10px; font-weight: 700; color: black; text-align: left;">${a.numero_fatura ? '<span style="color: var(--accent);">Fatura:</span> ' + a.numero_fatura : ''}</div>
                    </div>
                </td>
                <td class="col-actions">
                    <div style="display:flex; gap:5px;">${reportBtnHtml}</div>
                </td>
            `;
            tr.querySelector('.col-tech').textContent = a.tecnico_nome || 'Não Atribuído';
            tr.querySelector('.col-client').textContent = a.cliente_nome || 'Sem Cliente';

            let badgeColor = '#ef4444'; // Vermelho para Avaria
            let typeLabel = 'AVARIA';
            if (a.type === 'servico') { badgeColor = '#3b82f6'; typeLabel = 'SERVIÇO'; }
            else if (a.type === 'manutencao') { badgeColor = '#7c3aed'; typeLabel = 'MANUTENÇÃO'; }

            tr.querySelector('.col-machine').innerHTML = `
                <span style="font-size:10px; font-weight:700; background: ${badgeColor}15; color: ${badgeColor}; border: 1px solid ${badgeColor}33; padding:2px 8px; border-radius:4px; margin-right:8px; vertical-align:middle;">${typeLabel}</span>
                <span style="vertical-align:middle;">${escapeHTML(a.maquina_nome || '---')}</span>
            `;

            const selFat = tr.querySelector('.select-faturacao');
            if (a.estado_faturacao) selFat.value = a.estado_faturacao;

            // Apply dynamic class for modern look
            const updateStatusClass = (val) => {
                selFat.classList.remove('status-por-faturar', 'status-para-faturar', 'status-faturado', 'status-oferta', 'status-garantia');
                const classMap = {
                    'Por Faturar': 'status-por-faturar',
                    'Para Faturar': 'status-para-faturar',
                    'Faturado': 'status-faturado',
                    'Oferta': 'status-oferta',
                    'Garantia': 'status-garantia'
                };
                if (classMap[val]) selFat.classList.add(classMap[val]);
            };
            updateStatusClass(selFat.value);

            selFat.addEventListener('change', async (e) => {
                const newVal = e.target.value;
                const oldVal = a.estado_faturacao || 'Por Faturar';

                if (!confirm(`Tem a certeza que deseja alterar o estado de faturação para "${newVal}"?`)) {
                    e.target.value = oldVal;
                    updateStatusClass(oldVal);
                    return;
                }

                updateStatusClass(newVal);

                if (newVal === 'Faturado') {
                    // Abrir modal personalizado
                    currentFaturacaoRef = { selectElement: e.target, item: a, oldVal: oldVal };
                    document.getElementById('faturacao-id').value = a.id;
                    document.getElementById('faturacao-type').value = a.type;
                    document.getElementById('faturacao-novo-estado').value = newVal;
                    document.getElementById('input-numero-fatura').value = a.numero_fatura || '';
                    openModal('modal-faturacao');
                    setTimeout(() => document.getElementById('input-numero-fatura').focus(), 100);
                    return;
                }

                try {
                    let numero_fatura = null;

                    const endpoint = a.type === 'servico' ? '/servicos/' : (a.type === 'manutencao' ? '/manutencoes/' : '/avarias/');
                    await apiFetch(endpoint + a.id + '/faturacao', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ estado_faturacao: newVal, numero_fatura })
                    });
                    showNotification('Faturação atualizada!');
                    a.estado_faturacao = newVal;
                    a.numero_fatura = numero_fatura;

                    // Update UI display
                    const fatDiv = selFat.closest('td').querySelector('.numero-fatura');
                    if (fatDiv) {
                        fatDiv.innerHTML = numero_fatura ? '<span style="color: var(--accent);">Fatura:</span> ' + numero_fatura : '';
                    }
                } catch (err) {
                    showNotification(err.message, true);
                    e.target.value = oldVal;
                    updateStatusClass(oldVal);
                }
            });

            if (a.relatorio || a.relatorio_submetido === 1) {

                const colActions = tr.querySelector('.col-actions div');
                const btnPdf = document.createElement('button');
                btnPdf.className = 'btn-status';
                btnPdf.style.padding = '5px 10px';
                btnPdf.style.fontSize = '12px';
                btnPdf.style.display = 'flex';
                btnPdf.style.alignItems = 'center';
                btnPdf.style.gap = '5px';
                btnPdf.style.border = 'none';
                btnPdf.style.borderRadius = '6px';
                btnPdf.style.cursor = 'pointer';
                btnPdf.style.fontWeight = '600';

                if (a.relatorio_submetido === 1) {
                    btnPdf.style.background = '#dc2626';
                    btnPdf.style.color = '#ffffff';
                    btnPdf.innerHTML = '<i class="ph ph-file-pdf"></i> PDF';
                } else {
                    btnPdf.style.background = '#fef08a';
                    btnPdf.style.color = '#854d0e';
                    btnPdf.style.padding = '3px 8px';
                    btnPdf.style.fontSize = '10px';
                    btnPdf.innerHTML = '<i class="ph ph-file-text"></i> Rascunho';
                }

                btnPdf.onclick = () => window.open(`/relatorio.html?id=${a.id}&type=${a.type}`, '_blank');
                btnPdf.style.background = '#FEE2E2';
                btnPdf.style.color = '#DC2626';
                btnPdf.style.border = '1px solid #FECACA';
                btnPdf.style.borderRadius = '8px';
                btnPdf.style.width = '32px';
                btnPdf.style.height = '32px';
                btnPdf.style.display = 'flex';
                btnPdf.style.alignItems = 'center';
                btnPdf.style.justifyContent = 'center';
                btnPdf.style.padding = '0';
                btnPdf.title = "Ver PDF";
                btnPdf.innerHTML = '<i class="ph ph-file-pdf" style="font-size: 18px;"></i>';
                colActions.appendChild(btnPdf);

                // Botão de Edição para o Admin (Lápis Icon)
                const btnEdit = document.createElement('button');
                btnEdit.className = 'btn-status';
                btnEdit.style.background = 'var(--accent-light)';
                btnEdit.style.color = 'var(--accent)';
                btnEdit.style.border = '1px solid #D1FAE5';
                btnEdit.style.borderRadius = '8px';
                btnEdit.style.width = '32px';
                btnEdit.style.height = '32px';
                btnEdit.style.display = 'flex';
                btnEdit.style.alignItems = 'center';
                btnEdit.style.justifyContent = 'center';
                btnEdit.style.padding = '0';
                btnEdit.style.cursor = 'pointer';
                btnEdit.style.transition = 'all 0.2s';
                btnEdit.innerHTML = '<i class="ph ph-note-pencil" style="font-size: 18px;"></i>';
                btnEdit.title = "Editar Relatório";
                
                btnEdit.onclick = () => {
                    openRelatorioModal(a.id, a.relatorio || '', a.relatorio_submetido === 1, a.pecas_substituidas, a.horas_trabalho, a.assinatura_cliente, a.type, a.assinatura_tecnico);
                };
                colActions.appendChild(btnEdit);
            }

            tbody.appendChild(tr);
        });
    } catch (e) {
        showNotification("Erro ao carregar histórico: " + e.message, true);
    }
}

// Handler para submissão da fatura (Modal Personalizado)
const formFaturacao = document.getElementById('form-faturacao');
if (formFaturacao) {
    formFaturacao.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentFaturacaoRef) return;

        const id = document.getElementById('faturacao-id').value;
        const type = document.getElementById('faturacao-type').value;
        const newVal = document.getElementById('faturacao-novo-estado').value;
        const numero_fatura = document.getElementById('input-numero-fatura').value;

        try {
            const endpoint = type === 'servico' ? '/servicos/' : (type === 'manutencao' ? '/manutencoes/' : '/avarias/');
            await apiFetch(endpoint + id + '/faturacao', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado_faturacao: newVal, numero_fatura })
            });

            showNotification('Faturação atualizada!');

            // Atualizar o objeto local
            currentFaturacaoRef.item.estado_faturacao = newVal;
            currentFaturacaoRef.item.numero_fatura = numero_fatura;

            // Atualizar a UI
            const selFat = currentFaturacaoRef.selectElement;
            const fatDiv = selFat.closest('td').querySelector('.numero-fatura');
            if (fatDiv) {
                fatDiv.innerHTML = numero_fatura ? '<span style="color: var(--accent);">Fatura:</span> ' + numero_fatura : '';
            }

            closeModal('modal-faturacao');
            currentFaturacaoRef = null;
        } catch (err) {
            showNotification(err.message, true);
        }
    });
}

// Garantir que se a modal fechar sem submeter, o select volta ao estado anterior
const closeFaturacaoBtn = document.querySelector('.close-btn[data-modal="modal-faturacao"]');
if (closeFaturacaoBtn) {
    closeFaturacaoBtn.addEventListener('click', () => {
        if (currentFaturacaoRef) {
            currentFaturacaoRef.selectElement.value = currentFaturacaoRef.oldVal;
            // updateStatusClass logic for the specific element
            const selFat = currentFaturacaoRef.selectElement;
            selFat.classList.remove('status-por-faturar', 'status-para-faturar', 'status-faturado', 'status-oferta', 'status-garantia');
            const classMap = {
                'Por Faturar': 'status-por-faturar',
                'Para Faturar': 'status-para-faturar',
                'Faturado': 'status-faturado',
                'Oferta': 'status-oferta',
                'Garantia': 'status-garantia'
            };
            if (classMap[currentFaturacaoRef.oldVal]) selFat.classList.add(classMap[currentFaturacaoRef.oldVal]);
            currentFaturacaoRef = null;
        }
    });
}

function viewRelatorio(texto) {
    const content = document.getElementById('view-relatorio-content');
    content.textContent = texto;
    openModal('modal-view-relatorio');
}

async function loadMachinesForReport() {
    const clienteId = document.getElementById('report-avaria-cliente').value;
    const select = document.getElementById('report-avaria-maquina');

    if (!clienteId) {
        select.innerHTML = '<option value="">Selecione o Cliente primeiro</option>';
        select.disabled = true;
        return;
    }

    try {
        const maquinas = await apiFetch('/maquinas');
        const filtered = maquinas.filter(m => m.cliente_id == clienteId);

        select.innerHTML = '<option value="">-- Selecionar Máquina --</option>';
        if (filtered.length === 0) {
            select.innerHTML = '<option value="">Nenhuma máquina encontrada</option>';
            select.disabled = true;
        } else {
            filtered.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.uuid;
                opt.textContent = (m.marca || '') + ((m.marca && m.modelo) ? ' - ' : '') + (m.modelo || '');
                select.appendChild(opt);
            });
            select.disabled = false;
        }
    } catch (e) {
        showNotification("Erro ao carregar máquinas", true);
    }
}

// INIT
window.onload = async () => {
    await ensureAuth();

    const urlParams = new URLSearchParams(window.location.search);
    const fullscreen = urlParams.get('fullscreen');
    const view = urlParams.get('view');
    
    if (fullscreen === 'true') {
        document.body.classList.add('fullscreen-mode');
        if (view === 'stock') {
            currentActiveView = 'stock';
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            const viewEl = document.getElementById(`view-stock`);
            if (viewEl) viewEl.classList.remove('hidden');
            
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            const b = document.querySelector('.nav-btn[data-target="stock"]');
            if (b) b.classList.add('active');
            
            loadStock();
        }
    }

    // Carregar o dashboard correto baseado no estado inicial
    if (currentMainDashboard === 'avarias') loadAvarias();
    else if (currentMainDashboard === 'servicos') loadServicos();
    else if (currentMainDashboard === 'manutencoes') loadManutencoes();
    else loadTodas();

    loadClientes();
    loadTecnicos();

    const states = JSON.parse(localStorage.getItem('maclau_dashboard_cols') || '{}');
    Object.keys(states).forEach(colId => {
        if (states[colId]) {
            const col = document.getElementById(colId);
            if (col) col.classList.add('collapsed');
        }
    });

    // --- Listeners para conformidade CSP (Sem inline handlers) ---

    // Logout
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Fullscreen Stock Button
    const btnFullscreenStock = document.getElementById('btn-fullscreen-stock');
    if (btnFullscreenStock) {
        btnFullscreenStock.addEventListener('click', () => {
            window.open('/admin.html?view=stock&fullscreen=true', '_blank');
        });
    }

    // Filtros Dashboard
    const filterTech = document.getElementById('filter-tech-dashboard');
    if (filterTech) filterTech.addEventListener('change', loadAvarias);

    const filterEnd = document.getElementById('filter-date-end');
    if (filterEnd) filterEnd.addEventListener('change', loadAvarias);

    const filterSrvStart = document.getElementById('filter-srv-date-start');
    if (filterSrvStart) filterSrvStart.addEventListener('change', loadServicos);

    const filterSrvEnd = document.getElementById('filter-srv-date-end');
    if (filterSrvEnd) filterSrvEnd.addEventListener('change', loadServicos);

    // Filtros de Data para Manutenções Resolvidas
    const filterMntStart = document.getElementById('filter-mnt-date-start');
    const filterMntEnd = document.getElementById('filter-mnt-date-end');
    if (filterMntStart) filterMntStart.addEventListener('change', loadManutencoes);
    if (filterMntEnd) filterMntEnd.addEventListener('change', loadManutencoes);

    // Filtros de Data para Dashboard Unificado
    const filterAllStart = document.getElementById('filter-all-date-start');
    const filterAllEnd = document.getElementById('filter-all-date-end');
    if (filterAllStart) filterAllStart.addEventListener('change', loadTodas);
    if (filterAllEnd) filterAllEnd.addEventListener('change', loadTodas);

    // O filtro de técnico já chama loadAvarias, mas precisamos que ele saiba qual dashboard carregar
    if (filterTech) {
        filterTech.removeEventListener('change', loadAvarias);
        filterTech.addEventListener('change', () => {
            if (currentMainDashboard === 'avarias') loadAvarias();
            else loadServicos();
        });
    }

    // Toggle Colunas
    document.querySelectorAll('.btn-toggle-col').forEach(btn => {
        btn.addEventListener('click', () => {
            const colId = btn.getAttribute('data-col');
            toggleDashboardCol(colId);
        });
    });

    // Estatísticas
    const statsAgrup = document.getElementById('stats-agrupamento');
    if (statsAgrup) statsAgrup.addEventListener('change', loadEstatisticas);

    const statsTechF = document.getElementById('stats-tecnico');
    if (statsTechF) statsTechF.addEventListener('change', loadEstatisticas);

    // Histórico
    const histClient = document.getElementById('hist-cliente');
    if (histClient) histClient.addEventListener('change', () => {
        histCurrentPage = 1;
        loadHistoricoMaquinas();
        updateFilterBadge();
        loadHistorico();
    });

    const histMaq = document.getElementById('hist-maquina');
    if (histMaq) histMaq.addEventListener('change', () => {
        histCurrentPage = 1;
        updateFilterBadge();
        loadHistorico();
    });

    const histTechF = document.getElementById('hist-tecnico');
    if (histTechF) histTechF.addEventListener('change', () => {
        histCurrentPage = 1;
        updateFilterBadge();
        loadHistorico();
    });

    const histFatF = document.getElementById('hist-faturacao');
    if (histFatF) histFatF.addEventListener('change', () => {
        histCurrentPage = 1;
        updateFilterBadge();
        loadHistorico();
    });

    const histDateStart = document.getElementById('hist-date-start');
    if (histDateStart) histDateStart.addEventListener('change', () => {
        histCurrentPage = 1;
        updateFilterBadge();
        loadHistorico();
    });

    const histDateEnd = document.getElementById('hist-date-end');
    if (histDateEnd) histDateEnd.addEventListener('change', () => {
        histCurrentPage = 1;
        updateFilterBadge();
        loadHistorico();
    });

    const histTipo = document.getElementById('hist-tipo');
    if (histTipo) histTipo.addEventListener('change', () => {
        histCurrentPage = 1;
        updateFilterBadge();
        loadHistorico();
    });

    // Paginação Histórico
    const btnPrevPage = document.getElementById('btn-prev-page');
    if (btnPrevPage) btnPrevPage.addEventListener('click', () => {
        if (histCurrentPage > 1) {
            histCurrentPage--;
            loadHistorico();
        }
    });

    const btnNextPage = document.getElementById('btn-next-page');
    if (btnNextPage) btnNextPage.addEventListener('click', () => {
        histCurrentPage++;
        loadHistorico();
    });

    // --- Filter Menu Toggle Logic ---
    const btnFilterToggle = document.getElementById('btn-filter-toggle');
    const filterMenu = document.getElementById('filter-menu');

    if (btnFilterToggle && filterMenu) {
        btnFilterToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            filterMenu.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (!filterMenu.contains(e.target) && !btnFilterToggle.contains(e.target)) {
                filterMenu.classList.remove('active');
            }
        });
    }

    const btnClearHistFilters = document.getElementById('btn-clear-hist-filters');
    if (btnClearHistFilters) {
        btnClearHistFilters.addEventListener('click', (e) => {
            e.stopPropagation();
            histCurrentPage = 1;
            document.getElementById('hist-cliente').value = '';
            document.getElementById('hist-maquina').value = '';
            document.getElementById('hist-tecnico').value = '';
            document.getElementById('hist-faturacao').value = '';
            document.getElementById('hist-date-start').value = '';
            document.getElementById('hist-date-end').value = '';
            const hTipo = document.getElementById('hist-tipo');
            if (hTipo) hTipo.value = '';
            loadHistoricoMaquinas();
            updateFilterBadge();
            loadHistorico();
        });
    }

    function updateFilterBadge() {
        const c = document.getElementById('hist-cliente').value;
        const tp = document.getElementById('hist-tipo')?.value || '';
        const m = document.getElementById('hist-maquina').value;
        const t = document.getElementById('hist-tecnico').value;
        const f = document.getElementById('hist-faturacao').value;
        const ds = document.getElementById('hist-date-start').value;
        const de = document.getElementById('hist-date-end').value;

        let count = 0;
        if (c) count++;
        if (tp) count++;
        if (m) count++;
        if (t) count++;
        if (f) count++;
        if (ds || de) count++;

        const badge = document.getElementById('active-filters-count');
        const clearBtn = document.getElementById('btn-clear-hist-filters');

        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'flex';
                if (clearBtn) clearBtn.style.display = 'flex';
            } else {
                badge.style.display = 'none';
                if (clearBtn) clearBtn.style.display = 'none';
            }
        }
    }
    // Chamar uma vez no início ou quando mudar filtros
    updateFilterBadge();

    // Máquinas
    const filterClMaq = document.getElementById('filter-cliente-maquinas');
    if (filterClMaq) filterClMaq.addEventListener('change', loadMaquinas);

    // Abertura de Modals Estáticos
    const addClientBtn = document.getElementById('btn-open-add-client');
    if (addClientBtn) addClientBtn.addEventListener('click', () => openModal('modal-add-client'));

    const addMaqBtn = document.getElementById('btn-open-add-maquina');
    if (addMaqBtn) addMaqBtn.addEventListener('click', () => openModal('modal-add-maquina'));

    const addTechBtn = document.getElementById('btn-open-add-tecnico');
    if (addTechBtn) addTechBtn.addEventListener('click', () => openModal('modal-add-tecnico'));

    // O listener do form-report-avaria e servico agora está fora do window.onload
    // para suportar chamadas externas se necessário e evitar duplicação
    // No entanto, vou garantir que os campos de data são limpos ao abrir o modal
    document.querySelectorAll('.btn-open-report-avaria').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('report-avaria-agendada').value = '';
            loadClientes();
            loadTecnicos();
            openModal('modal-report-avaria');
        });
    });

    document.querySelectorAll('.btn-open-report-servico').forEach(btn => {
        btn.addEventListener('click', () => {
            const form = document.getElementById('form-report-servico');
            if (form) form.reset();
            const customContainer = document.getElementById('report-servico-tipo-outro-container');
            if (customContainer) customContainer.classList.add('hidden');
            const customInput = document.getElementById('report-servico-tipo-outro');
            if (customInput) {
                customInput.required = false;
                customInput.value = '';
            }
            const customCamiaoContainer = document.getElementById('report-servico-camiao-outro-container');
            if (customCamiaoContainer) customCamiaoContainer.classList.add('hidden');
            const customCamiaoInput = document.getElementById('report-servico-camiao-outro');
            if (customCamiaoInput) {
                customCamiaoInput.required = false;
                customCamiaoInput.value = '';
            }
            const machinesContainer = document.getElementById('report-servico-maquinas-container');
            if (machinesContainer) {
                machinesContainer.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center;">Selecione um cliente para carregar as máquinas.</p>';
            }
            document.getElementById('report-servico-agendada').value = '';
            loadClientes();
            loadTecnicos();
            openModal('modal-report-servico');
        });
    });

    document.querySelectorAll('.btn-open-report-manutencao').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('report-manutencao-agendada').value = '';
            loadClientes();
            loadTecnicos();
            openModal('modal-report-manutencao');
        });
    });

    // Fecho de Modals
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-modal');
            if (modalId) closeModal(modalId);
        });
    });

    // Impressão QR
    const printBtn = document.getElementById('btn-print-qr');
    if (printBtn) printBtn.addEventListener('click', () => window.print());

    const printProductBtn = document.getElementById('btn-print-product-qr');
    if (printProductBtn) printProductBtn.addEventListener('click', () => window.print());

    const btnCloseViewSupplier = document.getElementById('btn-close-view-supplier');
    if (btnCloseViewSupplier) {
        btnCloseViewSupplier.addEventListener('click', () => closeModal('modal-view-supplier'));
    }

    // Iniciar Auto-Refresh se estivermos no Dashboard
    startAutoRefresh();
    updateRefreshStatus();

    // Toggle Sidebar Mobile
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => {
            const sidebar = document.querySelector('.sidebar');
            sidebar.classList.toggle('active');
        });
    }

    // Fechar Sidebar Mobile
    const btnCloseSidebar = document.getElementById('btn-close-sidebar');
    if (btnCloseSidebar) {
        btnCloseSidebar.addEventListener('click', () => {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) sidebar.classList.remove('active');
        });
    }

    // Fechar sidebar ao clicar num link (mobile)
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar) sidebar.classList.remove('active');
            }
        });
    });

    // Iniciar Signature Pads e Listeners de Relatório
    initSignaturePad();

    const btnSubmitReport = document.getElementById('btn-submit-report');
    if (btnSubmitReport) {
        btnSubmitReport.addEventListener('click', (e) => {
            e.preventDefault();
            openModal('modal-confirm-submit');
        });
    }

    const btnConfirmSubmit = document.getElementById('btn-confirm-submit-action');
    if (btnConfirmSubmit) {
        btnConfirmSubmit.addEventListener('click', () => {
            closeModal('modal-confirm-submit');
            submitRelatorio();
        });
    }

    const btnCancelSubmit = document.getElementById('btn-cancel-submit');
    if (btnCancelSubmit) {
        btnCancelSubmit.addEventListener('click', () => {
            closeModal('modal-confirm-submit');
        });
    }
};

window.onclick = function (event) {
    if (event.target.classList.contains('modal')) {
        const modalId = event.target.id;
        if (modalId === 'modal-faturacao' && currentFaturacaoRef) {
            currentFaturacaoRef.selectElement.value = currentFaturacaoRef.oldVal;
            const selFat = currentFaturacaoRef.selectElement;
            selFat.classList.remove('status-por-faturar', 'status-para-faturar', 'status-faturado', 'status-oferta', 'status-garantia');
            const classMap = {
                'Por Faturar': 'status-por-faturar',
                'Para Faturar': 'status-para-faturar',
                'Faturado': 'status-faturado',
                'Oferta': 'status-oferta',
                'Garantia': 'status-garantia'
            };
            if (classMap[currentFaturacaoRef.oldVal]) selFat.classList.add(classMap[currentFaturacaoRef.oldVal]);
            currentFaturacaoRef = null;
        }
        event.target.classList.add('hidden');
    }
}
// Reportar Avaria (Manual Admin / Editar)
document.getElementById('form-report-avaria').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    const editId = document.getElementById('edit-avaria-id').value;
    const isEdit = !!editId;

    const payload = {
        maquina_id: document.getElementById('report-avaria-maquina').value,
        tipo_avaria: parseInt(document.getElementById('report-avaria-tipo').value),
        tecnico_ids: Array.from(document.querySelectorAll('input[name="report-avaria-tecnico-ids"]:checked')).map(cb => cb.value),
        notas: document.getElementById('report-avaria-notas').value,
        data_agendada: document.getElementById('report-avaria-agendada').value || null
    };

    try {
        await apiFetch(isEdit ? `/avarias/${editId}` : '/avarias', {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showNotification(isEdit ? 'Avaria atualizada com sucesso!' : 'Avaria reportada com sucesso!');
        closeModal('modal-report-avaria');
        refreshActiveDashboard();
        if (currentActiveView === 'agendamentos') loadAgendamentos();
    } catch (e) {
        showNotification(e.message, true);
    } finally {
        if (btn) btn.disabled = false;
    }
});

// Reportar Serviço (Manual Admin / Editar)
document.getElementById('form-report-servico').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    const editId = document.getElementById('edit-servico-id').value;
    const isEdit = !!editId;

    const tipoSelect = document.getElementById('report-servico-tipo').value;
    const tipoFinal = tipoSelect === 'Outros' ? document.getElementById('report-servico-tipo-outro').value : tipoSelect;
    const camiaoSelect = document.getElementById('report-servico-camiao').value;
    const camiaoFinal = camiaoSelect === 'Outros' ? document.getElementById('report-servico-camiao-outro').value : camiaoSelect;
    const maquina_ids = Array.from(document.querySelectorAll('.srv-maquina-checkbox:checked')).map(cb => parseInt(cb.value));

    const payload = {
        cliente_id: document.getElementById('report-servico-cliente').value,
        tipo_servico: tipoFinal,
        tipo_camiao: camiaoFinal,
        tecnico_ids: Array.from(document.querySelectorAll('input[name="report-servico-tecnico-ids"]:checked')).map(cb => cb.value),
        notas: document.getElementById('report-servico-notas').value,
        data_agendada: document.getElementById('report-servico-agendada').value || null,
        maquina_ids: maquina_ids
    };

    try {
        await apiFetch(isEdit ? `/servicos/${editId}` : '/servicos', {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showNotification(isEdit ? 'Serviço atualizado com sucesso!' : 'Serviço reportado com sucesso!');
        closeModal('modal-report-servico');
        refreshActiveDashboard();
        if (currentActiveView === 'agendamentos') loadAgendamentos();
    } catch (e) {
        showNotification(e.message, true);
    } finally {
        if (btn) btn.disabled = false;
    }
});

// Carregar máquinas para o modal de manutenção
async function loadMachinesForMaintenance() {
    const clienteId = document.getElementById('report-manutencao-cliente').value;
    const container = document.getElementById('report-manutencao-maquinas-container');

    if (!clienteId) {
        container.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center;">Selecione um cliente para carregar as máquinas.</p>';
        return;
    }

    try {
        container.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center;">Carregando máquinas...</p>';
        const maquinas = await apiFetch('/maquinas');
        const filtradas = maquinas.filter(m => m.cliente_id == clienteId);

        if (filtradas.length === 0) {
            container.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center;">Nenhuma máquina encontrada para este cliente.</p>';
        } else {
            container.innerHTML = '';
            filtradas.forEach(m => {
                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.gap = '10px';
                div.style.padding = '8px';
                div.style.borderBottom = '1px solid #edf2f7';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'mnt-maquina-checkbox';
                checkbox.value = m.id;
                checkbox.id = `mnt-maq-${m.id}`;
                checkbox.style.width = '18px';
                checkbox.style.height = '18px';
                checkbox.style.cursor = 'pointer';

                const label = document.createElement('label');
                label.htmlFor = `mnt-maq-${m.id}`;
                label.style.fontSize = '14px';
                label.style.cursor = 'pointer';
                label.style.flex = '1';
                label.textContent = `${m.marca} - ${m.modelo} (${m.numero_serie || 'S/N'})`;

                div.appendChild(checkbox);
                div.appendChild(label);
                container.appendChild(div);
            });
        }
    } catch (e) {
        container.innerHTML = '<p style="font-size: 13px; color: var(--danger); text-align: center;">Erro ao carregar máquinas.</p>';
    }
}

// Carregar máquinas para o modal de serviço
async function loadMachinesForService() {
    const clienteId = document.getElementById('report-servico-cliente').value;
    const container = document.getElementById('report-servico-maquinas-container');

    if (!clienteId) {
        container.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center;">Selecione um cliente para carregar as máquinas.</p>';
        return;
    }

    try {
        container.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center;">Carregando máquinas...</p>';
        const maquinas = await apiFetch('/maquinas');
        const filtradas = maquinas.filter(m => m.cliente_id == clienteId);

        if (filtradas.length === 0) {
            container.innerHTML = '<p style="font-size: 13px; color: var(--text-secondary); text-align: center;">Nenhuma máquina encontrada para este cliente.</p>';
        } else {
            container.innerHTML = '';
            filtradas.forEach(m => {
                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.gap = '10px';
                div.style.padding = '8px';
                div.style.borderBottom = '1px solid #edf2f7';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'srv-maquina-checkbox';
                checkbox.value = m.id;
                checkbox.id = `srv-maq-${m.id}`;
                checkbox.style.width = '18px';
                checkbox.style.height = '18px';
                checkbox.style.cursor = 'pointer';

                const label = document.createElement('label');
                label.htmlFor = `srv-maq-${m.id}`;
                label.style.fontSize = '14px';
                label.style.cursor = 'pointer';
                label.style.flex = '1';
                label.textContent = `${m.marca} - ${m.modelo} (${m.numero_serie || 'S/N'})`;

                div.appendChild(checkbox);
                div.appendChild(label);
                container.appendChild(div);
            });
        }
    } catch (e) {
        container.innerHTML = '<p style="font-size: 13px; color: var(--danger); text-align: center;">Erro ao carregar máquinas.</p>';
    }
}

// Reportar Manutenção (Manual Admin / Editar)
document.getElementById('form-report-manutencao').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;

    const editId = document.getElementById('edit-manutencao-id').value;
    const isEdit = !!editId;

    const maquina_ids = Array.from(document.querySelectorAll('.mnt-maquina-checkbox:checked')).map(cb => parseInt(cb.value));

    if (maquina_ids.length === 0) {
        if (!confirm('Não selecionou nenhuma máquina. Deseja reportar manutenção para TODAS as máquinas do cliente?')) {
            if (btn) btn.disabled = false;
            return;
        }
    }

    const payload = {
        cliente_id: document.getElementById('report-manutencao-cliente').value,
        tecnico_ids: Array.from(document.querySelectorAll('input[name="report-manutencao-tecnico-ids"]:checked')).map(cb => cb.value),
        notas: document.getElementById('report-manutencao-notas').value,
        data_agendada: document.getElementById('report-manutencao-agendada').value || null,
        maquina_ids: maquina_ids
    };

    try {
        await apiFetch(isEdit ? `/manutencoes/${editId}` : '/manutencoes', {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showNotification(isEdit ? 'Manutenção atualizada com sucesso!' : 'Manutenção criada com sucesso!');
        closeModal('modal-report-manutencao');
        refreshActiveDashboard();
        if (currentActiveView === 'agendamentos') loadAgendamentos();
    } catch (e) {
        showNotification(e.message, true);
    } finally {
        if (btn) btn.disabled = false;
    }
});


// Filtros de cascata para modal de reporte
document.getElementById('report-avaria-cliente').addEventListener('change', async (e) => {
    const clienteId = e.target.value;
    const selectMaquina = document.getElementById('report-avaria-maquina');

    if (!clienteId) {
        selectMaquina.innerHTML = '<option value="">Selecione o Cliente primeiro</option>';
        selectMaquina.disabled = true;
        return;
    }

    try {
        const maquinas = await apiFetch('/maquinas');
        const filtradas = maquinas.filter(m => m.cliente_id == clienteId);

        selectMaquina.innerHTML = '<option value="">Selecione a Máquina</option>';
        filtradas.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.uuid;
            opt.textContent = `${m.marca} - ${m.modelo} (${m.numero_serie || 'S/N'})`;
            selectMaquina.appendChild(opt);
        });
        selectMaquina.disabled = false;
    } catch (e) {
        showNotification('Erro ao carregar máquinas', true);
    }
});

document.getElementById('report-manutencao-cliente').addEventListener('change', loadMachinesForMaintenance);

document.getElementById('report-servico-cliente').addEventListener('change', loadMachinesForService);

// Toggle conditional field for "Outros" service type
const selectTipoServico = document.getElementById('report-servico-tipo');
if (selectTipoServico) {
    selectTipoServico.addEventListener('change', (e) => {
        const customContainer = document.getElementById('report-servico-tipo-outro-container');
        const customInput = document.getElementById('report-servico-tipo-outro');
        if (e.target.value === 'Outros') {
            customContainer.classList.remove('hidden');
            customInput.required = true;
        } else {
            customContainer.classList.add('hidden');
            customInput.required = false;
            customInput.value = '';
        }
    });
}

// Toggle conditional field for "Outros" transport type
const selectCamiaoServico = document.getElementById('report-servico-camiao');
if (selectCamiaoServico) {
    selectCamiaoServico.addEventListener('change', (e) => {
        const customContainer = document.getElementById('report-servico-camiao-outro-container');
        const customInput = document.getElementById('report-servico-camiao-outro');
        if (e.target.value === 'Outros') {
            customContainer.classList.remove('hidden');
            customInput.required = true;
        } else {
            customContainer.classList.add('hidden');
            customInput.required = false;
            customInput.value = '';
        }
    });
}

document.getElementById('btn-srv-select-all').addEventListener('click', () => {
    document.querySelectorAll('.srv-maquina-checkbox').forEach(cb => cb.checked = true);
});

document.getElementById('btn-srv-deselect-all').addEventListener('click', () => {
    document.querySelectorAll('.srv-maquina-checkbox').forEach(cb => cb.checked = false);
});

document.getElementById('btn-mnt-select-all').addEventListener('click', () => {
    document.querySelectorAll('.mnt-maquina-checkbox').forEach(cb => cb.checked = true);
});

document.getElementById('btn-mnt-deselect-all').addEventListener('click', () => {
    document.querySelectorAll('.mnt-maquina-checkbox').forEach(cb => cb.checked = false);
});

// --- Gestão de Frota ---
async function loadFrota() {
    try {
        const frota = await apiFetch('/frota');
        const tbody = document.getElementById('table-frota-body');
        tbody.innerHTML = '';

        frota.forEach(v => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${v.id}</td>
                <td>${v.marca}</td>
                <td>${v.modelo}</td>
                <td>${v.ano || '-'}</td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-info" title="Ver Detalhes">
                            <i class="ph ph-info"></i>
                        </button>
                        <button class="btn-icon btn-edit" title="Editar">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon delete btn-delete" title="Apagar">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;

            tr.querySelector('.btn-info').addEventListener('click', () => openViewFrotaModal(v));
            tr.querySelector('.btn-edit').addEventListener('click', () => openEditFrotaModal(v));
            tr.querySelector('.btn-delete').addEventListener('click', () => deleteFrota(v.id));

            tbody.appendChild(tr);
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

function openViewFrotaModal(v) {
    document.getElementById('view-frota-marca').textContent = v.marca;
    document.getElementById('view-frota-modelo').textContent = v.modelo;
    document.getElementById('view-frota-ano').textContent = v.ano || 'N/A';
    document.getElementById('view-frota-data-proxima-inspecao').textContent = formatDate(v.data_proxima_inspecao);
    document.getElementById('view-frota-proxima-revisao-kms').textContent = v.proxima_revisao_kms || 'N/A';
    document.getElementById('view-frota-data-ultima-revisao').textContent = formatDate(v.data_ultima_revisao);
    openModal('modal-view-frota');
}

const btnCloseViewFrota = document.getElementById('btn-close-view-frota');
if (btnCloseViewFrota) {
    btnCloseViewFrota.addEventListener('click', () => closeModal('modal-view-frota'));
}

function openEditFrotaModal(v) {
    document.getElementById('edit-frota-id').value = v.id;
    document.getElementById('edit-frota-marca').value = v.marca;
    document.getElementById('edit-frota-modelo').value = v.modelo;
    document.getElementById('edit-frota-ano').value = v.ano || '';
    document.getElementById('edit-frota-data-proxima-inspecao').value = v.data_proxima_inspecao || '';
    document.getElementById('edit-frota-proxima-revisao-kms').value = v.proxima_revisao_kms || '';
    document.getElementById('edit-frota-data-ultima-revisao').value = v.data_ultima_revisao || '';
    openModal('modal-edit-frota');
}

async function deleteFrota(id) {
    if (!confirm('Tem a certeza que deseja remover este veículo?')) return;
    try {
        await apiFetch(`/frota/${id}`, { method: 'DELETE' });
        showNotification('Veículo removido.');
        loadFrota();
    } catch (e) { showNotification(e.message, true); }
}

const btnOpenAddFrota = document.getElementById('btn-open-add-frota');
if (btnOpenAddFrota) {
    btnOpenAddFrota.addEventListener('click', () => openModal('modal-add-frota'));
}

document.getElementById('form-add-frota').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        marca: document.getElementById('frota-marca').value,
        modelo: document.getElementById('frota-modelo').value,
        ano: document.getElementById('frota-ano').value,
        data_proxima_inspecao: document.getElementById('frota-data-proxima-inspecao').value,
        proxima_revisao_kms: document.getElementById('frota-proxima-revisao-kms').value,
        data_ultima_revisao: document.getElementById('frota-data-ultima-revisao').value
    };

    try {
        await apiFetch('/frota', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showNotification('Veículo adicionado com sucesso!');
        closeModal('modal-add-frota');
        document.getElementById('form-add-frota').reset();
        loadFrota();
    } catch (e) {
        showNotification(e.message, true);
    }
});

document.getElementById('form-edit-frota').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-frota-id').value;
    const payload = {
        marca: document.getElementById('edit-frota-marca').value,
        modelo: document.getElementById('edit-frota-modelo').value,
        ano: document.getElementById('edit-frota-ano').value,
        data_proxima_inspecao: document.getElementById('edit-frota-data-proxima-inspecao').value,
        proxima_revisao_kms: document.getElementById('edit-frota-proxima-revisao-kms').value,
        data_ultima_revisao: document.getElementById('edit-frota-data-ultima-revisao').value
    };

    try {
        await apiFetch(`/frota/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showNotification('Veículo atualizado com sucesso!');
        closeModal('modal-edit-frota');
        loadFrota();
    } catch (e) {
        showNotification(e.message, true);
    }
});

// --- Gestão de Utilizadores de Cliente ---
let currentViewingClientId = null;

async function showClientUsersView(clientId, clientName) {
    currentViewingClientId = clientId;
    currentActiveView = 'client-users';

    // Hide all views, show client-users
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-client-users').classList.remove('hidden');

    document.getElementById('client-users-title').textContent = `Logins do Cliente: ${clientName}`;
    loadClientUsers(clientId);
}

async function loadClientUsers(clientId) {
    try {
        const users = await apiFetch(`/clientes/${clientId}/users`);
        const tbody = document.getElementById('table-client-users-body');
        tbody.innerHTML = '';

        users.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHTML(u.nome)}</td>
                <td><code>${escapeHTML(u.username)}</code></td>
                <td>${escapeHTML(u.email || '-')}</td>
                <td><code style="color: var(--accent); background: var(--accent-light); padding: 2px 6px; border-radius: 4px;">${escapeHTML(u.password_plain || '(não disponível)')}</code></td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-edit-user" title="Editar Login">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon delete btn-delete-user" title="Remover Acesso">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;

            tr.querySelector('.btn-edit-user').onclick = () => openEditClientUserModal(u);
            tr.querySelector('.btn-delete-user').onclick = () => deleteClientUser(u.id);

            tbody.appendChild(tr);
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

function openEditClientUserModal(u) {
    document.getElementById('edit-client-user-id').value = u.id;
    document.getElementById('edit-client-user-nome').value = u.nome;
    document.getElementById('edit-client-user-username').value = u.username;
    document.getElementById('edit-client-user-email').value = u.email || '';
    document.getElementById('edit-client-user-password').value = u.password_plain || ''; // Mostrar password real
    openModal('modal-edit-client-user');
}

// Lógica de Toggle de Password
document.querySelectorAll('.btn-toggle-password').forEach(btn => {
    btn.onclick = (e) => {
        const targetId = e.currentTarget.getAttribute('data-target');
        const input = document.getElementById(targetId);
        const icon = e.currentTarget.querySelector('i');

        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.remove('ph-eye');
            icon.classList.add('ph-eye-closed');
        } else {
            input.type = 'password';
            icon.classList.remove('ph-eye-closed');
            icon.classList.add('ph-eye');
        }
    };
});

async function deleteClientUser(userId) {
    if (!confirm('Deseja remover este acesso? O técnico deixará de conseguir reportar avarias.')) return;
    try {
        await apiFetch(`/clientes-users/${userId}`, { method: 'DELETE' });
        showNotification('Acesso removido.');
        loadClientUsers(currentViewingClientId);
    } catch (e) {
        showNotification(e.message, true);
    }
}

// Listeners para Botões e Forms de Client Users
const btnBackToClients = document.getElementById('btn-back-to-clients');
if (btnBackToClients) {
    btnBackToClients.onclick = () => {
        // Forçar fechar a vista atual
        document.getElementById('view-client-users').classList.add('hidden');
        // Procurar o botão de Clientes na barra lateral e clicar
        const clientsBtn = document.querySelector('.nav-btn[data-target="clientes"]');
        if (clientsBtn) {
            clientsBtn.click();
        } else {
            // Fallback se o botão não for encontrado
            document.getElementById('view-clientes').classList.remove('hidden');
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            const b = document.querySelector('.nav-btn[data-target="clientes"]');
            if (b) b.classList.add('active');
        }
    };
}

const btnOpenAddClientUser = document.getElementById('btn-open-add-client-user');
if (btnOpenAddClientUser) {
    btnOpenAddClientUser.onclick = () => {
        document.getElementById('add-client-user-client-id').value = currentViewingClientId;
        document.getElementById('form-add-client-user').reset();
        openModal('modal-add-client-user');
    };
}

const formAddClientUser = document.getElementById('form-add-client-user');
if (formAddClientUser) {
    formAddClientUser.addEventListener('submit', async (e) => {
        e.preventDefault();
        const clientId = document.getElementById('add-client-user-client-id').value;
        const data = {
            nome: document.getElementById('client-user-nome').value,
            username: document.getElementById('client-user-username').value,
            email: document.getElementById('client-user-email').value
        };

        try {
            const res = await apiFetch(`/clientes/${clientId}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            showNotification('Login criado com sucesso!');
            closeModal('modal-add-client-user');
            loadClientUsers(clientId);

            if (res.tempPassword) {
                document.getElementById('display-client-temp-password').textContent = res.tempPassword;
                openModal('modal-client-user-success');
            }
        } catch (e) {
            showNotification(e.message, true);
        }
    });
}

document.getElementById('btn-client-user-success-ok')?.addEventListener('click', () => {
    closeModal('modal-client-user-success');
});

document.getElementById('btn-copy-client-password')?.addEventListener('click', async () => {
    const pwd = document.getElementById('display-client-temp-password').textContent;
    if (pwd) {
        try {
            await navigator.clipboard.writeText(pwd);
            showNotification('Palavra-passe copiada!');
        } catch (e) {
            showNotification('Falha ao copiar', true);
        }
    }
});

const formEditClientUser = document.getElementById('form-edit-client-user');
if (formEditClientUser) {
    formEditClientUser.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('edit-client-user-id').value;
        const data = {
            nome: document.getElementById('edit-client-user-nome').value,
            username: document.getElementById('edit-client-user-username').value,
            email: document.getElementById('edit-client-user-email').value,
            password: document.getElementById('edit-client-user-password').value
        };

        // Se a senha estiver vazia, não a enviamos para não alterar
        if (!data.password) {
            delete data.password;
        }

        try {
            await apiFetch(`/clientes-users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            showNotification('Login atualizado!');
            closeModal('modal-edit-client-user');
            loadClientUsers(currentViewingClientId);
        } catch (e) {
            showNotification(e.message, true);
        }
    });
}

// --- Gestão de Checklists ---
async function loadChecklistModelos() {
    try {
        const res = await apiFetch('/modelos');
        const filterSelect = document.getElementById('filter-checklist-modelo');

        const adminOptionsContainer = document.getElementById('options-admin-checklist-modelo');
        const adminHiddenInput = document.getElementById('admin-checklist-modelo');
        const adminSearchInput = document.getElementById('search-admin-checklist-modelo');

        const editOptionsContainer = document.getElementById('options-edit-checklist-modelo');
        const editHiddenInput = document.getElementById('edit-checklist-modelo');
        const editSearchInput = document.getElementById('search-edit-checklist-modelo');

        if (filterSelect) filterSelect.innerHTML = '<option value="">Todos os Modelos</option>';
        if (adminOptionsContainer) adminOptionsContainer.innerHTML = '';
        if (editOptionsContainer) editOptionsContainer.innerHTML = '';

        res.forEach(m => {
            const label = `${m.marca} ${m.modelo}`;
            const optVal = JSON.stringify({ marca: m.marca, modelo: m.modelo });

            if (filterSelect) {
                const optFilter = document.createElement('option');
                optFilter.value = optVal;
                optFilter.textContent = label;
                filterSelect.appendChild(optFilter);
            }

            if (adminOptionsContainer) {
                const div = document.createElement('div');
                div.className = 'custom-select-option';
                div.textContent = label;
                div.dataset.value = optVal;

                div.onclick = () => {
                    adminHiddenInput.value = optVal;
                    if (adminSearchInput) adminSearchInput.value = label;
                    document.getElementById('dropdown-admin-checklist-modelo').classList.add('hidden');
                };
                adminOptionsContainer.appendChild(div);
            }

            if (editOptionsContainer) {
                const div = document.createElement('div');
                div.className = 'custom-select-option';
                div.textContent = label;
                div.dataset.value = optVal;

                div.onclick = () => {
                    editHiddenInput.value = optVal;
                    if (editSearchInput) editSearchInput.value = label;
                    document.getElementById('dropdown-edit-checklist-modelo').classList.add('hidden');
                };
                editOptionsContainer.appendChild(div);
            }
        });

        initCustomSelect('admin-checklist-modelo');
        initCustomSelect('edit-checklist-modelo');

        // Also populate edit custom select
        const editOptionsContainerForEdit = document.getElementById('options-edit-checklist-modelo');
        if (editOptionsContainerForEdit) {
            editOptionsContainerForEdit.innerHTML = '';
            res.forEach(m => {
                const label = `${m.marca} ${m.modelo}`;
                const optVal = JSON.stringify({ marca: m.marca, modelo: m.modelo });
                const div = document.createElement('div');
                div.className = 'custom-select-option';
                div.textContent = label;
                div.dataset.value = optVal;

                div.onclick = () => {
                    document.getElementById('edit-checklist-modelo').value = optVal;
                    const searchInput = document.getElementById('search-edit-checklist-modelo');
                    if (searchInput) searchInput.value = label;
                    document.getElementById('dropdown-edit-checklist-modelo').classList.add('hidden');
                };
                editOptionsContainerForEdit.appendChild(div);
            });
            initCustomSelect('edit-checklist-modelo');
        }

    } catch (e) {
        console.error("Erro ao carregar modelos", e);
    }
}

async function loadChecklists() {
    try {
        const filterSelect = document.getElementById('filter-checklist-modelo');
        if (!filterSelect) return;

        const filterVal = filterSelect.value;
        let url = '/checklists';
        if (filterVal) {
            const { marca, modelo } = JSON.parse(filterVal);
            url += `?marca=${encodeURIComponent(marca)}&modelo=${encodeURIComponent(modelo)}`;
        }
        const checklists = await apiFetch(url);

        const tbody = document.getElementById('table-checklists-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        if (checklists.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhuma checklist encontrada</td></tr>';
            return;
        }

        for (const c of checklists) {
            // Need to fetch steps to show count
            const details = await apiFetch(`/checklists/${c.id}`);
            const count = details.passos ? details.passos.length : 0;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHTML(c.marca)}</td>
                <td>${escapeHTML(c.modelo)}</td>
                <td style="font-weight:600;">${escapeHTML(c.titulo_avaria)}</td>
                <td><span class="status-pill status-em-resolucao" style="background:#dbeafe; color:#2563eb; padding:4px 8px; border-radius:6px;">${count} Passos</span></td>
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-icon btn-edit-checklist" data-id="${c.id}" title="Editar"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn-icon btn-delete-checklist" data-id="${c.id}" title="Eliminar"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }

        document.querySelectorAll('.btn-delete-checklist').forEach(btn => {
            btn.onclick = async () => {
                if (confirm("Tem a certeza que deseja eliminar esta checklist?")) {
                    try {
                        await apiFetch(`/checklists/${btn.dataset.id}`, { method: 'DELETE' });
                        showNotification('Checklist eliminada');
                        loadChecklists();
                    } catch (e) {
                        showNotification(e.message, true);
                    }
                }
            }
        });

        document.querySelectorAll('.btn-edit-checklist').forEach(btn => {
            btn.onclick = async () => {
                try {
                    const checklist = await apiFetch(`/checklists/${btn.dataset.id}`);
                    document.getElementById('edit-checklist-id').value = checklist.id;
                    const optVal = JSON.stringify({ marca: checklist.marca, modelo: checklist.modelo });
                    document.getElementById('edit-checklist-modelo').value = optVal;
                    document.getElementById('search-edit-checklist-modelo').value = `${checklist.marca} ${checklist.modelo}`;
                    document.getElementById('edit-checklist-titulo').value = checklist.titulo_avaria;
                    document.getElementById('edit-checklist-descricao').value = checklist.descricao || '';

                    const container = document.getElementById('edit-checklist-passos-container');
                    container.innerHTML = '';
                    if (checklist.passos && checklist.passos.length > 0) {
                        checklist.passos.forEach((p, index) => {
                            addPassoRow(container, index + 1, p.descricao);
                        });
                    } else {
                        addPassoRow(container, 1, '');
                    }
                    openModal('modal-edit-checklist');
                } catch (e) {
                    showNotification(e.message, true);
                }
            };
        });

    } catch (e) {
        console.error("Erro ao carregar checklists", e);
    }
}

// Add Checklist setup
const filterChecklistModelo = document.getElementById('filter-checklist-modelo');
if (filterChecklistModelo) filterChecklistModelo.addEventListener('change', loadChecklists);

const btnOpenAddChecklist = document.getElementById('btn-open-add-checklist');
if (btnOpenAddChecklist) {
    btnOpenAddChecklist.addEventListener('click', () => {
        document.getElementById('form-add-checklist').reset();
        const container = document.getElementById('checklist-passos-container');
        container.innerHTML = '';
        addPassoRow(container, 1, '');

        // Se houver um filtro de modelo selecionado, preencher logo a marca e modelo no form
        const filterVal = document.getElementById('filter-checklist-modelo').value;
        const hiddenInput = document.getElementById('admin-checklist-modelo');
        const searchInput = document.getElementById('search-admin-checklist-modelo');

        if (filterVal) {
            const { marca, modelo } = JSON.parse(filterVal);
            if (hiddenInput) hiddenInput.value = filterVal;
            if (searchInput) searchInput.value = `${marca} ${modelo}`;
        } else {
            if (hiddenInput) hiddenInput.value = '';
            if (searchInput) searchInput.value = '';
        }

        openModal('modal-add-checklist');
    });
}

const formEditChecklist = document.getElementById('form-edit-checklist');
if (formEditChecklist) {
    formEditChecklist.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = document.getElementById('edit-checklist-id').value;
        const checklistModeloInput = document.getElementById('edit-checklist-modelo').value;
        if (!checklistModeloInput) {
            return showNotification("Por favor, selecione uma máquina.", true);
        }

        const { marca, modelo } = JSON.parse(checklistModeloInput);
        const titulo = document.getElementById('edit-checklist-titulo').value.trim();
        const descricao = document.getElementById('edit-checklist-descricao').value.trim();

        const passosInputs = document.querySelectorAll('#edit-checklist-passos-container .passo-input');
        const passos = Array.from(passosInputs)
            .map(input => input.value.trim())
            .filter(val => val !== '');

        if (passos.length === 0) {
            return showNotification("A checklist deve ter pelo menos um passo.", true);
        }

        const body = { marca, modelo, titulo_avaria: titulo, descricao, passos };

        try {
            const res = await apiFetch(`/checklists/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            showNotification(res.message || "Checklist atualizada!");
            closeModal('modal-edit-checklist');
            loadChecklists();
        } catch (err) {
            showNotification(err.message, true);
        }
    });
}



function addPassoRow(container, number, value = '') {
    const div = document.createElement('div');
    div.className = 'checklist-passo-row';
    div.style.display = 'flex';
    div.style.gap = '10px';
    div.style.alignItems = 'flex-start';
    div.style.marginTop = '10px';
    div.innerHTML = `
        <span class="passo-numero" style="font-weight:bold; color:var(--text-secondary); width:20px; padding-top:10px;">${number}.</span>
        <textarea class="passo-input" required placeholder="Ex: Verificar filtro da bomba" style="flex:1; min-height: 80px; resize: vertical; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-family: inherit; font-size: 14px;">${escapeHTML(value)}</textarea>
        <button type="button" class="btn-remove-passo btn-icon" style="color:var(--danger); margin-top:5px;"><i class="ph ph-trash"></i></button>
    `;
    container.appendChild(div);
    updatePassosNumbers(container.id);
}

const btnAddPasso = document.getElementById('btn-add-passo');
if (btnAddPasso) {
    btnAddPasso.addEventListener('click', () => {
        const container = document.getElementById('checklist-passos-container');
        const rowsCount = container.querySelectorAll('.checklist-passo-row').length + 1;
        addPassoRow(container, rowsCount, '');
    });
}

const btnEditAddPasso = document.getElementById('btn-edit-add-passo');
if (btnEditAddPasso) {
    btnEditAddPasso.addEventListener('click', () => {
        const container = document.getElementById('edit-checklist-passos-container');
        const rowsCount = container.querySelectorAll('.checklist-passo-row').length + 1;
        addPassoRow(container, rowsCount, '');
    });
}

const passosContainers = [
    document.getElementById('checklist-passos-container'),
    document.getElementById('edit-checklist-passos-container')
];

passosContainers.forEach(container => {
    if (container) {
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-passo');
            if (btn) {
                btn.closest('.checklist-passo-row').remove();
                updatePassosNumbers(container.id);
            }
        });
    }
});

function updatePassosNumbers(containerId = 'checklist-passos-container') {
    const rows = document.querySelectorAll(`#${containerId} .checklist-passo-row`);
    rows.forEach((row, index) => {
        row.querySelector('.passo-numero').textContent = (index + 1) + '.';
        const removeBtn = row.querySelector('.btn-remove-passo');
        if (rows.length === 1) {
            removeBtn.style.display = 'none';
        } else {
            removeBtn.style.display = 'inline-flex';
        }
    });
}

const formAddChecklist = document.getElementById('form-add-checklist');
if (formAddChecklist) {
    formAddChecklist.addEventListener('submit', async (e) => {
        e.preventDefault();
        const checklistModeloInput = document.getElementById('admin-checklist-modelo').value;
        if (!checklistModeloInput) {
            return showNotification("Por favor, selecione uma máquina.", true);
        }
        const { marca, modelo } = JSON.parse(checklistModeloInput);
        const titulo_avaria = document.getElementById('checklist-titulo').value;
        const descricao = document.getElementById('checklist-descricao').value;

        const passosInputs = document.querySelectorAll('#checklist-passos-container .passo-input');
        const passos = Array.from(passosInputs).map(i => i.value).filter(v => v.trim() !== '');

        if (passos.length === 0) {
            return showNotification("Adicione pelo menos um passo.", true);
        }

        try {
            await apiFetch('/checklists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ marca, modelo, titulo_avaria, descricao, passos })
            });
            showNotification("Checklist guardada com sucesso!");
            closeModal('modal-add-checklist');
            loadChecklistModelos(); // might have new model
            loadChecklists();
        } catch (err) {
            showNotification(err.message, true);
        }
    });
}

function openEditChecklistModal(checklist) {
    document.getElementById('edit-checklist-id').value = checklist.id;
    document.getElementById('edit-checklist-titulo').value = checklist.titulo_avaria || '';
    document.getElementById('edit-checklist-descricao').value = checklist.descricao || '';

    // Fill custom select
    const filterVal = JSON.stringify({ marca: checklist.marca, modelo: checklist.modelo });
    const hiddenInput = document.getElementById('edit-checklist-modelo');
    const searchInput = document.getElementById('search-edit-checklist-modelo');
    if (hiddenInput) hiddenInput.value = filterVal;
    if (searchInput) searchInput.value = `${checklist.marca} ${checklist.modelo}`;

    // Fill Passos
    const container = document.getElementById('edit-checklist-passos-container');
    container.innerHTML = '';

    if (checklist.passos && checklist.passos.length > 0) {
        checklist.passos.forEach((p, index) => {
            const div = document.createElement('div');
            div.className = 'edit-checklist-passo-row';
            div.style.display = 'flex';
            div.style.gap = '10px';
            div.style.alignItems = 'center';
            div.style.marginTop = '10px';
            div.innerHTML = `
                <span class="passo-numero" style="font-weight:bold; color:var(--text-secondary); width:20px;">${index + 1}.</span>
                <input type="text" class="passo-input" required value="${escapeHTML(p.descricao)}" style="flex:1;">
                <button type="button" class="btn-remove-edit-passo btn-icon" style="color:var(--danger);"><i class="ph ph-trash"></i></button>
            `;
            container.appendChild(div);
        });
    } else {
        // Fallback for no steps
        const div = document.createElement('div');
        div.className = 'edit-checklist-passo-row';
        div.style.display = 'flex';
        div.style.gap = '10px';
        div.style.alignItems = 'center';
        div.style.marginTop = '10px';
        div.innerHTML = `
            <span class="passo-numero" style="font-weight:bold; color:var(--text-secondary); width:20px;">1.</span>
            <input type="text" class="passo-input" required placeholder="Novo passo..." style="flex:1;">
            <button type="button" class="btn-remove-edit-passo btn-icon" style="color:var(--danger); display:none;"><i class="ph ph-trash"></i></button>
        `;
        container.appendChild(div);
    }

    updateEditPassosNumbers();

    openModal('modal-edit-checklist');
}



// --- Funções Auxiliares para Custom Selects ---
function initCustomSelect(id) {
    const trigger = document.getElementById(`trigger-${id}`);
    const dropdown = document.getElementById(`dropdown-${id}`);
    const search = document.getElementById(`search-${id}`);
    const optionsContainer = document.getElementById(`options-${id}`);

    if (!dropdown) return;

    if (trigger) {
        trigger.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
            if (!dropdown.classList.contains('hidden')) {
                if (search) search.focus();
            }
        };
    } else if (search) {
        search.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.remove('hidden');
        };
    }

    if (search && optionsContainer) {
        search.oninput = () => {
            dropdown.classList.remove('hidden');
            const filter = search.value.toLowerCase();
            Array.from(optionsContainer.children).forEach(child => {
                if (child.textContent.toLowerCase().includes(filter)) {
                    child.style.display = '';
                } else {
                    child.style.display = 'none';
                }
            });
        };
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest(`#wrapper-${id}`)) {
            dropdown.classList.add('hidden');
        }
    });
}
async function openRelatorioModal(id, currentText = '', isSubmitted = false, currentPecas = '', currentHoras = '', currentSignature = '', type = 'avaria', currentSignatureTech = '') {
    document.getElementById('relatorio-avaria-id').value = id;
    document.getElementById('relatorio-type').value = type;

    const textarea = document.getElementById('relatorio-texto');
    const pecasArea = document.getElementById('relatorio-pecas');
    const horasInput = document.getElementById('relatorio-horas');

    try {
        const endpoint = type === 'servico' ? `/servicos/${id}/detalhes-relatorio` : (type === 'manutencao' ? `/manutencoes/${id}/detalhes-relatorio` : `/avarias/${id}/detalhes-relatorio`);
        const res = await apiFetch(endpoint);
        const data = res;

        // Populate Headers and Info
        document.getElementById('a4-report-id').textContent = `ID: #${data.id.toString().padStart(5, '0')}`;
        const dateObj = new Date(data.data_hora_fim || data.data_hora);
        document.getElementById('a4-report-date').textContent = `Data: ${dateObj.toLocaleDateString('pt-PT')}`;
        document.getElementById('a4-report-type').innerHTML = 'Relatório de Intervenção (Modo Admin)';

        document.getElementById('a4-cliente-nome').textContent = data.cliente_nome || '---';
        document.getElementById('a4-cliente-email').textContent = data.cliente_email || '---';
        document.getElementById('a4-cliente-contato').textContent = data.cliente_contato || '---';
        document.getElementById('a4-cliente-nif').textContent = data.cliente_nif || '---';
        document.getElementById('a4-tecnico-nome').textContent = data.tecnico_nome || '---';
        
        const machineRow = document.getElementById('a4-machine-row');
        const serviceRow = document.getElementById('a4-service-row');
        const detailsTitle = document.getElementById('a4-details-title');

        if (type === 'avaria') {
            detailsTitle.innerHTML = '<i class="ph ph-wrench"></i> Máquina';
            machineRow.style.display = 'block';
            serviceRow.style.display = 'none';
            document.getElementById('a4-maquina-nome').textContent = data.maquina_nome || '---';
            document.getElementById('a4-maquina-serie').textContent = data.maquina_serie || '---';
            document.getElementById('a4-maquina-serie-row').style.display = 'block';
            document.getElementById('a4-tipo-avaria').textContent = data.tipo_avaria === 1 ? 'Elétrica' : (data.tipo_avaria === 3 ? 'Mecânica' : 'Outra');
        } else if (type === 'manutencao') {
            detailsTitle.innerHTML = '<i class="ph ph-wrench"></i> Manutenção';
            machineRow.style.display = 'block';
            serviceRow.style.display = 'none';
            document.getElementById('a4-maquina-nome').textContent = "Todas as máquinas";
            document.getElementById('a4-maquina-serie-row').style.display = 'none';
            document.getElementById('a4-tipo-avaria').textContent = "Geral";
        } else {
            detailsTitle.innerHTML = '<i class="ph ph-truck"></i> Serviço';
            machineRow.style.display = 'none';
            serviceRow.style.display = 'block';
            document.getElementById('a4-tipo-servico').textContent = data.tipo_servico || '---';
            document.getElementById('a4-tipo-camiao').textContent = data.tipo_camiao || '---';
        }

        // Handle Manutenção Machines List
        const mntSection = document.getElementById('a4-manutencao-maquinas-section');
        const mntList = document.getElementById('a4-manutencao-maquinas-list');
        if (mntSection && mntList) {
            if (type === 'manutencao' && data.maquinas && data.maquinas.length > 0) {
                mntSection.style.display = 'block';
                mntList.innerHTML = data.maquinas.map(m => `
                    <div style="font-size: 12px; background: #f8fafc; padding: 10px 14px; border-radius: 10px; border: 1px solid #e2e8f0; display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
                        <i class="ph-fill ph-check-circle" style="color: #10b981; font-size: 16px;"></i>
                        <span style="font-weight: 700;">${m.marca} ${m.modelo}</span>
                        <span style="color: #64748b;"> - SN: ${m.numero_serie || '---'}</span>
                    </div>
                `).join('');
            } else {
                mntSection.style.display = 'none';
            }
        }

        // Populate Editable Fields
        textarea.value = data.relatorio || currentText || '';
        pecasArea.value = data.pecas_substituidas || currentPecas || '';
        horasInput.value = (data.horas_trabalho !== null && data.horas_trabalho !== undefined) ? hoursToHHmm(data.horas_trabalho) : (currentHoras || '');

        const deslocacoesInput = document.getElementById('relatorio-deslocacoes');
        if (deslocacoesInput) {
            deslocacoesInput.value = (data.deslocacoes !== null && data.deslocacoes !== undefined) ? data.deslocacoes : 1;
        }
        const staticDeslocacoes = document.getElementById('a4-deslocacoes');
        if (staticDeslocacoes) {
            staticDeslocacoes.textContent = (data.deslocacoes !== null && data.deslocacoes !== undefined) ? data.deslocacoes : 1;
        }

        // Static Horas
        document.getElementById('a4-horas-trabalho').textContent = hoursToHHmm(data.horas_trabalho);

        // Signatures
        clearSignature();
        clearSignatureTech();
        
        const sigCli = currentSignature || data.assinatura_cliente;
        if (sigCli) {
            const img = new Image();
            img.onload = () => sigCtx.drawImage(img, 0, 0);
            img.src = sigCli;
        }

        const sigTech = currentSignatureTech || data.assinatura_tecnico;
        if (sigTech) {
            const imgTech = new Image();
            imgTech.onload = () => sigCtxTech.drawImage(imgTech, 0, 0);
            imgTech.src = sigTech;
        }

        openModal('modal-relatorio');
    } catch (e) {
        showNotification("Erro ao carregar dados do relatório.", true);
    }
}

async function submitRelatorio() {
    const id = document.getElementById('relatorio-avaria-id').value;
    const type = document.getElementById('relatorio-type').value;
    const relatorio = document.getElementById('relatorio-texto').value;
    const pecas_substituidas = document.getElementById('relatorio-pecas').value;
    const horas_raw = document.getElementById('relatorio-horas').value;
    const horas_trabalho = HHmmToHours(horas_raw);
    const deslocacoesInput = document.getElementById('relatorio-deslocacoes');
    const deslocacoes = deslocacoesInput ? parseInt(deslocacoesInput.value) || 0 : 1;
    
    const canvasCli = document.getElementById('signature-pad');
    const canvasTec = document.getElementById('signature-pad-tech');
    
    const assinatura_cliente = isCanvasBlank(canvasCli) ? null : canvasCli.toDataURL('image/png');
    const assinatura_tecnico = isCanvasBlank(canvasTec) ? null : canvasTec.toDataURL('image/png');

    try {
        const endpoint = type === 'servico' ? `/admin/servicos/${id}/relatorio` : (type === 'manutencao' ? `/admin/manutencoes/${id}/relatorio` : `/admin/avarias/${id}/relatorio`);
        await apiFetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico, deslocacoes })
        });

        showNotification("Relatório atualizado com sucesso!");
        closeModal('modal-relatorio');
        loadHistorico(); // Atualizar a tabela
    } catch (e) {
        showNotification(e.message, true);
    }
}

// --- Signature & Helpers ---
let sigCanvas, sigCtx, isDrawing = false;
let sigCanvasTech, sigCtxTech, isDrawingTech = false;

function initSignaturePad() {
    sigCanvas = document.getElementById('signature-pad');
    if (sigCanvas) {
        sigCtx = sigCanvas.getContext('2d');
        sigCtx.lineWidth = 2; sigCtx.lineCap = 'round'; sigCtx.strokeStyle = '#000';
        sigCanvas.addEventListener('mousedown', (e) => { isDrawing = true; sigCtx.beginPath(); const p = getPos(e); sigCtx.moveTo(p.x, p.y); });
        sigCanvas.addEventListener('mousemove', (e) => { if (!isDrawing) return; const p = getPos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); });
        sigCanvas.addEventListener('mouseup', () => isDrawing = false);
        sigCanvas.addEventListener('mouseout', () => isDrawing = false);
        // Touch
        sigCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); isDrawing = true; sigCtx.beginPath(); const p = getPos(e); sigCtx.moveTo(p.x, p.y); }, {passive: false});
        sigCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (!isDrawing) return; const p = getPos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); }, {passive: false});
        sigCanvas.addEventListener('touchend', () => isDrawing = false);

        document.getElementById('btn-clear-signature').addEventListener('click', clearSignature);
    }

    sigCanvasTech = document.getElementById('signature-pad-tech');
    if (sigCanvasTech) {
        sigCtxTech = sigCanvasTech.getContext('2d');
        sigCtxTech.lineWidth = 2; sigCtxTech.lineCap = 'round'; sigCtxTech.strokeStyle = '#000';
        sigCanvasTech.addEventListener('mousedown', (e) => { isDrawingTech = true; sigCtxTech.beginPath(); const p = getPosTech(e); sigCtxTech.moveTo(p.x, p.y); });
        sigCanvasTech.addEventListener('mousemove', (e) => { if (!isDrawingTech) return; const p = getPosTech(e); sigCtxTech.lineTo(p.x, p.y); sigCtxTech.stroke(); });
        sigCanvasTech.addEventListener('mouseup', () => isDrawingTech = false);
        sigCanvasTech.addEventListener('mouseout', () => isDrawingTech = false);
        // Touch
        sigCanvasTech.addEventListener('touchstart', (e) => { e.preventDefault(); isDrawingTech = true; sigCtxTech.beginPath(); const p = getPosTech(e); sigCtxTech.moveTo(p.x, p.y); }, {passive: false});
        sigCanvasTech.addEventListener('touchmove', (e) => { e.preventDefault(); if (!isDrawingTech) return; const p = getPosTech(e); sigCtxTech.lineTo(p.x, p.y); sigCtxTech.stroke(); }, {passive: false});
        sigCanvasTech.addEventListener('touchend', () => isDrawingTech = false);

        document.getElementById('btn-clear-signature-tech').addEventListener('click', clearSignatureTech);
    }
}

function getPos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    const cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    const cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * (sigCanvas.width / rect.width), y: (cy - rect.top) * (sigCanvas.height / rect.height) };
}
function getPosTech(e) {
    const rect = sigCanvasTech.getBoundingClientRect();
    const cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    const cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) * (sigCanvasTech.width / rect.width), y: (cy - rect.top) * (sigCanvasTech.height / rect.height) };
}

function clearSignature() { if (sigCtx) sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); }
function clearSignatureTech() { if (sigCtxTech) sigCtxTech.clearRect(0, 0, sigCanvasTech.width, sigCanvasTech.height); }

function isCanvasBlank(canvas) {
    if (!canvas) return true;
    const blank = document.createElement('canvas');
    blank.width = canvas.width; blank.height = canvas.height;
    return canvas.toDataURL() === blank.toDataURL();
}

function HHmmToHours(hhmm) {
    if (!hhmm || !hhmm.includes(':')) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h + (m / 60);
}

// --- Anotações / Checklist Futura ---
async function loadAnotacoes() {
    try {
        const anotacoes = await apiFetch('/admin/anotacoes');
        const containerPendentes = document.getElementById('anotacoes-pendentes-container');
        const containerConcluidas = document.getElementById('anotacoes-concluidas-container');
        if (!containerPendentes || !containerConcluidas) return;

        containerPendentes.innerHTML = '';
        containerConcluidas.innerHTML = '';

        const filterCli = document.getElementById('filter-anotacoes-cliente')?.value;

        let filtered = anotacoes;
        if (filterCli) {
            filtered = filtered.filter(a => a.cliente_id == filterCli);
        }

        const pendentes = filtered.filter(a => a.estado === 'pendente');
        const conluídas = filtered.filter(a => a.estado === 'concluida');

        if (pendentes.length === 0) {
            containerPendentes.innerHTML = '<p style="text-align:center; grid-column: 1/-1; color:var(--text-secondary); padding: 20px;">Não existem anotações pendentes.</p>';
        } else {
            renderAnotacoesGrouped(pendentes, containerPendentes);
        }

        if (conluídas.length === 0) {
            containerConcluidas.innerHTML = '<p style="text-align:center; grid-column: 1/-1; color:var(--text-secondary); padding: 20px;">Não existem anotações concluídas.</p>';
        } else {
            renderAnotacoesGrouped(conluídas, containerConcluidas, true);
        }

    } catch (e) {
        showNotification(e.message, true);
    }
}

function renderAnotacoesGrouped(data, container, isConcluida = false) {
    // Agrupar por cliente
    const agrupado = {};
    data.forEach(a => {
        if (!agrupado[a.cliente_nome]) agrupado[a.cliente_nome] = [];
        agrupado[a.cliente_nome].push(a);
    });

    Object.keys(agrupado).forEach(cliente => {
        const card = document.createElement('div');
        card.className = 'anotacoes-client-card';
        card.style.background = 'var(--surface-color)';
        card.style.borderRadius = '12px';
        card.style.boxShadow = 'var(--shadow-sm)';
        card.style.padding = '20px';
        card.style.border = '1px solid var(--border-color)';

        let itemsHtml = '';
        agrupado[cliente].forEach(item => {
            const dataStr = new Date(item.data_criacao).toLocaleDateString('pt-PT');
            const maquinaStr = item.maquina_id ? `<span style="font-size:11px; color:var(--accent); font-weight:700; background:var(--accent-light); padding:2px 6px; border-radius:4px;">${escapeHTML(item.marca)} ${escapeHTML(item.modelo)}</span>` : '';
            
            const opacity = isConcluida ? '0.6' : '1';
            const textDecoration = isConcluida ? 'text-decoration: line-through;' : '';

            itemsHtml += `
                <div style="display:flex; gap:12px; padding:12px; background:#f8fafc; border-radius:8px; margin-bottom:10px; align-items:flex-start; opacity: ${opacity}; transition: opacity 0.3s;">
                    <input type="checkbox" class="btn-concluir-anotacao" data-id="${item.id}"
                           style="width:20px; height:20px; cursor:pointer; accent-color:var(--primary); margin-top:3px;" 
                           ${isConcluida ? 'checked disabled' : ''}>
                    <div style="flex:1;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            ${maquinaStr}
                            <span style="font-size:11px; color:var(--text-secondary); font-weight:600;">${dataStr}</span>
                        </div>
                        <p style="font-size:14px; color:var(--text-main); margin:0; line-height:1.4; white-space:pre-wrap; ${textDecoration}">${escapeHTML(item.descricao)}</p>
                        <div style="margin-top:8px; font-size:11px; color:var(--text-secondary); display:flex; align-items:center; gap:4px;">
                            <i class="ph ph-user-circle"></i> Técnico: ${escapeHTML(item.tecnico_nome)}
                        </div>
                    </div>
                </div>
            `;
        });

        card.innerHTML = `
            <h3 style="margin-bottom:15px; font-size:16px; display:flex; align-items:center; gap:8px; color:var(--accent);">
                <i class="ph ph-buildings"></i> ${escapeHTML(cliente)}
            </h3>
            <div class="checklist-items">
                ${itemsHtml}
            </div>
        `;
        container.appendChild(card);
    });

    // Vincular eventos de conclusão
    container.querySelectorAll('.btn-concluir-anotacao').forEach(btn => {
        btn.onclick = (e) => {
            const id = e.target.dataset.id;
            window.concluirAnotacao(id);
        };
    });
}

window.concluirAnotacao = async function(id) {
    if (!confirm('Deseja marcar esta anotação como concluída? Ela passará para a lista de concluídas.')) {
        loadAnotacoes(); 
        return;
    }

    try {
        await apiFetch(`/admin/anotacoes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'concluida' })
        });
        showNotification('Anotação concluída!');
        loadAnotacoes();
    } catch (e) {
        showNotification(e.message, true);
    }
};

// --- Manutenções Recorrentes ---
async function loadRecorrentes(forceFetch = true) {
    try {
        if (forceFetch || !cachedClientes) {
            cachedClientes = await apiFetch('/clientes');
        }
        const tbody = document.getElementById('table-recorrentes-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const searchQuery = (document.getElementById('search-recorrente')?.value || '').toLowerCase().trim();

        const filtered = cachedClientes.filter(c => {
            if (!searchQuery) return true;
            const idStr = String(c.id);
            const nome = (c.nome || '').toLowerCase();
            const tel = (c.telefone || '').toLowerCase();
            const email = (c.email || '').toLowerCase();
            const morada = (c.morada || '').toLowerCase();
            const nif = (c.NIF || '').toLowerCase();
            return idStr.includes(searchQuery) || nome.includes(searchQuery) || tel.includes(searchQuery) || email.includes(searchQuery) || morada.includes(searchQuery) || nif.includes(searchQuery);
        });

        filtered.forEach(c => {
            const tr = document.createElement('tr');
            const isAuto = c.manutencao_automatica === 1;
            const statusBadge = isAuto 
                ? '<span class="badge" style="background:#dcfce7; color:#15803d; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600; display:inline-flex; align-items:center; gap:4px;"><i class="ph ph-check-circle"></i> Ativo</span>'
                : '<span class="badge" style="background:#f1f5f9; color:#64748b; padding:4px 8px; border-radius:12px; font-size:11px; font-weight:600; display:inline-flex; align-items:center; gap:4px;"><i class="ph ph-minus-circle"></i> Inativo</span>';
            
            let freqText = '-';
            if (isAuto && c.manutencao_periodo) {
                freqText = c.manutencao_periodo.charAt(0).toUpperCase() + c.manutencao_periodo.slice(1);
            }

            let dateText = '-';
            if (isAuto && c.manutencao_data_inicio) {
                const dateObj = new Date(c.manutencao_data_inicio);
                dateText = isNaN(dateObj.getTime()) ? c.manutencao_data_inicio : dateObj.toLocaleDateString('pt-PT');
            }

            tr.innerHTML = `
                <td>${c.id}</td>
                <td style="font-weight: 600; color: var(--text-primary);">${escapeHTML(c.nome)}</td>
                <td>${statusBadge}</td>
                <td>${freqText}</td>
                <td>${dateText}</td>
                <td>
                    <button class="btn-edit-recorrente btn-filter-main" title="Configurar Manutenção" style="padding: 6px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: white; cursor: pointer;">
                        <i class="ph ph-gear" style="font-size: 18px; color: var(--accent);"></i>
                    </button>
                </td>
            `;

            tr.querySelector('.btn-edit-recorrente').onclick = () => openRecorrenteModal(c);
            tbody.appendChild(tr);
        });
    } catch (e) {
        showNotification(e.message, true);
    }
}

function openRecorrenteModal(c) {
    document.getElementById('recorrente-client-id').value = c.id;
    document.getElementById('recorrente-client-nome').value = c.nome;

    const isAuto = c.manutencao_automatica === 1;
    document.getElementById('recorrente-manutencao-automatica').checked = isAuto;
    document.getElementById('recorrente-manutencao-periodo').value = c.manutencao_periodo || 'trimestral';
    document.getElementById('recorrente-manutencao-data-inicio').value = c.manutencao_data_inicio || '';
    document.getElementById('recorrente-periodo-wrapper').style.display = isAuto ? 'block' : 'none';

    openModal('modal-edit-recorrente');
}

document.getElementById('form-edit-recorrente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('recorrente-client-id').value;
    const client = cachedClientes.find(c => c.id == id);
    if (!client) return;

    const manutencao_automatica = document.getElementById('recorrente-manutencao-automatica').checked ? 1 : 0;
    const manutencao_periodo = manutencao_automatica ? document.getElementById('recorrente-manutencao-periodo').value : null;
    const manutencao_data_inicio = manutencao_automatica ? document.getElementById('recorrente-manutencao-data-inicio').value : null;

    if (manutencao_automatica && !manutencao_data_inicio) {
        showNotification('A data da primeira manutenção é obrigatória!', true);
        return;
    }

    try {
        await apiFetch(`/clientes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nome: client.nome,
                telefone: client.telefone,
                email: client.email,
                morada: client.morada,
                NIF: client.NIF,
                manutencao_automatica,
                manutencao_periodo,
                manutencao_data_inicio
            })
        });
        showNotification('Configuração de manutenção atualizada!');
        closeModal('modal-edit-recorrente');
        loadRecorrentes(true);
    } catch (err) {
        showNotification(err.message, true);
    }
});

// --- Gestão de Stock ---
let cachedProducts = [];

async function loadStock() {
    try {
        const products = await apiFetch('/stock');
        cachedProducts = products;
        updateStockCategoriesFilter(products);
        renderStockTable(products);
    } catch (e) {
        showNotification(e.message, true);
    }
}

function updateStockCategoriesFilter(products) {
    const filterSelect = document.getElementById('filter-stock-category');
    const pillsContainer = document.getElementById('stock-categories-pills');
    if (!filterSelect) return;
    
    const currentVal = filterSelect.value;
    const categories = [...new Set(products.map(p => p.categoria_produto).filter(Boolean))].sort();
    
    // 1. Sincronizar o elemento select original oculto (para retrocompatibilidade)
    filterSelect.innerHTML = '<option value="">Todas as Categorias</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        filterSelect.appendChild(opt);
    });
    
    if (categories.includes(currentVal)) {
        filterSelect.value = currentVal;
    } else {
        filterSelect.value = "";
    }
    
    if (!pillsContainer) return;
    
    // 2. Renderizar dinamicamente as pills de categoria
    const activeVal = filterSelect.value;
    pillsContainer.innerHTML = '';
    
    // Pill "Todas"
    const allPill = document.createElement('button');
    allPill.className = `category-pill ${activeVal === "" ? "active" : ""}`;
    allPill.innerHTML = `<i class="ph ph-squares-four"></i> Todas`;
    allPill.addEventListener('click', () => {
        filterSelect.value = "";
        filterSelect.dispatchEvent(new Event('change'));
        updatePillSelection("");
    });
    pillsContainer.appendChild(allPill);
    
    // Pills das Categorias
    categories.forEach(cat => {
        const pill = document.createElement('button');
        pill.className = `category-pill ${activeVal === cat ? "active" : ""}`;
        pill.textContent = cat;
        pill.addEventListener('click', () => {
            filterSelect.value = cat;
            filterSelect.dispatchEvent(new Event('change'));
            updatePillSelection(cat);
        });
        pillsContainer.appendChild(pill);
    });
}

function updatePillSelection(selectedCategory) {
    const pillsContainer = document.getElementById('stock-categories-pills');
    if (!pillsContainer) return;
    const pills = pillsContainer.querySelectorAll('.category-pill');
    pills.forEach((pill, idx) => {
        if (idx === 0) {
            // A pill "Todas" está no índice 0
            if (selectedCategory === "") {
                pill.classList.add('active');
            } else {
                pill.classList.remove('active');
            }
        } else {
            // Outras pills correspondem à categoria de texto
            if (pill.textContent.trim() === selectedCategory) {
                pill.classList.add('active');
            } else {
                pill.classList.remove('active');
            }
        }
    });
}

function renderStockTable(products) {
    const tbody = document.getElementById('table-stock-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const searchVal = document.getElementById('search-stock').value.toLowerCase().trim();
    const categoryVal = document.getElementById('filter-stock-category').value;
    
    const filtered = products.filter(p => {
        if (categoryVal && p.categoria_produto !== categoryVal) return false;
        if (searchVal) {
            const nameMatch = p.nome_produto && p.nome_produto.toLowerCase().includes(searchVal);
            const barcodeMatch = p.codigo_barras && p.codigo_barras.toLowerCase().includes(searchVal);
            const categoryMatch = p.categoria_produto && p.categoria_produto.toLowerCase().includes(searchVal);
            const supplierMatch = p.fornecedor_nome && p.fornecedor_nome.toLowerCase().includes(searchVal);
            return nameMatch || barcodeMatch || categoryMatch || supplierMatch;
        }
        return true;
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-secondary); padding: 30px 10px;">Nenhum produto encontrado.</td></tr>`;
        return;
    }
    
    filtered.forEach(p => {
        const tr = document.createElement('tr');
        const lastAddedDateStr = p.data_ultima_adicao ? new Date(p.data_ultima_adicao).toLocaleString('pt-PT') : '-';
        
        const isLowStock = p.quantidade_minima !== null && p.quantidade_minima !== undefined && p.quantidade <= p.quantidade_minima;
        const qtyColorStyle = isLowStock ? 'color: var(--danger); font-weight: bold;' : '';
        const warningIcon = isLowStock ? `<i class="ph ph-warning-circle" style="color: var(--danger); font-size: 16px; vertical-align: middle;" title="Abaixo do stock mínimo! (Mínimo: ${p.quantidade_minima} ${p.unidade || 'un'})"></i>` : '';
        
        tr.innerHTML = `
            <td>
                <span class="barcode-badge" style="font-family: monospace; background: #f1f5f9; padding: 4px 8px; border-radius: 6px; font-size: 13px;">
                    ${p.codigo_barras ? p.codigo_barras : '<span style="color:#94a3b8; font-style:italic;">Sem código</span>'}
                </span>
            </td>
            <td><strong>${escapeHTML(p.nome_produto)}</strong></td>
            <td>${p.categoria_produto ? escapeHTML(p.categoria_produto) : '<span style="color:#94a3b8; font-style:italic;">Sem categoria</span>'}</td>
            <td>${p.fornecedor_nome ? `<a href="#" class="supplier-detail-link" data-id="${p.fornecedor_id}" style="color: var(--accent); font-weight: 600; text-decoration: none; border-bottom: 1px dashed var(--accent); cursor: pointer;">${escapeHTML(p.fornecedor_nome)}</a>` : '<span style="color:#94a3b8; font-style:italic;">Sem fornecedor</span>'}</td>
            <td style="text-align: center;">
                <div class="qty-control">
                    <button class="qty-btn btn-qty-dec" title="Diminuir Stock">-</button>
                    <span class="qty-val" style="display: flex; align-items: center; gap: 4px; ${qtyColorStyle}">
                        ${warningIcon}
                        <span>${Number(Number(p.quantidade).toFixed(2).replace(/\.00$/, ''))}</span>
                        <span style="font-size: 11px; color: ${isLowStock ? 'var(--danger)' : 'var(--text-secondary)'}; font-weight: 600; text-transform: lowercase;">${p.unidade || 'un'}</span>
                    </span>
                    <button class="qty-btn btn-qty-inc" title="Aumentar Stock">+</button>
                </div>
            </td>
            <td>${lastAddedDateStr}</td>
            <td>
                <div style="display:flex; justify-content: flex-end; gap:8px;">
                    <button class="btn-icon btn-qr-stock" title="Imprimir QR Code">
                        <i class="ph ph-qr-code"></i>
                    </button>
                    <button class="btn-icon btn-edit-stock" title="Editar Produto">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="btn-icon delete btn-delete-stock" title="Eliminar Produto">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </td>
        `;
        
        tr.querySelector('.btn-qty-dec').addEventListener('click', () => openAddStockQtyModal(p, 'subtract'));
        tr.querySelector('.btn-qty-inc').addEventListener('click', () => openAddStockQtyModal(p, 'add'));
        tr.querySelector('.btn-qr-stock').addEventListener('click', () => generateProductQR(p.id, p.nome_produto));
        tr.querySelector('.btn-edit-stock').addEventListener('click', () => openEditProductModal(p));
        tr.querySelector('.btn-delete-stock').addEventListener('click', () => deleteProduct(p.id));
        
        const supplierLink = tr.querySelector('.supplier-detail-link');
        if (supplierLink) {
            supplierLink.addEventListener('click', (e) => {
                e.preventDefault();
                showSupplierDetails(p.fornecedor_id);
            });
        }
        
        tbody.appendChild(tr);
    });
}

async function adjustStockQty(id, delta) {
    try {
        await apiFetch(`/stock/${id}/quantity`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta })
        });
        showNotification('Stock atualizado com sucesso!');
        loadStock();
    } catch (e) {
        showNotification(e.message, true);
    }
}

async function deleteProduct(id) {
    if (!confirm('Tem a certeza que deseja eliminar este produto do stock?')) return;
    try {
        await apiFetch(`/stock/${id}`, { method: 'DELETE' });
        showNotification('Produto eliminado do stock.');
        loadStock();
    } catch (e) {
        showNotification(e.message, true);
    }
}

let cachedStockMovements = [];

async function loadHistoricoStock() {
    try {
        const movements = await apiFetch('/stock/movimentos');
        cachedStockMovements = movements;
        
        // Popula select de clientes e garante que temos a lista
        await loadClientes(false);
        
        // Configura listeners para filtros se necessário
        const filterIds = [
            'search-hist-stock',
            'filter-hist-stock-client',
            'filter-hist-stock-type',
            'filter-hist-stock-date-start',
            'filter-hist-stock-date-end'
        ];
        
        filterIds.forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.dataset.listenerAdded) {
                el.addEventListener(id === 'search-hist-stock' ? 'input' : 'change', () => {
                    renderHistoricoStockTable(cachedStockMovements);
                });
                el.dataset.listenerAdded = 'true';
            }
        });

        renderHistoricoStockTable(movements);
    } catch (e) {
        showNotification(e.message, true);
    }
}

function renderHistoricoStockTable(movements) {
    const tbody = document.getElementById('table-historico-stock-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const searchVal = (document.getElementById('search-hist-stock')?.value || '').toLowerCase().trim();
    const clientVal = document.getElementById('filter-hist-stock-client')?.value;
    const typeVal = document.getElementById('filter-hist-stock-type')?.value;
    const dateStartVal = document.getElementById('filter-hist-stock-date-start')?.value;
    const dateEndVal = document.getElementById('filter-hist-stock-date-end')?.value;

    const filtered = movements.filter(m => {
        // 1. Filtro de pesquisa (produto, quem, referência, cliente)
        if (searchVal) {
            const prodMatch = m.nome_produto && m.nome_produto.toLowerCase().includes(searchVal);
            const userMatch = m.utilizador_nome && m.utilizador_nome.toLowerCase().includes(searchVal);
            const refMatch = m.referencia_id && String(m.referencia_id).includes(searchVal);
            const clientMatch = m.cliente_nome && m.cliente_nome.toLowerCase().includes(searchVal);
            if (!prodMatch && !userMatch && !refMatch && !clientMatch) return false;
        }

        // 2. Filtro de cliente
        if (clientVal && m.cliente_id != clientVal) return false;

        // 3. Filtro de tipo
        if (typeVal) {
            if (typeVal === 'consumo') {
                if (!['consumo_avaria', 'consumo_servico', 'consumo_manutencao', 'ajuste_avaria', 'ajuste_servico', 'ajuste_manutencao'].includes(m.tipo_movimento)) return false;
            } else if (typeVal === 'ajuste') {
                if (m.tipo_movimento !== 'ajuste_manual') return false;
            } else if (typeVal === 'adicao') {
                if (!['registo_inicial', 'adicao_codigo_barras'].includes(m.tipo_movimento)) return false;
            }
        }

        // 4. Filtro de data
        if (m.data_hora) {
            const mDate = new Date(m.data_hora);
            if (dateStartVal) {
                const start = new Date(dateStartVal);
                start.setHours(0, 0, 0, 0);
                if (mDate < start) return false;
            }
            if (dateEndVal) {
                const end = new Date(dateEndVal);
                end.setHours(23, 59, 59, 999);
                if (mDate > end) return false;
            }
        }

        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-secondary); padding: 30px 10px;">Nenhum registo encontrado.</td></tr>`;
        return;
    }

    const typeLabels = {
        'registo_inicial': 'Registo Inicial',
        'ajuste_manual': 'Ajuste Manual',
        'adicao_codigo_barras': 'Leitura Código Barras',
        'consumo_avaria': 'Consumo (Avaria)',
        'consumo_servico': 'Consumo (Serviço)',
        'consumo_manutencao': 'Consumo (Manutenção)',
        'ajuste_avaria': 'Ajuste (Avaria)',
        'ajuste_servico': 'Ajuste (Serviço)',
        'ajuste_manutencao': 'Ajuste (Manutenção)'
    };

    filtered.forEach(m => {
        const tr = document.createElement('tr');
        const dateStr = m.data_hora ? new Date(m.data_hora).toLocaleString('pt-PT') : '-';
        
        // Quantidade formatting & colors
        const qtyVal = Number(Number(m.quantidade).toFixed(2).replace(/\.00$/, ''));
        let qtyText = qtyVal;
        let qtyColor = 'var(--text-primary)';
        if (qtyVal > 0) {
            qtyText = `+${qtyVal}`;
            qtyColor = 'var(--success)';
        } else if (qtyVal < 0) {
            qtyText = `${qtyVal}`;
            qtyColor = 'var(--danger)';
        }
        
        const typeLabel = typeLabels[m.tipo_movimento] || m.tipo_movimento;
        
        // badge background/color based on type
        let badgeBg = '#f1f5f9';
        let badgeColor = '#475569';
        if (m.tipo_movimento.includes('consumo')) {
            badgeBg = '#fee2e2';
            badgeColor = '#b91c1c';
        } else if (m.tipo_movimento.includes('ajuste_manual')) {
            badgeBg = '#e0f2fe';
            badgeColor = '#0369a1';
        } else if (['registo_inicial', 'adicao_codigo_barras'].includes(m.tipo_movimento)) {
            badgeBg = 'var(--accent-light)';
            badgeColor = 'var(--accent)';
        }

        // Referência formatting
        let refText = '-';
        if (m.referencia_id) {
            if (m.tipo_movimento.includes('avaria')) {
                refText = `Avaria #${m.referencia_id}`;
            } else if (m.tipo_movimento.includes('servico')) {
                refText = `Serviço #${m.referencia_id}`;
            } else if (m.tipo_movimento.includes('manutencao')) {
                refText = `Manutenção #${m.referencia_id}`;
            } else {
                refText = `#${m.referencia_id}`;
            }
        }

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td><strong>${escapeHTML(m.nome_produto || 'Produto Eliminado')}</strong></td>
            <td style="text-align: center; font-weight: bold; color: ${qtyColor};">${qtyText} <span style="font-size: 11px; font-weight: normal; color: var(--text-secondary); text-transform: lowercase;">${m.unidade || 'un'}</span></td>
            <td><span class="badge-type" style="padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; background: ${badgeBg}; color: ${badgeColor};">${typeLabel}</span></td>
            <td>${escapeHTML(m.utilizador_nome || 'Sistema')}</td>
            <td>${m.cliente_nome ? escapeHTML(m.cliente_nome) : '<span style="color:#94a3b8; font-style:italic;">N/A</span>'}</td>
            <td><span style="font-family: monospace; font-size: 13px;">${refText}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

let html5QrScanner = null;
let activeScanTargetInputId = null;
let scannerInitializing = false;
let scanTimeoutId = null;

function openBarcodeScanner(targetInputId = null) {
    activeScanTargetInputId = targetInputId;
    openModal('modal-barcode-scanner');
    
    const scannerStatus = document.getElementById('scanner-status');
    if (scannerStatus) scannerStatus.textContent = "A inicializar câmara...";
    
    // Reset reader container display
    const readerContainer = document.getElementById('barcode-reader-container');
    if (readerContainer) readerContainer.style.display = 'block';
    
    if (html5QrScanner) {
        if (html5QrScanner.isScanning) {
            html5QrScanner.stop().catch(err => console.error(err));
        }
        html5QrScanner = null;
    }
    
    if (scanTimeoutId) {
        clearTimeout(scanTimeoutId);
    }
    
    scannerInitializing = true;
    
    scanTimeoutId = setTimeout(() => {
        if (!scannerInitializing) return;
        
        try {
            const config = {
                fps: 20,
                qrbox: (width, height) => {
                    const w = width || 300;
                    const h = height || 300;
                    const size = Math.min(w * 0.75, h * 0.75, 250);
                    return { width: Math.floor(size), height: Math.floor(size) };
                }
            };
            
            const startWithCamera = (cameraIdOrFacingMode) => {
                const container = document.getElementById("barcode-reader");
                if (container) container.innerHTML = "";
                
                html5QrScanner = new Html5Qrcode("barcode-reader");
                
                const constraints = typeof cameraIdOrFacingMode === 'string'
                    ? { deviceId: { exact: cameraIdOrFacingMode } }
                    : cameraIdOrFacingMode;
                
                if (typeof constraints === 'object') {
                    constraints.width = { ideal: 1280 };
                    constraints.height = { ideal: 720 };
                }
                
                return html5QrScanner.start(
                    constraints,
                    config,
                    onBarcodeScanSuccess,
                    onBarcodeScanFailure
                );
            };
            
            const setupCameraControls = () => {
                if (!scannerInitializing) return;
                if (scannerStatus) scannerStatus.textContent = "A ler código de barras...";
                
                try {
                    const track = html5QrScanner.getVideoRepresentativeTrack();
                    if (!track) return;
                    
                    const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
                    
                    const btnTorch = document.getElementById('btn-toggle-camera-torch');
                    if (capabilities.torch && btnTorch) {
                        btnTorch.style.display = 'inline-flex';
                        let torchOn = false;
                        btnTorch.onclick = () => {
                            torchOn = !torchOn;
                            if (typeof html5QrScanner.applyVideoConstraints === 'function') {
                                html5QrScanner.applyVideoConstraints({
                                    advanced: [{ torch: torchOn }]
                                }).catch(e => console.error("Error setting torch via library", e));
                            } else {
                                track.applyConstraints({
                                    advanced: [{ torch: torchOn }]
                                }).catch(e => console.error("Error setting torch via track", e));
                            }
                        };
                    } else if (btnTorch) {
                        btnTorch.style.display = 'none';
                    }
                    
                    if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
                        if (typeof html5QrScanner.applyVideoConstraints === 'function') {
                            html5QrScanner.applyVideoConstraints({
                                advanced: [{ focusMode: 'continuous' }]
                            }).catch(e => console.error("Error setting focusMode via library", e));
                        } else {
                            track.applyConstraints({
                                advanced: [{ focusMode: 'continuous' }]
                            }).catch(e => console.error("Error setting focusMode via track", e));
                        }
                    }
                    
                    const zoomContainer = document.getElementById('scanner-zoom-container');
                    const zoomSlider = document.getElementById('scanner-zoom-slider');
                    const zoomValue = document.getElementById('scanner-zoom-value');
                    
                    if (zoomContainer) {
                        zoomContainer.style.display = 'flex';
                        
                        const hasNativeZoom = !!capabilities.zoom;
                        const minZoom = hasNativeZoom ? (capabilities.zoom.min || 1) : 1;
                        const maxZoom = hasNativeZoom ? (capabilities.zoom.max || 1) : 4;
                        const stepZoom = hasNativeZoom ? (capabilities.zoom.step || 0.1) : 0.1;
                        
                        const setZoom = (val) => {
                            const targetZoom = Math.max(minZoom, Math.min(maxZoom, val));
                            if (zoomSlider) zoomSlider.value = targetZoom;
                            if (zoomValue) zoomValue.textContent = `${targetZoom.toFixed(1)}x`;
                            
                            if (hasNativeZoom) {
                                if (typeof html5QrScanner.applyVideoConstraints === 'function') {
                                    html5QrScanner.applyVideoConstraints({
                                        advanced: [{ zoom: targetZoom }]
                                    }).catch(e => console.error("Error setting zoom via library", e));
                                } else {
                                    track.applyConstraints({
                                        advanced: [{ zoom: targetZoom }]
                                    }).catch(e => console.error("Error setting zoom via track", e));
                                }
                            } else {
                                const videoEl = document.querySelector('#barcode-reader video');
                                if (videoEl) {
                                    videoEl.style.transform = `scale(${targetZoom})`;
                                    videoEl.style.transformOrigin = 'center';
                                }
                            }
                        };
                        
                        if (zoomSlider) {
                            zoomSlider.min = minZoom;
                            zoomSlider.max = maxZoom;
                            zoomSlider.step = stepZoom;
                            zoomSlider.value = minZoom;
                            if (zoomValue) zoomValue.textContent = `${minZoom.toFixed(1)}x`;
                            
                            zoomSlider.oninput = (e) => {
                                const val = parseFloat(e.target.value);
                                setZoom(val);
                            };
                        }
                        
                        const btnZoom1x = document.getElementById('btn-zoom-1x');
                        const btnZoom2x = document.getElementById('btn-zoom-2x');
                        const btnZoom3x = document.getElementById('btn-zoom-3x');
                        const btnZoom4x = document.getElementById('btn-zoom-4x');
                        
                        if (btnZoom1x) {
                            btnZoom1x.onclick = () => setZoom(1);
                        }
                        if (btnZoom2x) {
                            btnZoom2x.onclick = () => setZoom(2);
                        }
                        if (btnZoom3x) {
                            btnZoom3x.onclick = () => setZoom(3);
                        }
                        if (btnZoom4x) {
                            btnZoom4x.onclick = () => setZoom(4);
                        }
                    }
                } catch (e) {
                    console.log("Controls setup error", e);
                }
            };
            
            const fallbackStart = () => {
                startWithCamera({ facingMode: "environment" }).catch(err => {
                    console.warn("Fallback environment failed, trying any camera", err);
                    return startWithCamera({});
                }).then(() => {
                    setupCameraControls();
                }).catch(err => {
                    console.error("All camera start attempts failed", err);
                    if (scannerInitializing) {
                        const readerContainer = document.getElementById('barcode-reader-container');
                        if (readerContainer) readerContainer.style.display = 'none';
                        
                        const zoomContainer = document.getElementById('scanner-zoom-container');
                        if (zoomContainer) zoomContainer.style.display = 'none';
                        
                        const btnTorch = document.getElementById('btn-toggle-camera-torch');
                        if (btnTorch) btnTorch.style.display = 'none';
                        
                        if (scannerStatus) {
                            scannerStatus.innerHTML = `<span style="font-size: 15px; color: var(--text-main); font-weight: 600; display: block; margin-bottom: 8px;">Por favor, clique no botão abaixo para tirar uma foto do código de barras:</span>`;
                        }
                    }
                });
            };
            
            fallbackStart();
            
        } catch (e) {
            console.error("Erro ao instanciar Html5Qrcode:", e);
        }
    }, 300);
}

function closeBarcodeScanner() {
    scannerInitializing = false;
    if (scanTimeoutId) {
        clearTimeout(scanTimeoutId);
        scanTimeoutId = null;
    }
    closeModal('modal-barcode-scanner');
    
    if (html5QrScanner) {
        const scannerToStop = html5QrScanner;
        html5QrScanner = null;
        
        if (scannerToStop.isScanning) {
            scannerToStop.stop().then(() => {
                try {
                    scannerToStop.clear();
                } catch(e) {
                    console.error("Erro ao limpar scanner:", e);
                }
            }).catch(err => {
                console.error("Erro ao desligar câmara:", err);
            });
        } else {
            try {
                scannerToStop.clear();
            } catch(e) {
                console.error("Erro ao limpar scanner:", e);
            }
        }
    }
    
    const btnTorch = document.getElementById('btn-toggle-camera-torch');
    if (btnTorch) btnTorch.style.display = 'none';
    
    const btnSwitch = document.getElementById('btn-switch-camera');
    if (btnSwitch) btnSwitch.style.display = 'none';
    
    const zoomContainer = document.getElementById('scanner-zoom-container');
    if (zoomContainer) zoomContainer.style.display = 'none';
    
    // Reset visual scale on video element
    const videoEl = document.querySelector('#barcode-reader video');
    if (videoEl) {
        videoEl.style.transform = '';
    }
    
    // Reset zoom slider controls
    const zoomSlider = document.getElementById('scanner-zoom-slider');
    if (zoomSlider) {
        zoomSlider.value = 1;
        zoomSlider.min = 1;
        zoomSlider.max = 1;
    }
    const zoomValue = document.getElementById('scanner-zoom-value');
    if (zoomValue) zoomValue.textContent = '1.0x';
}

function scanFileBarcode(file) {
    const scannerStatus = document.getElementById('scanner-status');
    const container = document.getElementById("barcode-reader");
    if (container) container.innerHTML = "";
    
    const fileScanner = new Html5Qrcode("barcode-reader");
    fileScanner.scanFile(file, true)
        .then(decodedText => {
            if (scannerStatus) scannerStatus.textContent = "Código detetado com sucesso!";
            onBarcodeScanSuccess(decodedText);
        })
        .catch(err => {
            console.error("Error scanning file", err);
            if (scannerStatus) {
                scannerStatus.textContent = "Erro: Não foi possível ler o código na foto. Aproxime a câmara para focar e certifique-se de que há boa luz.";
            }
            showNotification("Erro ao ler código. Tente tirar a foto com melhor focagem e luz.", true);
        });
}

window.openBarcodeScanner = openBarcodeScanner;
window.closeBarcodeScanner = closeBarcodeScanner;

function playSuccessBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.15);
    } catch (e) {
        console.error("Web Audio API error", e);
    }
}

async function onBarcodeScanSuccess(decodedText, decodedResult) {
    console.log(`Scan success: ${decodedText}`, decodedResult);
    playSuccessBeep();
    
    closeBarcodeScanner();
    
    if (activeScanTargetInputId) {
        const input = document.getElementById(activeScanTargetInputId);
        if (input) {
            input.value = decodedText;
            showNotification(`Código lido: ${decodedText}`);
        }
        return;
    }
    
    try {
        const productRes = await fetch(`/api/stock/barcode/${decodedText}`, {
            headers: { 'Authorization': `Bearer ${jwtToken}` }
        });
        
        if (productRes.status === 200) {
            const data = await productRes.json();
            openAddStockQtyModal(data);
            showNotification(`Produto "${data.nome_produto}" encontrado.`);
        } else if (productRes.status === 404) {
            openAddProductModal(decodedText);
            showNotification("Código novo detetado. Preencha os dados do produto.", false);
        } else {
            const err = await productRes.json();
            showNotification(err.error || "Erro ao ler código de barras", true);
        }
    } catch (e) {
        showNotification(e.message, true);
    }
}

function updateStockProductCalcVisibility() {
    const unit = document.getElementById('stock-product-unidade').value;
    const qtyGroupVisible = document.getElementById('stock-product-qty-group').style.display !== 'none';
    const calcGroup = document.getElementById('stock-product-calc-group');
    
    if (calcGroup) {
        if (unit !== 'un' && qtyGroupVisible) {
            calcGroup.style.display = 'block';
            calcGroup.querySelectorAll('.unit-placeholder').forEach(span => {
                span.textContent = unit;
            });
        } else {
            calcGroup.style.display = 'none';
        }
    }

    // Atualizar o label da quantidade mínima
    const labelMap = {
        'un': 'unidades',
        'l': 'litros',
        'kg': 'kilos',
        'm': 'metros'
    };
    const label = document.getElementById('lbl-stock-product-qty-minima');
    if (label) {
        const unitName = labelMap[unit] || 'unidades';
        label.textContent = `Quantidade Mínima a Notificar (${unitName})`;
    }
}

function calculateStockProductQty() {
    const embalagens = parseFloat(document.getElementById('stock-product-embalagens').value);
    const medida = parseFloat(document.getElementById('stock-product-medida').value);
    if (!isNaN(embalagens) && !isNaN(medida) && embalagens > 0 && medida > 0) {
        document.getElementById('stock-product-quantidade').value = (embalagens * medida);
    }
}

function calculateAddStockQty() {
    const embalagens = parseFloat(document.getElementById('add-stock-embalagens').value);
    const medida = parseFloat(document.getElementById('add-stock-medida').value);
    if (!isNaN(embalagens) && !isNaN(medida) && embalagens > 0 && medida > 0) {
        document.getElementById('add-stock-product-adicionar').value = (embalagens * medida);
    }
}

function openAddStockQtyModal(p, action = 'add') {
    document.getElementById('add-stock-product-id').value = p.id;
    document.getElementById('add-stock-product-nome').value = p.nome_produto;
    document.getElementById('add-stock-product-barras').value = p.codigo_barras || '';
    document.getElementById('add-stock-product-atual').value = p.quantidade;
    document.getElementById('add-stock-product-adicionar').value = 1;
    
    const unitLabel = document.getElementById('add-stock-product-unit-label');
    if (unitLabel) unitLabel.textContent = p.unidade || 'un';
    
    // Reset calculator inputs
    const addStockEmb = document.getElementById('add-stock-embalagens');
    const addStockMed = document.getElementById('add-stock-medida');
    if (addStockEmb) addStockEmb.value = '';
    if (addStockMed) addStockMed.value = '';
    
    const addCalcGroup = document.getElementById('add-stock-calc-group');
    if (addCalcGroup) {
        if (p.unidade && p.unidade !== 'un' && action === 'add') {
            addCalcGroup.style.display = 'block';
            addCalcGroup.querySelectorAll('.unit-placeholder').forEach(span => {
                span.textContent = p.unidade;
            });
        } else {
            addCalcGroup.style.display = 'none';
        }
    }
    
    // Set or create hidden action type field
    let actionInput = document.getElementById('add-stock-action-type');
    if (!actionInput) {
        actionInput = document.createElement('input');
        actionInput.type = 'hidden';
        actionInput.id = 'add-stock-action-type';
        document.getElementById('form-add-stock-qty').appendChild(actionInput);
    }
    actionInput.value = action;
    
    // Update header title and input style/label dynamically
    const modalTitle = document.querySelector('#modal-add-stock-qty h2');
    const quantityInput = document.getElementById('add-stock-product-adicionar');
    const inputLabel = quantityInput.previousElementSibling;
    
    if (action === 'subtract') {
        if (modalTitle) modalTitle.innerHTML = '<i class="ph ph-package"></i> Retirar do Stock';
        if (inputLabel) {
            inputLabel.innerHTML = `Qtd. a Retirar (<span id="add-stock-product-unit-label">${p.unidade || 'un'}</span>) *`;
            inputLabel.style.color = 'var(--danger)';
        }
        quantityInput.style.borderColor = 'var(--danger)';
    } else {
        if (modalTitle) modalTitle.innerHTML = '<i class="ph ph-package"></i> Adicionar ao Stock';
        if (inputLabel) {
            inputLabel.innerHTML = `Qtd. a Adicionar (<span id="add-stock-product-unit-label">${p.unidade || 'un'}</span>) *`;
            inputLabel.style.color = 'var(--accent)';
        }
        quantityInput.style.borderColor = 'var(--accent)';
    }
    
    openModal('modal-add-stock-qty');
}

function onBarcodeScanFailure(error) {
    // Silently ignore frame scan errors
}

function populateProductModalCategories(selectedCategory = '') {
    const select = document.getElementById('stock-product-categoria');
    if (!select) return;
    
    const categories = [...new Set(cachedProducts.map(p => p.categoria_produto).filter(Boolean))].sort();
    
    select.innerHTML = '<option value="">Nenhuma Categoria</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });
    
    if (selectedCategory && !categories.includes(selectedCategory)) {
        const opt = document.createElement('option');
        opt.value = selectedCategory;
        opt.textContent = selectedCategory;
        select.appendChild(opt);
    }
    
    select.value = selectedCategory;
}

async function populateProductModalSuppliers(selectedSupplierId = '') {
    const select = document.getElementById('stock-product-fornecedor');
    if (!select) return;
    
    select.innerHTML = '<option value="">A carregar fornecedores...</option>';
    
    try {
        const suppliers = await apiFetch('/fornecedores');
        select.innerHTML = '<option value="">Nenhum</option>';
        suppliers.forEach(sup => {
            const opt = document.createElement('option');
            opt.value = sup.id;
            opt.textContent = sup.nome;
            select.appendChild(opt);
        });
        
        select.value = selectedSupplierId || '';
    } catch (e) {
        console.error("Erro ao carregar fornecedores para modal:", e);
        select.innerHTML = '<option value="">Erro ao carregar fornecedores</option>';
    }
}

function addNewCategoryPrompt() {
    const newCat = prompt("Introduza o nome da nova categoria:");
    if (!newCat) return;
    const cleanCat = newCat.trim();
    if (!cleanCat) return;
    
    const select = document.getElementById('stock-product-categoria');
    if (!select) return;
    
    let exists = false;
    for (let option of select.options) {
        if (option.value.toLowerCase() === cleanCat.toLowerCase()) {
            select.value = option.value;
            exists = true;
            break;
        }
    }
    
    if (!exists) {
        const opt = document.createElement('option');
        opt.value = cleanCat;
        opt.textContent = cleanCat;
        select.appendChild(opt);
        select.value = cleanCat;
    }
}

// Visualizar Detalhes do Fornecedor
async function showSupplierDetails(id) {
    try {
        const sup = await apiFetch(`/fornecedores/${id}`);
        const idEl = document.getElementById('view-supplier-id');
        const nomeEl = document.getElementById('view-supplier-nome');
        const contactoEl = document.getElementById('view-supplier-contacto');
        const moradaEl = document.getElementById('view-supplier-morada');
        
        if (idEl) idEl.textContent = sup.id || '-';
        if (nomeEl) nomeEl.textContent = sup.nome || '-';
        if (contactoEl) contactoEl.textContent = sup.contacto || 'Sem contacto';
        if (moradaEl) moradaEl.textContent = sup.morada || 'Sem morada';
        
        openModal('modal-view-supplier');
    } catch (e) {
        showNotification(e.message || 'Erro ao carregar dados do fornecedor', true);
    }
}

// --- Gestão de Fornecedores ---
async function loadSuppliers() {
    const tbody = document.getElementById('table-suppliers-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 10px;">A carregar...</td></tr>';
    
    try {
        const suppliers = await apiFetch('/fornecedores');
        renderSuppliersTable(suppliers);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--danger); padding: 10px;">Erro: ${escapeHTML(e.message)}</td></tr>`;
    }
}

function renderSuppliersTable(suppliers) {
    const tbody = document.getElementById('table-suppliers-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary); padding: 15px;">Nenhum fornecedor registado.</td></tr>';
        return;
    }
    
    suppliers.forEach(sup => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${sup.id}</td>
            <td><strong>${escapeHTML(sup.nome)}</strong></td>
            <td>${sup.contacto ? escapeHTML(sup.contacto) : '<span style="color:#94a3b8; font-style:italic;">-</span>'}</td>
            <td>${sup.morada ? escapeHTML(sup.morada) : '<span style="color:#94a3b8; font-style:italic;">-</span>'}</td>
            <td>
                <div style="display:flex; justify-content: flex-end; gap:8px;">
                    <button type="button" class="btn-icon btn-edit-supplier" title="Editar Fornecedor" style="width:28px; height:28px; font-size:14px; padding:0;">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button type="button" class="btn-icon delete btn-delete-supplier" title="Eliminar Fornecedor" style="width:28px; height:28px; font-size:14px; padding:0;">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </td>
        `;
        
        tr.querySelector('.btn-edit-supplier').onclick = () => editSupplier(sup);
        tr.querySelector('.btn-delete-supplier').onclick = () => deleteSupplier(sup.id);
        tbody.appendChild(tr);
    });
}

function editSupplier(sup) {
    document.getElementById('supplier-id').value = sup.id;
    document.getElementById('supplier-nome').value = sup.nome;
    document.getElementById('supplier-contacto').value = sup.contacto || '';
    document.getElementById('supplier-morada').value = sup.morada || '';
    document.getElementById('modal-supplier-title').textContent = 'Editar Fornecedor';
    document.getElementById('btn-submit-supplier').textContent = 'Atualizar';
    openModal('modal-supplier');
}

function resetSupplierForm() {
    document.getElementById('supplier-id').value = '';
    document.getElementById('supplier-nome').value = '';
    document.getElementById('supplier-contacto').value = '';
    document.getElementById('supplier-morada').value = '';
    document.getElementById('modal-supplier-title').textContent = 'Novo Fornecedor';
    document.getElementById('btn-submit-supplier').textContent = 'Guardar';
}

async function saveSupplier(e) {
    e.preventDefault();
    const id = document.getElementById('supplier-id').value;
    const nome = document.getElementById('supplier-nome').value;
    const contacto = document.getElementById('supplier-contacto').value;
    const morada = document.getElementById('supplier-morada').value;
    
    const isEdit = id !== '';
    const endpoint = isEdit ? `/fornecedores/${id}` : '/fornecedores';
    const method = isEdit ? 'PUT' : 'POST';
    
    try {
        await apiFetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, contacto, morada })
        });
        showNotification(isEdit ? 'Fornecedor atualizado com sucesso!' : 'Fornecedor criado com sucesso!');
        closeModal('modal-supplier');
        loadSuppliers();
        
        const productModal = document.getElementById('modal-stock-product');
        if (productModal && !productModal.classList.contains('hidden')) {
            const currentSelected = document.getElementById('stock-product-fornecedor')?.value;
            populateProductModalSuppliers(currentSelected);
        }
    } catch (err) {
        showNotification(err.message, true);
    }
}

async function deleteSupplier(id) {
    if (!confirm('Tem a certeza que deseja eliminar este fornecedor?')) return;
    try {
        await apiFetch(`/fornecedores/${id}`, { method: 'DELETE' });
        showNotification('Fornecedor eliminado com sucesso.');
        loadSuppliers();
    } catch (err) {
        showNotification(err.message, true);
    }
}

function openAddProductModal(barcode = '') {
    document.getElementById('modal-stock-title').textContent = 'Novo Produto';
    document.getElementById('stock-product-id').value = '';
    document.getElementById('stock-product-nome').value = '';
    
    populateProductModalCategories('');
    populateProductModalSuppliers('');
    
    document.getElementById('stock-product-barras').value = barcode;
    document.getElementById('stock-product-quantidade').value = 0;
    document.getElementById('stock-product-unidade').value = 'un';
    document.getElementById('stock-product-qty-minima').value = 0;
    
    // Reset calculator inputs
    const stockProductEmb = document.getElementById('stock-product-embalagens');
    const stockProductMed = document.getElementById('stock-product-medida');
    if (stockProductEmb) stockProductEmb.value = '';
    if (stockProductMed) stockProductMed.value = '';
    
    document.getElementById('stock-product-qty-group').style.display = 'block';
    
    updateStockProductCalcVisibility();
    
    openModal('modal-stock-product');
}

function openEditProductModal(p) {
    document.getElementById('modal-stock-title').textContent = 'Editar Produto';
    document.getElementById('stock-product-id').value = p.id;
    document.getElementById('stock-product-nome').value = p.nome_produto;
    
    populateProductModalCategories(p.categoria_produto || '');
    populateProductModalSuppliers(p.fornecedor_id || '');
    
    document.getElementById('stock-product-barras').value = p.codigo_barras || '';
    document.getElementById('stock-product-unidade').value = p.unidade || 'un';
    document.getElementById('stock-product-qty-minima').value = p.quantidade_minima !== null && p.quantidade_minima !== undefined ? p.quantidade_minima : '';
    
    document.getElementById('stock-product-qty-group').style.display = 'none';
    
    updateStockProductCalcVisibility();
    
    openModal('modal-stock-product');
}

// --- GESTÃO DE STOCK DE MÁQUINAS ---
let cachedStockMaquinas = [];

async function loadStockMaquinas() {
    try {
        cachedStockMaquinas = await apiFetch('/stock_maquinas');
        renderStockMaquinasTable(cachedStockMaquinas);
    } catch (e) {
        showNotification(e.message, true);
    }
}

let expandedStockGroups = new Set();

function renderStockMaquinasTable(data) {
    const tbody = document.getElementById('table-stock-maquinas-body');
    tbody.innerHTML = '';

    const query = (document.getElementById('search-stock-maquina')?.value || '').toLowerCase().trim();
    const filtered = data.filter(m => {
        if (!query) return true;
        return (m.marca && m.marca.toLowerCase().includes(query)) ||
               (m.modelo && m.modelo.toLowerCase().includes(query)) ||
               (m.numero_serie && m.numero_serie.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary); padding: 15px;">Nenhuma máquina em stock encontrada.</td></tr>';
        return;
    }

    // Group by Marca + Modelo
    const groups = {};
    filtered.forEach(m => {
        const key = `${(m.marca || '').trim()}|||${(m.modelo || '').trim()}`;
        if (!groups[key]) {
            groups[key] = {
                marca: m.marca || '',
                modelo: m.modelo || '',
                units: []
            };
        }
        groups[key].units.push(m);
    });

    Object.keys(groups).forEach(key => {
        const group = groups[key];
        const tr = document.createElement('tr');
        tr.className = 'group-row';
        tr.style.cursor = 'pointer';
        
        const isExpanded = expandedStockGroups.has(key);
        const caretIcon = isExpanded ? 'ph-caret-down' : 'ph-caret-right';

        tr.innerHTML = `
            <td style="text-align: center; font-size: 16px; color: var(--accent); width: 40px;" class="col-caret">
                <i class="ph ${caretIcon}"></i>
            </td>
            <td class="col-marca" style="font-weight: 600;"></td>
            <td class="col-modelo"></td>
            <td class="col-qty">
                <span style="background: var(--accent-light); color: var(--accent); padding: 3px 10px; border-radius: 20px; font-weight: 700; font-size: 12px;">
                    ${group.units.length} ${group.units.length === 1 ? 'unidade' : 'unidades'}
                </span>
            </td>
            <td>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button class="btn-icon btn-add-unit" title="Adicionar Unidade deste Modelo" style="color: var(--accent); width:28px; height:28px; font-size:14px; padding:0;">
                        <i class="ph ph-plus"></i>
                    </button>
                </div>
            </td>
        `;

        tr.querySelector('.col-marca').textContent = group.marca || '-';
        tr.querySelector('.col-modelo').textContent = group.modelo || '-';

        // Pre-fill button click
        tr.querySelector('.btn-add-unit').onclick = (e) => {
            e.stopPropagation();
            openAddStockMaquinaModalWithPrefill(group.marca, group.modelo);
        };

        // Toggle expand logic
        const toggleExpand = () => {
            if (expandedStockGroups.has(key)) {
                expandedStockGroups.delete(key);
            } else {
                expandedStockGroups.add(key);
            }
            renderStockMaquinasTable(data);
        };

        tr.onclick = toggleExpand;

        tbody.appendChild(tr);

        // Render nested row if expanded
        if (isExpanded) {
            const trNested = document.createElement('tr');
            trNested.className = 'nested-row-container';
            
            trNested.innerHTML = `
                <td></td>
                <td colspan="4" style="padding: 10px 15px 15px 15px; background: #f8fafc;">
                    <div style="border-left: 4px solid var(--accent); padding-left: 15px;">
                        <table class="data-table" style="margin-bottom: 0; background: white; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); width: 100%;">
                            <thead>
                                <tr style="background: #f1f5f9;">
                                    <th style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--text-secondary); width: 80px;">ID Unidade</th>
                                    <th style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--text-secondary);">Número de Série</th>
                                    <th style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--text-secondary);">Data de Entrada</th>
                                    <th style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--text-secondary); text-align: right; width: 150px; padding-right: 15px;">Ações</th>
                                </tr>
                            </thead>
                            <tbody class="nested-units-body">
                            </tbody>
                        </table>
                    </div>
                </td>
            `;

            const nestedTbody = trNested.querySelector('.nested-units-body');
            group.units.forEach(unit => {
                const trUnit = document.createElement('tr');
                const dataEntradaStr = unit.data_entrada ? new Date(unit.data_entrada).toLocaleString('pt-PT') : '-';

                trUnit.innerHTML = `
                    <td class="col-unit-id" style="font-weight: 600; color: var(--text-secondary);"></td>
                    <td class="col-unit-serie"></td>
                    <td class="col-unit-data" style="color: var(--text-secondary); font-size: 13px;"></td>
                    <td>
                        <div style="display:flex; gap:8px; justify-content:flex-end;">
                            <button type="button" class="btn-icon btn-assoc-unit" title="Associar a Cliente" style="color: var(--accent); width:28px; height:28px; font-size:14px; padding:0;">
                                <i class="ph ph-user-plus"></i>
                            </button>
                            <button type="button" class="btn-icon btn-edit-unit" title="Editar Unidade" style="width:28px; height:28px; font-size:14px; padding:0;">
                                <i class="ph ph-pencil-simple"></i>
                            </button>
                            <button type="button" class="btn-icon delete btn-delete-unit" title="Apagar Unidade" style="width:28px; height:28px; font-size:14px; padding:0;">
                                <i class="ph ph-trash"></i>
                            </button>
                        </div>
                    </td>
                `;

                trUnit.querySelector('.col-unit-id').textContent = `#${unit.id}`;
                
                const colSerie = trUnit.querySelector('.col-unit-serie');
                colSerie.textContent = unit.numero_serie || 'Sem número de série';
                if (!unit.numero_serie) {
                    colSerie.style.color = '#94a3b8';
                    colSerie.style.fontStyle = 'italic';
                } else {
                    colSerie.style.fontWeight = '600';
                }

                trUnit.querySelector('.col-unit-data').textContent = dataEntradaStr;

                trUnit.querySelector('.btn-assoc-unit').onclick = (e) => {
                    e.stopPropagation();
                    openAssociateStockMaquinaModal(unit);
                };
                trUnit.querySelector('.btn-edit-unit').onclick = (e) => {
                    e.stopPropagation();
                    openEditStockMaquinaModal(unit);
                };
                trUnit.querySelector('.btn-delete-unit').onclick = (e) => {
                    e.stopPropagation();
                    deleteStockMaquina(unit.id);
                };

                nestedTbody.appendChild(trUnit);
            });

            tbody.appendChild(trNested);
        }
    });
}

function openAddStockMaquinaModal() {
    document.getElementById('modal-stock-maquina-title').textContent = 'Nova Máquina em Stock';
    document.getElementById('form-stock-maquina').reset();
    document.getElementById('stock-maq-id').value = '';
    openModal('modal-stock-maquina');
}

function openAddStockMaquinaModalWithPrefill(marca, modelo) {
    document.getElementById('modal-stock-maquina-title').textContent = 'Nova Máquina em Stock';
    document.getElementById('form-stock-maquina').reset();
    document.getElementById('stock-maq-id').value = '';
    document.getElementById('stock-maq-marca').value = marca;
    document.getElementById('stock-maq-modelo').value = modelo;
    openModal('modal-stock-maquina');
}

function openEditStockMaquinaModal(m) {
    document.getElementById('modal-stock-maquina-title').textContent = 'Editar Máquina em Stock';
    document.getElementById('stock-maq-id').value = m.id;
    document.getElementById('stock-maq-marca').value = m.marca || '';
    document.getElementById('stock-maq-modelo').value = m.modelo || '';
    document.getElementById('stock-maq-numero-serie').value = m.numero_serie || '';
    openModal('modal-stock-maquina');
}

async function deleteStockMaquina(id) {
    if (!confirm('Tem a certeza que deseja remover esta máquina do stock?')) return;
    try {
        await apiFetch(`/stock_maquinas/${id}`, { method: 'DELETE' });
        showNotification('Máquina removida do stock!');
        loadStockMaquinas();
    } catch (e) {
        showNotification(e.message, true);
    }
}

async function openAssociateStockMaquinaModal(m) {
    document.getElementById('assoc-stock-id').value = m.id;
    document.getElementById('assoc-detalhe-modelo').value = `${m.marca || ''} - ${m.modelo || ''}`;
    document.getElementById('assoc-numero-serie').value = m.numero_serie || '';
    
    // Reset date fields
    document.getElementById('assoc-data-instalacao').value = '';
    document.getElementById('assoc-data-inicio-garantia').value = '';
    document.getElementById('assoc-data-fim-garantia').value = '';
    
    // Load clients
    const select = document.getElementById('assoc-cliente-id');
    select.innerHTML = '<option value="">A carregar clientes...</option>';
    try {
        const clients = await apiFetch('/clientes');
        select.innerHTML = '<option value="">Selecione o Cliente</option>';
        clients.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.nome;
            select.appendChild(opt);
        });
    } catch (e) {
        select.innerHTML = '<option value="">Erro ao carregar clientes</option>';
    }

    openModal('modal-associar-maquina');
}

// --- GESTÃO DE COMPONENTES DE MÁQUINAS ---
let currentComponentsModel = null;
let editingComponentId = null;

async function openComponentsModal(m) {
    if (!m.modelo) {
        showNotification('Esta máquina não tem modelo definido. Edite a máquina primeiro para definir um modelo.', true);
        return;
    }
    
    currentComponentsModel = m.modelo;
    document.getElementById('comp-maquina-modelo-titulo').textContent = m.modelo;
    
    resetComponentForm();
    await loadSuppliersForComponents();
    await loadComponentsForModel(m.modelo);
    
    openModal('modal-componentes-maquina');
}

async function loadSuppliersForComponents() {
    const select = document.getElementById('comp-fornecedor');
    select.innerHTML = '<option value="">A carregar fornecedores...</option>';
    try {
        const suppliers = await apiFetch('/fornecedores');
        select.innerHTML = '<option value="">Selecione o Fornecedor</option>';
        suppliers.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.nome;
            opt.textContent = s.nome;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error("Erro ao carregar fornecedores:", e);
        select.innerHTML = '<option value="">Erro ao carregar fornecedores</option>';
    }
}

async function loadComponentsForModel(model) {
    const tbody = document.getElementById('table-componentes-body');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">A carregar peças...</td></tr>';
    try {
        const res = await apiFetch(`/componentes_maquina/modelo/${encodeURIComponent(model)}`);
        tbody.innerHTML = '';
        if (res.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary); padding: 15px;">Nenhuma peça registada para este modelo.</td></tr>';
            return;
        }
        res.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-comp-ref"></td>
                <td class="col-comp-nome"></td>
                <td class="col-comp-forn"></td>
                <td>
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button type="button" class="btn-icon btn-edit-comp" title="Editar Peça" style="width:28px; height:28px; font-size:14px; padding:0;">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button type="button" class="btn-icon delete btn-delete-comp" title="Eliminar Peça" style="width:28px; height:28px; font-size:14px; padding:0;">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tr.querySelector('.col-comp-ref').textContent = c.referencia;
            tr.querySelector('.col-comp-nome').textContent = c.nome;
            tr.querySelector('.col-comp-forn').textContent = c.fornecedor;
            
            tr.querySelector('.btn-edit-comp').onclick = () => setupEditComponent(c);
            tr.querySelector('.btn-delete-comp').onclick = () => deleteComponent(c.id);
            
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Erro ao carregar componentes:", e);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--danger); padding: 15px;">Erro ao carregar peças.</td></tr>';
    }
}

function setupEditComponent(c) {
    editingComponentId = c.id;
    document.getElementById('comp-id').value = c.id;
    document.getElementById('comp-referencia').value = c.referencia;
    document.getElementById('comp-nome').value = c.nome;
    document.getElementById('comp-fornecedor').value = c.fornecedor;
    
    document.getElementById('comp-form-title').textContent = 'Editar Peça';
    document.getElementById('btn-submit-componente').textContent = 'Atualizar';
    document.getElementById('btn-cancelar-edit-componente').style.display = 'inline-block';
}

function resetComponentForm() {
    editingComponentId = null;
    document.getElementById('form-componente-maquina').reset();
    document.getElementById('comp-id').value = '';
    
    document.getElementById('comp-form-title').textContent = 'Adicionar Nova Peça';
    document.getElementById('btn-submit-componente').textContent = 'Guardar';
    document.getElementById('btn-cancelar-edit-componente').style.display = 'none';
}

async function deleteComponent(id) {
    if (!confirm('Tem a certeza que deseja eliminar esta peça?')) return;
    try {
        await apiFetch(`/componentes_maquina/${id}`, {
            method: 'DELETE'
        });
        showNotification('Peça eliminada com sucesso!');
        if (editingComponentId == id) {
            resetComponentForm();
        }
        loadComponentsForModel(currentComponentsModel);
    } catch (err) {
        showNotification(err.message, true);
    }
}

// Add event listener setup on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    // Setup unit calculator events for stock creation
    const stockProductUnidade = document.getElementById('stock-product-unidade');
    if (stockProductUnidade) {
        stockProductUnidade.addEventListener('change', updateStockProductCalcVisibility);
    }
    const stockProductEmbalagens = document.getElementById('stock-product-embalagens');
    if (stockProductEmbalagens) {
        stockProductEmbalagens.addEventListener('input', calculateStockProductQty);
    }
    const stockProductMedida = document.getElementById('stock-product-medida');
    if (stockProductMedida) {
        stockProductMedida.addEventListener('input', calculateStockProductQty);
    }

    // Setup unit calculator events for stock adjustment
    const addStockEmbalagens = document.getElementById('add-stock-embalagens');
    if (addStockEmbalagens) {
        addStockEmbalagens.addEventListener('input', calculateAddStockQty);
    }
    const addStockMedida = document.getElementById('add-stock-medida');
    if (addStockMedida) {
        addStockMedida.addEventListener('input', calculateAddStockQty);
    }

    const formProduct = document.getElementById('form-stock-product');
    if (formProduct) {
        formProduct.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const id = document.getElementById('stock-product-id').value;
            const nome_produto = document.getElementById('stock-product-nome').value;
            const categoria_produto = document.getElementById('stock-product-categoria').value;
            const fornecedor_id = document.getElementById('stock-product-fornecedor').value;
            const codigo_barras = document.getElementById('stock-product-barras').value;
            const quantidade = document.getElementById('stock-product-quantidade').value;
            const unidade = document.getElementById('stock-product-unidade').value;
            const quantidade_minima = document.getElementById('stock-product-qty-minima').value;
            
            const isEdit = id !== '';
            const endpoint = isEdit ? `/stock/${id}` : '/stock';
            const method = isEdit ? 'PUT' : 'POST';
            
            const body = {
                nome_produto,
                categoria_produto,
                codigo_barras,
                unidade,
                fornecedor_id: fornecedor_id || null,
                quantidade_minima: quantidade_minima !== '' ? parseFloat(quantidade_minima) : null
            };
            
            if (!isEdit) {
                body.quantidade = quantidade;
            }
            
            try {
                await apiFetch(endpoint, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                
                showNotification(isEdit ? 'Produto atualizado com sucesso!' : 'Produto criado com sucesso!');
                closeModal('modal-stock-product');
                loadStock();
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }
    
    const formAddStockQty = document.getElementById('form-add-stock-qty');
    if (formAddStockQty) {
        formAddStockQty.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('add-stock-product-id').value;
            const nome = document.getElementById('add-stock-product-nome').value;
            const qtyVal = parseFloat(document.getElementById('add-stock-product-adicionar').value);
            
            if (isNaN(qtyVal) || qtyVal <= 0) {
                showNotification('Quantidade inválida.', true);
                return;
            }
            
            const actionType = document.getElementById('add-stock-action-type')?.value || 'add';
            const multiplier = actionType === 'subtract' ? -1 : 1;
            const delta = qtyVal * multiplier;
            
            const actionVerb = actionType === 'subtract' ? 'retirar' : 'adicionar';
            const unitLabel = document.getElementById('add-stock-product-unit-label')?.textContent || 'un';
            const confirmMsg = `Deseja ${actionVerb} ${qtyVal} ${unitLabel} do stock do produto "${nome}"?`;
            
            if (!confirm(confirmMsg)) return;
            
            try {
                const updateRes = await apiFetch(`/stock/${id}/quantity`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ delta })
                });
                
                const successMsg = actionType === 'subtract' 
                    ? `Stock de "${nome}" reduzido para ${updateRes.quantidade}!`
                    : `Stock de "${nome}" aumentado para ${updateRes.quantidade}!`;
                
                showNotification(successMsg);
                closeModal('modal-add-stock-qty');
                loadStock();
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }
    
    const searchStock = document.getElementById('search-stock');
    if (searchStock) {
        searchStock.addEventListener('input', () => {
            renderStockTable(cachedProducts);
        });
    }
    
    const filterCatStock = document.getElementById('filter-stock-category');
    if (filterCatStock) {
        filterCatStock.addEventListener('change', () => {
            renderStockTable(cachedProducts);
        });
    }
    
    const btnOpenAddStock = document.getElementById('btn-open-add-stock');
    if (btnOpenAddStock) {
        btnOpenAddStock.addEventListener('click', () => openAddProductModal());
    }
    
    const btnScanBarcode = document.getElementById('btn-scan-barcode');
    if (btnScanBarcode) {
        btnScanBarcode.addEventListener('click', () => openBarcodeScanner());
    }
    const btnOpenAddSupplier = document.getElementById('btn-open-add-supplier');
    if (btnOpenAddSupplier) {
        btnOpenAddSupplier.addEventListener('click', () => {
            resetSupplierForm();
            openModal('modal-supplier');
        });
    }
    
    const formSupplier = document.getElementById('form-supplier');
    if (formSupplier) {
        formSupplier.addEventListener('submit', saveSupplier);
    }
    
    const btnCancelSupplier = document.getElementById('btn-cancel-supplier');
    if (btnCancelSupplier) {
        btnCancelSupplier.addEventListener('click', () => {
            closeModal('modal-supplier');
        });
    }
    
    const btnAddNewCategory = document.getElementById('btn-add-new-category');
    if (btnAddNewCategory) {
        btnAddNewCategory.addEventListener('click', addNewCategoryPrompt);
    }
    
    const btnScanInsideModal = document.getElementById('btn-scan-inside-modal');
    if (btnScanInsideModal) {
        btnScanInsideModal.addEventListener('click', () => openBarcodeScanner('stock-product-barras'));
    }

    // Botão Cancelar e X do modal do scanner (sem onclick inline — bloqueado pela CSP)
    const btnCancelScanner = document.getElementById('btn-cancel-scanner');
    if (btnCancelScanner) {
        btnCancelScanner.addEventListener('click', () => closeBarcodeScanner());
    }

    const btnCloseScanner = document.getElementById('btn-close-scanner');
    if (btnCloseScanner) {
        btnCloseScanner.addEventListener('click', () => closeBarcodeScanner());
    }
    
    // Tirar Foto / Carregar Ficheiro
    const btnTakePhoto = document.getElementById('btn-take-photo');
    const fileInput = document.getElementById('barcode-file-input');
    if (btnTakePhoto && fileInput) {
        btnTakePhoto.addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length === 0) return;
            const file = e.target.files[0];
            
            const scannerStatus = document.getElementById('scanner-status');
            if (scannerStatus) scannerStatus.textContent = "A ler código de barras a partir da foto...";
            
            // Clean up live scanner if active
            if (html5QrScanner && html5QrScanner.isScanning) {
                html5QrScanner.stop().then(() => {
                    html5QrScanner = null;
                    scanFileBarcode(file);
                }).catch(err => {
                    console.error(err);
                    html5QrScanner = null;
                    scanFileBarcode(file);
                });
            } else {
                scanFileBarcode(file);
            }
        });
    }

    const btnCloseReportBottom = document.getElementById('btn-close-report-bottom');
    if (btnCloseReportBottom) {
        btnCloseReportBottom.addEventListener('click', () => {
            closeModal('modal-relatorio');
        });
    }

    const btnCancelStockProduct = document.getElementById('btn-cancel-stock-product');
    if (btnCancelStockProduct) {
        btnCancelStockProduct.addEventListener('click', () => {
            closeModal('modal-stock-product');
        });
    }

    const btnCancelAddStock = document.getElementById('btn-cancel-add-stock');
    if (btnCancelAddStock) {
        btnCancelAddStock.addEventListener('click', () => {
            closeModal('modal-add-stock-qty');
        });
    }

    // --- Eventos do Guia de Peças do Modelo ---
    const formCompMaquina = document.getElementById('form-componente-maquina');
    if (formCompMaquina) {
        formCompMaquina.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('comp-id').value;
            const referencia = document.getElementById('comp-referencia').value;
            const nome = document.getElementById('comp-nome').value;
            const fornecedor = document.getElementById('comp-fornecedor').value;
            
            if (!currentComponentsModel) {
                showNotification('Nenhum modelo de máquina selecionado.', true);
                return;
            }
            
            const payload = {
                modelo_maquina: currentComponentsModel,
                referencia,
                nome,
                fornecedor
            };
            
            try {
                if (id) {
                    await apiFetch(`/componentes_maquina/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    showNotification('Peça atualizada com sucesso!');
                } else {
                    await apiFetch('/componentes_maquina', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    showNotification('Peça adicionada com sucesso!');
                }
                resetComponentForm();
                loadComponentsForModel(currentComponentsModel);
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }

    const btnCancelEditComp = document.getElementById('btn-cancelar-edit-componente');
    if (btnCancelEditComp) {
        btnCancelEditComp.addEventListener('click', () => {
            resetComponentForm();
        });
    }

    // --- Stock de Máquinas Eventos ---
    const btnOpenAddStockMaquina = document.getElementById('btn-open-add-stock-maquina');
    if (btnOpenAddStockMaquina) {
        btnOpenAddStockMaquina.addEventListener('click', openAddStockMaquinaModal);
    }

    const searchStockMaquina = document.getElementById('search-stock-maquina');
    if (searchStockMaquina) {
        searchStockMaquina.addEventListener('input', () => {
            renderStockMaquinasTable(cachedStockMaquinas);
        });
    }

    const formStockMaquina = document.getElementById('form-stock-maquina');
    if (formStockMaquina) {
        formStockMaquina.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('stock-maq-id').value;
            const marca = document.getElementById('stock-maq-marca').value;
            const modelo = document.getElementById('stock-maq-modelo').value;
            const numero_serie = document.getElementById('stock-maq-numero-serie').value;

            const payload = { marca, modelo, numero_serie };

            try {
                if (id) {
                    await apiFetch(`/stock_maquinas/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    showNotification('Máquina em stock atualizada com sucesso!');
                } else {
                    await apiFetch('/stock_maquinas', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    showNotification('Máquina adicionada ao stock com sucesso!');
                }
                closeModal('modal-stock-maquina');
                loadStockMaquinas();
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }

    const btnCancelStockMaquina = document.getElementById('btn-cancel-stock-maquina');
    if (btnCancelStockMaquina) {
        btnCancelStockMaquina.addEventListener('click', () => {
            closeModal('modal-stock-maquina');
        });
    }

    const formAssociarMaquina = document.getElementById('form-associar-maquina');
    if (formAssociarMaquina) {
        formAssociarMaquina.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('assoc-stock-id').value;
            const cliente_id = document.getElementById('assoc-cliente-id').value;
            const numero_serie = document.getElementById('assoc-numero-serie').value;
            const data_instalacao = document.getElementById('assoc-data-instalacao').value;
            const data_inicio_garantia = document.getElementById('assoc-data-inicio-garantia').value;
            const data_fim_garantia = document.getElementById('assoc-data-fim-garantia').value;

            const payload = {
                cliente_id,
                numero_serie,
                data_instalacao,
                data_inicio_garantia,
                data_fim_garantia
            };

            try {
                await apiFetch(`/stock_maquinas/${id}/associar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                showNotification('Máquina associada ao cliente com sucesso!');
                closeModal('modal-associar-maquina');
                loadStockMaquinas();
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }

    const btnCancelAssociar = document.getElementById('btn-cancel-associar');
    if (btnCancelAssociar) {
        btnCancelAssociar.addEventListener('click', () => {
            closeModal('modal-associar-maquina');
        });
    }

    const btnOpenAddAdmin = document.getElementById('btn-open-add-administrador');
    if (btnOpenAddAdmin) {
        btnOpenAddAdmin.addEventListener('click', () => {
            document.getElementById('form-add-administrador').reset();
            openModal('modal-add-administrador');
        });
    }

    const formAddAdmin = document.getElementById('form-add-administrador');
    if (formAddAdmin) {
        formAddAdmin.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('admin-username').value.trim();
            const email = document.getElementById('admin-email').value.trim();
            const password = document.getElementById('admin-password').value;
            const confirmPassword = document.getElementById('admin-password-confirm').value;

            if (password.length < 6) {
                return showNotification("A palavra-passe deve ter no mínimo 6 caracteres.", true);
            }

            if (password !== confirmPassword) {
                return showNotification("As palavras-passes não coincidem.", true);
            }

            try {
                await apiFetch('/administradores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, email, password })
                });

                showNotification("Administrador adicionado com sucesso!");
                closeModal('modal-add-administrador');
                document.getElementById('form-add-administrador').reset();
                loadAdministradores();
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }

    const formEditAdmin = document.getElementById('form-edit-administrador');
    if (formEditAdmin) {
        formEditAdmin.addEventListener('submit', async (e) => {
            e.preventDefault();

            const id = document.getElementById('edit-admin-id').value;
            const username = document.getElementById('edit-admin-username').value.trim();
            const email = document.getElementById('edit-admin-email').value.trim();
            const password = document.getElementById('edit-admin-password').value;
            const confirmPassword = document.getElementById('edit-admin-password-confirm').value;

            const payload = { username, email };

            if (password) {
                if (password.length < 6) {
                    return showNotification("A nova palavra-passe deve ter no mínimo 6 caracteres.", true);
                }
                if (password !== confirmPassword) {
                    return showNotification("As novas palavras-passes não coincidem.", true);
                }
                payload.password = password;
            }

            try {
                await apiFetch(`/administradores/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                showNotification("Administrador atualizado com sucesso!");
                closeModal('modal-edit-administrador');
                document.getElementById('form-edit-administrador').reset();
                loadAdministradores();
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }
});
