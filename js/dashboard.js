// Dashboard: load student profile, books, and full gamification experience

// Prevent redirect loops
let redirectCheckDone = false;
let isRedirecting = false;

const REDIRECT_HISTORY_KEY = 'redirectHistory';
const MAX_REDIRECTS = 3;
const REDIRECT_WINDOW = 2000;

function checkRedirectLoop() {
    const history = JSON.parse(sessionStorage.getItem(REDIRECT_HISTORY_KEY) || '[]');
    const now = Date.now();
    const recent = history.filter(timestamp => now - timestamp < REDIRECT_WINDOW);

    if (recent.length >= MAX_REDIRECTS) {
        console.warn('Redirect loop detected! Clearing auth data.');
        localStorage.clear();
        sessionStorage.clear();
        return true;
    }

    recent.push(now);
    sessionStorage.setItem(REDIRECT_HISTORY_KEY, JSON.stringify(recent));
    return false;
}

// ========== GAMIFICATION UI ==========

function formatXP(xp) {
    if (xp >= 1000000) return (xp / 1000000).toFixed(1) + 'M';
    if (xp >= 1000) return (xp / 1000).toFixed(1) + 'K';
    return xp.toString();
}

function updateLevelDisplay(levelData) {
    if (!levelData) return;

    const levelDisplay = document.getElementById('levelDisplay');
    const levelTitle = document.getElementById('levelTitle');
    const xpBarFill = document.getElementById('xpBarFill');
    const xpBarValue = document.getElementById('xpBarValue');
    const xpTotalDisplay = document.getElementById('xpTotalDisplay');

    if (levelDisplay) levelDisplay.textContent = 'Level ' + levelData.current_level;
    if (levelTitle) levelTitle.textContent = levelData.title;

    const progress = Math.min(levelData.progress_percentage || 0, 100);
    if (xpBarFill) {
        // Animate after a short delay for visual impact
        setTimeout(() => { xpBarFill.style.width = progress + '%'; }, 300);
    }
    if (xpBarValue) {
        xpBarValue.textContent = formatXP(levelData.current_xp) + ' / ' + formatXP(levelData.xp_to_next_level) + ' XP';
    }
    if (xpTotalDisplay) {
        xpTotalDisplay.textContent = formatXP(levelData.total_xp_earned) + ' XP total';
    }
}

function updateStreakDisplay(streakData) {
    const streakEl = document.getElementById('readingStreakCount');
    const streakFlame = document.getElementById('streakFlame');
    const streakBest = document.getElementById('streakBest');
    const streakCard = document.getElementById('streakCard');

    let current = 0;
    let max = 0;

    if (streakData && streakData.details && streakData.details.daily_study) {
        const daily = streakData.details.daily_study;
        current = daily.current || 0;
        max = daily.max || 0;
    }

    if (streakEl) streakEl.textContent = current;
    if (streakBest && max > 0) streakBest.textContent = 'Best: ' + max;

    if (streakFlame) {
        if (current === 0) {
            streakFlame.classList.add('inactive');
        } else {
            streakFlame.classList.remove('inactive');
        }
    }

    // Update the streak label with encouraging message
    const streakLabel = document.querySelector('.streak-label');
    if (streakLabel) {
        if (current === 0) streakLabel.textContent = 'Start reading to begin!';
        else if (current === 1) streakLabel.textContent = 'Great start!';
        else if (current < 7) streakLabel.textContent = 'Keep it going!';
        else if (current < 30) streakLabel.textContent = 'On fire!';
        else streakLabel.textContent = 'Incredible streak!';
    }
}

function updateBadgeShowcase(badgeData) {
    const showcase = document.getElementById('badgeShowcase');
    const earnedCount = document.getElementById('badgeEarnedCount');
    const totalCount = document.getElementById('badgeTotalCount');
    if (!showcase || !badgeData) return;

    const catalog = badgeData.catalog || [];
    const earnedIds = badgeData.earned_ids || [];

    if (earnedCount) earnedCount.textContent = badgeData.total_count || 0;
    if (totalCount) totalCount.textContent = catalog.length;

    // Sort: earned first, then by difficulty
    const difficultyOrder = { platinum: 0, gold: 1, silver: 2, bronze: 3 };
    const sorted = [...catalog].sort((a, b) => {
        if (a.earned !== b.earned) return a.earned ? -1 : 1;
        return (difficultyOrder[a.difficulty] || 4) - (difficultyOrder[b.difficulty] || 4);
    });

    // Show up to 9 badges (3x3 grid)
    const visible = sorted.slice(0, 9);

    showcase.innerHTML = visible.map(badge => {
        const isEarned = badge.earned;
        const isNew = isRecentlyEarned(badge.id);
        return `
            <div class="badge-item ${isEarned ? 'earned' : 'locked'}" title="${badge.name}: ${badge.description}${isEarned ? ' (Earned!)' : ''}">
                ${isNew ? '<div class="badge-new-indicator"></div>' : ''}
                <div class="badge-icon">${badge.icon}</div>
                <div class="badge-name">${badge.name}</div>
                <div class="badge-difficulty ${badge.difficulty}">${badge.difficulty}</div>
            </div>
        `;
    }).join('');
}

