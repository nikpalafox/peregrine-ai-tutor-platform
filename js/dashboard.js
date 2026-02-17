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
        const initialsEl = document.getElementById('userInitials');
        if (initialsEl && profile.name) {
            const parts = profile.name.trim().split(/\s+/);
            initialsEl.textContent = parts.map(p => p[0]).join('').substring(0, 2).toUpperCase();
        }
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
        if (!userId) {
            console.error('No userId provided to loadStudentBooks');
            showError('User ID not found. Please log in again.');
            return;
        }
        console.log(`Loading books for userId: ${userId}`);
        const books = await apiRequest('GET', `/students/${userId}/books`) || [];
        console.log(`Received ${books.length} books from API`);
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
    if (!container) {
        console.warn('readingList container not found');
        return;
    }

    container.innerHTML = '';

    if (!books || books.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">&#x1F4DA;</div>
                <div class="empty-state-title">No chapters yet</div>
                <div class="empty-state-text">Click "New Chapter" to generate your first AI-powered reading chapter!</div>
            </div>`;
        return;
    }

    books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';

        const title = book.title || book.topic || 'Untitled Chapter';
        const description = book.description ||
                          (book.content ? book.content.substring(0, 150) + '...' : '') ||
                          'A custom reading chapter for you!';
        const progress = book.reading_progress || 0;

        card.innerHTML = `
            <div class="book-card-title">${title}</div>
            <div class="book-card-desc">${description}</div>
            <div class="book-card-progress">
                <div class="book-card-progress-bar" style="width: ${progress}%"></div>
            </div>
            <button data-book-id="${book.id}" class="start-reading btn-read">
                ${progress > 0 ? 'Continue Reading' : 'Start Reading'}
            </button>
        `;
        container.appendChild(card);
    });

    container.querySelectorAll('.start-reading').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const bookId = e.currentTarget.getAttribute('data-book-id');
            console.log('Start reading clicked, bookId:', bookId); // Debug log
            if (bookId) {
                window.location.href = `reading.html?id=${bookId}`;
            } else {
                console.error('Button missing data-book-id attribute');
                showError('Book ID not found. Please try again.');
            }
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

// Prevent multiple event listeners
let chapterGenerationSetup = false;

async function setupChapterGeneration(userId) {
    const generateBtn = document.getElementById('generateChapterBtn');
    if (!generateBtn) return;
    
    // Only set up once
    if (chapterGenerationSetup) {
        return;
    }
    chapterGenerationSetup = true;

    generateBtn.addEventListener('click', async () => {
        const topic = prompt('What topic would you like to read about?');
        if (!topic || !topic.trim()) {
            return;
        }

        try {
            showLoading();
            generateBtn.disabled = true;
            generateBtn.innerHTML = 'Generating...';
            
            console.log('Requesting chapter generation for topic:', topic);
            const chapter = await apiRequest('POST', '/generate-chapter', {
                student_id: userId,
                topic: topic.trim(),
                chapter_number: 1
            });
            
            hideLoading();
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> New Chapter';

            console.log('Generated chapter response:', chapter); // Debug log
            
            if (chapter && chapter.id) {
                // Refresh the books list first to ensure the new chapter appears
                await loadStudentBooks(userId);
                
                // Also add to chapters container for immediate visual feedback
                displayChapter(chapter);
                
                // Show success message
                const toast = document.getElementById('errorToast');
                if (toast) {
                    const originalText = toast.textContent;
                    toast.textContent = '✓ Chapter generated successfully!';
                    toast.className = toast.className.replace('bg-red-500', 'bg-green-500');
                    toast.classList.add('visible');
                    setTimeout(() => {
                        toast.classList.remove('visible');
                        toast.className = toast.className.replace('bg-green-500', 'bg-red-500');
                        toast.textContent = originalText;
                    }, 3000);
                }
            } else {
                console.error('Chapter missing id:', chapter);
                showError('Chapter generated but missing ID. Please try again.');
            }
        } catch (err) {
            console.error('Failed to generate chapter', err);
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> New Chapter';
            hideLoading();
            
            // Show detailed error message
            const errorMsg = err.message || 'Failed to generate chapter';
            if (errorMsg.includes('API key') || errorMsg.includes('OpenAI')) {
                showError('OpenAI API key not configured. Please check your .env file.');
            } else {
                showError(errorMsg);
            }
        }
    });
}

function displayChapter(chapter) {
    // Try chapters-container first (for older generated chapters display)
    let container = document.getElementById('chapters-container');
    
    // If not found, try readingList (for books display)
    if (!container) {
        container = document.getElementById('readingList');
    }
    
    if (!container) {
        console.error('No container found for displaying chapter');
        // Create container if it doesn't exist
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            container = document.createElement('div');
            container.id = 'chapters-container';
            container.className = 'space-y-4 mt-6';
            mainContent.appendChild(container);
        } else {
            console.error('Cannot create container - main-content not found');
            return;
        }
    }

    // Check if this chapter already exists to avoid duplicates
    const existingCard = container.querySelector(`[data-chapter-id="${chapter.id}"]`);
    if (existingCard) {
        console.log('Chapter already displayed:', chapter.id);
        return;
    }

    const card = document.createElement('div');
    card.className = 'chapter-card';
    card.setAttribute('data-chapter-id', chapter.id);

    const title = chapter.title || chapter.topic || 'New Chapter';
    const description = chapter.description || chapter.content?.substring(0, 100) + '...' || 'A custom chapter just for you!';

    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
            <div style="flex: 1;">
                <div class="book-card-title">${title}</div>
                <div class="book-card-desc">${description}</div>
            </div>
            <span class="level-badge" style="flex-shrink: 0; margin-left: 12px;">New</span>
        </div>
        <div class="progress-bar" style="margin-bottom: 16px;">
            <div class="progress" style="width: 0%" aria-valuenow="0"></div>
        </div>
        <button data-chapter-id="${chapter.id}" class="btn-read">
            Start Reading
        </button>
    `;

    // Add to top of list
    if (container.firstChild) {
        container.insertBefore(card, container.firstChild);
    } else {
        container.appendChild(card);
    }

    // Wire up the start reading button
    const btn = card.querySelector('button[data-chapter-id]');
    if (btn) {
        btn.addEventListener('click', () => {
            console.log('Chapter start reading clicked, chapter.id:', chapter.id); // Debug log
            if (chapter.id) {
                window.location.href = `reading.html?id=${chapter.id}`;
            } else {
                console.error('Chapter missing ID:', chapter);
                showError('Chapter ID not found. Please try again.');
            }
        });
    }
}

// Prevent multiple initializations
let dashboardInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
    // Only initialize once
    if (dashboardInitialized) {
        return;
    }
    dashboardInitialized = true;
    
    // Clear any redirect flags when dashboard loads successfully
    sessionStorage.removeItem('redirecting');
    // Small delay to ensure page is fully loaded before checking auth
    setTimeout(() => {
        initDashboard();
    }, 50);
});
