// public/js/tecnico.js

const API_BASE = '/api';

window.openModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
};
window.closeModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
};

// Prioridade: URL Params (?id=X&name=Y) > localStorage
const urlParams = new URLSearchParams(window.location.search);
let currentTechId = urlParams.get('id') || localStorage.getItem('maclau_tech_id');
let currentTechName = urlParams.get('name') || localStorage.getItem('maclau_tech_name');

// Save to localStorage if came from URL
if (urlParams.get('id')) localStorage.setItem('maclau_tech_id', currentTechId);
if (urlParams.get('name')) localStorage.setItem('maclau_tech_name', currentTechName);

// Estilo para o aviso a piscar
const blinkStyle = document.createElement('style');
blinkStyle.innerHTML = `@keyframes blinker { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.98); } 100% { opacity: 1; transform: scale(1); } }`;
document.head.appendChild(blinkStyle);

let jwtToken = localStorage.getItem('maclau_token');
let currentDashboardFilter = 'all';
let allPendingTasks = [];
let timerInterval = null;
let refreshIntervalId = null;

function updateRefreshStatus() {
    const statusEl = document.getElementById('refresh-status');
    if (!statusEl) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    statusEl.innerHTML = `
        <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%;"></span>
        Sincronizado às ${timeStr}
    `;
}

function refreshTechnicianDashboard() {
    const dashboardView = document.getElementById('view-dashboard');
    const historicoView = document.getElementById('view-historico');
    const agendamentosView = document.getElementById('view-agendamentos');

    // Refresh regardless of visibility to keep background data in sync
    loadMyTasks();
    loadHistorico();
    loadAgendamentos();
}

function startAutoRefresh() {
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    refreshIntervalId = setInterval(() => {
        // Não atualizar se houver modais abertos
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        if (openModals.length > 0) return;

        refreshTechnicianDashboard();
    }, 10000); // 10 segundos
}

// --- Gestão de Cronómetro ---
function getTimerState() {
    const state = localStorage.getItem('maclau_timer');
    return state ? JSON.parse(state) : { taskId: null, taskType: null, startTime: null, accumulatedMs: 0 };
}

function saveTimerState(state) {
    localStorage.setItem('maclau_timer', JSON.stringify(state));
}

function startTimer(id, type) {
    let state = getTimerState();
    // Se for uma tarefa diferente (ID ou Tipo), reinicia o cronómetro
    if (state.taskId && (state.taskId != id || state.taskType != type)) {
        state = { taskId: id, taskType: type, startTime: Date.now(), accumulatedMs: 0 };
    } else {
        state.taskId = id;
        state.taskType = type;
        if (!state.startTime) state.startTime = Date.now();
    }
    saveTimerState(state);
    initGlobalTimer();
}

function pauseTimer() {
    const state = getTimerState();
    if (state.startTime) {
        state.accumulatedMs += (Date.now() - state.startTime);
        state.startTime = null;
        saveTimerState(state);
    }
}

function stopTimer() {
    localStorage.removeItem('maclau_timer');
}

function formatDuration(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function hoursToHHmm(decimalHours) {
    if (decimalHours === null || decimalHours === undefined || decimalHours === '') return '';
    const totalMins = Math.round(parseFloat(decimalHours) * 60);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function HHmmToHours(hhmm) {
    if (!hhmm) return 0;
    const s = String(hhmm).trim();
    if (s.includes(':')) {
        const parts = s.split(':');
        const hrs = parseInt(parts[0]) || 0;
        const mins = parseInt(parts[1]) || 0;
        return hrs + (mins / 60);
    }
    // Suporte para quem ainda usa decimal (ex: 1.5)
    return parseFloat(s.replace(',', '.')) || 0;
}

function initGlobalTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const timerElements = document.querySelectorAll('[id^="timer-"]');
        timerElements.forEach(el => {
            const idParts = el.id.split('-'); // e.g. ["timer", "avaria", "12"]
            if (idParts.length < 3) return;
            const taskType = idParts[1];
            const taskId = parseInt(idParts[2]);
            
            const task = allPendingTasks.find(t => t.id === taskId && t._type === taskType);
            if (task && task.estado === 'em resolução' && task.data_hora_inicio) {
                const startTimeMs = new Date(task.data_hora_inicio).getTime();
                if (!isNaN(startTimeMs)) {
                    const accumulatedMs = (task.tempo_acumulado || 0) * 1000;
                    const totalMs = accumulatedMs + (Date.now() - startTimeMs);
                    el.textContent = formatDuration(totalMs >= 0 ? totalMs : 0);
                }
            }
        });
    }, 1000);
}

function showNotification(msg, isError = false) {
    const notif = document.getElementById('notification');
    if (!notif) return;
    notif.textContent = msg;
    notif.className = `notification ${isError ? 'error' : ''}`;
    notif.classList.remove('hidden');
    setTimeout(() => notif.classList.add('hidden'), 3000);
}

function escapeHTML(str) {
    if (!str) return '';
    const p = document.createElement('p');
    p.textContent = str;
    return p.innerHTML;
}

// Fake auth removed

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { console.error("Erro ao limpar sessão no servidor", e); }

    localStorage.removeItem('maclau_tech_id');
    localStorage.removeItem('maclau_tech_name');
    localStorage.removeItem('maclau_token');
    localStorage.removeItem('maclau_role');
    window.location.href = 'index.html';
}

async function showView() {
    if (!jwtToken) {
        window.location.href = 'index.html?expired=1';
        return;
    }

    if (!currentTechId) {
        // Fallback: se não tiver Id, talvez não seja um técnico
        window.location.href = 'index.html?expired=1';
        return;
    }

    document.getElementById('tech-name-display').textContent = `Olá, ${currentTechName || 'Técnico'}!`;
    loadMyTasks();
}

