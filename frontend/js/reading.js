// reading.js - simple ReadingSession using apiRequest helper

class ReadingSession {
    constructor(bookId) {
        this.bookId = bookId;
        this.pages = [];
        this.currentIndex = 0;
        this.startTime = null;
        this.endTime = null;
        this.wordsRead = 0;
        this.recognition = null;
        this.isListening = false;
        this.spokenWords = [];
        this.expectedWords = [];
        this.currentAccuracy = 0;
        this.studentId = localStorage.getItem('userId');
        this.lastSpokenText = '';
        this.pauseStartTime = null;
        this.lastFeedbackTime = 0;
        this.feedbackCooldown = 3000; // 3 seconds between feedback requests
        this.currentTranscript = ''; // Track ongoing transcript
    }

    setupSpeechRecognition() {
        // Prefer standard SpeechRecognition where available
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('Speech recognition not supported');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                    const transcriptLower = transcript.trim().toLowerCase();
                    this.spokenWords.push(...transcriptLower.split(/\s+/));
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Update current transcript for display
            this.currentTranscript = this.lastSpokenText + finalTranscript + interimTranscript;
            
            // Update display
            this.updateAccuracyDisplay();
            this.updateTranscriptDisplay();
            
            // Get feedback when we have final results and enough time has passed
            if (finalTranscript.trim() && (Date.now() - this.lastFeedbackTime) > this.feedbackCooldown) {
                this.lastSpokenText += finalTranscript;
                this.getReadingFeedback();
            }
            
            // Detect pauses (no speech for a while)
            if (interimTranscript.trim() === '' && this.isListening) {
                if (!this.pauseStartTime) {
                    this.pauseStartTime = Date.now();
                } else if (Date.now() - this.pauseStartTime > 3000) {
                    // 3 second pause detected
                    this.handleStruggle('long_pause');
                }
            } else {
                this.pauseStartTime = null;
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            try {
                this.stopListening();
            } catch (e) {}
        };
    }

    async init() {
        if (!this.bookId) {
            showError('No book id provided');
            return;
        }

        try {
            const data = await apiRequest('GET', `/reading/content/${this.bookId}`);
            // Expect data.pages = [ { text: '...' }, ... ] or data.content string
            if (data && Array.isArray(data.pages)) {
                this.pages = data.pages.map((p) => p.text || p);
            } else if (data && typeof data.content === 'string') {
                this.pages = data.content.split(/\n\n+/).filter(Boolean);
            } else if (typeof data === 'string') {
                this.pages = data.split(/\n\n+/).filter(Boolean);
            } else {
                this.pages = [];
            }

            // Setup speech recognition
            this.setupSpeechRecognition();

            if (this.pages.length === 0) {
                showError('No reading content available');
                return;
            }

            this.startTime = Date.now();
            this.renderCurrentPage();
            this.updateProgress();
            this.setupButtons();
        } catch (err) {
            console.error('Failed to load reading content', err);
            showError('Failed to load reading content');
        }
    }

