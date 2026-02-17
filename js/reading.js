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
        this.lastFeedbackCount = 0; // Track word count at last feedback
        this.lastUpdateTime = 0; // Track last UI update time
        this.updateDebounceDelay = 200; // Debounce UI updates to 200ms
        this.lastSpokenWordsCount = 0; // Track last spoken words count to avoid unnecessary updates
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
                    // Add final words to spokenWords array
                    const transcriptLower = transcript.trim().toLowerCase();
                    const newWords = transcriptLower.split(/\s+/).filter(w => w.length > 0);
                    if (newWords.length > 0) {
                        this.spokenWords.push(...newWords);
                        this.lastSpokenText += transcript + ' ';
                    }
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Update current transcript for display (includes both final and interim)
            this.currentTranscript = this.lastSpokenText + finalTranscript + interimTranscript;
            
            // Process interim results to extract words incrementally
            // This allows real-time word tracking as students speak, not just after pauses
            if (interimTranscript.trim() || finalTranscript.trim()) {
                const fullTranscript = this.currentTranscript.toLowerCase();
                const allWords = fullTranscript.split(/\s+/).filter(w => w.length > 0);
                const expectedWords = this.expectedWords || [];
                
                // Match words from the full transcript to expected words in sequence
                // This gives us real-time progress tracking
                const matchedWords = [];
                let transcriptIndex = 0;
                
                for (let expectedIndex = 0; expectedIndex < expectedWords.length && transcriptIndex < allWords.length; expectedIndex++) {
                    const expectedWord = expectedWords[expectedIndex].replace(/[^a-z0-9]/g, '');
                    
                    // Look for a match in the remaining transcript
                    let found = false;
                    for (let i = transcriptIndex; i < allWords.length; i++) {
                        const spokenWord = allWords[i].replace(/[^a-z0-9]/g, '');
                        
                        // Check for exact match or close match (for interim results)
                        if (spokenWord === expectedWord || 
                            (spokenWord.length >= 2 && expectedWord.startsWith(spokenWord.substring(0, Math.min(spokenWord.length, expectedWord.length)))) ||
                            (expectedWord.length >= 2 && spokenWord.startsWith(expectedWord.substring(0, Math.min(expectedWord.length, spokenWord.length))))) {
                            matchedWords.push(allWords[i]);
                            transcriptIndex = i + 1;
                            found = true;
                            break;
                        }
                    }
                    
                    // If no match found, stop tracking (student may have skipped or misread)
                    if (!found) {
                        break;
                    }
                }
                
                // Update spokenWords with matched words for real-time display
                if (matchedWords.length > 0) {
                    this.spokenWords = matchedWords;
                }
            }
            
            // Update display in real-time as words are detected
            // But debounce to avoid excessive re-renders
            const now = Date.now();
            const shouldUpdate = now - this.lastUpdateTime > this.updateDebounceDelay ||
                                this.spokenWords.length !== this.lastSpokenWordsCount;
            
            if (shouldUpdate) {
                this.updateAccuracyDisplay();
                this.updateTranscriptDisplay();
                this.updateWordHighlighting();
                this.lastUpdateTime = now;
                this.lastSpokenWordsCount = this.spokenWords.length;
            }
            
            // Get feedback more frequently - on final results OR when we detect significant progress
            const shouldGetFeedback = finalTranscript.trim() && 
                (Date.now() - this.lastFeedbackTime) > this.feedbackCooldown;
            
            // Also get feedback when we've spoken a few words (every 3-5 words)
            const wordsSinceLastFeedback = this.spokenWords.length - (this.lastFeedbackCount || 0);
            const shouldGetIncrementalFeedback = wordsSinceLastFeedback >= 3 && 
                (Date.now() - this.lastFeedbackTime) > 1500; // Shorter cooldown for incremental feedback
            
            if (shouldGetFeedback || shouldGetIncrementalFeedback) {
                this.lastFeedbackCount = this.spokenWords.length;
                this.getReadingFeedback();
            }
            
            // Detect pauses (no speech for a while)
            if (interimTranscript.trim() === '' && finalTranscript.trim() === '' && this.isListening) {
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
            // Don't auto-restart on certain errors to prevent refresh loops
            if (event.error === 'no-speech' || event.error === 'aborted') {
                // These are normal - don't do anything
                return;
            }
            // Only stop on serious errors
            if (event.error === 'network' || event.error === 'not-allowed') {
                try {
                    this.stopListening();
                } catch (e) {}
            }
        };
        
        // Don't auto-restart - with continuous mode, it should keep running
        // Only restart manually when user clicks the button
        this.recognition.onend = () => {
            // With continuous: true, onend should only fire on errors
            // Don't auto-restart to prevent refresh loops
            if (this.isListening) {
                console.log('Speech recognition ended unexpectedly');
                // Update UI to show it stopped
                const toggleBtn = document.querySelector('#toggleSpeech');
                if (toggleBtn) {
                    toggleBtn.textContent = 'Start Speaking';
                    toggleBtn.className = 'btn-mic';
                }
                this.isListening = false;
            }
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
        this.lastFeedbackCount = 0;
        this.lastUpdateTime = 0;
        this.lastSpokenWordsCount = 0;

        // Add Reading Agent feedback panel
        const agentPanel = document.createElement('div');
        agentPanel.id = 'readingAgentPanel';
        agentPanel.innerHTML = `
            <div class="agent-row">
                <div class="agent-avatar">&#x1F393;</div>
                <div style="flex: 1;">
                    <h3>Reading Teacher</h3>
                    <p id="agentFeedback">Ready to help you read! Click "Start Speaking" when you're ready.</p>
                </div>
            </div>
        `;
        container.appendChild(agentPanel);

        // Wire up the external speech toggle button from the controls bar
        const toggleBtn = document.querySelector('#toggleSpeech');
        if (toggleBtn) {
            // Remove previous listeners by replacing element
            const newToggle = toggleBtn.cloneNode(true);
            toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);
            newToggle.addEventListener('click', () => {
                if (this.isListening) {
                    this.stopListening();
                    newToggle.textContent = 'Start Speaking';
                    newToggle.className = 'btn-mic';
                } else {
                    this.startListening();
                    newToggle.textContent = 'Stop Speaking';
                    newToggle.className = 'btn-mic recording';
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
        // Allow shorter cooldown for incremental feedback
        const minCooldown = 1500; // 1.5 seconds minimum
        if (now - this.lastFeedbackTime < minCooldown) return;
        
        const currentPageText = this.pages[this.currentIndex] || '';
        // Use the full transcript including interim results for more accurate feedback
        const spokenText = this.currentTranscript.trim() || this.lastSpokenText.trim();
        
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
        if (!transcriptEl) return;
        
        // Only update if transcript actually changed to avoid unnecessary DOM updates
        const newText = this.currentTranscript || '(listening...)';
        if (transcriptEl.textContent !== newText) {
            transcriptEl.textContent = newText;
        }
    }
    
    updateWordHighlighting() {
        // Update the word highlighting in real-time as words are detected
        // Only update if there's an actual change to avoid unnecessary re-renders
        const textEl = document.getElementById('readingText');
        if (!textEl) return;
        
        const pageText = this.pages[this.currentIndex] || '';
        const newHTML = this.highlightCurrentWord(pageText);
        
        // Only update if the content actually changed
        if (textEl.innerHTML !== newHTML) {
            textEl.innerHTML = newHTML;
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
            // Only update if accuracy changed to avoid unnecessary DOM updates
            const currentText = accuracyEl.textContent;
            const newText = `Accuracy: ${accuracy}%`;
            if (currentText !== newText) {
                accuracyEl.textContent = newText;
            }
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

        const pageNumberEl = document.getElementById('pageNumber');
        if (pageNumberEl) pageNumberEl.textContent = `${this.currentIndex + 1} / ${this.pages.length}`;
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
            <div class="modal-overlay">
                <div class="modal-card">
                    <h3>Reading Results</h3>
                    <div class="results-grid">
                        <div class="result-stat">
                            <div class="result-stat-value purple">${accuracy}%</div>
                            <div class="result-stat-label">Reading Accuracy</div>
                        </div>
                        <div class="result-stat">
                            <div class="result-stat-value green">${wpm}</div>
                            <div class="result-stat-label">Words per Minute</div>
                        </div>
                    </div>
                    <div>
                        <label class="modal-label">
                            How well did you understand the passage? (0-100)
                        </label>
                        <input type="number" id="comprehensionScore"
                               class="modal-input"
                               min="0" max="100" step="1" placeholder="Enter score">
                    </div>
                    <button id="submitResults" class="modal-submit">
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
                    student_id: this.studentId,
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
    console.log('Reading page loaded with bookId:', bookId); // Debug log
    
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    if (!bookId) {
        showError('No book ID provided in URL');
        console.error('Missing book ID in URL. URL:', window.location.href);
        // Redirect back to dashboard after 2 seconds
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 2000);
        return;
    }

    const session = new ReadingSession(bookId);
    await session.init();
});