async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${jwtToken}`;
    return fetch(url, options);
}

async function loadMyTasks() {
    try {
        const [resAvarias, resServicos, resManutencoes] = await Promise.all([
            authFetch(`${API_BASE}/tecnico/avarias?_=${Date.now()}`),
            authFetch(`${API_BASE}/tecnico/servicos?_=${Date.now()}`),
            authFetch(`${API_BASE}/tecnico/manutencoes?_=${Date.now()}`)
        ]);

        const avarias = await resAvarias.json();
        const servicos = await resServicos.json();
        const manutencoes = await resManutencoes.json();
        updateRefreshStatus();

        // Marcar o tipo para cada item
        const tasks = [
            ...avarias.map(a => ({ ...a, _type: 'avaria' })),
            ...servicos.map(s => ({ ...s, _type: 'servico' })),
            ...manutencoes.map(m => ({ ...m, _type: 'manutencao' }))
        ];

        // Ordenar: Pausadas primeiro, depois por data decrescente
        tasks.sort((a, b) => {
            if (a.estado === 'pausada' && b.estado !== 'pausada') return -1;
            if (a.estado !== 'pausada' && b.estado === 'pausada') return 1;
            return new Date(b.data_hora) - new Date(a.data_hora);
        });

        allPendingTasks = tasks;

        // Populate client filter dropdown
        const uniqueClients = [...new Set(tasks.map(t => t.cliente_nome))].filter(Boolean).sort();
        const filterSelect = document.getElementById('filter-dash-cliente');
        if (filterSelect) {
            const currentVal = filterSelect.value;
            filterSelect.innerHTML = '<option value="">Todos os Clientes</option>';
            uniqueClients.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                filterSelect.appendChild(opt);
            });
            filterSelect.value = currentVal;
        }

        renderPendingTasks();
    } catch (e) {
        showNotification("Erro ao carregar tarefas.", true);
    }
}

window.renderPendingTasks = function() {
    const container = document.getElementById('repairs-container');
    const stats = document.getElementById('tech-stats');
    if (!container || !stats) return;

    let filteredTasks = allPendingTasks;

    // Filtro Tipo
    if (currentDashboardFilter !== 'all') {
        filteredTasks = filteredTasks.filter(t => t._type === currentDashboardFilter);
    }

    // Filtro Cliente
    const filterClient = document.getElementById('filter-dash-cliente')?.value;
    if (filterClient) {
        filteredTasks = filteredTasks.filter(t => t.cliente_nome === filterClient);
    }

    // Filtro Data
    const filterDate = document.getElementById('filter-dash-data')?.value;
    if (filterDate) {
        filteredTasks = filteredTasks.filter(t => {
            if (!t.data_hora) return false;
            const taskDate = new Date(t.data_hora).toISOString().split('T')[0];
            return taskDate === filterDate;
        });
    }

    const total = filteredTasks.length;
    stats.textContent = total === 1 ? "Tem 1 tarefa pendente." : `Tem ${total} tarefas pendentes.`;
    container.innerHTML = '';

    if (total === 0) {
        let msg = currentDashboardFilter === 'avaria' ? 'Não tem avarias pendentes.' : (currentDashboardFilter === 'servico' ? 'Não tem serviços pendentes.' : (currentDashboardFilter === 'manutencao' ? 'Não tem manutenções pendentes.' : 'Não tem tarefas pendentes.'));
        if (filterClient || filterDate) msg = 'Não há tarefas para los filtros selecionados.';
        container.innerHTML = `<p style="text-align:center; color:var(--text-secondary); margin-top:20px;">${msg} Bom trabalho!</p>`;
        return;
    }

    filteredTasks.forEach(task => {
        const div = document.createElement('div');
        div.className = 'repair-item';

        let tagStr = '';
        let tagColor = 'var(--accent)';
        let titleStr = '';
        
        if (task._type === 'avaria') {
            tagStr = task.tipo_avaria === 1 ? 'ELÉTRICA' : (task.tipo_avaria === 3 ? 'MECÂNICA' : 'DESCONHECIDA');
            titleStr = task.maquina_nome;
        } else if (task._type === 'manutencao') {
            tagStr = 'MANUTENÇÃO';
            tagColor = '#7c3aed';
            titleStr = task.cliente_nome;
        } else {
            tagStr = 'SERVIÇO';
            tagColor = '#1E4419';
            titleStr = task.tipo_servico;
        }

        let statusLabel = 'Em Resolução';
        let statusColor = 'var(--warning)';
        let warningBlink = '';

        if (task.estado === 'pendente') {
            statusLabel = 'Aguardando Início';
            statusColor = 'var(--danger)';
            
            // Verificar Atraso
            if (task.data_agendada) {
                const agendada = new Date(task.data_agendada);
                const agora = new Date();
                if (agora > agendada) {
                    warningBlink = `<span style="background-color: #ef4444; color: white; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 800; text-transform: uppercase; animation: blinker 1s linear infinite; display:flex; align-items:center; gap:4px; box-shadow: 0 0 8px rgba(239, 68, 68, 0.5); letter-spacing: 0.5px;"><i class="ph-fill ph-warning-circle" style="font-size:14px;"></i> Atrasado</span>`;
                }
            }

        } else if (task.estado === 'pausada') {
            const pDate = task.data_hora_pausa ? new Date(task.data_hora_pausa) : new Date();
            statusLabel = `Pausado às ${pDate.getHours().toString().padStart(2, '0')}:${pDate.getMinutes().toString().padStart(2, '0')}h ${pDate.toLocaleDateString('pt-PT')}`;
            statusColor = '#ca8a04';
        }

        let agendadoHtml = '';
        if (task.data_agendada) {
            const dateA = new Date(task.data_agendada);
            const hours = dateA.getHours().toString().padStart(2, '0');
            const minutes = dateA.getMinutes().toString().padStart(2, '0');
            agendadoHtml = `<div style="font-size:13px; color:var(--primary-color); font-weight:600; margin-top:10px; display:flex; align-items:center; gap:5px;"><i class="ph-bold ph-calendar-blank"></i> Agendado para: ${dateA.toLocaleDateString('pt-PT')} às ${hours}:${minutes}h</div>`;
        }

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                <div style="display:flex; gap:5px;">
                    <span style="font-size:11px; font-weight:700; background:var(--accent-light); color:${tagColor}; padding:3px 8px; border-radius:4px;">${tagStr}</span>
                    ${task._type === 'servico' ? `<span style="font-size:11px; font-weight:700; background:#f1f5f9; color:#475569; padding:3px 8px; border-radius:4px;">${task.tipo_camiao}</span>` : ''}
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                    ${warningBlink}
                    <span style="font-size:12px; font-weight:700; color:${statusColor};">${statusLabel}</span>
                </div>
            </div>
            <h3 class="task-machine-name" style="margin-bottom:5px;">${escapeHTML(titleStr)}</h3>
            <p class="task-client-name" style="font-size:14px; color:var(--text-secondary); font-weight:600;">${task._type === 'manutencao' ? 'Todas as Máquinas' : escapeHTML(task.cliente_nome || 'Serviço Externo')}</p>
            ${task.cliente_morada ? `<div style="font-size:13px; color:var(--accent); margin-top:2px;"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.cliente_morada)}" target="_blank" style="text-decoration:none; color:inherit; display:flex; align-items:center; gap:4px;" onclick="event.stopPropagation();"><i class="ph ph-map-pin"></i> ${escapeHTML(task.cliente_morada)}</a></div>` : ''}
            ${agendadoHtml}
            <div style="font-size:12px; color:var(--text-secondary); margin-top:${task.data_agendada ? '4px' : '10px'};">Reportado em: ${new Date(task.data_hora).toLocaleString('pt-PT')}</div>
            ${task.notas ? `<div class="admin-note-btn" style="margin-top:10px; padding:10px; background:var(--surface-color); border-radius:6px; font-size:13px; border-left:3px solid var(--accent); cursor:pointer; transition:background 0.2s;"><strong style="color:var(--text-main);">Notas do Admin:</strong><div style="display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin-top:4px;">${escapeHTML(task.notas)}</div></div>` : ''}
            
            ${task.estado === 'em resolução' ? `
            <div class="timer-badge">
                <div class="timer-pulse"></div>
                <span id="timer-${task._type}-${task.id}">00:00:00</span>
            </div>
            ` : ''}

            <div class="repair-actions" style="gap:10px; margin-top:15px;">
            </div>
        `;

        const actionsDiv = div.querySelector('.repair-actions');

        if (task.notas) {
            const noteBtn = div.querySelector('.admin-note-btn');
            if (noteBtn) {
                noteBtn.addEventListener('mouseover', () => noteBtn.style.background = '#f1f5f9');
                noteBtn.addEventListener('mouseout', () => noteBtn.style.background = 'var(--surface-color)');
                noteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (typeof window.openFullNoteModal === 'function') {
                        window.openFullNoteModal(encodeURIComponent(task.notas).replace(/'/g, "%27"));
                    }
                });
            }
        }

        if (task.estado === 'em resolução') {
            const btnPausar = document.createElement('button');
            btnPausar.className = 'btn-status';
            btnPausar.style.backgroundColor = '#e2e8f0';
            btnPausar.style.color = '#475569';
            btnPausar.innerHTML = '<i class="ph ph-pause"></i> Pausar';
            btnPausar.onclick = (e) => {
                e.stopPropagation();
                document.getElementById('pausar-avaria-id').value = task.id;
                document.getElementById('pausar-type').value = task._type;
                document.getElementById('pausar-motivo').value = '';
                document.getElementById('modal-pausar').classList.remove('hidden');
            };
            actionsDiv.appendChild(btnPausar);
        }

        const btn = document.createElement('button');
        const ehAguardando = (task.estado === 'pendente' || task.estado === 'pausada');
        btn.className = 'btn-status ' + (ehAguardando ? 'btn-resolucao' : 'btn-resolvida');
        btn.innerHTML = ehAguardando ? '<i class="ph ph-play"></i> ' + (task.estado === 'pausada' ? 'Retomar' : 'Começar') : '<i class="ph ph-check"></i> Concluir';
        btn.onclick = (e) => {
            e.stopPropagation();
            updateStatus(task.id, ehAguardando ? 'em resolução' : 'resolvida', task.relatorio, task._type);
        };
        actionsDiv.appendChild(btn);

        // Click no card abre detalhes
        div.onclick = () => window.openTicketDetailsModal(task);

        container.appendChild(div);
    });
    initGlobalTimer();
}

async function updateStatus(id, newStatus, currentText = '', type = 'avaria') {
    try {
        const endpoint = type === 'servico' ? `${API_BASE}/servicos/${id}/status` : (type === 'manutencao' ? `${API_BASE}/manutencoes/${id}/status` : `${API_BASE}/avarias/${id}/status`);
        const res = await authFetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: newStatus })
        });

        if (res.ok) {
            if (newStatus === 'resolvida') {
                pauseTimer();
                // Refresh background list immediately so the task disappears while filling report
                loadMyTasks(); 
                openRelatorioModal(id, true, currentText, false, '', '', '', type);
            } else {
                if (newStatus === 'em resolução') startTimer(id, type);
                showNotification(newStatus === 'pausada' ? "Tarefa pausada." : "Tarefa iniciada!");
                loadMyTasks();
            }
        } else {
            throw new Error("Erro ao atualizar estado.");
        }
    } catch (e) {
        showNotification(e.message, true);
    }
}

// --- Funções de Relatório ---

// --- Gestão de Fotos ---
window.deletePhoto = async function(photoId) {
    if (!confirm("Tem a certeza que deseja remover esta foto?")) return;
    
    try {
        const res = await authFetch(`${API_BASE}/tecnico/fotos/${photoId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Erro ao remover foto");
        
        showNotification("Foto removida.");
        // Recarregar o modal
        const id = document.getElementById('relatorio-avaria-id').value;
        const type = document.getElementById('relatorio-type').value;
        const currentText = document.getElementById('relatorio-texto').value;
        const currentPecas = document.getElementById('relatorio-pecas').value;
        const currentHoras = document.getElementById('relatorio-horas').value;
        const currentDeslocacoes = document.getElementById('relatorio-deslocacoes')?.value || '';
        
        const canvasCli = document.getElementById('signature-pad');
        const canvasTec = document.getElementById('signature-pad-tech');
        const currentSig = isCanvasBlank(canvasCli) ? '' : canvasCli.toDataURL('image/png');
        const currentSigTech = isCanvasBlank(canvasTec) ? '' : canvasTec.toDataURL('image/png');

        openRelatorioModal(id, false, currentText, false, currentPecas, currentHoras, currentSig, type, currentSigTech, currentDeslocacoes);
    } catch (err) {
        showNotification(err.message, true);
    }
};