function isRecentlyEarned(badgeId) {
    // Check if badge was earned in the last session (stored in sessionStorage)
    const recentBadges = JSON.parse(sessionStorage.getItem('recentBadges') || '[]');
    return recentBadges.includes(badgeId);
}

function updateQuestBoard(questData) {
    const board = document.getElementById('questBoard');
    if (!board || !questData) return;

    const quests = questData.details || [];

    if (quests.length === 0) {
        board.innerHTML = `
            <div class="quest-card" style="opacity: 0.5; border-left-color: var(--border);">
                <div class="quest-desc" style="margin: 0; font-style: italic;">Start reading to unlock quests!</div>
            </div>`;
        return;
    }

    board.innerHTML = quests.map(quest => {
        const pct = Math.min(quest.completion_percentage || 0, 100);
        return `
            <div class="quest-card">
                <div class="quest-header">
                    <div class="quest-name">${quest.name}</div>
                    <div class="quest-xp">+${quest.xp_reward || '?'} XP</div>
                </div>
                <div class="quest-desc">${quest.description}</div>
                <div class="quest-progress-bar">
                    <div class="quest-progress-fill" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    }).join('');

    // Fetch XP rewards from the quest template names (not in progress data)
    // We'll enhance with a separate API call if needed
}

function updateStatsDisplay(statsData) {
    if (!statsData) return;

    const chaptersEl = document.getElementById('chaptersReadCount');
    if (chaptersEl) chaptersEl.textContent = statsData.books_read || 0;

    const messagesEl = document.getElementById('messagesSentCount');
    if (messagesEl) messagesEl.textContent = statsData.total_messages || 0;
}

// ========== CELEBRATION SYSTEM ==========

function showCelebration(type, data) {
    let icon, title, subtitle, xp;

    if (type === 'level_up') {
        icon = '\u2B50';
        title = 'Level Up!';
        subtitle = 'You reached Level ' + data.new_level + ' \u2014 ' + data.new_title;
        xp = null;
    } else if (type === 'badge') {
        icon = data.icon || '\u{1F3C6}';
        title = 'Badge Earned!';
        subtitle = data.name + ' \u2014 ' + data.description;
        xp = '+' + data.xp_reward + ' XP';
    } else if (type === 'quest') {
        icon = '\u{1F3AF}';
        title = 'Quest Complete!';
        subtitle = data.name;
        xp = '+' + data.xp_earned + ' XP';
    }

    const overlay = document.createElement('div');
    overlay.className = 'celebration-overlay';
    overlay.innerHTML = `
        <div class="celebration-card">
            <div class="celebration-icon">${icon}</div>
            <div class="celebration-title">${title}</div>
            <div class="celebration-subtitle">${subtitle}</div>
            ${xp ? '<div class="celebration-xp">' + xp + '</div>' : ''}
            <button class="celebration-dismiss">Awesome!</button>
        </div>
    `;

    document.body.appendChild(overlay);
    spawnConfetti();

    const dismiss = overlay.querySelector('.celebration-dismiss');
    dismiss.addEventListener('click', () => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    });

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        if (document.body.contains(overlay)) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 300);
        }
    }, 5000);
}

function spawnConfetti() {
    const colors = ['#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
    const shapes = ['\u25CF', '\u25A0', '\u2605', '\u2764'];

    for (let i = 0; i < 40; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.textContent = shapes[Math.floor(Math.random() * shapes.length)];
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.color = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.fontSize = (8 + Math.random() * 14) + 'px';
        confetti.style.animationDuration = (2 + Math.random() * 3) + 's';
        confetti.style.animationDelay = Math.random() * 0.8 + 's';
        document.body.appendChild(confetti);

        setTimeout(() => confetti.remove(), 5500);
    }
}

function showGamToast(icon, title, desc) {
    const toast = document.createElement('div');
    toast.className = 'gam-toast';
    toast.innerHTML = `
        <div class="gam-toast-icon">${icon}</div>
        <div class="gam-toast-content">
            <div class="gam-toast-title">${title}</div>
            <div class="gam-toast-desc">${desc}</div>
        </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// Check for pending celebrations from reading session results
function checkPendingCelebrations() {
    const pending = sessionStorage.getItem('pendingCelebrations');
    if (!pending) return;

    sessionStorage.removeItem('pendingCelebrations');

    try {
        const celebrations = JSON.parse(pending);
        let delay = 300;

        // Show XP toast first
        if (celebrations.xp_gained && celebrations.xp_gained > 0) {
            setTimeout(() => {
                showGamToast('\u26A1', '+' + celebrations.xp_gained + ' XP', 'Great reading session!');
            }, delay);
            delay += 1500;
        }

        // Show level up celebration
        if (celebrations.level_up && celebrations.level_info) {
            setTimeout(() => {
                showCelebration('level_up', celebrations.level_info);
            }, delay);
            delay += 2000;
        }

        // Show new badges
        if (celebrations.new_badges && celebrations.new_badges.length > 0) {
            celebrations.new_badges.forEach((badge, idx) => {
                setTimeout(() => {
                    showCelebration('badge', badge);
                    // Track as recently earned for the new-indicator
                    const recent = JSON.parse(sessionStorage.getItem('recentBadges') || '[]');
                    recent.push(badge.id);
                    sessionStorage.setItem('recentBadges', JSON.stringify(recent));
                }, delay + idx * 2500);
            });
        }
    } catch (e) {
        console.warn('Failed to parse pending celebrations:', e);
    }
}

// ========== MAIN DATA LOADING ==========

async function loadGamificationStats(userId) {
    try {
        const dashboard = await apiRequest('GET', `/gamification/student/${userId}/dashboard`);

        // Level & XP
        updateLevelDisplay(dashboard.level);

        // Streak
        updateStreakDisplay(dashboard.streaks);

        // Stats
        updateStatsDisplay(dashboard.stats);

        // Badges
        updateBadgeShowcase(dashboard.badges);

        // Quests — add xp_reward from quest definitions if available
        if (dashboard.quests && dashboard.quests.details) {
            // The backend includes quest names and descriptions but may not include xp_reward in details
            // We'll enrich quest data with xp from the quest catalog if needed
            try {
                const questsCatalog = await apiRequest('GET', `/gamification/student/${userId}/quests`);
                if (questsCatalog && questsCatalog.suggested_quests) {
                    const xpMap = {};
                    questsCatalog.suggested_quests.forEach(q => {
                        xpMap[q.id] = q.xp_reward;
                    });
                    dashboard.quests.details.forEach(q => {
                        if (!q.xp_reward && xpMap[q.id]) {
                            q.xp_reward = xpMap[q.id];
                        }
                    });
                }
            } catch (e) {
                // Non-fatal, quest XP just won't show
            }
        }
        updateQuestBoard(dashboard.quests);

    } catch (err) {
        console.warn('Failed to load gamification stats (non-fatal):', err);
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
        const books = await apiRequest('GET', `/students/${userId}/books`) || [];
        displayReadingList(books);
    } catch (err) {
        console.error('Failed to load books', err);
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
            if (bookId) {
                window.location.href = `reading.html?id=${bookId}`;
            } else {
                showError('Book ID not found. Please try again.');
            }
        });
    });
}

