// API Configuration
// API configuration
// Point to backend server (includes /api prefix)
const API_BASE_URL = 'http://127.0.0.1:8000/api';

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
            const serverMessage = (result && (result.message || result.detail)) || resultText || response.statusText;
            throw new Error(`${response.status} ${serverMessage || 'API request failed'}`);
        }

        return result;
    } catch (error) {
        console.error('API Error:', error);
        showError(error.message || 'An unexpected error occurred');
        throw error;
    } finally {
        hideLoading();
    }
}

// Loading indicator functions
function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
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