function renderPhotosPreview(fotos, disabled = false) {
    const container = document.getElementById('fotos-preview');
    if (!container) return;
    container.innerHTML = '';
    
    // Se estiver desativado (visualização), usar estilo A4 (grid 2 colunas, imagens maiores)
    if (disabled) {
        container.style.display = 'grid';
        container.style.gridTemplateColumns = '1fr 1fr';
        container.style.gap = '20px';
        container.style.width = '100%';
        container.style.marginTop = '15px';
        
        fotos.forEach(f => {
            const div = document.createElement('div');
            div.style.border = '1px solid #e2e8f0';
            div.style.borderRadius = '8px';
            div.style.overflow = 'hidden';
            div.style.background = 'white';
            div.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
            
            const img = document.createElement('img');
            img.src = `${f.caminho}?token=${jwtToken}&v=${Date.now()}`;
            img.style.width = '100%';
            img.style.height = '300px';
            img.style.objectFit = 'cover';
            img.style.display = 'block';
            div.appendChild(img);
            
            container.appendChild(div);
        });
        return;
    }

    // Estilo edição (thumbnails pequenos com botão de remover)
    container.style.display = 'flex';
    container.style.flexWrap = 'wrap';
    container.style.gap = '10px';
    container.style.width = 'auto';

    fotos.forEach(f => {
        const div = document.createElement('div');
        div.className = 'foto-preview-item';
        div.style.position = 'relative';
        div.style.width = '100px';
        div.style.height = '100px';
        div.style.borderRadius = '8px';
        div.style.overflow = 'hidden';
        div.style.border = '2px solid #e2e8f0';
        div.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
        
        const img = document.createElement('img');
        img.src = `${f.caminho}?token=${jwtToken}&v=${Date.now()}`;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        div.appendChild(img);
        
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = '<i class="ph ph-x" style="font-weight:bold;"></i>';
        btn.style.position = 'absolute';
        btn.style.top = '4px';
        btn.style.right = '4px';
        btn.style.background = '#ef4444';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '50%';
        btn.style.width = '24px';
        btn.style.height = '24px';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.zIndex = '999';
        btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.deletePhoto(f.id);
        };
        
        div.appendChild(btn);
        container.appendChild(div);
    });
}

async function uploadPhotos(filesList) {
    if (!filesList || filesList.length === 0) return;
    const files = Array.from(filesList); // Converter para array estático

    const id = document.getElementById('relatorio-avaria-id').value;
    const type = document.getElementById('relatorio-type').value;
    
    // Validação de tamanho no cliente (20MB)
    const MAX_SIZE = 20 * 1024 * 1024;
    for (let i = 0; i < files.length; i++) {
        if (files[i].size > MAX_SIZE) {
            showNotification(`A foto "${files[i].name}" é demasiado grande (máx 20MB).`, true);
            return;
        }
    }

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('fotos', files[i]);
    }
    
    if (type === 'servico') formData.append('servico_id', id);
    else if (type === 'manutencao') formData.append('manutencao_id', id);
    else formData.append('avaria_id', id);
    
    try {
        const res = await fetch(`${API_BASE}/tecnico/upload-fotos`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${jwtToken}` },
            body: formData
        });
        
        let data;
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            data = await res.json();
        } else {
            const text = await res.text();
            throw new Error(`Erro inesperado do servidor: ${res.status}`);
        }

        if (!res.ok) throw new Error(data.error || "Erro ao carregar fotos");
        
        showNotification("Fotos carregadas com sucesso!");
        
        // Recarregar o modal para ver as novas fotos
        const currentText = document.getElementById('relatorio-texto').value;
        const currentPecas = document.getElementById('relatorio-pecas').value;
        const currentHoras = document.getElementById('relatorio-horas').value;
        const currentDeslocacoes = document.getElementById('relatorio-deslocacoes')?.value || '';
        
        const canvasCli = document.getElementById('signature-pad');
        const canvasTec = document.getElementById('signature-pad-tech');
        const currentSig = isCanvasBlank(canvasCli) ? '' : canvasCli.toDataURL('image/png');
        const currentSigTech = isCanvasBlank(canvasTec) ? '' : canvasTec.toDataURL('image/png');

        openRelatorioModal(id, false, currentText, false, currentPecas, currentHoras, currentSig, type, currentSigTech, currentDeslocacoes);
        
    } catch (err) {
        console.error("Upload Error:", err);
        showNotification(err.message, true);
    }
}

async function openRelatorioModal(id, isStatusChange = false, currentText = '', isSubmitted = false, currentPecas = '', currentHoras = '', currentSignature = '', type = 'avaria', currentSignatureTech = '', currentDeslocacoes = '') {
    document.getElementById('relatorio-avaria-id').value = id;
    document.getElementById('relatorio-type').value = type;
    document.getElementById('relatorio-status-change').value = isStatusChange ? '1' : '0';

    // UI Elements
    const btnSubmit = document.getElementById('btn-submit-report');
    const btnSave = document.getElementById('btn-save-draft');
    const warning = document.getElementById('relatorio-warning');
    const textarea = document.getElementById('relatorio-texto');
    const pecasArea = document.getElementById('relatorio-pecas');
    const horasInput = document.getElementById('relatorio-horas');

    // Fetch Details to populate A4 Sheet
    try {
        const endpoint = type === 'servico' ? `/api/servicos/${id}/detalhes-relatorio` : (type === 'manutencao' ? `/api/manutencoes/${id}/detalhes-relatorio` : `/api/avarias/${id}/detalhes-relatorio`);
        const res = await authFetch(endpoint);
        if (!res.ok) throw new Error("Erro ao carregar detalhes");
        const data = await res.json();

        // Populate Headers and Info
        document.getElementById('a4-report-id').textContent = `ID: #${data.id.toString().padStart(5, '0')}`;
        const dateObj = new Date(data.data_hora_fim || data.data_hora);
        document.getElementById('a4-report-date').textContent = `Data: ${dateObj.toLocaleDateString('pt-PT')}`;
        document.getElementById('a4-report-type').innerHTML = data.relatorio_submetido === 1 ? 'Relatório de Intervenção' : '<span style="color:#ca8a04;">Relatório (Rascunho)</span>';

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
                mntList.style.display = 'grid';
                mntList.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
                mntList.style.gap = '10px';
                mntList.style.padding = '0';
                
                mntList.innerHTML = data.maquinas.map(m => `
                    <div style="font-size: 12px; background: #f8fafc; padding: 10px 14px; border-radius: 10px; border: 1px solid #e2e8f0; display: flex; align-items: center; gap: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
                        <i class="ph-fill ph-check-circle" style="color: #10b981; font-size: 16px;"></i>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span style="font-weight: 700; color: #1e293b; font-size: 13px;">${m.marca} ${m.modelo}</span>
                            <span style="color: #64748b; font-family: 'Inter', monospace; font-size: 11px;"> - SN: ${m.numero_serie || '---'}</span>
                        </div>
                    </div>
                `).join('');
            } else {
                mntSection.style.display = 'none';
            }
        }

        // Populate Editable Fields
        textarea.value = currentText || data.relatorio || '';
        pecasArea.value = currentPecas || data.pecas_substituidas || '';

        // Handle Admin Notes in Report
        const adminNotesSection = document.getElementById('a4-admin-notes-section');
        const adminNotesDiv = document.getElementById('a4-admin-notes');
        if (adminNotesSection && adminNotesDiv) {
            if (data.notas) {
                adminNotesSection.style.display = 'block';
                adminNotesDiv.textContent = data.notas;
            } else {
                adminNotesSection.style.display = 'none';
            }
        }
        
        let hoursVal = currentHoras || hoursToHHmm(data.horas_trabalho) || '';
        // Se estivermos a concluir agora e o campo estiver vazio, usa o cronómetro
        if (!hoursVal && isStatusChange) {
            const state = getTimerState();
            if (state.taskId == id && state.taskType == type) {
                const totalMs = state.accumulatedMs + (state.startTime ? (Date.now() - state.startTime) : 0);
                const totalHours = totalMs / (1000 * 60 * 60);
                if (totalHours > 0.005) { // Apenas se tiver pelo menos ~20 segundos
                    hoursVal = hoursToHHmm(totalHours);
                }
            }
        }
        horasInput.value = hoursVal;

        const deslocacoesInput = document.getElementById('relatorio-deslocacoes');
        if (deslocacoesInput) {
            if (currentDeslocacoes !== undefined && currentDeslocacoes !== null && currentDeslocacoes !== '') {
                deslocacoesInput.value = currentDeslocacoes;
            } else {
                deslocacoesInput.value = (data.deslocacoes !== null && data.deslocacoes !== undefined) ? data.deslocacoes : 1;
            }
        }

        const staticDeslocacoes = document.getElementById('a4-deslocacoes');
        if (staticDeslocacoes) {
            staticDeslocacoes.textContent = (data.deslocacoes !== null && data.deslocacoes !== undefined) ? data.deslocacoes : 1;
        }

        // Populate Static Horas for viewing
        const staticHoras = document.getElementById('a4-horas-trabalho');
        if (staticHoras) staticHoras.textContent = hoursToHHmm(data.horas_trabalho);

        // Handle Signatures
        clearSignature();
        clearSignatureTech();
        
        const sigToUse = currentSignature || data.assinatura_cliente;
        if (sigToUse) {
            const img = new Image();
            img.onload = () => sigCtx.drawImage(img, 0, 0);
            img.src = sigToUse;
        }

        const sigTechToUse = currentSignatureTech || data.assinatura_tecnico;
        if (sigTechToUse) {
            const imgTech = new Image();
            imgTech.onload = () => sigCtxTech.drawImage(imgTech, 0, 0);
            imgTech.src = sigTechToUse;
        }

        // Constraints
        const disabled = data.relatorio_submetido === 1;
        textarea.disabled = disabled;
        pecasArea.disabled = disabled;
        horasInput.disabled = disabled;
        if (deslocacoesInput) deslocacoesInput.disabled = disabled;
        btnSubmit.style.display = disabled ? 'none' : 'block';
        btnSave.style.display = disabled ? 'none' : 'block';
        warning.style.display = disabled ? 'none' : 'block';

        // Visibility adjustments for "Identical to PDF"
        const reportSheet = document.getElementById('a4-report-sheet');
        const pdfViewer = document.getElementById('pdf-viewer-container');
        const pdfIframe = document.getElementById('pdf-iframe');
        const toolbar = document.getElementById('relatorio-toolbar');
        
        if (disabled) {
            // Em modo de visualização (submetido), mostrar o PDF REAL em iframe
            if (reportSheet) reportSheet.style.display = 'none';
            if (toolbar) toolbar.style.display = 'none';
            if (pdfViewer) {
                pdfViewer.classList.remove('hidden');
                pdfViewer.style.display = 'block';
                pdfIframe.src = `/relatorio.html?id=${id}&type=${type}`;
            }
        } else {
            // Em modo de edição, mostrar a folha interativa
            if (pdfViewer) {
                pdfViewer.classList.add('hidden');
                pdfViewer.style.display = 'none';
                pdfIframe.src = '';
            }
            if (reportSheet) reportSheet.style.display = 'block';
            if (toolbar) toolbar.style.display = 'flex';
            
            // Populate sections normally
            const timeInputSection = document.getElementById('a4-time-input-section');
            const descInputSection = document.getElementById('a4-desc-input-section');
            const pecasInputSection = document.getElementById('a4-pecas-input-section');
            const pecasDisplay = document.getElementById('a4-pecas-display');
            const btnAddFotos = document.getElementById('btn-add-fotos');

            if (timeInputSection) timeInputSection.style.display = 'block';
            if (descInputSection) descInputSection.style.display = 'block';
            if (pecasDisplay) pecasDisplay.style.display = 'none';
            if (btnAddFotos) btnAddFotos.style.display = 'block';

            // Hide clear buttons normally
            const btnClearSig = document.getElementById('btn-clear-signature');
            const btnClearSigTech = document.getElementById('btn-clear-signature-tech');
            if (btnClearSig) btnClearSig.style.display = 'block';
            if (btnClearSigTech) btnClearSigTech.style.display = 'block';

            // Renderizar fotos para edição
            renderPhotosPreview(data.fotos || [], false);
        }

        // Ajustar títulos dinâmicos
        if (detailsTitle) {
            if (type === 'servico') {
                detailsTitle.innerHTML = '<i class="ph ph-wrench"></i> Serviço';
            } else if (type === 'manutencao') {
                detailsTitle.innerHTML = '<i class="ph ph-wrench"></i> Manutenção';
            } else {
                detailsTitle.innerHTML = '<i class="ph ph-wrench"></i> Máquina';
            }
        }

        document.getElementById('modal-relatorio').classList.remove('hidden');
    } catch (e) {
        showNotification("Erro ao carregar dados do relatório.", true);
    }
}