function handleLogout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userId');
    sessionStorage.removeItem('recentBadges');
    sessionStorage.removeItem('pendingCelebrations');
    window.location.href = 'login.html';
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

// ========== CHAPTER GENERATION ==========

let chapterGenerationSetup = false;

async function setupChapterGeneration(userId) {
    const generateBtn = document.getElementById('generateChapterBtn');
    if (!generateBtn) return;
    if (chapterGenerationSetup) return;
    chapterGenerationSetup = true;

    generateBtn.addEventListener('click', () => {
        showTopicModal(userId, generateBtn);
    });
}

function showTopicModal(userId, generateBtn) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-card">
            <h3>Generate New Chapter</h3>
            <p class="modal-desc">Enter a topic and we'll create a personalized reading chapter for you using AI.</p>
            <label class="modal-label" for="topicInput">Topic</label>
            <input type="text" id="topicInput" class="modal-input" placeholder="e.g. Space exploration, Dinosaurs, Ocean life..." autofocus>
            <div class="modal-actions">
                <button class="btn-cancel" id="modalCancel">Cancel</button>
                <button class="btn-submit" id="modalSubmit">Generate</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector('#topicInput');
    const submitBtn = modal.querySelector('#modalSubmit');
    const cancelBtn = modal.querySelector('#modalCancel');

    setTimeout(() => input.focus(), 50);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    cancelBtn.addEventListener('click', () => modal.remove());

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
        if (e.key === 'Escape') modal.remove();
    });

    submitBtn.addEventListener('click', async () => {
        const topic = input.value.trim();
        if (!topic) {
            input.style.borderColor = 'var(--error)';
            input.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.12)';
            input.focus();
            return;
        }

        modal.remove();

        try {
            showLoading();
            generateBtn.disabled = true;
            generateBtn.innerHTML = 'Generating...';

            const chapter = await apiRequest('POST', '/generate-chapter', {
                student_id: userId,
                topic: topic.trim(),
                chapter_number: 1
            });

            hideLoading();
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> New Chapter';

            if (chapter && chapter.id) {
                await loadStudentBooks(userId);
                displayChapter(chapter);

                // Show XP toast for generating a chapter
                showGamToast('\u2728', '+20 XP', 'New chapter created!');

                // Refresh gamification stats after activity
                loadGamificationStats(userId);
            } else {
                showError('Chapter generated but missing ID. Please try again.');
            }
        } catch (err) {
            console.error('Failed to generate chapter', err);
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> New Chapter';
            hideLoading();

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
    let container = document.getElementById('chapters-container');
    if (!container) container = document.getElementById('readingList');
    if (!container) {
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            container = document.createElement('div');
            container.id = 'chapters-container';
            container.className = 'space-y-4 mt-6';
            mainContent.appendChild(container);
        } else {
            return;
        }
    }

    const existingCard = container.querySelector(`[data-chapter-id="${chapter.id}"]`);
    if (existingCard) return;

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

    if (container.firstChild) {
        container.insertBefore(card, container.firstChild);
    } else {
        container.appendChild(card);
    }

    const btn = card.querySelector('button[data-chapter-id]');
    if (btn) {
        btn.addEventListener('click', () => {
            if (chapter.id) {
                window.location.href = `reading.html?id=${chapter.id}`;
            } else {
                showError('Chapter ID not found. Please try again.');
            }
        });
    }
}

