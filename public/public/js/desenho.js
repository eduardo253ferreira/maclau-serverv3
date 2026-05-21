// public/js/desenho.js

(function() {
    const token = localStorage.getItem('maclau_token');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const userNameEl = document.getElementById('user-name');
    if (userNameEl) userNameEl.textContent = params.get('name') || 'Colaborador';

    const showNotification = (msg, type = 'success') => {
        const n = document.getElementById('notification');
        if (!n) return;
        n.textContent = msg;
        n.className = `notification ${type}`;
        n.classList.remove('hidden');
        setTimeout(() => n.classList.add('hidden'), 3000);
    };

    let allTasks = [];

    async function loadTasks() {
        try {
            const res = await fetch('/api/laser/tasks', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error("Erro API");
            allTasks = await res.json();
            renderTasks();
            renderHistory();
        } catch(e) {
            console.error(e);
        }
    }

    function renderTasks() {
        const container = document.getElementById('task-list');
        if (!container) return;

        const pendingTasks = allTasks.filter(t => t.estado === 'pendente');
        
        if (!pendingTasks.length) {
            container.innerHTML = `
                <div style="text-align:center; padding:60px 20px; background:white; border-radius:16px; border:1px solid var(--border);">
                    <i class="ph ph-check-circle" style="font-size:48px; color:var(--success); margin-bottom:15px; display:block;"></i>
                    <h3 style="margin:0; color:var(--text-primary);">Tudo em dia!</h3>
                    <p style="color:var(--text-secondary); margin-top:8px;">Não existem novas tarefas de desenho pendentes.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = pendingTasks.map(t => `
            <div class="laser-card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h3 style="margin:0; font-size:20px;">${t.cliente_nome}</h3>
                    <span class="status-badge status-pendente">Pendente</span>
                </div>
                
                <div class="task-description-box">
                    <h4>Instruções do Desenho</h4>
                    <p>${t.descricao || 'Sem descrição detalhada.'}</p>
                </div>

                <div class="upload-area-mini">
                    <div style="display:flex; align-items:center; gap:12px; flex:1;">
                        <i class="ph ph-file-arrow-up" style="font-size:24px; color:var(--accent);"></i>
                        <div>
                            <p style="margin:0; font-weight:600; font-size:14px;">Submeter Desenho Técnico</p>
                            <input type="file" id="file-${t.id}" style="font-size:12px; margin-top:4px;">
                        </div>
                    </div>
                    <button class="btn-primary btn-upload" data-id="${t.id}" style="padding:10px 24px; font-weight:700;">
                        <i class="ph ph-paper-plane-right"></i> Enviar
                    </button>
                </div>
            </div>
        `).join('');

        // Attach upload listeners
        container.querySelectorAll('.btn-upload').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const taskId = e.currentTarget.dataset.id;
                await uploadDrawing(taskId);
            });
        });
    }

    function renderHistory() {
        const container = document.getElementById('history-list');
        if (!container) return;

        // Histórico são as que já têm desenho
        const historyTasks = allTasks.filter(t => t.desenho_caminho !== null).sort((a,b) => new Date(b.data_criacao) - new Date(a.data_criacao));

        if (!historyTasks.length) {
            container.innerHTML = '<p style="text-align:center; padding:40px; color:var(--text-secondary);">Ainda não submeteu nenhum desenho.</p>';
            return;
        }

        container.innerHTML = historyTasks.map(t => `
            <div class="history-item">
                <div class="history-info">
                    <h4>${t.cliente_nome}</h4>
                    <p><i class="ph ph-calendar"></i> ${new Date(t.data_criacao).toLocaleDateString()} &nbsp; • &nbsp; <i class="ph ph-file"></i> ${t.desenho_nome_original || 'Desenho'}</p>
                </div>
                <a href="${t.desenho_caminho}?token=${token}" download="${t.desenho_nome_original || 'Desenho'}" class="btn-download-mini">
                    <i class="ph ph-download-simple"></i> Download
                </a>
            </div>
        `).join('');
    }

    async function uploadDrawing(taskId) {
        const fileInput = document.getElementById(`file-${taskId}`);
        if (!fileInput || !fileInput.files.length) return alert('Por favor, selecione um ficheiro primeiro.');

        const btn = document.querySelector(`.btn-upload[data-id="${taskId}"]`);
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner-gap anim-spin"></i> Enviando...';

        const formData = new FormData();
        formData.append('desenho', fileInput.files[0]);

        try {
            const res = await fetch(`/api/laser/tasks/${taskId}/upload`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            if (res.ok) {
                showNotification('Desenho enviado com sucesso!');
                loadTasks();
            } else {
                showNotification('Erro ao enviar desenho.', 'error');
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        } catch(e) {
            showNotification('Erro de conexão.', 'error');
            btn.disabled = false;
            btn.innerHTML = originalText;
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
            title.textContent = 'Tarefas de Desenho';
            desc.textContent = 'Submeta os desenhos para as tarefas de corte a laser.';
        } else {
            btnTasks.classList.remove('active');
            btnHistory.classList.add('active');
            secTasks.classList.add('hidden');
            secHistory.classList.remove('hidden');
            title.textContent = 'Histórico de Desenhos';
            desc.textContent = 'Consulte e descarregue os seus desenhos submetidos anteriormente.';
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