async function saveRelatorioDraft() {
    const id = document.getElementById('relatorio-avaria-id').value;
    const type = document.getElementById('relatorio-type').value;
    const relatorio = document.getElementById('relatorio-texto').value;
    const pecas_substituidas = document.getElementById('relatorio-pecas').value;
    const horas_raw = document.getElementById('relatorio-horas').value;
    const horas_trabalho = HHmmToHours(horas_raw);
    const deslocacoesInput = document.getElementById('relatorio-deslocacoes');
    const deslocacoes = deslocacoesInput ? parseInt(deslocacoesInput.value) || 0 : 1;
    const isStatusChange = document.getElementById('relatorio-status-change').value === '1';
    
    const canvasCli = document.getElementById('signature-pad');
    const canvasTec = document.getElementById('signature-pad-tech');
    
    const assinatura_cliente = isCanvasBlank(canvasCli) ? null : canvasCli.toDataURL('image/png');
    const assinatura_tecnico = isCanvasBlank(canvasTec) ? null : canvasTec.toDataURL('image/png');

    console.log("Tentando salvar rascunho. Assinatura técnico presente:", !!assinatura_tecnico);

    try {
        const endpoint = type === 'servico' ? `${API_BASE}/tecnico/servicos/${id}/relatorio` : (type === 'manutencao' ? `${API_BASE}/tecnico/manutencoes/${id}/relatorio` : `${API_BASE}/tecnico/avarias/${id}/relatorio`);
        const res = await authFetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico, deslocacoes })
        });

        if (res.ok) {
            showNotification("Rascunho salvo com sucesso.");
            document.getElementById('modal-relatorio').classList.add('hidden');
            refreshTechnicianDashboard();
        } else {
            const data = await res.json();
            throw new Error(data.error || "Erro ao salvar rascunho");
        }
    } catch (e) {
        showNotification(e.message, true);
    }
}

async function submitRelatorio() {
    const btnAction = document.getElementById('btn-confirm-submit-action');
    const modalConfirm = document.getElementById('modal-confirm-submit');
    
    // Abrir o modal de confirmação
    modalConfirm.classList.remove('hidden');

    // Limpar listeners anteriores para evitar submissões duplicadas
    const newBtnAction = btnAction.cloneNode(true);
    btnAction.parentNode.replaceChild(newBtnAction, btnAction);
    
    document.getElementById('btn-cancel-submit').onclick = () => modalConfirm.classList.add('hidden');

    newBtnAction.onclick = async () => {
        const originalText = newBtnAction.textContent;
        newBtnAction.disabled = true;
        newBtnAction.textContent = "A submeter...";
        
        try {
            const id = document.getElementById('relatorio-avaria-id').value;
            const type = document.getElementById('relatorio-type').value;
            const relatorio = document.getElementById('relatorio-texto').value;
            const pecas_substituidas = document.getElementById('relatorio-pecas').value;
            const horas_raw = document.getElementById('relatorio-horas').value;
            const horas_trabalho = HHmmToHours(horas_raw);
            const deslocacoesInput = document.getElementById('relatorio-deslocacoes');
            const deslocacoes = deslocacoesInput ? parseInt(deslocacoesInput.value) || 0 : 1;
            const isStatusChange = document.getElementById('relatorio-status-change').value === '1';
            
            const canvasCli = document.getElementById('signature-pad');
            const canvasTec = document.getElementById('signature-pad-tech');
            
            const assinatura_cliente = isCanvasBlank(canvasCli) ? null : canvasCli.toDataURL('image/png');
            const assinatura_tecnico = isCanvasBlank(canvasTec) ? null : canvasTec.toDataURL('image/png');

            // 1. Salvar Rascunho Final
            const draftEndpoint = type === 'servico' ? `${API_BASE}/tecnico/servicos/${id}/relatorio` : (type === 'manutencao' ? `${API_BASE}/tecnico/manutencoes/${id}/relatorio` : `${API_BASE}/tecnico/avarias/${id}/relatorio`);
            await authFetch(draftEndpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico, deslocacoes })
            });

            // 2. Submeter
            const submitEndpoint = type === 'servico' ? `${API_BASE}/tecnico/servicos/${id}/submeter-relatorio` : (type === 'manutencao' ? `${API_BASE}/tecnico/manutencoes/${id}/submeter-relatorio` : `${API_BASE}/tecnico/avarias/${id}/submeter-relatorio`);
            const res = await authFetch(submitEndpoint, { method: 'POST' });

            if (res.ok) {
                stopTimer();
                showNotification("Relatório submetido com sucesso!");
                modalConfirm.classList.add('hidden');
                document.getElementById('modal-relatorio').classList.add('hidden');
                refreshTechnicianDashboard();
            } else {
                const data = await res.json();
                throw new Error(data.error || "Erro ao submeter");
            }
        } catch (e) {
            console.error("Erro na submissão:", e);
            showNotification(e.message, true);
        } finally {
            newBtnAction.disabled = false;
            newBtnAction.textContent = originalText;
        }
    };
}

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

let historicoData = [];

