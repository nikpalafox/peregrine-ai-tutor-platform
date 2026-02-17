// Authentication: form toggle, register, login, logout

function showLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
    const tabs = document.querySelectorAll('.auth-tab, .auth-toggle-btn');
    tabs.forEach(btn => {
        if (btn.onclick && btn.onclick.toString().includes('showLogin')) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
    const tabs = document.querySelectorAll('.auth-tab, .auth-toggle-btn');
    tabs.forEach(btn => {
        if (btn.onclick && btn.onclick.toString().includes('showRegister')) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
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
let authInitDone = false;

// Track redirect attempts to detect loops
const REDIRECT_HISTORY_KEY = 'redirectHistory';
const MAX_REDIRECTS = 3;
const REDIRECT_WINDOW = 2000; // 2 seconds

function checkRedirectLoop() {
    const history = JSON.parse(sessionStorage.getItem(REDIRECT_HISTORY_KEY) || '[]');
    const now = Date.now();
    // Remove old entries
    const recent = history.filter(timestamp => now - timestamp < REDIRECT_WINDOW);
    
    if (recent.length >= MAX_REDIRECTS) {
        // Too many redirects - clear everything and stop
        console.warn('Redirect loop detected! Clearing auth data.');
        localStorage.clear();
        sessionStorage.clear();
        return true;
    }
    
    // Add current timestamp
    recent.push(now);
    sessionStorage.setItem(REDIRECT_HISTORY_KEY, JSON.stringify(recent));
    return false;
}

document.addEventListener('DOMContentLoaded', () => {
    // Only run once
    if (authInitDone) {
        return;
    }
    authInitDone = true;
    
    // Check for redirect loop
    if (checkRedirectLoop()) {
        showLogin();
        return;
    }
    
    // Prevent redirect loops - check if we're already redirecting
    if (sessionStorage.getItem('redirecting')) {
        sessionStorage.removeItem('redirecting');
        // Don't redirect again - just show login
        showLogin();
        return;
    }
    
    // Check if we're on the login page (index.html) - be very explicit
    const currentPath = window.location.pathname;
    const isLoginPage = currentPath.includes('index.html') || 
                       (currentPath.endsWith('/') && !currentPath.includes('dashboard') && !currentPath.includes('reading')) ||
                       (currentPath === '/' || currentPath.endsWith('/index.html'));
    
    // Only check for redirect if we're actually on the login page
    if (isLoginPage) {
        // Check if we just redirected here (prevent immediate re-redirect)
        if (sessionStorage.getItem('redirecting')) {
            // We just redirected here, clear the flag and show login
            sessionStorage.removeItem('redirecting');
            showLogin();
            return;
        }
        
        const token = localStorage.getItem('authToken');
        
        // Only redirect if we have a valid token
        // Don't require userId/email - those might not be set yet
        if (token) {
            // Check if token is actually valid by making a quick test
            // But to avoid loops, just check if we have the minimum required
            const userId = localStorage.getItem('userId');
            const email = localStorage.getItem('userEmail');
            
            // Only redirect if we have token AND at least one other piece of info
            // This prevents redirect loops when token exists but data is incomplete
            if (userId || email) {
                // Check for redirect loop before redirecting
                if (checkRedirectLoop()) {
                    // Loop detected, don't redirect - just show login
                    showLogin();
                    return;
                }
                
                // Double-check we're still on login page before redirecting
                const stillOnLogin = window.location.pathname.includes('index.html') || 
                                    window.location.pathname.endsWith('/');
                if (stillOnLogin) {
                    // Set redirect flag and redirect
                    sessionStorage.setItem('redirecting', 'true');
                    // Use a small delay to ensure page is ready
                    // Only redirect if we're not already redirecting
                    if (!sessionStorage.getItem('redirecting')) {
                        sessionStorage.setItem('redirecting', 'true');
                        setTimeout(() => {
                            // Triple-check we're still on login page
                            const finalCheck = window.location.pathname.includes('index.html') || 
                                             window.location.pathname.endsWith('/');
                            if (finalCheck) {
                                window.location.href = 'dashboard.html';
                            } else {
                                sessionStorage.removeItem('redirecting');
                            }
                        }, 150);
                    }
                    return;
                }
            } else {
                // Token exists but no user data - might be invalid, clear it
                localStorage.removeItem('authToken');
            }
        }
    }
    
    showLogin();
});