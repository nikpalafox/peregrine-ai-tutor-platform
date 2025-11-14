// Dashboard: load student profile and books (recommended reading)

// Prevent redirect loops - use a more robust flag
let redirectCheckDone = false;
let isRedirecting = false;

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

async function initDashboard() {
    // Only run once per page load
    if (redirectCheckDone) {
        return;
    }
    redirectCheckDone = true;
    
    // Verify we're actually on the dashboard page
    const currentPath = window.location.pathname;
    const isDashboardPage = currentPath.includes('dashboard.html') || 
                           (currentPath.endsWith('/') && document.title.includes('Dashboard'));
    
    if (!isDashboardPage) {
        // Not on dashboard page, don't run dashboard init
        return;
    }
    
    // Prevent multiple simultaneous redirects
    if (isRedirecting) {
        return;
    }
    
    // Check if we just redirected here (prevent immediate re-redirect)
    if (sessionStorage.getItem('redirecting')) {
        // We just redirected here, clear the flag and continue
        sessionStorage.removeItem('redirecting');
    }
    
    const token = localStorage.getItem('authToken');
    const userId = localStorage.getItem('userId');
    const email = localStorage.getItem('userEmail');

    // Only redirect if we're truly missing authentication
    // Don't redirect if we have a token but are missing userId/email - that's a data issue, not auth issue
    if (!token) {
        // Check for redirect loop before redirecting
        if (checkRedirectLoop()) {
            // Loop detected, don't redirect
            return;
        }
        
        // No token at all - clear everything and redirect
        localStorage.removeItem('authToken');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userId');
        
        if (!isRedirecting) {
            isRedirecting = true;
            sessionStorage.setItem('redirecting', 'true');
            // Only redirect if we're still on dashboard page
            const stillOnDashboard = window.location.pathname.includes('dashboard.html');
            if (stillOnDashboard) {
                window.location.href = 'index.html';
            }
        }
        return;
    }

    // If we have a token but missing userId/email, try to continue anyway
    // The API calls will handle errors appropriately
    if (email) {
        const userEmailEl = document.getElementById('userEmail');
        if (userEmailEl) userEmailEl.textContent = email;
    }

    // Only try to load profile if we have userId
    if (userId) {
        try {
            await loadUserProfile(userId);
            await loadStudentBooks(userId);
            setupChapterGeneration(userId);
        } catch (err) {
            // Don't redirect on API errors - just log and show error
            console.error('Dashboard initialization error:', err);
            // If it's a 401, api.js will handle the redirect
            if (err.message && err.message.includes('401')) {
                return; // api.js will redirect
            }
        }
    } else {
        // No userId - just show what we can
        console.warn('No userId found, skipping profile load');
    }
}

async function loadUserProfile(userId) {
    try {
        const profile = await apiRequest('GET', `/students/${userId}`);
        const gradeEl = document.getElementById('userGrade');
        if (gradeEl) gradeEl.textContent = profile.grade_level || '-';
        const nameEl = document.getElementById('userName');
        if (nameEl) nameEl.textContent = profile.name || '';
    } catch (err) {
        console.error('Failed to load profile', err);
        // Don't show error if it's a 401 - api.js will handle redirect
        if (!err.message || !err.message.includes('401')) {
            showError('Failed to load profile');
        }
    }
}

async function loadStudentBooks(userId) {
    try {
        const books = await apiRequest('GET', `/students/${userId}/books`) || [];
        displayReadingList(books);
    } catch (err) {
        console.error('Failed to load books', err);
        // Don't show error if it's a 401 - api.js will handle redirect
        if (!err.message || !err.message.includes('401')) {
            showError('Failed to load reading list');
        }
    }
}

function displayReadingList(books) {
    const container = document.getElementById('readingList');
    if (!container) return;
    container.innerHTML = '';

    if (!books || books.length === 0) {
        container.innerHTML = '<p class="text-gray-500 col-span-full text-center">No books available.</p>';
        return;
    }

    books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'card p-6';
        card.innerHTML = `
            <h4 class="text-lg font-semibold mb-2">${book.title}</h4>
            <p class="text-gray-600 text-sm mb-4">${book.description || ''}</p>
            <button data-book-id="${book.id}" class="start-reading bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors w-full">
                Start Reading
            </button>
        `;
        container.appendChild(card);
    });

    container.querySelectorAll('.start-reading').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const bookId = e.currentTarget.getAttribute('data-book-id');
            if (bookId) window.location.href = `reading.html?id=${bookId}`;
        });
    });
}

function handleLogout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userId');
    window.location.href = 'index.html';
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

async function setupChapterGeneration(userId) {
    const generateBtn = document.getElementById('generateChapterBtn');
    if (!generateBtn) return;

    generateBtn.addEventListener('click', async () => {
        const topic = prompt('What topic would you like to read about?');
        if (!topic) return;

        try {
            showLoading();
            const chapter = await apiRequest('POST', '/generate-chapter', {
                student_id: userId,
                topic,
                chapter_number: 1
            });
            hideLoading();

            if (chapter && chapter.id) {
                // Add new chapter to the list
                displayChapter(chapter);
            }
        } catch (err) {
            console.error('Failed to generate chapter', err);
            showError('Failed to generate chapter');
            hideLoading();
        }
    });
}

function displayChapter(chapter) {
    const container = document.getElementById('chapters-container');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'chapter-card';
    card.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div>
                <h3 class="text-xl font-semibold mb-2">${chapter.title || chapter.topic}</h3>
                <p class="text-gray-600">${chapter.description || 'A custom chapter just for you!'}</p>
            </div>
            <span class="level-badge">New</span>
        </div>
        <div class="progress-bar">
            <div class="progress" style="width: 0%" aria-valuenow="0"></div>
        </div>
        <button data-chapter-id="${chapter.id}" 
                class="mt-4 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors w-full">
            Start Reading
        </button>
    `;

    // Add to top of list
    container.insertBefore(card, container.firstChild);

    // Wire up the start reading button
    const btn = card.querySelector('button');
    btn.addEventListener('click', () => {
        window.location.href = `reading.html?id=${chapter.id}`;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Clear any redirect flags when dashboard loads successfully
    sessionStorage.removeItem('redirecting');
    // Small delay to ensure page is fully loaded before checking auth
    setTimeout(() => {
        initDashboard();
    }, 50);
});