async function loadHistorico() {
    try {
        const [resAvarias, resServicos, resManutencoes] = await Promise.all([
            authFetch(`${API_BASE}/tecnico/historico`),
            authFetch(`${API_BASE}/tecnico/servicos/historico`),
            authFetch(`${API_BASE}/tecnico/manutencoes/historico`)
        ]);

        const avarias = await resAvarias.json();
        const servicos = await resServicos.json();
        const manutencoes = await resManutencoes.json();

        // Marcar tipos
        historicoData = [
            ...avarias.map(a => ({ ...a, _type: 'avaria' })),
            ...servicos.map(s => ({ ...s, _type: 'servico' })),
            ...manutencoes.map(m => ({ ...m, _type: 'manutencao' }))
        ];

        // Ordenar por data de fim decrescente
        historicoData.sort((a, b) => new Date(b.data_hora_fim || b.data_hora) - new Date(a.data_hora_fim || a.data_hora));

        const uniqueClients = [...new Set(historicoData.map(a => a.cliente_nome))].filter(Boolean).sort();
        const filterSelect = document.getElementById('filter-hist-cliente');
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">Todos / Pesquisar Cliente</option>';
            uniqueClients.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                filterSelect.appendChild(opt);
            });
        }

        renderHistorico();
    } catch (e) {
        showNotification("Erro ao carregar histórico", true);
    }
}

window.renderHistorico = function () {
    const tbody = document.getElementById('table-historico-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filter = document.getElementById('filter-hist-cliente')?.value;

    let filteredData = historicoData;
    if (filter) {
        filteredData = historicoData.filter(a => a.cliente_nome === filter);
    }

    filteredData.forEach(a => {
        const dateStr = a.data_hora_fim ? new Date(a.data_hora_fim).toLocaleString('pt-PT') : new Date(a.data_hora).toLocaleString('pt-PT');

        const tr = document.createElement('tr');

        let maqNome = '';
        let badgeColor = '#10b981';
        let typeLabel = 'AVARIA';

        if (a._type === 'avaria') {
            badgeColor = '#ef4444'; // Vermelho para Avarias
            typeLabel = 'AVARIA';
            maqNome = escapeHTML(a.maquina_nome || 'Máquina Removida');
        } else if (a._type === 'servico') {
            badgeColor = '#3b82f6'; // Azul para Serviços
            typeLabel = 'SERVIÇO';
            maqNome = escapeHTML(a.tipo_servico);
        } else if (a._type === 'manutencao') {
            badgeColor = '#7c3aed'; // Roxo para Manutenções
            typeLabel = 'MANUTENÇÃO';
            maqNome = 'Todas as Máquinas';
        }

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td class="col-client"></td>
            <td class="col-machine">
                <span style="font-size:10px; font-weight:700; background: ${badgeColor}15; color: ${badgeColor}; border: 1px solid ${badgeColor}33; padding:2px 8px; border-radius:4px; margin-right:8px; vertical-align:middle;">${typeLabel}</span>
                <span style="vertical-align:middle; font-weight:600; color:var(--text-primary);">${maqNome}</span>
            </td>
            <td>${hoursToHHmm(a.horas_trabalho)}</td>
            <td class="col-report"><div style="display:flex; gap:5px;"></div></td>
        `;

        tr.querySelector('.col-client').textContent = a.cliente_nome || '-';
        // Removida a substituição direta para manter o formato rico (com as etiquetas coloridas)

        const colReport = tr.querySelector('.col-report div');

        if (a.relatorio_submetido !== 1) {
            const btn = document.createElement('button');
            btn.className = 'btn-status';
            btn.style.padding = '5px 10px';
            btn.style.fontSize = '12px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.gap = '5px';
            btn.style.border = 'none';
            btn.style.borderRadius = '6px';
            btn.style.cursor = 'pointer';
            btn.style.fontWeight = '600';

            btn.style.background = '#fef9c3';
            btn.style.color = '#854d0e';
            btn.innerHTML = '<i class="ph ph-pencil-line"></i> Editar';

            btn.onclick = () => openReportFromHistory(a.id, a._type);
            colReport.appendChild(btn);
        }

        if (a.relatorio_submetido === 1) {
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
            btnPdf.style.background = '#dc2626';
            btnPdf.style.color = '#ffffff';
            btnPdf.innerHTML = '<i class="ph ph-file-pdf"></i> PDF';
            btnPdf.onclick = () => viewPDF(a.id, a._type);
            colReport.appendChild(btnPdf);
        }

        tbody.appendChild(tr);
    });
};

// Nav Switch
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

        const target = e.target.getAttribute('data-target');
        const view = document.getElementById(`view-${target}`);
        if (view) view.classList.remove('hidden');

        if (target === 'dashboard') loadMyTasks();
        if (target === 'agendamentos') loadAgendamentos();
        if (target === 'historico') loadHistorico();
        if (target === 'consulta') loadConsultaClientes();
        if (target === 'checklists') loadChecklistModelos();
        if (target === 'anotacoes') {
            loadAnotacoesClientes();
            loadAnotacoesHist();
        }
    });
});

// --- Consulta por Máquina ---
let consultaClientes = [];
let consultaMaquinas = [];
let consultaHistorico = [];

// --- Helper for Custom Select Search ---
function setupCustomSelect(inputId, dropdownId, data, onSelect) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    
    dropdown.innerHTML = '';
    data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'custom-search-option';
        div.textContent = item.label;
        div.dataset.id = item.id;
        
        div.onmousedown = (e) => {
            e.preventDefault(); // Prevents input blur
            input.value = item.label;
            dropdown.classList.remove('show');
            onSelect(item.id);
        };
        dropdown.appendChild(div);
    });

    input.oninput = () => {
        dropdown.classList.add('show');
        const filter = input.value.toLowerCase();
        Array.from(dropdown.children).forEach(child => {
            if (child.textContent.toLowerCase().includes(filter)) {
                child.classList.remove('hidden');
            } else {
                child.classList.add('hidden');
            }
        });
    };

    input.onfocus = () => {
        if (!input.disabled && data.length > 0) {
            dropdown.classList.add('show');
            Array.from(dropdown.children).forEach(child => child.classList.remove('hidden'));
        }
    };

    input.onblur = () => {
        dropdown.classList.remove('show');
        const match = data.find(d => d.label === input.value);
        if (!match) {
            input.value = '';
            onSelect(null);
        }
    };
}

async function loadConsultaClientes() {
    try {
        const res = await authFetch(`${API_BASE}/tecnico/clientes`);
        if (!res.ok) throw new Error("Erro ao buscar clientes");
        consultaClientes = await res.json();
        
        const inputClient = document.getElementById('filter-consulta-cliente');
        const inputMachine = document.getElementById('filter-consulta-maquina');
        const dropdownMachine = document.getElementById('dropdown-maquinas');
        const emptyMsg = document.getElementById('consulta-empty');
        const tableContainer = document.getElementById('consulta-table-container');

        inputClient.value = '';
        inputClient.placeholder = 'Escreva ou selecione...';
        inputClient.disabled = false;

        inputMachine.value = '';
        inputMachine.placeholder = 'Selecione primeiro o cliente';
        inputMachine.disabled = true;
        dropdownMachine.innerHTML = '';
        emptyMsg.style.display = 'block';
        tableContainer.style.display = 'none';

        const clientData = consultaClientes.map(c => ({ id: c.id, label: c.nome }));

        setupCustomSelect('filter-consulta-cliente', 'dropdown-clientes', clientData, (clientId) => {
            if (clientId) {
                loadConsultaMaquinas(clientId);
            } else {
                inputMachine.value = '';
                inputMachine.placeholder = 'Selecione primeiro o cliente';
                inputMachine.disabled = true;
                dropdownMachine.innerHTML = '';
                emptyMsg.style.display = 'block';
                tableContainer.style.display = 'none';
            }
        });

    } catch (e) {
        showNotification("Erro ao carregar clientes para consulta.", true);
    }
}

async function loadConsultaMaquinas(clienteId) {
    const inputMachine = document.getElementById('filter-consulta-maquina');
    const dropdownMachine = document.getElementById('dropdown-maquinas');
    inputMachine.value = '';
    inputMachine.placeholder = 'A carregar máquinas...';
    inputMachine.disabled = true;
    dropdownMachine.innerHTML = '';

    try {
        const res = await authFetch(`${API_BASE}/tecnico/clientes/${clienteId}/maquinas`);
        if (!res.ok) throw new Error("Erro ao buscar máquinas");
        consultaMaquinas = await res.json();

        if (consultaMaquinas.length === 0) {
            inputMachine.placeholder = 'Nenhuma máquina encontrada';
        } else {
            inputMachine.placeholder = 'Escreva ou selecione a máquina...';
            const machineData = consultaMaquinas.map(m => ({
                id: m.id,
                label: `${m.marca} ${m.modelo} (SN: ${m.numero_serie || 'N/A'})`
            }));

            setupCustomSelect('filter-consulta-maquina', 'dropdown-maquinas', machineData, (maquinaId) => {
                if (maquinaId) {
                    loadConsultaHistorico(maquinaId);
                } else {
                    document.getElementById('consulta-empty').style.display = 'block';
                    document.getElementById('consulta-table-container').style.display = 'none';
                }
            });
            inputMachine.disabled = false;
        }
        
        document.getElementById('consulta-empty').style.display = 'block';
        document.getElementById('consulta-table-container').style.display = 'none';
    } catch (e) {
        inputMachine.placeholder = 'Erro ao carregar';
        showNotification("Erro ao carregar máquinas do cliente.", true);
    }
}

async function loadConsultaHistorico(maquinaId) {
    const loadingMsg = document.getElementById('consulta-loading');
    const emptyMsg = document.getElementById('consulta-empty');
    const tableContainer = document.getElementById('consulta-table-container');
    const tbody = document.getElementById('table-consulta-body');

    loadingMsg.style.display = 'block';
    emptyMsg.style.display = 'none';
    tableContainer.style.display = 'none';

    try {
        const res = await authFetch(`${API_BASE}/tecnico/maquinas/${maquinaId}/historico`);
        if (!res.ok) throw new Error("Erro ao buscar histórico");
        consultaHistorico = await res.json();

        loadingMsg.style.display = 'none';

        if (consultaHistorico.length === 0) {
            emptyMsg.style.display = 'block';
        } else {
            tbody.innerHTML = '';
            consultaHistorico.forEach(item => {
                const tr = document.createElement('tr');

                const tdDate = document.createElement('td');
                const d = new Date(item.data_hora_fim);
                tdDate.innerHTML = `<span style="font-weight:600; color:var(--text-main);">${d.toLocaleDateString('pt-PT')}</span><br><span style="font-size:12px; color:var(--text-secondary);">${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}h</span>`;
                tr.appendChild(tdDate);

                const tdClient = document.createElement('td');
                tdClient.textContent = item.cliente_nome || '---';
                tr.appendChild(tdClient);

                const tdType = document.createElement('td');
                let tagColor = 'var(--accent)';
                let tagStr = 'AVARIA';
                let tipoDesc = '';
                
                if (item.tipo === 'manutencao') {
                    tagStr = 'MANUTENÇÃO';
                    tagColor = '#7c3aed';
                    tipoDesc = 'Geral';
                } else {
                    tipoDesc = item.tipo_avaria === 1 ? 'Elétrica' : (item.tipo_avaria === 3 ? 'Mecânica' : 'Outra');
                }
                tdType.innerHTML = `<span style="font-size:11px; font-weight:700; background:var(--accent-light); color:${tagColor}; padding:3px 8px; border-radius:4px; display:inline-block; margin-bottom:4px;">${tagStr}</span><br>${tipoDesc}`;
                tr.appendChild(tdType);

                const tdTech = document.createElement('td');
                tdTech.textContent = item.tecnico_nome || '---';
                tr.appendChild(tdTech);

                const tdReport = document.createElement('td');
                const btnView = document.createElement('button');
                btnView.className = 'btn-secondary';
                btnView.style.padding = '6px 12px';
                btnView.style.fontSize = '12px';
                btnView.innerHTML = '<i class="ph ph-file-text"></i> Ver Relatório';
                btnView.onclick = () => {
                    openRelatorioModal(item.id, false, '', true, '', '', '', item.tipo);
                };
                tdReport.appendChild(btnView);
                tr.appendChild(tdReport);

                tbody.appendChild(tr);
            });
            tableContainer.style.display = 'block';
        }
    } catch (e) {
        loadingMsg.style.display = 'none';
        emptyMsg.style.display = 'block';
        showNotification("Erro ao carregar histórico da máquina.", true);
    }
}

// Password Change Form
const pwdForm = document.getElementById('form-change-password');
if (pwdForm) {
    pwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPassword = document.getElementById('pwd-old').value;
        const newPassword = document.getElementById('pwd-new').value;
        const confirmPwd = document.getElementById('pwd-confirm').value;

        if (newPassword !== confirmPwd) {
            showNotification("As novas passwords não coincidem", true);
            return;
        }

        try {
            const res = await authFetch(`${API_BASE}/tecnico/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro ao atualizar");

            showNotification("Password atualizada com sucesso!");
            pwdForm.reset();
        } catch (err) {
            showNotification(err.message, true);
        }
    });
}

