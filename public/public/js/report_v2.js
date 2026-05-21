// public/js/report.js

const urlParams = new URLSearchParams(window.location.search);
const machineUUID = urlParams.get('machine');

const API_BASE = '/api/public';

// Elementos da UIs
const loader = document.getElementById('loader');
const reportView = document.getElementById('report-view');
const successView = document.getElementById('success-view');
const errorView = document.getElementById('error-view');
const loginRequiredView = document.getElementById('login-required-view');
const machineNameEl = document.getElementById('machine-name');
const errorMessageEl = document.getElementById('error-message');

async function loadMachineInfo() {
    if (!machineUUID) {
        showError("Nenhum código de máquina foi fornecido no endereço.");
        return;
    }

    const token = localStorage.getItem('maclau_token');
    
    // Se não há token, nem vale a pena tentar chamar a API
    if (!token || token === 'null') {
        loader.classList.add('hidden');
        loginRequiredView.classList.remove('hidden');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/maquinas/${machineUUID}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401) {
            // Não logado
            loader.classList.add('hidden');
            loginRequiredView.classList.remove('hidden');
            return;
        }

        if (response.status === 403) {
            // Logado mas sem permissão
            loader.classList.add('hidden');
            showError("Acesso Negado: Esta máquina não pertence à sua lavandaria ou a sua sessão expirou.");
            // Adicionar botão de logout para permitir trocar de conta
            const btnLogout = document.createElement('button');
            btnLogout.className = 'btn-avaria secondary';
            btnLogout.style.marginTop = '10px';
            btnLogout.textContent = 'Trocar de Utilizador';
            btnLogout.onclick = () => {
                localStorage.clear();
                window.location.reload();
            };
            document.getElementById('error-view').appendChild(btnLogout);
            return;
        }

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "Máquina não encontrada.");
        }
        
        const data = await response.json();
        
        // Hide loader & Show report view
        loader.classList.add('hidden');
        if (machineNameEl) {
            machineNameEl.textContent = data.nome;
        }
        reportView.classList.remove('hidden');
        reportView.style.display = ''; // Remover display: none inline

    } catch (e) {
        showError(e.message);
    }
}

async function submitAvaria(tipo) {
    if (!machineUUID) return;

    const token = localStorage.getItem('maclau_token');
    if (!token) {
        window.location.reload(); 
        return;
    }

    // Desabilitar botões
    const btns = document.querySelectorAll('.btn-avaria');
    btns.forEach(b => { b.disabled = true; b.style.opacity = '0.7'; });

    try {
        const response = await fetch(`${API_BASE}/avarias`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ maquina_id: machineUUID, tipo_avaria: tipo })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Erro ao reportar. Tente novamente.");
        }
        
        reportView.classList.add('hidden');
        successView.classList.remove('hidden');

    } catch (e) {
        alert(e.message);
        btns.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
    }
}

function showError(msg) {
    loader.classList.add('hidden');
    errorMessageEl.textContent = msg;
    errorView.classList.remove('hidden');
}

// Iniciar app
window.onload = () => {
    loadMachineInfo();

    // Botão Ir para Login
    const btnGoToLogin = document.getElementById('btn-go-to-login');
    if (btnGoToLogin) {
        btnGoToLogin.onclick = () => {
            const currentUrl = window.location.href;
            window.location.href = `/index.html?redirect=${encodeURIComponent(currentUrl)}`;
        };
    }

    // CSP Listeners
    document.querySelectorAll('.btn-avaria').forEach(btn => {
        btn.addEventListener('click', () => {
            const tipo = parseInt(btn.getAttribute('data-tipo'));
            if (tipo) submitAvaria(tipo);
        });
    });
};
