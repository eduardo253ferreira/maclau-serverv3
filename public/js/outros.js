// public/js/outros.js

(function() {
    console.log("[LASER] Script initialized");

    const token = localStorage.getItem('maclau_token') || (function() {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; maclau_token=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    })();

    if (!token || token === 'null') {
        window.location.href = 'index.html?expired=1';
        return;
    }

    // --- Utility Functions ---
    const showNotification = (msg, type = 'success') => {
        const n = document.getElementById('notification');
        if (!n) return;
        n.textContent = msg;
        n.className = `notification ${type}`;
        n.classList.remove('hidden');
        setTimeout(() => n.classList.add('hidden'), 3000);
    };

    function formatTime(totalSeconds) {
        if (!totalSeconds || totalSeconds <= 0) return "0 min";
        const minutes = Math.ceil(totalSeconds / 60);
        if (minutes < 60) return `${minutes} min`;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }

    const openModal = (id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('hidden');
            el.style.display = 'flex';
        }
    };

    const closeModal = (id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.style.display = 'none';
        }
    };

    const switchTab = (tab) => {
        document.getElementById('section-pedidos').classList.toggle('hidden', tab !== 'pedidos');
        document.getElementById('section-equipa').classList.toggle('hidden', tab !== 'equipa');
        
        document.getElementById('tab-pedidos').classList.toggle('active', tab === 'pedidos');
        document.getElementById('tab-equipa').classList.toggle('active', tab === 'equipa');
    };

    // --- API Calls ---
    async function loadTasks() {
        try {
            const res = await fetch('/api/laser/tasks', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error("Erro API");
            const tasks = await res.json();
            const container = document.getElementById('laser-list');
            if (!container) return;
            
            container.innerHTML = '';
            if (!tasks.length) {
                container.innerHTML = '<p style="text-align:center; padding:20px;">Nenhum pedido encontrado.</p>';
                return;
            }

            tasks.forEach(t => {
                const card = document.createElement('div');
                card.className = 'laser-card';
                card.innerHTML = `
                    <div style="flex: 1;">
                        <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                            <h3 style="margin:0;">${t.cliente_nome}</h3>
                            <span class="status-badge status-${t.estado.replace(/\s+/g, '-')}">${t.estado}</span>
                        </div>
                        <p style="margin:0 0 12px 0; color:var(--text-secondary);">${t.descricao || 'Sem descrição'}</p>
                        <div style="display:flex; gap:20px; align-items:center;">
                            <small style="color:var(--text-secondary); display:flex; align-items:center; gap:5px;">
                                <i class="ph ph-calendar"></i> ${new Date(t.data_criacao).toLocaleDateString()}
                            </small>
                            <small style="color:var(--accent); font-weight:700; display:flex; align-items:center; gap:5px;">
                                <i class="ph ph-timer"></i> Duração: ${formatTime(t.tempo_total_segundos)}
                            </small>
                        </div>
                    </div>
                    <div class="actions" style="display:flex; align-items:center; gap:12px;">
                        ${t.desenho_caminho ? `
                            <a href="${t.desenho_caminho}?token=${token}" download="${t.desenho_nome_original || 'Desenho'}" class="btn-secondary" style="display:flex; align-items:center; gap:8px; text-decoration:none;">
                                <i class="ph ph-file-pdf"></i> Desenho
                            </a>
                        ` : ''}
                        <button class="btn-delete-task" data-id="${t.id}" style="width:40px; height:40px; border-radius:10px; border:1px solid #fee2e2; background:#fef2f2; color:var(--danger); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                            <i class="ph ph-trash" style="font-size:20px;"></i>
                        </button>
                    </div>
                `;
                container.appendChild(card);
            });

            // Delegate delete clicks
            container.querySelectorAll('.btn-delete-task').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.currentTarget.dataset.id;
                    if (confirm("Remover tarefa?")) {
                        const resDel = await fetch(`/api/laser/tasks/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                        if (resDel.ok) { showNotification("Removido"); loadTasks(); }
                    }
                });
            });
        } catch(e) { console.error(e); }
    }

    async function loadEquipa() {
        try {
            const [resColab, resTech] = await Promise.all([
                fetch('/api/colaboradores', { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch('/api/tecnico-laser', { headers: { 'Authorization': `Bearer ${token}` } })
            ]);
            if (resColab.ok) {
                const data = await resColab.json();
                document.getElementById('colab-list').innerHTML = data.map(c => `
                    <div class="laser-card" style="padding:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:700; color:var(--text-primary);">${c.nome}</div>
                            <div style="font-size:13px; color:var(--text-secondary);">${c.email}</div>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-edit-colab" data-user='${JSON.stringify(c)}' style="width:36px; height:36px; border-radius:8px; border:1px solid var(--border); background:white; color:var(--accent); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                                <i class="ph ph-pencil-simple"></i>
                            </button>
                            <button class="btn-delete-colab" data-id="${c.id}" style="width:36px; height:36px; border-radius:8px; border:1px solid #fee2e2; background:#fef2f2; color:var(--danger); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                                <i class="ph ph-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('');
            }
            if (resTech.ok) {
                const data = await resTech.json();
                document.getElementById('tech-laser-list').innerHTML = data.map(t => `
                    <div class="laser-card" style="padding:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:700; color:var(--text-primary);">${t.nome}</div>
                            <div style="font-size:13px; color:var(--text-secondary);">${t.email}</div>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-edit-tech-laser" data-user='${JSON.stringify(t)}' style="width:36px; height:36px; border-radius:8px; border:1px solid var(--border); background:white; color:var(--accent); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                                <i class="ph ph-pencil-simple"></i>
                            </button>
                            <button class="btn-delete-tech-laser" data-id="${t.id}" style="width:36px; height:36px; border-radius:8px; border:1px solid #fee2e2; background:#fef2f2; color:var(--danger); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                                <i class="ph ph-trash"></i>
                            </button>
                        </div>
                    </div>
                `).join('');
            }

            // Bind team actions
            document.querySelectorAll('.btn-edit-colab').forEach(btn => {
                btn.onclick = () => {
                    const u = JSON.parse(btn.dataset.user);
                    document.getElementById('edit-colab-id').value = u.id;
                    document.getElementById('edit-colab-nome').value = u.nome;
                    document.getElementById('edit-colab-email').value = u.email;
                    document.getElementById('edit-colab-pass').value = '';
                    openModal('modal-edit-colab');
                };
            });
            document.querySelectorAll('.btn-delete-colab').forEach(btn => {
                btn.onclick = async () => {
                    if (confirm("Remover colaborador?")) {
                        const r = await fetch(`/api/colaboradores/${btn.dataset.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                        if (r.ok) { showNotification("Removido"); loadEquipa(); }
                    }
                };
            });
            document.querySelectorAll('.btn-edit-tech-laser').forEach(btn => {
                btn.onclick = () => {
                    const u = JSON.parse(btn.dataset.user);
                    document.getElementById('edit-tech-laser-id').value = u.id;
                    document.getElementById('edit-tech-laser-nome').value = u.nome;
                    document.getElementById('edit-tech-laser-email').value = u.email;
                    document.getElementById('edit-tech-laser-pass').value = '';
                    openModal('modal-edit-tech-laser');
                };
            });
            document.querySelectorAll('.btn-delete-tech-laser').forEach(btn => {
                btn.onclick = async () => {
                    if (confirm("Remover técnico laser?")) {
                        const r = await fetch(`/api/tecnico-laser/${btn.dataset.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                        if (r.ok) { showNotification("Removido"); loadEquipa(); }
                    }
                };
            });

        } catch(e) {}
    }

    // --- Initialization ---
    const init = () => {
        // Tab listeners
        document.getElementById('tab-pedidos').addEventListener('click', () => switchTab('pedidos'));
        document.getElementById('tab-equipa').addEventListener('click', () => switchTab('equipa'));

        // Modal openers
        document.getElementById('btn-open-modal-laser').addEventListener('click', () => openModal('modal-novo-laser'));
        document.getElementById('btn-open-modal-colab').addEventListener('click', () => openModal('modal-novo-colab'));
        document.getElementById('btn-open-modal-tech').addEventListener('click', () => openModal('modal-novo-tech-laser'));

        // Modal closers
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => closeModal(e.currentTarget.dataset.close));
        });

        // Form submits
        document.getElementById('form-novo-laser').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = { cliente_nome: document.getElementById('laser-cliente').value, descricao: document.getElementById('laser-descricao').value };
            const res = await fetch('/api/laser/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) });
            if (res.ok) { showNotification("Criado!"); closeModal('modal-novo-laser'); loadTasks(); e.target.reset(); }
        });

        document.getElementById('form-novo-colab').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = { nome: document.getElementById('colab-nome').value, email: document.getElementById('colab-email').value, password: document.getElementById('colab-pass').value };
            const res = await fetch('/api/colaboradores', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) });
            if (res.ok) { showNotification("Colaborador criado!"); closeModal('modal-novo-colab'); loadEquipa(); e.target.reset(); }
        });

        document.getElementById('form-novo-tech-laser').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = { nome: document.getElementById('tech-laser-nome').value, email: document.getElementById('tech-laser-email').value, password: document.getElementById('tech-laser-pass').value };
            const res = await fetch('/api/tecnico-laser', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) });
            if (res.ok) { showNotification("Técnico criado!"); closeModal('modal-novo-tech-laser'); loadEquipa(); e.target.reset(); }
        });

        document.getElementById('form-edit-colab').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-colab-id').value;
            const data = { 
                nome: document.getElementById('edit-colab-nome').value, 
                email: document.getElementById('edit-colab-email').value,
                password: document.getElementById('edit-colab-pass').value || undefined
            };
            const res = await fetch(`/api/colaboradores/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) });
            if (res.ok) { showNotification("Atualizado!"); closeModal('modal-edit-colab'); loadEquipa(); }
        });

        document.getElementById('form-edit-tech-laser').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-tech-laser-id').value;
            const data = { 
                nome: document.getElementById('edit-tech-laser-nome').value, 
                email: document.getElementById('edit-tech-laser-email').value,
                password: document.getElementById('edit-tech-laser-pass').value || undefined
            };
            const res = await fetch(`/api/tecnico-laser/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) });
            if (res.ok) { showNotification("Atualizado!"); closeModal('modal-edit-tech-laser'); loadEquipa(); }
        });


        document.getElementById('btn-logout').addEventListener('click', () => {
            localStorage.removeItem('maclau_token');
            document.cookie = "maclau_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
            window.location.href = 'index.html';
        });

        // Initial load
        loadTasks();
        loadEquipa();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