window.onload = () => {
    showView();
    initSignaturePad();
    initGlobalTimer();
    startAutoRefresh();

    const inputFotos = document.getElementById('relatorio-fotos');
    if (inputFotos) {
        inputFotos.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                uploadPhotos(files);
                // Pequeno delay para garantir que o FileList foi capturado antes de limpar o valor
                setTimeout(() => { e.target.value = ''; }, 100);
            }
        });
    }

    const btnAddFotos = document.getElementById('btn-add-fotos');
    if (btnAddFotos) {
        btnAddFotos.addEventListener('click', () => {
            document.getElementById('relatorio-fotos').click();
        });
    }

    // CSP Listeners
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    const histFilter = document.getElementById('filter-hist-cliente');
    if (histFilter) histFilter.addEventListener('change', renderHistorico);

    // Toggle Sidebar Mobile
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => {
            const sidebar = document.querySelector('.sidebar');
            sidebar.classList.toggle('active');
        });
    }

    // Dashboard Toggle Listeners
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentDashboardFilter = e.target.getAttribute('data-filter');
            renderPendingTasks();
        });
    });

    // Dashboard Custom Filters Listeners
    const filterDashCliente = document.getElementById('filter-dash-cliente');
    const filterDashData = document.getElementById('filter-dash-data');
    const btnClearDashFilters = document.getElementById('btn-clear-dash-filters');

    if (filterDashCliente) filterDashCliente.addEventListener('change', renderPendingTasks);
    if (filterDashData) filterDashData.addEventListener('change', renderPendingTasks);
    if (btnClearDashFilters) {
        btnClearDashFilters.addEventListener('click', () => {
            if (filterDashCliente) filterDashCliente.value = '';
            if (filterDashData) filterDashData.value = '';
            renderPendingTasks();
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

    // Relatorio Listeners
    const btnSaveDraft = document.getElementById('btn-save-draft');
    if (btnSaveDraft) btnSaveDraft.addEventListener('click', saveRelatorioDraft);

    const btnSubmitReport = document.getElementById('btn-submit-report');
    if (btnSubmitReport) {
        btnSubmitReport.addEventListener('click', (e) => {
            e.preventDefault();
            submitRelatorio();
        });
    }

    // Botão Nova Anotação
    const btnNovaAnotacao = document.getElementById('btn-nova-anotacao');
    if (btnNovaAnotacao) {
        btnNovaAnotacao.addEventListener('click', () => {
            window.openModal('modal-add-anotacao');
        });
    }

    // Botão Cancelar Anotação
    const btnCancelarAnotacao = document.getElementById('btn-cancelar-anotacao');
    if (btnCancelarAnotacao) {
        btnCancelarAnotacao.addEventListener('click', () => {
            window.closeModal('modal-add-anotacao');
        });
    }

    const formPausar = document.getElementById('form-pausar');
    if (formPausar) {
        formPausar.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('pausar-avaria-id').value;
            const type = document.getElementById('pausar-type').value;
            const motivo = document.getElementById('pausar-motivo').value;

            try {
                const endpoint = type === 'servico' ? `${API_BASE}/servicos/${id}/status` : (type === 'manutencao' ? `${API_BASE}/manutencoes/${id}/status` : `${API_BASE}/avarias/${id}/status`);
                const res = await authFetch(endpoint, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ estado: 'pausada', motivo_pausa: motivo })
                });

                if (res.ok) {
                    pauseTimer(); // Para o cronómetro ao pausar
                    showNotification("Tarefa pausada.");
                    document.getElementById('modal-pausar').classList.add('hidden');
                    refreshTechnicianDashboard();
                } else {
                    const data = await res.json();
                    throw new Error(data.error || "Erro ao pausar.");
                }
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }

    const closeBtns = document.querySelectorAll('.close-btn');
    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-modal');
            if (modalId) {
                document.getElementById(modalId).classList.add('hidden');
                // Se era o modal de relatório vindo de uma conclusão, recarrega tarefas
                if (modalId === 'modal-relatorio' && document.getElementById('relatorio-status-change').value === '1') {
                    loadMyTasks();
                }
            }
        });
    });

    const btnCloseNote = document.getElementById('btn-close-note');
    if (btnCloseNote) {
        btnCloseNote.addEventListener('click', () => {
            document.getElementById('modal-view-note').classList.add('hidden');
        });
    }

    // Anotações Form Listeners
    const anotacaoClienteSelect = document.getElementById('anotacao-cliente');
    if (anotacaoClienteSelect) {
        anotacaoClienteSelect.addEventListener('change', (e) => {
            const clienteId = e.target.value;
            if (clienteId) {
                loadAnotacoesMaquinas(clienteId);
            } else {
                const maqSelect = document.getElementById('anotacao-maquina');
                maqSelect.innerHTML = '<option value="">Selecione primeiro o cliente</option>';
                maqSelect.disabled = true;
            }
        });
    }

    const formNovaAnotacao = document.getElementById('form-nova-anotacao');
    if (formNovaAnotacao) {
        formNovaAnotacao.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cliente_id = document.getElementById('anotacao-cliente').value;
            const maquina_id = document.getElementById('anotacao-maquina').value;
            const descricao = document.getElementById('anotacao-descricao').value;

            try {
                const res = await authFetch(`${API_BASE}/tecnico/anotacoes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cliente_id, maquina_id, descricao })
                });

                if (res.ok) {
                    showNotification("Anotação enviada com sucesso!");
                    formNovaAnotacao.reset();
                    document.getElementById('anotacao-maquina').disabled = true;
                    document.getElementById('anotacao-maquina').innerHTML = '<option value="">Selecione primeiro o cliente</option>';
                    closeModal('modal-add-anotacao');
                    loadAnotacoesHist();
                } else {
                    const data = await res.json();
                    throw new Error(data.error || "Erro ao enviar anotação");
                }
            } catch (err) {
                showNotification(err.message, true);
            }
        });
    }
};

// --- Anotações / Intervenções Futuras ---

async function loadAnotacoesClientes() {
    try {
        const res = await authFetch(`${API_BASE}/tecnico/clientes`);
        const clientes = await res.json();
        const select = document.getElementById('anotacao-cliente');
        if (!select) return;

        const currentVal = select.value;
        select.innerHTML = '<option value="">Selecione o Cliente</option>';
        clientes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.nome;
            select.appendChild(opt);
        });
        select.value = currentVal;
    } catch (e) {
        console.error("Erro ao carregar clientes para anotações", e);
    }
}

async function loadAnotacoesMaquinas(clienteId) {
    const select = document.getElementById('anotacao-maquina');
    if (!select) return;

    select.disabled = true;
    select.innerHTML = '<option value="">A carregar máquinas...</option>';

    try {
        const res = await authFetch(`${API_BASE}/tecnico/clientes/${clienteId}/maquinas`);
        const máquinas = await res.json();

        select.innerHTML = '<option value="">(Opcional) Selecione a Máquina</option>';
        máquinas.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.uuid; // Usamos uuid aqui para manter consistência com o que o server espera ou id
            opt.textContent = `${m.marca} ${m.modelo} (SN: ${m.numero_serie || 'N/A'})`;
            select.appendChild(opt);
        });
        select.disabled = false;
    } catch (e) {
        select.innerHTML = '<option value="">Erro ao carregar máquinas</option>';
    }
}

async function loadAnotacoesHist() {
    try {
        const res = await authFetch(`${API_BASE}/tecnico/anotacoes`);
        const anotacoes = await res.json();
        const tbody = document.getElementById('table-anotacoes-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        anotacoes.forEach(a => {
            const tr = document.createElement('tr');
            
            const statusLabel = a.estado === 'pendente' ? 'Pendente' : 'Concluída';
            const statusStyle = a.estado === 'pendente' ? 'color: var(--danger); font-weight: bold;' : 'color: var(--success); font-weight: bold;';

            tr.innerHTML = `
                <td>${new Date(a.data_criacao).toLocaleString('pt-PT')}</td>
                <td>${escapeHTML(a.cliente_nome)}</td>
                <td>${a.maquina_id ? `${escapeHTML(a.marca)} ${escapeHTML(a.modelo)}` : '---'}</td>
                <td style="font-size: 13px; max-width: 300px; white-space: pre-wrap;">${escapeHTML(a.descricao)}</td>
                <td style="${statusStyle}">${statusLabel}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Erro ao carregar histórico de anotações", e);
    }
}

function escapeJS(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

window.openReportFromHistory = function (id, type) {
    const item = historicoData.find(a => a.id === id && a._type === type);
    if (!item) return;
    openRelatorioModal(item.id, false, item.relatorio, item.relatorio_submetido === 1, item.pecas_substituidas, item.horas_trabalho, item.assinatura_cliente, item._type, item.assinatura_tecnico, item.deslocacoes);
};

window.openFullNoteModal = function(encodedNote) {
    const note = decodeURIComponent(encodedNote);
    document.getElementById('full-note-content').textContent = note;
    document.getElementById('modal-view-note').classList.remove('hidden');
};

window.openTicketDetailsModal = function(task) {
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
        titleStr = task.maquina_nome;
        subTitleStr = task.tipo_avaria === 1 ? 'Elétrica' : (task.tipo_avaria === 3 ? 'Mecânica' : 'Outra');
    } else if (task._type === 'servico') {
        typeLabel = 'Serviço';
        typeColor = '#1E4419';
        icon = 'ph-truck';
        titleStr = task.tipo_servico || task.title; // Fallback for agendamentos
        subTitleStr = `Camião: ${task.tipo_camiao || '---'}`;
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
        </div>

        ${task.notas ? `
        <div style="margin-bottom:20px;">
            <h3 style="font-size:13px; color:var(--text-secondary); margin-bottom:8px; display:flex; align-items:center; gap:6px;"><i class="ph ph-note"></i> Notas do Admin</h3>
            <div style="background:#fffbeb; border-left:4px solid #f59e0b; padding:12px; border-radius:4px; font-size:14px; color:#92400e; line-height:1.5; white-space:pre-wrap;">${escapeHTML(task.notas)}</div>
        </div>
        ` : ''}
        
        <div style="display:flex; justify-content:flex-end; margin-top:25px;">
            <button class="btn-primary" id="btn-close-ticket-details" style="width:auto; padding:8px 25px;">Fechar</button>
        </div>
    `;

    const btnFechar = document.getElementById('btn-close-ticket-details');
    if (btnFechar) {
        btnFechar.onclick = () => document.getElementById('modal-ticket-details').classList.add('hidden');
    }

    document.getElementById('modal-ticket-details').classList.remove('hidden');
};

// --- Assinatura Digital ---
let sigCanvas, sigCtx, isDrawing = false;
let sigCanvasTech, sigCtxTech, isDrawingTech = false;

function initSignaturePad() {
    // Cliente
    sigCanvas = document.getElementById('signature-pad');
    if (sigCanvas) {
        sigCtx = sigCanvas.getContext('2d');
        sigCtx.lineWidth = 2;
        sigCtx.lineCap = 'round';
        sigCtx.strokeStyle = '#000000';
        sigCanvas.addEventListener('mousedown', startDrawing);
        sigCanvas.addEventListener('mousemove', draw);
        sigCanvas.addEventListener('mouseup', stopDrawing);
        sigCanvas.addEventListener('mouseout', stopDrawing);
        sigCanvas.addEventListener('touchstart', startDrawing, { passive: false });
        sigCanvas.addEventListener('touchmove', draw, { passive: false });
        sigCanvas.addEventListener('touchend', stopDrawing);
        sigCanvas.addEventListener('touchcancel', stopDrawing);
        document.getElementById('btn-clear-signature').addEventListener('click', clearSignature);
    }

    // Técnico
    sigCanvasTech = document.getElementById('signature-pad-tech');
    if (sigCanvasTech) {
        sigCtxTech = sigCanvasTech.getContext('2d');
        sigCtxTech.lineWidth = 2;
        sigCtxTech.lineCap = 'round';
        sigCtxTech.strokeStyle = '#000000';
        sigCanvasTech.addEventListener('mousedown', startDrawingTech);
        sigCanvasTech.addEventListener('mousemove', drawTech);
        sigCanvasTech.addEventListener('mouseup', stopDrawingTech);
        sigCanvasTech.addEventListener('mouseout', stopDrawingTech);
        sigCanvasTech.addEventListener('touchstart', startDrawingTech, { passive: false });
        sigCanvasTech.addEventListener('touchmove', drawTech, { passive: false });
        sigCanvasTech.addEventListener('touchend', stopDrawingTech);
        sigCanvasTech.addEventListener('touchcancel', stopDrawingTech);
        document.getElementById('btn-clear-signature-tech').addEventListener('click', clearSignatureTech);
    }
}

// Lógica Cliente
function getPos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    const scaleX = sigCanvas.width / (rect.width || 1);
    const scaleY = sigCanvas.height / (rect.height || 1);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}
function startDrawing(e) {
    if (document.getElementById('relatorio-texto').disabled) return;
    if (e.cancelable) e.preventDefault();
    isDrawing = true;
    const pos = getPos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
}
function draw(e) {
    if (!isDrawing) return;
    if (e.type.includes('touch')) e.preventDefault();
    const pos = getPos(e);
    sigCtx.lineTo(pos.x, pos.y);
    sigCtx.stroke();
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
}
function stopDrawing() { isDrawing = false; sigCtx.beginPath(); }
function clearSignature() {
    if (!sigCanvas || !sigCtx) return;
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
}

// Lógica Técnico
function getPosTech(e) {
    const rect = sigCanvasTech.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    const scaleX = sigCanvasTech.width / (rect.width || 1);
    const scaleY = sigCanvasTech.height / (rect.height || 1);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}
function startDrawingTech(e) {
    if (document.getElementById('relatorio-texto').disabled) return;
    if (e.cancelable) e.preventDefault();
    isDrawingTech = true;
    const pos = getPosTech(e);
    sigCtxTech.beginPath();
    sigCtxTech.moveTo(pos.x, pos.y);
}
function drawTech(e) {
    if (!isDrawingTech) return;
    if (e.type.includes('touch')) e.preventDefault();
    const pos = getPosTech(e);
    sigCtxTech.lineTo(pos.x, pos.y);
    sigCtxTech.stroke();
    sigCtxTech.beginPath();
    sigCtxTech.moveTo(pos.x, pos.y);
}
function stopDrawingTech() { isDrawingTech = false; sigCtxTech.beginPath(); }
function clearSignatureTech() {
    if (!sigCanvasTech || !sigCtxTech) return;
    sigCtxTech.clearRect(0, 0, sigCanvasTech.width, sigCanvasTech.height);
}

function isCanvasBlank(canvas) {
    if (!canvas) return true;
    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    return canvas.toDataURL() === blank.toDataURL();
}

window.viewPDF = function (id, type = 'avaria') {
    window.open(`/relatorio.html?id=${id}&type=${type}`, '_blank');
};
async function loadAgendamentos() {
    try {
        const res = await authFetch(`${API_BASE}/tecnico/agendamentos`);
        const agendamentos = await res.json();
        const container = document.getElementById('agendamentos-container');
        container.innerHTML = '';

        if (agendamentos.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:20px;">Não tem intervenções agendadas para o futuro.</p>';
            return;
        }

        agendamentos.forEach(a => {
            const div = document.createElement('div');
            div.className = 'repair-item';
            div.style.borderLeft = `5px solid ${a.type === 'avaria' ? '#ef4444' : (a.type === 'servico' ? '#3b82f6' : '#7c3aed')}`;

            const dateStr = new Date(a.data_agendada).toLocaleString('pt-PT', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
                    <span style="font-size:11px; font-weight:700; background:var(--accent-light); color:var(--accent); padding:3px 8px; border-radius:4px;">
                        ${a.type === 'avaria' ? 'AVARIA' : (a.type === 'servico' ? 'SERVIÇO' : 'MANUTENÇÃO')}
                    </span>
                    <span style="font-size:12px; font-weight:700; color:var(--text-secondary);">${a.estado.toUpperCase()}</span>
                </div>
                <h3 style="margin-bottom:5px;">${escapeHTML(a.title)}</h3>
                <p style="font-size:14px; color:var(--text-secondary); font-weight:600;">${escapeHTML(a.cliente_nome)}</p>
                ${a.cliente_morada ? `<div style="font-size:13px; color:var(--accent); margin-top:2px;"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.cliente_morada)}" target="_blank" style="text-decoration:none; color:inherit; display:flex; align-items:center; gap:4px;"><i class="ph ph-map-pin"></i> ${escapeHTML(a.cliente_morada)}</a></div>` : ''}
                <div style="margin-top:10px; font-weight:600; color:var(--accent); display:flex; align-items:center; gap:5px;">
                    <i class="ph ph-calendar-blank"></i> ${dateStr}
                </div>
                ${a.notas ? `<div style="margin-top:10px; padding:10px; background:var(--surface-color); border-radius:6px; font-size:13px;"><strong style="color:var(--text-main);">Notas:</strong><br>${escapeHTML(a.notas)}</div>` : ''}
            `;
            // Click no card abre detalhes
            div.onclick = () => window.openTicketDetailsModal({...a, _type: a.type});
            container.appendChild(div);
        });
    } catch (e) {
        showNotification("Erro ao carregar agendamentos.", true);
    }
}

// --- Guias de Resolução (Checklists) ---
async function loadChecklistModelos() {
    try {
        const rawRes = await authFetch(`${API_BASE}/modelos`);
        const res = await rawRes.json();
        const trigger = document.getElementById('trigger-tech-checklist-modelo');
        const optionsContainer = document.getElementById('options-tech-checklist-modelo');
        const hiddenInput = document.getElementById('tech-checklist-modelo');
        
        if (!trigger || !optionsContainer || !hiddenInput) return;

        // Limpar dropdown anterior
        optionsContainer.innerHTML = '';

        // Adicionar opção "Todos"
        const optionTodos = document.createElement('div');
        optionTodos.className = 'custom-select-option';
        optionTodos.textContent = 'Todos os Modelos';
        optionTodos.dataset.value = '';
        optionTodos.onclick = () => {
            hiddenInput.value = '';
            trigger.querySelector('.custom-select-text').textContent = 'Todos os Modelos';
            document.getElementById('dropdown-tech-checklist-modelo').classList.add('hidden');
            loadTechChecklists();
        };
        optionsContainer.appendChild(optionTodos);

        // Preencher com modelos
        res.forEach(m => {
            const label = `${m.marca} ${m.modelo}`;
            const opt = document.createElement('div');
            opt.className = 'custom-select-option';
            opt.textContent = label;
            opt.dataset.value = JSON.stringify({marca: m.marca, modelo: m.modelo});
            
            opt.onclick = () => {
                hiddenInput.value = opt.dataset.value;
                trigger.querySelector('.custom-select-text').textContent = label;
                document.getElementById('dropdown-tech-checklist-modelo').classList.add('hidden');
                loadTechChecklists();
            };
            optionsContainer.appendChild(opt);
        });

        initCustomSelect('tech-checklist-modelo');

        // Initial load
        loadTechChecklists();
    } catch (e) {
        console.error("Erro ao carregar modelos", e);
    }
}

async function loadTechChecklists() {
    try {
        const hiddenInput = document.getElementById('tech-checklist-modelo');
        if (!hiddenInput) return;
        
        const filterVal = hiddenInput.value;
        let url = `${API_BASE}/checklists`;
        if (filterVal) {
            const { marca, modelo } = JSON.parse(filterVal);
            url += `?marca=${encodeURIComponent(marca)}&modelo=${encodeURIComponent(modelo)}`;
        }
        
        const rawChecklists = await authFetch(url);
        const checklists = await rawChecklists.json();
        const container = document.getElementById('tech-checklists-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (checklists.length === 0) {
            container.innerHTML = '<div style="text-align:center; color:var(--text-secondary); padding:20px;">Nenhuma checklist encontrada.</div>';
            return;
        }

        for (const c of checklists) {
            // Need to fetch details for steps
            const rawDetails = await authFetch(`${API_BASE}/checklists/${c.id}`);
            const details = await rawDetails.json();
            const passos = details.passos || [];

            const card = document.createElement('div');
            card.style.background = 'var(--surface-color)';
            card.style.borderRadius = '12px';
            card.style.boxShadow = 'var(--shadow-sm)';
            card.style.overflow = 'hidden';

            const header = document.createElement('div');
            header.style.padding = '15px 20px';
            header.style.background = '#f8fafc';
            header.style.borderBottom = '1px solid var(--border-color)';
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.cursor = 'pointer';

            header.innerHTML = `
                <div>
                    <h3 style="margin:0; font-size:16px; color:var(--text-main);"><span style="color:var(--text-secondary); font-size:12px; display:block; text-transform:uppercase;">${escapeHTML(c.marca)} ${escapeHTML(c.modelo)}</span>${escapeHTML(c.titulo_avaria)}</h3>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:12px; font-weight:700; color:var(--accent); background:var(--accent-light); padding:4px 8px; border-radius:6px;">${passos.length} Passos</span>
                    <i class="ph ph-caret-down checklist-caret" style="transition: transform 0.3s; font-size:20px; color:var(--text-secondary);"></i>
                </div>
            `;

            const body = document.createElement('div');
            body.className = 'checklist-body hidden';
            body.style.padding = '20px';

            let bodyHtml = '';
            if (c.descricao) {
                bodyHtml += `<p style="margin-top:0; margin-bottom:20px; font-size:14px; color:var(--text-secondary); line-height:1.5;">${escapeHTML(c.descricao)}</p>`;
            }

            if (passos.length > 0) {
                bodyHtml += `<div style="display:flex; flex-direction:column; gap:12px;">`;
                passos.forEach((p, idx) => {
                    const uniqueId = `passo-${c.id}-${idx}`;
                    bodyHtml += `
                        <label for="${uniqueId}" style="display:flex; gap:12px; align-items:flex-start; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; cursor:pointer; transition: background 0.2s;">
                            <input type="checkbox" id="${uniqueId}" style="margin-top:4px; width:18px; height:18px; accent-color:var(--primary);">
                            <div style="flex:1;">
                                <span style="font-weight:bold; color:var(--text-secondary); margin-right:5px;">${idx + 1}.</span>
                                <span style="font-size:15px; color:var(--text-main);">${escapeHTML(p.descricao)}</span>
                            </div>
                        </label>
                    `;
                });
                bodyHtml += `</div>`;
            }

            body.innerHTML = bodyHtml;

            // Toggle Expand/Collapse
            header.onclick = () => {
                body.classList.toggle('hidden');
                const caret = header.querySelector('.checklist-caret');
                if (body.classList.contains('hidden')) {
                    caret.style.transform = 'rotate(0deg)';
                } else {
                    caret.style.transform = 'rotate(180deg)';
                }
            };

            card.appendChild(header);
            card.appendChild(body);
            container.appendChild(card);
        }
    } catch(e) {
        console.error("Erro ao carregar guias de resolução", e);
    }
}

// --- Funções Auxiliares para Custom Selects ---
function initCustomSelect(id) {
    const trigger = document.getElementById(`trigger-${id}`);
    const dropdown = document.getElementById(`dropdown-${id}`);
    const search = document.getElementById(`search-${id}`);
    const optionsContainer = document.getElementById(`options-${id}`);
    
    if (!trigger || !dropdown) return;

    trigger.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
        if (!dropdown.classList.contains('hidden')) {
            if(search) search.focus();
        }
    };

    if (search && optionsContainer) {
        search.oninput = () => {
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
