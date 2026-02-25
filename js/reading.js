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
        this.feedbackCooldown = 20000; // 20 seconds minimum between feedback requests
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
        this.lastSpeechActivityTime = 0; // Last time any speech was detected
        this._processedSpokenIndex = 0; // Index into spoken words we've already matched
        this._matchedExpectedCount = 0; // How many expected words we've matched so far
        this._advanceQueue = []; // Queue of positions to advance to, animated one-by-one
        this._advanceTimer = null; // Timer for animating word-by-word advancement
        this.tts = window.speechSynthesis; // Text-to-speech
        this.ttsVoice = null; // Will be set when voices load
        this.ttsVoiceReady = false; // Whether we've resolved the best voice
        this.isSpeaking = false; // Track if TTS is currently speaking
        this._ttsAudio = null; // Current ElevenLabs audio element

        // Pre-load voices (Chrome loads them asynchronously)
        this._initTTSVoices();
    }

    /**
     * Initialize TTS voice selection.
     * Chrome loads voices asynchronously, so we listen for the voiceschanged event.
     * We rank voices by quality — preferring natural/premium voices that sound human.
     */
    _initTTSVoices() {
        if (!this.tts) return;

        const pickBestVoice = () => {
            const voices = this.tts.getVoices();
            if (!voices || voices.length === 0) return;

            // Filter to English voices only
            const enVoices = voices.filter(v => v.lang.startsWith('en'));
            if (enVoices.length === 0) return;

            // Score each voice — higher is better
            const scored = enVoices.map(v => {
                let score = 0;
                const name = v.name.toLowerCase();

                // Premium / Natural voices (Chrome on desktop/Android)
                // These use neural TTS and sound very natural
                if (name.includes('natural')) score += 100;
                if (name.includes('premium')) score += 90;

                // Google UK English Female is widely considered the best default
                if (name.includes('google') && name.includes('female')) score += 60;
                if (name.includes('google') && name.includes('uk')) score += 50;

                // macOS high-quality voices
                if (name.includes('samantha')) score += 70;  // macOS default, good quality
                if (name.includes('karen')) score += 65;     // Australian, warm tone
                if (name.includes('moira')) score += 60;     // Irish, gentle
                if (name.includes('tessa')) score += 55;     // South African, clear
                if (name.includes('fiona')) score += 55;     // Scottish, warm

                // Windows good voices
                if (name.includes('zira')) score += 50;      // Windows US female
                if (name.includes('hazel')) score += 50;     // Windows UK female
                if (name.includes('jenny')) score += 65;     // Windows 11 neural voice

                // Prefer female voices for a warm teacher persona
                if (name.includes('female')) score += 20;

                // Prefer US/UK English
                if (v.lang === 'en-US') score += 10;
                if (v.lang === 'en-GB') score += 8;

                // Slight penalty for very robotic-sounding ones
                if (name.includes('espeak')) score -= 50;
                if (name.includes('mbrola')) score -= 40;

                return { voice: v, score };
            });

            // Sort by score descending, pick the best
            scored.sort((a, b) => b.score - a.score);

            this.ttsVoice = scored[0].voice;
            this.ttsVoiceReady = true;
            console.log('TTS voice selected:', this.ttsVoice.name, `(score: ${scored[0].score})`);
        };

        // Try immediately (works in Firefox/Safari)
        pickBestVoice();

        // Also listen for async load (Chrome)
        if (this.tts.onvoiceschanged !== undefined) {
            this.tts.onvoiceschanged = () => {
                if (!this.ttsVoiceReady) {
                    pickBestVoice();
                }
            };
        }
    }

    /**
     * Filter out filler words and return only real spoken words.
     */
    _filterFillers(words) {
        const fillerWords = new Set([
            'um', 'uh', 'ah', 'er', 'hmm', 'hm', 'mm',
            'ugh', 'huh', 'mhm', 'uhh', 'umm', 'ehm'
        ]);
        return words.filter(w => {
            const clean = w.replace(/[^a-z0-9]/g, '');
            return clean.length > 0 && !fillerWords.has(clean);
        });
    }

    /** Strip punctuation so "cat." matches "cat", "don't" matches "dont" etc. */
    _cleanWord(w) {
        return w.replace(/[^a-z0-9]/g, '');
    }

    /** Check if a spoken word matches an expected word (fuzzy: ignores punctuation) */
    _wordsMatch(spoken, expected) {
        return this._cleanWord(spoken) === this._cleanWord(expected);
    }

    /**
     * Advance the yellow highlight by one word.
     * Called on a timer so that batch-finalized words
     * appear to move one-by-one instead of jumping.
     */
    _advanceOneWord() {
        if (this._advanceQueue.length === 0) {
            this._advanceTimer = null;
            return;
        }

        const expected = this.expectedWords || [];
        if (this.spokenWords.length < expected.length) {
            this.spokenWords.push(expected[this.spokenWords.length] || '');
        }
        this._advanceQueue.shift();

        // Update UI immediately for this single word advance
        this.updateAccuracyDisplay();
        this.updateWordHighlighting();

        // Progress tracking for struggle detection
        if (this.spokenWords.length > this.lastProgressIndex) {
            this.lastProgressIndex = this.spokenWords.length;
            this.lastProgressTime = Date.now();
            this.pauseStartTime = null;
        }

        // Schedule next word if more in queue
        if (this._advanceQueue.length > 0) {
            this._advanceTimer = setTimeout(() => this._advanceOneWord(), 150);
        } else {
            this._advanceTimer = null;
        }
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
                    this.lastSpokenText += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }

            // Build the full running transcript (final text + current interim)
            this.currentTranscript = this.lastSpokenText + interimTranscript;

            // --- Word position tracking: sequential matching ---
            // Instead of counting spoken words and assuming 1:1 mapping,
            // we match each spoken word against the NEXT expected word.
            // This prevents skipping when SR adds extra words or when
            // repeated words appear across sentence boundaries.
            const allSpoken = this.lastSpokenText.toLowerCase()
                .split(/\s+/).filter(w => w.length > 0);
            const realWords = this._filterFillers(allSpoken);
            const expected = this.expectedWords || [];

            // Walk through any NEW spoken words we haven't processed yet
            let newMatches = 0;
            while (this._processedSpokenIndex < realWords.length
                   && this._matchedExpectedCount < expected.length) {
                const spokenWord = realWords[this._processedSpokenIndex];
                const nextExpected = expected[this._matchedExpectedCount];

                if (this._wordsMatch(spokenWord, nextExpected)) {
                    // Match! Advance expected position
                    this._matchedExpectedCount++;
                    newMatches++;
                }
                // Always advance spoken index (skip unmatched/extra words)
                this._processedSpokenIndex++;
            }

            if (newMatches > 0) {
                // Queue matched words for one-by-one animated advancement
                for (let i = 0; i < newMatches; i++) {
                    this._advanceQueue.push(1);
                }

                // Start the animation timer if not already running
                if (!this._advanceTimer) {
                    this._advanceOneWord();
                }
            }

            // --- UI updates (transcript display, debounced) ---
            const now = Date.now();
            if (now - this.lastUpdateTime > this.updateDebounceDelay) {
                this.updateTranscriptDisplay();
                this.lastUpdateTime = now;
            }

            // Any speech activity at all resets the silence timer
            if (interimTranscript.trim() || finalTranscript.trim()) {
                this.pauseStartTime = null;
                this.lastSpeechActivityTime = Date.now();
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

        // Set up word arrays BEFORE rendering so highlightCurrentWord works
        this.displayWords = pageText.split(' ').filter(w => w.trim().length > 0);
        this.expectedWords = this.displayWords.map(w => w.toLowerCase());
        this.spokenWords = [];
        this._processedSpokenIndex = 0;
        this._matchedExpectedCount = 0;
        this._advanceQueue = [];
        if (this._advanceTimer) { clearTimeout(this._advanceTimer); this._advanceTimer = null; }

        // Create text display with word highlighting
        const textContainer = document.createElement('div');
        textContainer.className = 'mb-6';
        textContainer.innerHTML = `
            <p id="readingText" class="text-lg leading-relaxed mb-4">${this.highlightCurrentWord()}</p>
            <div id="transcriptDisplay" class="text-sm text-gray-600 mb-4 italic">
                <strong>You said:</strong> <span id="currentTranscript"></span>
            </div>
        `;
        container.appendChild(textContainer);
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
            this._processedSpokenIndex = 0;
            this._matchedExpectedCount = 0;
            this._advanceQueue = [];
            if (this._advanceTimer) { clearTimeout(this._advanceTimer); this._advanceTimer = null; }
            this.lastSpokenText = '';
            this.currentTranscript = '';
            this.isListening = true;
            this.pauseStartTime = null;
            this.lastProgressIndex = 0;
            this.lastProgressTime = Date.now();
            this.lastSpeechActivityTime = Date.now();
            this.feedbackInFlight = false;
            this.isSpeaking = false;

            // Show a text-only greeting (don't speak it — let the student start)
            this.updateAgentFeedback("I'm listening! Start reading when you're ready. I'll help if you get stuck.");

            // Check for struggles periodically (every 3 seconds)
            this._struggleTimer = setInterval(() => this.checkForStruggle(), 3000);

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
            // Clear word advance animation
            if (this._advanceTimer) { clearTimeout(this._advanceTimer); this._advanceTimer = null; }
            this._advanceQueue = [];
            this.pauseStartTime = null;
            // Clear struggle timer
            if (this._struggleTimer) {
                clearInterval(this._struggleTimer);
                this._struggleTimer = null;
            }
            // Stop ElevenLabs audio if playing
            if (this._ttsAudio) {
                this._ttsAudio.pause();
                this._ttsAudio.currentTime = 0;
                this._ttsAudio = null;
            }
            // Stop browser TTS if speaking
            if (this.tts) this.tts.cancel();
            this.isSpeaking = false;
            try {
                this.recognition.stop();
            } catch (e) {}
        }
    }
    
    /**
     * Check if the student needs help. Called on a timer, not on every speech event.
     *
     * Philosophy: The tutor should stay QUIET while the student reads. Only speak up when:
     *   1. Student has gone completely silent for 10+ seconds (they may be stuck or lost)
     *   2. Student hasn't made progress on a new word for 8+ seconds (stuck on a word)
     *   3. Minimum 20 seconds between any feedback to avoid being annoying
     *   4. Never triggers if the student hasn't spoken yet (they may still be getting ready)
     *   5. Never triggers if fewer than 3 words have been read (still warming up)
     */
    checkForStruggle() {
        if (!this.isListening || this.feedbackInFlight || this.isSpeaking) return;

        const now = Date.now();
        if (now - this.lastFeedbackTime < this.feedbackCooldown) return;

        // Don't trigger if student hasn't really started reading yet
        if (this.spokenWords.length < 3) return;

        const timeSinceProgress = this.lastProgressTime > 0 ? (now - this.lastProgressTime) : 0;
        // Use lastSpeechActivityTime for silence detection since onresult doesn't fire during true silence
        const timeSinceSpeech = this.lastSpeechActivityTime ? (now - this.lastSpeechActivityTime) : 0;

        let reason = null;

        // Case 1: Complete silence for 10+ seconds (student stopped talking)
        if (timeSinceSpeech >= 10000) {
            reason = 'long_pause';
        }
        // Case 2: Student is speaking but no new word matched for 8+ seconds
        else if (timeSinceProgress >= 8000 && this.lastProgressTime > 0) {
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

        const spokenWords = spokenText.toLowerCase().split(/\s+/);
        const expectedWords = this.expectedWords || [];
        // The yellow highlighted word = the one at index spokenWords.length
        const currentWordIndex = this.spokenWords.length;

        // The word the student is stuck on = the yellow highlighted word
        const stuckWord = (this.displayWords && this.displayWords[currentWordIndex])
            ? this.displayWords[currentWordIndex]
            : (expectedWords[currentWordIndex] || '');

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
     * Speak feedback aloud using ElevenLabs TTS via the backend proxy.
     * Falls back to browser SpeechSynthesis if the API call fails.
     */
    async speakFeedback(text) {
        // Cancel any in-progress speech
        if (this._ttsAudio) {
            this._ttsAudio.pause();
            this._ttsAudio.currentTime = 0;
            this._ttsAudio = null;
        }
        if (this.tts) this.tts.cancel();

        // Pause speech recognition while tutor speaks
        this.isSpeaking = true;
        if (this.recognition && this.isListening) {
            try { this.recognition.stop(); } catch (e) {}
        }

        try {
            const token = localStorage.getItem('authToken');
            const apiBase = (window.location.hostname === 'localhost' ||
                             window.location.hostname === '127.0.0.1')
                ? 'http://127.0.0.1:8000/api' : '/api';

            const response = await fetch(`${apiBase}/tts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ text })
            });

            if (!response.ok) throw new Error(`TTS API returned ${response.status}`);

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            this._ttsAudio = audio;

            audio.onended = () => {
                this.isSpeaking = false;
                URL.revokeObjectURL(audioUrl);
                this._ttsAudio = null;
                if (this.isListening && this.recognition) {
                    try { this.recognition.start(); } catch (e) {}
                }
            };

            audio.onerror = () => {
                this.isSpeaking = false;
                URL.revokeObjectURL(audioUrl);
                this._ttsAudio = null;
                if (this.isListening && this.recognition) {
                    try { this.recognition.start(); } catch (e) {}
                }
                console.warn('Audio playback failed, falling back to browser TTS');
                this._speakWithBrowserTTS(text);
            };

            await audio.play();
        } catch (err) {
            console.warn('ElevenLabs TTS failed, falling back to browser TTS:', err.message);
            this._speakWithBrowserTTS(text);
        }
    }

    /**
     * Fallback: speak using browser's built-in SpeechSynthesis.
     */
    _speakWithBrowserTTS(text) {
        if (!this.tts) {
            this.isSpeaking = false;
            if (this.isListening && this.recognition) {
                try { this.recognition.start(); } catch (e) {}
            }
            return;
        }

        this.tts.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.88;
        utterance.pitch = 1.12;
        utterance.volume = 1.0;
        if (this.ttsVoice) utterance.voice = this.ttsVoice;

        utterance.onstart = () => {
            this.isSpeaking = true;
            if (this.recognition && this.isListening) {
                try { this.recognition.stop(); } catch (e) {}
            }
        };
        utterance.onend = () => {
            this.isSpeaking = false;
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
        
        const newHTML = this.highlightCurrentWord();
        
        // Only update if the content actually changed
        if (textEl.innerHTML !== newHTML) {
            textEl.innerHTML = newHTML;
        }
    }
    
    highlightCurrentWord() {
        // Word highlighting for elementary students:
        //   GREEN  = word was read (positive reinforcement)
        //   YELLOW = the next word to read (current position)
        //   default = not yet reached
        //
        // Uses this.displayWords for consistent indexing with spokenWords.
        const words = this.displayWords || [];
        const spokenCount = this.spokenWords.length;

        return words.map((word, index) => {
            let className = '';
            if (index < spokenCount) {
                className = 'text-green-600 font-semibold';
            } else if (index === spokenCount) {
                className = 'bg-yellow-200 font-semibold';
            }
            return `<span class="${className}">${word}</span>`;
        }).join(' ');
    }
    
    highlightIncorrectWords(incorrectWords) {
        const textEl = document.getElementById('readingText');
        if (!textEl) return;
        
        textEl.innerHTML = this.highlightCurrentWord();
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

        // All matched words count as correct (the matcher already validated them)
        const matches = this.spokenWords.length;

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
        window.location.href = 'login.html';
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