// ========== INITIALIZATION ==========

async function initDashboard() {
    if (redirectCheckDone) return;
    redirectCheckDone = true;

    const currentPath = window.location.pathname;
    const isDashboardPage = currentPath.includes('dashboard.html') ||
                           (currentPath.endsWith('/') && document.title.includes('Dashboard'));
    if (!isDashboardPage) return;
    if (isRedirecting) return;

    if (sessionStorage.getItem('redirecting')) {
        sessionStorage.removeItem('redirecting');
    }

    const token = localStorage.getItem('authToken');
    const userId = localStorage.getItem('userId');
    const email = localStorage.getItem('userEmail');

    if (!token) {
        if (checkRedirectLoop()) return;
        localStorage.removeItem('authToken');
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userId');
        if (!isRedirecting) {
            isRedirecting = true;
            sessionStorage.setItem('redirecting', 'true');
            const stillOnDashboard = window.location.pathname.includes('dashboard.html');
            if (stillOnDashboard) window.location.href = 'login.html';
        }
        return;
    }

    if (email) {
        const userEmailEl = document.getElementById('userEmail');
        if (userEmailEl) userEmailEl.textContent = email;
    }

    if (userId) {
        try {
            await loadUserProfile(userId);
            await loadStudentBooks(userId);
            setupChapterGeneration(userId);
            // Load gamification (the big one!)
            loadGamificationStats(userId);
            // Check for celebrations from a recently completed reading session
            setTimeout(() => checkPendingCelebrations(), 600);
        } catch (err) {
            console.error('Dashboard initialization error:', err);
            if (err.message && err.message.includes('401')) return;
        }
    } else {
        console.warn('No userId found, skipping profile load');
    }
}

let dashboardInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
    if (dashboardInitialized) return;
    dashboardInitialized = true;
    sessionStorage.removeItem('redirecting');
    setTimeout(() => initDashboard(), 50);
});