    renderCurrentPage() {
        const container = document.getElementById('readingContent');
        if (!container) return;
        container.innerHTML = '';

        const pageText = this.pages[this.currentIndex] || '';
        
        // Create text display with word highlighting
        const textContainer = document.createElement('div');
        textContainer.className = 'mb-6';
        textContainer.innerHTML = `
            <p id="readingText" class="text-lg leading-relaxed mb-4">${this.highlightCurrentWord(pageText)}</p>
            <div id="transcriptDisplay" class="text-sm text-gray-600 mb-4 italic">
                <strong>You said:</strong> <span id="currentTranscript"></span>
            </div>
        `;
        container.appendChild(textContainer);

        // Save expected words for accuracy comparison
        this.expectedWords = pageText.toLowerCase().split(/\s+/).filter(Boolean);
        
        // Reset spoken words for new page
        this.spokenWords = [];
        this.lastSpokenText = '';
        this.currentTranscript = '';

        // Add Reading Agent feedback panel
        const agentPanel = document.createElement('div');
        agentPanel.id = 'readingAgentPanel';
        agentPanel.className = 'mt-6 bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg';
        agentPanel.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="text-2xl">👩‍🏫</div>
                <div class="flex-1">
                    <h3 class="font-semibold text-blue-900 mb-2">Reading Teacher</h3>
                    <p id="agentFeedback" class="text-blue-800 text-sm">Ready to help you read! Click "Start Reading" when you're ready.</p>
                </div>
            </div>
        `;
        container.appendChild(agentPanel);

        // Add speech controls
        const controls = document.createElement('div');
        controls.className = 'mt-6 flex items-center justify-center gap-4 flex-wrap';
        controls.innerHTML = `
                        <button id="toggleSpeech" class="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700">
                                🎤 Start Reading
                        </button>
                        <div id="accuracy" class="text-lg font-semibold">
                                Accuracy: 0%
                        </div>
                `;
        container.appendChild(controls);

        // Wire up speech toggle
        const toggleBtn = controls.querySelector('#toggleSpeech');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (this.isListening) {
                    this.stopListening();
                    toggleBtn.textContent = 'Start Speaking';
                    toggleBtn.className = 'bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700';
                } else {
                    this.startListening();
                    toggleBtn.textContent = 'Stop Speaking';
                    toggleBtn.className = 'bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700';
                }
            });
        }

        const pageNumberEl = document.getElementById('pageNumber');
        if (pageNumberEl) pageNumberEl.textContent = `${this.currentIndex + 1} / ${this.pages.length}`;
    }

    startListening() {
        if (this.recognition) {
            this.spokenWords = [];
            this.lastSpokenText = '';
            this.currentTranscript = '';
            this.isListening = true;
            this.pauseStartTime = null;
            this.updateAgentFeedback("I'm listening! Start reading when you're ready. Take your time with each word.");
            try {
                this.recognition.start();
            } catch (e) {
                // ignore already started errors
            }
        }
    }

    stopListening() {
        if (this.recognition) {
            this.isListening = false;
            this.pauseStartTime = null;
            try {
                this.recognition.stop();
            } catch (e) {}
            // Get final feedback
            if (this.lastSpokenText.trim()) {
                this.getReadingFeedback();
            }
        }
    }
    
    async getReadingFeedback() {
        if (!this.studentId || !this.isListening) return;
        
        const now = Date.now();
        if (now - this.lastFeedbackTime < this.feedbackCooldown) return;
        
        const currentPageText = this.pages[this.currentIndex] || '';
        const spokenText = this.lastSpokenText.trim();
        
        if (!spokenText) return;
        
        // Calculate current word index
        const expectedWords = currentPageText.toLowerCase().split(/\s+/);
        const spokenWords = spokenText.toLowerCase().split(/\s+/);
        const currentWordIndex = Math.min(spokenWords.length, expectedWords.length);
        
        // Detect struggle indicators
        const struggleIndicators = {
            long_pause: this.pauseStartTime && (now - this.pauseStartTime > 3000),
            repetition: this.detectRepetition(spokenWords),
            hesitation: this.detectHesitation(spokenText)
        };
        
        try {
            const feedback = await apiRequest('POST', '/reading/feedback', {
                expected_text: currentPageText,
                spoken_text: spokenText,
                student_id: this.studentId,
                current_word_index: currentWordIndex,
                struggle_indicators: struggleIndicators
            });
            
            if (feedback && feedback.feedback) {
                this.updateAgentFeedback(feedback.feedback);
                this.lastFeedbackTime = now;
                
                // Update accuracy if provided
                if (feedback.accuracy !== undefined) {
                    this.currentAccuracy = feedback.accuracy;
                    this.updateAccuracyDisplay();
                }
                
                // Highlight incorrect words
                if (feedback.incorrect_words && feedback.incorrect_words.length > 0) {
                    this.highlightIncorrectWords(feedback.incorrect_words);
                }
            }
        } catch (err) {
            console.error('Failed to get reading feedback', err);
            // Don't show error - just continue
        }
    }
    
    updateAgentFeedback(message) {
        const feedbackEl = document.getElementById('agentFeedback');
        if (feedbackEl) {
            feedbackEl.textContent = message;
            // Animate the panel
            const panel = document.getElementById('readingAgentPanel');
            if (panel) {
                panel.classList.add('animate-pulse');
                setTimeout(() => {
                    panel.classList.remove('animate-pulse');
                }, 500);
            }
        }
    }
    
    updateTranscriptDisplay() {
        const transcriptEl = document.getElementById('currentTranscript');
        if (transcriptEl) {
            transcriptEl.textContent = this.currentTranscript || '(listening...)';
        }
    }
    
    highlightCurrentWord(text) {
        // Simple word highlighting based on spoken words
        const words = text.split(' ');
        const spokenCount = this.spokenWords.length;
        
        return words.map((word, index) => {
            let className = '';
            if (index < spokenCount) {
                const expectedClean = word.toLowerCase().replace(/[^a-z0-9]/g, '');
                const spokenWord = this.spokenWords[index] || '';
                const spokenClean = spokenWord.replace(/[^a-z0-9]/g, '');
                
                if (expectedClean === spokenClean) {
                    className = 'text-green-600 font-semibold'; // Correct word
                } else {
                    className = 'text-red-600 underline'; // Incorrect word
                }
            } else if (index === spokenCount) {
                className = 'bg-yellow-200 font-semibold'; // Current word
            }
            
            return `<span class="${className}">${word}</span>`;
        }).join(' ');
    }
    
    highlightIncorrectWords(incorrectWords) {
        const textEl = document.getElementById('readingText');
        if (!textEl) return;
        
        // Re-render with highlighted incorrect words
        const pageText = this.pages[this.currentIndex] || '';
        textEl.innerHTML = this.highlightCurrentWord(pageText);
    }
    
    detectRepetition(words) {
        if (words.length < 2) return false;
        // Check for repeated words in sequence
        for (let i = 1; i < words.length; i++) {
            if (words[i] === words[i - 1]) {
                return true;
            }
        }
        return false;
    }
    
    detectHesitation(text) {
        // Look for hesitation markers like "um", "uh", long pauses in transcription
        const hesitationWords = ['um', 'uh', 'er', 'ah'];
        const words = text.toLowerCase().split(/\s+/);
        return hesitationWords.some(word => words.includes(word));
    }
    
    handleStruggle(type) {
        // Provide immediate encouragement when struggle is detected
        if (type === 'long_pause') {
            this.updateAgentFeedback("Take your time! I'm here to help. Try sounding out the next word slowly.");
        }
    }

    updateAccuracyDisplay() {
        if (!this.expectedWords || this.expectedWords.length === 0) return;

        // Simple word matching for accuracy
        const minLen = Math.min(this.spokenWords.length, this.expectedWords.length);
        let matches = 0;
        for (let i = 0; i < minLen; i++) {
            if ((this.spokenWords[i] || '').replace(/[^a-z0-9]/gi, '') === (this.expectedWords[i] || '').replace(/[^a-z0-9]/gi, '')) {
                matches++;
            }
        }

        const accuracy = Math.round((matches / this.expectedWords.length) * 100);
        const accuracyEl = document.getElementById('accuracy');
        if (accuracyEl) {
            accuracyEl.textContent = `Accuracy: ${accuracy}%`;
        }

        // Store for submission
        this.currentAccuracy = accuracy;
    }

    setupButtons() {
        const prev = document.getElementById('prevPage');
        const next = document.getElementById('nextPage');
        const finish = document.getElementById('finishReading');

        if (prev) prev.addEventListener('click', () => this.prevPage());
        if (next) next.addEventListener('click', () => this.nextPage());
        if (finish) finish.addEventListener('click', () => this.finish());
    }

    prevPage() {
        if (this.currentIndex > 0) {
            this.currentIndex -= 1;
            this.renderCurrentPage();
            this.updateProgress();
        }
    }

    nextPage() {
        if (this.currentIndex < this.pages.length - 1) {
            // accumulate words read roughly
            this.wordsRead += (this.pages[this.currentIndex] || '').split(/\s+/).length;
            this.currentIndex += 1;
            this.renderCurrentPage();
            this.updateProgress();
        }
    }

    updateProgress() {
        const bar = document.getElementById('readingProgress');
        if (!bar) return;
        const pct = Math.round(((this.currentIndex + 1) / this.pages.length) * 100);
        bar.style.width = pct + '%';
        bar.setAttribute('aria-valuenow', pct);
    }

    async finish() {
        this.endTime = Date.now();
        const durationSec = Math.max(1, Math.round((this.endTime - this.startTime) / 1000));
        const totalWords = this.wordsRead + ((this.pages[this.currentIndex] || '').split(/\s+/).length || 0);
        const wpm = Math.round((totalWords / Math.max(1, durationSec)) * 60);

        // Stop listening if active
        if (this.isListening) {
            this.stopListening();
        }

        // Calculate final accuracy
        const accuracy = this.currentAccuracy || 0;

        // Show results modal with accuracy
        const modalHTML = `
                        <div class="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center">
                                <div class="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
                                        <h3 class="text-2xl font-bold mb-6">Reading Results</h3>
                    
                                        <div class="grid grid-cols-2 gap-6 mb-6">
                                                <div class="text-center">
                                                        <div class="text-3xl font-bold text-indigo-600">${accuracy}%</div>
                                                        <div class="text-sm text-gray-600">Reading Accuracy</div>
                                                </div>
                                                <div class="text-center">
                                                        <div class="text-3xl font-bold text-green-600">${wpm}</div>
                                                        <div class="text-sm text-gray-600">Words per Minute</div>
                                                </div>
                                        </div>

                                        <div class="mb-6">
                                                <label class="block text-sm font-medium text-gray-700 mb-2">
                                                        How well did you understand the passage? (0-100)
                                                </label>
                                                <input type="number" id="comprehensionScore" 
                                                             class="w-full p-2 border rounded-lg"
                                                             min="0" max="100" step="1">
                                        </div>

                                        <button id="submitResults" 
                                                        class="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700">
                                                Submit Results
                                        </button>
                                </div>
                        </div>
                `;

        // Add modal to page
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHTML;
        document.body.appendChild(modalContainer);

        // Handle submission
        return new Promise((resolve) => {
            const submitBtn = document.getElementById('submitResults');
            if (!submitBtn) {
                resolve();
                return;
            }
            submitBtn.addEventListener('click', async () => {
                const comprehensionInput = document.getElementById('comprehensionScore');
                const comprehension = comprehensionInput ? parseInt(comprehensionInput.value, 10) : null;

                const payload = {
                    reading_time_seconds: durationSec,
                    words_read: totalWords,
                    wpm,
                    accuracy_score: accuracy,
                    comprehension_score: comprehension,
                };

                try {
                    await apiRequest('POST', `/reading/finish/${this.bookId}`, payload);
                    // Remove modal and redirect
                    modalContainer.remove();
                    window.location.href = 'dashboard.html';
                    resolve();
                } catch (err) {
                    console.error('Failed to submit reading results', err);
                    showError('Failed to submit reading session');
                    resolve();
                }
            });
        });
    }
}

function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
}

document.addEventListener('DOMContentLoaded', async () => {
    const bookId = getQueryParam('id');
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    const session = new ReadingSession(bookId);
    await session.init();
});