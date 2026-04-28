// public/js/login.js
console.log("[MACLAU] Login script loaded");

// Verificação de sessão expirada: se o servidor nos mandou de volta com ?expired=1, limpamos o lixo local
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('expired')) {
    console.log("[MACLAU] Session expired or invalid code. Clearing local state.");
    localStorage.removeItem('maclau_token');
    localStorage.removeItem('maclau_role');
    localStorage.removeItem('maclau_user_id');
} else {
    // Se não for um redirect por sessão expirada e já tivermos um token localmente
    const token = localStorage.getItem('maclau_token');
    const role = localStorage.getItem('maclau_role');
    if (token) {
        console.log("[MACLAU] Active session found. Auto-redirecting...");
        if (role === 'admin') window.location.replace('admin.html');
        else if (role === 'tecnico') window.location.replace('tecnico.html');
        // Adicionar outros roles se necessário no futuro
    }
}

function initLogin() {
    console.log("[MACLAU] Initializing login form listener");
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        // --- Início: Lógica do botão Mostrar/Esconder Password ---
        const togglePasswordBtn = document.getElementById('togglePassword');
        const passwordInput = document.getElementById('password');

        if (togglePasswordBtn && passwordInput) {
            togglePasswordBtn.addEventListener('click', () => {
                const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                passwordInput.setAttribute('type', type);

                // Mudar o ícone SVG dependendo do estado
                if (type === 'text') {
                    // Ícone "Olho riscado" (esconder)
                    togglePasswordBtn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                        </svg>
                    `;
                    togglePasswordBtn.setAttribute('aria-label', 'Esconder Palavra-passe');
                    togglePasswordBtn.setAttribute('title', 'Esconder Palavra-passe');
                } else {
                    // Ícone "Olho normal" (mostrar)
                    togglePasswordBtn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    `;
                    togglePasswordBtn.setAttribute('aria-label', 'Mostrar Palavra-passe');
                    togglePasswordBtn.setAttribute('title', 'Mostrar Palavra-passe');
                }
            });
        }
        // --- Fim: Lógica do botão Mostrar/Esconder Password ---

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log("[MACLAU] Login form submitted");

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const rememberMeEl = document.getElementById('remember-me');
            const remember = rememberMeEl ? rememberMeEl.checked : false;
            const redirect = urlParams.get('redirect');

            try {
                console.log("[MACLAU] Sending login request to /api/auth/login...");
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, remember, redirect })
                });

                console.log("[MACLAU] Server response status:", res.status);

                let data;
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    data = await res.json();
                } else {
                    const text = await res.text();
                    console.error("[MACLAU] Expected JSON but got:", text.substring(0, 100));
                    throw new Error("Resposta inválida do servidor (não é JSON).");
                }

                if (!res.ok) {
                    console.warn("[MACLAU] Login failed:", data.error);
                    showNotification(data.error || 'Erro ao efetuar login');
                    return;
                }

                console.log("[MACLAU] Login successful, redirecting to:", data.redirectUrl);
                localStorage.setItem('maclau_token', data.accessToken);
                localStorage.setItem('maclau_role', data.role);

                // Pequeno atraso para garantir que o utilizador vê a mensagem de sucesso se necessário
                // ou apenas procede para o redirect
                window.location.replace(data.redirectUrl);

            } catch (err) {
                console.error("[MACLAU] Login error details:", err);
                showNotification('Erro de ligação ao servidor. Verifique a consola para detalhes.');
            }
        });
    } else {
        console.error("[MACLAU] Login form not found!");
    }
}

// Ensure init runs even if loaded late
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogin);
} else {
    initLogin();
}

function showNotification(msg) {
    const notif = document.getElementById('notification');
    if (!notif) return;
    notif.textContent = msg;
    notif.classList.remove('hidden');
    setTimeout(() => notif.classList.add('hidden'), 3000);
}
