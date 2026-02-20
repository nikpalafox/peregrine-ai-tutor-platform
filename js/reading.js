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
        this.feedbackCooldown = 8000; // 8 seconds minimum between feedback requests
        this.currentTranscript = '';
        this.lastFeedbackCount = 0;
        this.lastUpdateTime = 0;
        this.updateDebounceDelay = 200;
        this.lastSpokenWordsCount = 0;
        // Struggle detection
        this.stuckWordIndex = -1; // Track if student is stuck on a word
        this.stuckWordStartTime = 0; // When they got stuck
        this.lastProgressIndex = 0; // Last word index where progress was made
        this.lastProgressTime = 0; // When last progress was made
        this.feedbackInFlight = false; // Prevent overlapping API calls
        this.tts = window.speechSynthesis; // Text-to-speech
        this.ttsVoice = null; // Will be set when voices load
        this.isSpeaking = false; // Track if TTS is currently speaking
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
            
            // === STRUGGLE-ONLY FEEDBACK ===
            // Only request feedback when the student is STUCK, not while reading smoothly.
            // Track progress: if new words are being matched, the student is doing fine.
            if (this.spokenWords.length > this.lastProgressIndex) {
                this.lastProgressIndex = this.spokenWords.length;
                this.lastProgressTime = Date.now();
                this.stuckWordIndex = -1; // Reset stuck tracking
                this.pauseStartTime = null;
            }

            // Detect pauses (no new speech activity)
            if (interimTranscript.trim() === '' && finalTranscript.trim() === '' && this.isListening) {
                if (!this.pauseStartTime) {
                    this.pauseStartTime = Date.now();
                }
            } else if (finalTranscript.trim()) {
                // Got new speech — check if progress was actually made
                // (pauseStartTime stays if no new word matches above)
                if (this.spokenWords.length <= this.lastProgressIndex) {
                    // Student is speaking but NOT making progress (wrong words / repetition)
                    if (!this.pauseStartTime) this.pauseStartTime = Date.now();
                }
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
            // If TTS is speaking, we intentionally stopped recognition — don't update UI
            if (this.isSpeaking) return;

            if (this.isListening) {
                console.log('Speech recognition ended unexpectedly');
                const toggleBtn = document.querySelector('#toggleSpeech');
                if (toggleBtn) {
                    toggleBtn.textContent = 'Start Speaking';
                    toggleBtn.className = 'btn-mic';
                }
                this.isListening = false;
                // Clear struggle timer
                if (this._struggleTimer) {
                    clearInterval(this._struggleTimer);
                    this._struggleTimer = null;
                }
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
            this.lastProgressIndex = 0;
            this.lastProgressTime = Date.now();
            this.feedbackInFlight = false;
            this.isSpeaking = false;

            // Load TTS voices (must be done after user gesture)
            if (this.tts) {
                const voices = this.tts.getVoices();
                if (voices.length > 0) {
                    this.ttsVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Samantha')) ||
                                    voices.find(v => v.lang.startsWith('en-US') && !v.name.includes('Google')) ||
                                    voices.find(v => v.lang.startsWith('en')) || null;
                }
            }

            // Speak a short greeting
            this.updateAgentFeedback("I'm listening! Start reading when you're ready.");
            this.speakFeedback("I'm listening! Start reading when you're ready.");

            // Start a periodic timer to check for struggles (every 2 seconds)
            this._struggleTimer = setInterval(() => this.checkForStruggle(), 2000);

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
            // Clear struggle timer
            if (this._struggleTimer) {
                clearInterval(this._struggleTimer);
                this._struggleTimer = null;
            }
            // Stop TTS if speaking
            if (this.tts) this.tts.cancel();
            this.isSpeaking = false;
            try {
                this.recognition.stop();
            } catch (e) {}
        }
    }
    
    /**
     * Check if the student needs help. Called on a timer, not on every speech event.
     * Only triggers feedback when:
     *   1. Student has been stuck (no progress) for 4+ seconds
     *   2. Student has a long pause (no speech at all) for 5+ seconds
     *   3. Minimum 8 seconds between any feedback
     */
    checkForStruggle() {
        if (!this.isListening || this.feedbackInFlight || this.isSpeaking) return;

        const now = Date.now();
        if (now - this.lastFeedbackTime < this.feedbackCooldown) return;

        const timeSinceProgress = now - (this.lastProgressTime || now);
        const timeSinceSpeech = this.pauseStartTime ? (now - this.pauseStartTime) : 0;

        let reason = null;

        // Case 1: Student has been silent for 5+ seconds while listening
        if (timeSinceSpeech >= 5000 && this.spokenWords.length > 0) {
            reason = 'long_pause';
        }
        // Case 2: Student is speaking but stuck on a word (no new matches for 4s)
        else if (timeSinceProgress >= 4000 && this.spokenWords.length > 0 && this.lastProgressTime > 0) {
            reason = 'stuck_word';
        }

        if (reason) {
            this.getReadingFeedback(reason);
        }
    }

    async getReadingFeedback(reason) {
        if (!this.studentId || this.feedbackInFlight) return;

        this.feedbackInFlight = true;

        const currentPageText = this.pages[this.currentIndex] || '';
        const spokenText = this.currentTranscript.trim() || this.lastSpokenText.trim();

        if (!spokenText) {
            this.feedbackInFlight = false;
            return;
        }

        const expectedWords = currentPageText.toLowerCase().split(/\s+/);
        const spokenWords = spokenText.toLowerCase().split(/\s+/);
        const currentWordIndex = Math.min(this.spokenWords.length, expectedWords.length);

        // The word the student is stuck on
        const stuckWord = expectedWords[currentWordIndex] || '';

        const struggleIndicators = {
            long_pause: reason === 'long_pause',
            stuck_word: reason === 'stuck_word',
            stuck_on: stuckWord,
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
                this.speakFeedback(feedback.feedback);
                this.lastFeedbackTime = Date.now();

                if (feedback.accuracy !== undefined) {
                    this.currentAccuracy = feedback.accuracy;
                    this.updateAccuracyDisplay();
                }

                if (feedback.incorrect_words && feedback.incorrect_words.length > 0) {
                    this.highlightIncorrectWords(feedback.incorrect_words);
                }
            }
        } catch (err) {
            console.error('Failed to get reading feedback', err);
        } finally {
            this.feedbackInFlight = false;
        }
    }

    /**
     * Speak feedback aloud using the Web Speech API (text-to-speech).
     */
    speakFeedback(text) {
        if (!this.tts) return;

        // Cancel any in-progress speech
        this.tts.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1.05;
        utterance.volume = 1.0;

        // Pick a good English voice if available
        if (!this.ttsVoice) {
            const voices = this.tts.getVoices();
            this.ttsVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Samantha')) ||
                            voices.find(v => v.lang.startsWith('en-US') && !v.name.includes('Google')) ||
                            voices.find(v => v.lang.startsWith('en')) ||
                            null;
        }
        if (this.ttsVoice) utterance.voice = this.ttsVoice;

        // Pause speech recognition while tutor speaks to avoid feedback loop
        utterance.onstart = () => {
            this.isSpeaking = true;
            if (this.recognition && this.isListening) {
                try { this.recognition.stop(); } catch (e) {}
            }
        };

        utterance.onend = () => {
            this.isSpeaking = false;
            // Resume listening after tutor finishes speaking
            if (this.isListening && this.recognition) {
                try { this.recognition.start(); } catch (e) {}
            }
        };

        utterance.onerror = () => {
            this.isSpeaking = false;
            if (this.isListening && this.recognition) {
                try { this.recognition.start(); } catch (e) {}
            }
        };

        this.tts.speak(utterance);
    }

    updateAgentFeedback(message) {
        const feedbackEl = document.getElementById('agentFeedback');
        if (feedbackEl) {
            feedbackEl.textContent = message;
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
        // Handled by checkForStruggle timer now
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