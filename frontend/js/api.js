// API Configuration
// Automatically detect if running on Vercel (production) or localhost (development)
const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const API_BASE_URL = isProduction ? '/api' : 'http://127.0.0.1:8000/api';

// Generic API request function
async function apiRequest(method, endpoint, data = null) {
    const url = API_BASE_URL + endpoint;
    const token = localStorage.getItem('authToken');

    const headers = {
        'Content-Type': 'application/json'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        method: method,
        headers: headers
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        config.body = JSON.stringify(data);
    }

    try {
        showLoading();
        const response = await fetch(url, config);
        let resultText = null;
        let result = null;
        try {
            resultText = await response.text();
            result = resultText ? JSON.parse(resultText) : null;
        } catch (e) {
            // body was not JSON
            result = null;
        }

        if (!response.ok) {
            // Handle 401 Unauthorized - clear auth and redirect to login
            if (response.status === 401) {
                localStorage.removeItem('authToken');
                localStorage.removeItem('userEmail');
                localStorage.removeItem('userId');
                // Only redirect if we're not already on the login page and not already redirecting
                const currentPath = window.location.pathname;
                const isLoginPage = currentPath.includes('index.html') || 
                                   currentPath.endsWith('/') ||
                                   (!currentPath.includes('dashboard') && !currentPath.includes('reading'));
                
                if (!isLoginPage && !sessionStorage.getItem('redirecting')) {
                    sessionStorage.setItem('redirecting', 'true');
                    // Use setTimeout to prevent immediate redirect during error handling
                    setTimeout(() => {
                        // Double-check we're still not on login page
                        const newPath = window.location.pathname;
                        const stillNotLogin = !newPath.includes('index.html') && 
                                            !newPath.endsWith('/') &&
                                            (newPath.includes('dashboard') || newPath.includes('reading'));
                        if (stillNotLogin) {
                            window.location.href = 'index.html';
                        } else {
                            sessionStorage.removeItem('redirecting');
                        }
                    }, 200);
                }
            }
            const serverMessage = (result && (result.message || result.detail)) || resultText || response.statusText;
            throw new Error(`${response.status} ${serverMessage || 'API request failed'}`);
        }

        return result;
    } catch (error) {
        console.error('API Error:', error);
        // Don't show error toast for 401 - we're redirecting
        if (!error.message || !error.message.includes('401')) {
            showError(error.message || 'An unexpected error occurred');
        }
        throw error;
    } finally {
        // Always hide loading, even on error
        hideLoading();
    }
}

// Loading indicator functions
let loadingTimeout = null;

function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        // Clear any existing timeout
        if (loadingTimeout) {
            clearTimeout(loadingTimeout);
            loadingTimeout = null;
        }
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
        // Safety timeout - auto-hide after 10 seconds to prevent stuck overlay
        loadingTimeout = setTimeout(() => {
            hideLoading();
        }, 10000);
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        // Clear timeout if it exists
        if (loadingTimeout) {
            clearTimeout(loadingTimeout);
            loadingTimeout = null;
        }
        overlay.classList.add('hidden');
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 300);
    }
}

// Error toast functions
function showError(message, duration = 3000) {
    const toast = document.getElementById('errorToast');
    if (toast) {
        toast.textContent = message;
        toast.classList.add('visible');
        toast.classList.remove('scale-0');
        setTimeout(() => {
            toast.classList.remove('visible');
            toast.classList.add('scale-0');
        }, duration);
    }
}

// Export functions for use in other files
window.apiRequest = apiRequest;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.showError = showError;

// adding note to push
