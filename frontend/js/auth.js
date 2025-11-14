// Authentication: form toggle, register, login, logout

function showLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
    const btnLogin = document.querySelector('button[onclick="showLogin()"]');
    const btnRegister = document.querySelector('button[onclick="showRegister()"]');
    if (btnLogin) btnLogin.classList.add('active');
    if (btnRegister) btnRegister.classList.remove('active');
}

function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
    const btnLogin = document.querySelector('button[onclick="showLogin()"]');
    const btnRegister = document.querySelector('button[onclick="showRegister()"]');
    if (btnLogin) btnLogin.classList.remove('active');
    if (btnRegister) btnRegister.classList.add('active');
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showError('Please provide email and password');
        return;
    }

    try {
        const resp = await apiRequest('POST', '/auth/login', { email, password });
        // backend returns { access_token, token_type }
        if (resp && resp.access_token) {
            localStorage.setItem('authToken', resp.access_token);
            localStorage.setItem('userEmail', email);
            if (resp.user_id) localStorage.setItem('userId', resp.user_id);
            window.location.href = 'dashboard.html';
        } else {
            showError('Login failed.');
        }
    } catch (err) {
        console.error('Login error', err);
        showError(err.message || 'Login error');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const grade = document.getElementById('register-grade').value;

    if (!name || !email || !password || !grade) {
        showError('Please fill in all fields');
        return;
    }

    try {
        const resp = await apiRequest('POST', '/auth/register', {
            name,
            email,
            password,
            grade_level: parseInt(grade, 10)
        });

        if (resp && resp.user_id) {
            // Auto-login after registration
            const loginResp = await apiRequest('POST', '/auth/login', { email, password });
            if (loginResp && loginResp.access_token) {
                localStorage.setItem('authToken', loginResp.access_token);
                localStorage.setItem('userEmail', email);
                if (loginResp.user_id) localStorage.setItem('userId', loginResp.user_id);
                window.location.href = 'dashboard.html';
                return;
            }
            showError('Registered but login failed. Please try logging in.');
            showLogin();
        } else {
            showError(resp.message || 'Registration failed');
        }
    } catch (err) {
        console.error('Registration error', err);
        showError(err.message || 'Registration error');
    }
}

function handleLogout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userEmail');
    window.location.href = 'index.html';
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    // If user is already logged in, redirect to dashboard
    const token = localStorage.getItem('authToken');
    if (token) {
        window.location.href = 'dashboard.html';
        return;
    }
    showLogin();
});