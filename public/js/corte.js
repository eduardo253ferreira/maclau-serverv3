// public/js/corte.js

(function() {
    const token = localStorage.getItem('maclau_token');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const userNameEl = document.getElementById('user-name');
    if (userNameEl) userNameEl.textContent = params.get('name') || 'Técnico Laser';

    let activeTimers = {};
    let allTasks = [];

    const showNotification = (msg, type = 'success') => {
        const n = document.getElementById('notification');
        if (!n) return;
        n.textContent = msg;
        n.className = `notification ${type}`;
        n.classList.remove('hidden');
        setTimeout(() => n.classList.add('hidden'), 3000);
    };

    function formatTime(totalSeconds) {
        if (!totalSeconds || isNaN(totalSeconds)) return "0h 0m 0s";
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${h}h ${m}m ${s}s`;
    }

    function calculateLiveSeconds(startTime, baseSeconds) {
        let elapsedSeconds = 0;
        if (startTime && startTime !== "null" && startTime !== "") {
            const start = new Date(startTime);
            if (!isNaN(start.getTime())) {
                const now = new Date();
                elapsedSeconds = Math.floor((now - start) / 1000);
                if (elapsedSeconds < 0) elapsedSeconds = 0;
            }
        }
        return (baseSeconds || 0) + elapsedSeconds;
    }

    async function loadTasks() {
        try {
            const res = await fetch('/api/laser/tasks', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error("Erro API");
            allTasks = await res.json();
            
            Object.values(activeTimers).forEach(clearInterval);
            activeTimers = {};

            renderTasks();
            renderHistory();
        } catch(e) { console.error(e); }
    }

    function renderTasks() {
        const container = document.getElementById('task-list');
        if (!container) return;

        const cuttableTasks = allTasks.filter(t => t.desenho_caminho !== null && t.estado !== 'concluido');

        if (!cuttableTasks.length) {
            container.innerHTML = `
                <div style="text-align:center; padding:60px 20px; background:white; border-radius:16px; border:1px solid var(--border);">
                    <i class="ph ph-check-circle" style="font-size:48px; color:var(--success); margin-bottom:15px; display:block;"></i>
                    <h3 style="margin:0; color:var(--text-primary);">Tudo concluído!</h3>
                    <p style="color:var(--text-secondary); margin-top:8px;">Não existem tarefas prontas para corte de momento.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = cuttableTasks.map(t => {
            const isCutting = t.estado === 'em corte';
            const startTime = isCutting ? t.data_hora_inicio : null;
            const currentSeconds = calculateLiveSeconds(startTime, t.tempo_total_segundos || 0);

            return `
            <div class="laser-card" id="task-${t.id}">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px;">
                    <div>
                        <h3 style="margin:0; font-size:20px;">${t.cliente_nome}</h3>
                        <p style="margin:5px 0 0 0; color:var(--text-secondary); font-size:14px;">${t.descricao || 'Sem descrição'}</p>
                    </div>
                    <span class="status-badge status-${t.estado.replace(/\s+/g, '-')}">${t.estado}</span>
                </div>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:20px;">
                    <div style="padding:15px; background:#f1f5f9; border-radius:12px; display:flex; flex-direction:column; gap:5px;">
                        <span style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase;">Desenho Técnico</span>
                        <a href="${t.desenho_caminho}?token=${token}" download="${t.desenho_nome_original || 'desenho'}" style="color:var(--accent); font-weight:700; text-decoration:none; font-size:14px; display:flex; align-items:center; gap:8px;">
                            <i class="ph ph-download-simple"></i> Descarregar
                        </a>
                    </div>
                    <div style="padding:15px; background:var(--accent-light); border-radius:12px; display:flex; flex-direction:column; gap:5px;">
                        <span style="font-size:11px; font-weight:700; color:var(--accent); text-transform:uppercase;">Tempo Decorrido</span>
                        <span class="timer-display" data-base="${t.tempo_total_segundos || 0}" data-start="${startTime || ''}" style="font-weight:800; color:var(--accent); font-size:18px;">
                            ${formatTime(currentSeconds)}
                        </span>
                    </div>
                </div>

                <div class="actions" style="display:flex; gap:12px;">
                    ${isCutting ? `
                        <button class="update-status" data-id="${t.id}" data-status="pausado" style="flex:1; padding:14px; border-radius:10px; border:none; background:#f59e0b; color:white; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <i class="ph ph-pause" style="font-size:20px;"></i> Pausar
                        </button>
                        <button class="update-status" data-id="${t.id}" data-status="concluido" style="flex:1; padding:14px; border-radius:10px; border:none; background:var(--accent); color:white; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <i class="ph ph-check" style="font-size:20px;"></i> Finalizar
                        </button>
                    ` : `
                        <button class="update-status" data-id="${t.id}" data-status="em corte" style="flex:1; padding:16px; border-radius:10px; border:none; background:#22c55e; color:white; font-weight:700; cursor:pointer; font-size:16px; display:flex; align-items:center; justify-content:center; gap:10px;">
                            <i class="ph ph-play" style="font-size:24px;"></i> ${t.estado === 'pausado' ? 'Retomar Corte' : 'Iniciar Corte'}
                        </button>
                    `}
                </div>
            </div>
        `}).join('');

        // Start live timers
        container.querySelectorAll('.timer-display').forEach(timer => {
            const startTime = timer.dataset.start;
            if (startTime && startTime !== "" && startTime !== "null") {
                const base = parseInt(timer.dataset.base) || 0;
                const interval = setInterval(() => {
                    const nowSeconds = calculateLiveSeconds(startTime, base);
                    timer.textContent = formatTime(nowSeconds);
                }, 1000);
                activeTimers[timer.closest('.laser-card').id] = interval;
            }
        });

        // Attach status update listeners
        container.querySelectorAll('.update-status').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const taskId = e.currentTarget.dataset.id;
                const newStatus = e.currentTarget.dataset.status;
                await updateStatus(taskId, newStatus);
            });
        });
    }

    function renderHistory() {
        const container = document.getElementById('history-list');
        if (!container) return;

        const historyTasks = allTasks.filter(t => t.estado === 'concluido').sort((a,b) => new Date(b.data_hora_fim) - new Date(a.data_hora_fim));

        if (!historyTasks.length) {
            container.innerHTML = '<p style="text-align:center; padding:40px; color:var(--text-secondary);">Ainda não concluiu nenhuma tarefa.</p>';
            return;
        }

        container.innerHTML = historyTasks.map(t => `
            <div class="history-item">
                <div class="history-info">
                    <h4>${t.cliente_nome}</h4>
                    <p>
                        <i class="ph ph-calendar"></i> ${new Date(t.data_hora_fim || t.data_criacao).toLocaleDateString()} &nbsp; • &nbsp; 
                        <i class="ph ph-timer"></i> Duração: ${formatTime(t.tempo_total_segundos)}
                    </p>
                </div>
                <a href="${t.desenho_caminho}?token=${token}" download="${t.desenho_nome_original || 'desenho'}" class="btn-download-mini">
                    <i class="ph ph-download-simple"></i> Desenho
                </a>
            </div>
        `).join('');
    }

    async function updateStatus(taskId, estado) {
        try {
            const res = await fetch(`/api/laser/tasks/${taskId}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ estado })
            });

            if (res.ok) {
                showNotification(`Estado: ${estado.toUpperCase()}`);
                loadTasks();
            } else {
                showNotification('Erro ao atualizar estado.', 'error');
            }
        } catch(e) {
            showNotification('Erro de conexão.', 'error');
        }
    }

    function switchTab(tab) {
        const btnTasks = document.getElementById('tab-tasks');
        const btnHistory = document.getElementById('tab-history');
        const secTasks = document.getElementById('section-tasks');
        const secHistory = document.getElementById('section-history');
        const title = document.getElementById('view-title');
        const desc = document.getElementById('view-desc');

        if (tab === 'tasks') {
            btnTasks.classList.add('active');
            btnHistory.classList.remove('active');
            secTasks.classList.remove('hidden');
            secHistory.classList.add('hidden');
            title.textContent = 'Tarefas de Corte';
            desc.textContent = 'Controle o processo de corte a laser em tempo real.';
        } else {
            btnTasks.classList.remove('active');
            btnHistory.classList.add('active');
            secTasks.classList.add('hidden');
            secHistory.classList.remove('hidden');
            title.textContent = 'Histórico de Corte';
            desc.textContent = 'Consulte as tarefas de corte finalizadas e os seus tempos.';
        }
    }

    const init = () => {
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', () => {
                localStorage.removeItem('maclau_token');
                window.location.href = 'index.html';
            });
        }

        const btnTasks = document.getElementById('tab-tasks');
        const btnHistory = document.getElementById('tab-history');

        if (btnTasks) btnTasks.addEventListener('click', () => switchTab('tasks'));
        if (btnHistory) btnHistory.addEventListener('click', () => switchTab('history'));

        loadTasks();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
