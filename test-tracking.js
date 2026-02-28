// Word Tracking Unit Tests — run with: node test-tracking.js
//
// Tests the word tracking that matches spoken words against expected
// words using a full re-scan + high-water mark approach. Tracking
// uses the full transcript (final + interim) so words register as
// soon as they appear, even before Chrome marks them as final.

class TestReadingSession {
    constructor() {
        this.spokenWords = [];
        this.expectedWords = [];
        this.displayWords = [];
        this.lastSpokenText = '';
        this.currentTranscript = '';
        this._matchedExpectedCount = 0;
        this._advanceQueue = [];
    }

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

    _cleanWord(w) {
        return w.replace(/[^a-z0-9]/g, '');
    }

    _wordsMatch(spoken, expected) {
        return this._cleanWord(spoken) === this._cleanWord(expected);
    }

    // Simulate onresult with final words (sets both lastSpokenText and currentTranscript)
    simulateFinalWords(finalText) {
        this.lastSpokenText = finalText;
        this.currentTranscript = finalText;
        this._runMatching();
    }

    // Simulate interim words appearing (only updates currentTranscript, not lastSpokenText)
    simulateInterimWords(finalText, interimText) {
        this.lastSpokenText = finalText;
        this.currentTranscript = finalText + ' ' + interimText;
        this._runMatching();
    }

    // The actual matching logic — mirrors reading.js onresult handler
    _runMatching() {
        const allSpoken = this.currentTranscript.toLowerCase()
            .replace(/[.,:;!?]+/g, ' ')
            .split(/\s+/).filter(w => w.length > 0);
        const realWords = this._filterFillers(allSpoken);
        const expected = this.expectedWords || [];

        // Sequential match from beginning each time
        let matchCount = 0;
        let spokenIdx = 0;
        while (spokenIdx < realWords.length && matchCount < expected.length) {
            if (this._wordsMatch(realWords[spokenIdx], expected[matchCount])) {
                matchCount++;
            }
            spokenIdx++;
        }

        // Tail recovery: if full re-scan couldn't reach high-water mark,
        // search recent spoken words against expected from the high-water mark.
        // Requires ≥2 consecutive matches to prevent false positives.
        if (matchCount <= this._matchedExpectedCount && this._matchedExpectedCount < expected.length) {
            const recentCount = Math.min(realWords.length, 20);
            const recentStart = realWords.length - recentCount;
            let tailExpIdx = this._matchedExpectedCount;
            let tailSpokenIdx = recentStart;
            let consecutiveMatches = 0;

            while (tailSpokenIdx < realWords.length && tailExpIdx < expected.length) {
                if (this._wordsMatch(realWords[tailSpokenIdx], expected[tailExpIdx])) {
                    consecutiveMatches++;
                    tailExpIdx++;
                } else {
                    consecutiveMatches = 0;
                }
                tailSpokenIdx++;
            }

            if (consecutiveMatches >= 2 || (tailExpIdx - this._matchedExpectedCount) >= 2) {
                matchCount = Math.max(matchCount, tailExpIdx);
            }
        }

        // High-water mark: only advance, never go back
        const newMatches = matchCount - this._matchedExpectedCount;
        if (newMatches > 0) {
            this._matchedExpectedCount = matchCount;
            for (let i = 0; i < newMatches; i++) {
                this._advanceQueue.push(1);
            }
        }
    }

    advanceOne() {
        if (this._advanceQueue.length === 0) return false;
        const expected = this.expectedWords || [];
        if (this.spokenWords.length < expected.length) {
            this.spokenWords.push(expected[this.spokenWords.length] || '');
        }
        this._advanceQueue.shift();
        return true;
    }

    advanceAll() {
        while (this._advanceQueue.length > 0) {
            this.advanceOne();
        }
    }

    highlightCurrentWord() {
        const words = this.displayWords || [];
        const spokenCount = this.spokenWords.length;
        return words.map((word, index) => {
            if (index < spokenCount) return `[GREEN]${word}`;
            if (index === spokenCount) return `[YELLOW]${word}`;
            return `[---]${word}`;
        }).join(' ');
    }

    setupPage(text) {
        this.displayWords = text.split(' ').filter(w => w.trim().length > 0);
        this.expectedWords = this.displayWords.map(w => w.toLowerCase());
        this.spokenWords = [];
        this._matchedExpectedCount = 0;
        this._advanceQueue = [];
        this.lastSpokenText = '';
        this.currentTranscript = '';
    }

    getYellowWordIndex() {
        return this.spokenWords.length;
    }

    getStuckWord() {
        const idx = this.spokenWords.length;
        return (this.displayWords && this.displayWords[idx])
            ? this.displayWords[idx]
            : (this.expectedWords[idx] || '');
    }
}

// --- Test runner ---
let testCount = 0;
let passCount = 0;
let failCount = 0;

function assertEqual(actual, expected, description) {
    testCount++;
    if (actual === expected) {
        passCount++;
        console.log(`  \x1b[32m✓\x1b[0m ${description}`);
    } else {
        failCount++;
        console.log(`  \x1b[31m✗ ${description}\x1b[0m — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
    }
}

function assert(condition, description) {
    testCount++;
    if (condition) {
        passCount++;
        console.log(`  \x1b[32m✓\x1b[0m ${description}`);
    } else {
        failCount++;
        console.log(`  \x1b[31m✗ ${description}\x1b[0m — condition was false`);
    }
}

// ===== TESTS =====

console.log('\n--- Test 1: Yellow starts at first word ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The little fox ran fast');
    assertEqual(s.getYellowWordIndex(), 0, 'Yellow starts at index 0');
    assertEqual(s.getStuckWord(), 'The', 'Stuck word is "The"');
})();

console.log('\n--- Test 2: Saying 1 word moves yellow ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The little fox ran fast');
    s.simulateFinalWords('the');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 1, '1 word matched');
    assertEqual(s.getYellowWordIndex(), 1, 'Yellow at index 1');
    assertEqual(s.getStuckWord(), 'little', 'Stuck word is "little"');
})();

console.log('\n--- Test 3: Saying 3 words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The little fox ran fast');
    s.simulateFinalWords('the little fox');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, '3 words matched');
    assertEqual(s.getYellowWordIndex(), 3, 'Yellow at "ran" (index 3)');
    assertEqual(s.getStuckWord(), 'ran', 'Stuck word is "ran"');
})();

console.log('\n--- Test 4: Cap at passage length ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Hi there');
    s.simulateFinalWords('hi there and more words');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 2, 'Capped at 2');
})();

console.log('\n--- Test 5: Filler words excluded ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat sat down');
    s.simulateFinalWords('the um cat uh sat');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, '3 real words (um/uh excluded)');
    assertEqual(s.getYellowWordIndex(), 3, 'Yellow on "down"');
})();

console.log('\n--- Test 6: Never shrinks ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat is big');
    s.simulateFinalWords('the cat is');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, '3 after first update');
    s.simulateFinalWords('the cat is');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, 'Still 3 (no change)');
    s.simulateFinalWords('the cat is big');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 4, '4 after "big"');
})();

console.log('\n--- Test 7: Interim words do NOT go backward ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat is big');
    s.simulateFinalWords('the cat is');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, '3 matched from final');
    // Interim changes to something shorter — high-water mark keeps us at 3
    s.simulateInterimWords('the cat is', 'b');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, 'Still 3 (interim "b" does not match "big")');
})();

console.log('\n--- Test 8: Highlight rendering ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat sat');
    s.simulateFinalWords('the cat');
    s.advanceAll();
    const html = s.highlightCurrentWord();
    assert(html.includes('[GREEN]The'), 'First word green');
    assert(html.includes('[GREEN]cat'), 'Second word green');
    assert(html.includes('[YELLOW]sat'), 'Third word yellow');
})();

console.log('\n--- Test 9: Stuck word matches yellow ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('A big red ball');
    s.simulateFinalWords('a big');
    s.advanceAll();
    assertEqual(s.getStuckWord(), 'red', 'Stuck word is "red"');
    s.simulateFinalWords('a big red');
    s.advanceAll();
    assertEqual(s.getStuckWord(), 'ball', 'Stuck word is "ball"');
})();

console.log('\n--- Test 10: SR adds extra words that don\'t match ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('I like cats');
    s.simulateFinalWords('I really like cats');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, 'All 3 matched (extra "really" skipped)');
})();

console.log('\n--- Test 11: Empty passage ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('');
    s.simulateFinalWords('hello world');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 0, '0 matched for empty passage');
})();

console.log('\n--- Test 12: Incremental final words (Chrome batching) ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The big brown fox jumped over');
    s.simulateFinalWords('the big');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 2, 'Chunk 1: 2');
    assertEqual(s.getYellowWordIndex(), 2, 'Yellow on "brown"');

    s.simulateFinalWords('the big brown fox');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 4, 'Chunk 2: 4');
    assertEqual(s.getYellowWordIndex(), 4, 'Yellow on "jumped"');

    s.simulateFinalWords('the big brown fox jumped over');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 6, 'Chunk 3: all 6');
})();

console.log('\n--- Test 13: displayWords indexing matches expectedWords ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The  big   cat');  // extra spaces
    assertEqual(s.displayWords.length, s.expectedWords.length, 'displayWords.length === expectedWords.length');
    assertEqual(s.displayWords[0], 'The', 'displayWords[0] = "The"');
    assertEqual(s.expectedWords[0], 'the', 'expectedWords[0] = "the"');
})();

// === Tests for word-by-word animation ===

console.log('\n--- Test 14: Chrome batch creates queue, not instant jump ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The quick brown fox jumps');
    s.simulateFinalWords('the quick brown fox');
    assertEqual(s.spokenWords.length, 0, 'Before advance: spokenWords is 0');
    assertEqual(s._advanceQueue.length, 4, 'Queue has 4 words pending');

    s.advanceOne();
    assertEqual(s.spokenWords.length, 1, 'After 1st advance: 1 word');
    assertEqual(s.getYellowWordIndex(), 1, 'Yellow on "quick"');

    s.advanceOne();
    assertEqual(s.spokenWords.length, 2, 'After 2nd advance: 2 words');
    assertEqual(s.getYellowWordIndex(), 2, 'Yellow on "brown"');

    s.advanceOne();
    assertEqual(s.spokenWords.length, 3, 'After 3rd advance: 3 words');

    s.advanceOne();
    assertEqual(s.spokenWords.length, 4, 'After 4th advance: 4 words');
    assertEqual(s._advanceQueue.length, 0, 'Queue is empty');
})();

console.log('\n--- Test 15: Second batch adds to queue correctly ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('One two three four five six');
    s.simulateFinalWords('one two');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 2, 'First batch: 2');

    s.simulateFinalWords('one two three four five');
    assertEqual(s._advanceQueue.length, 3, 'Second batch queues 3 NEW words');
    s.advanceOne();
    assertEqual(s.spokenWords.length, 3, 'Advanced to 3');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 5, 'All 5 done');
})();

console.log('\n--- Test 16: Same final text does not re-queue ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Hello world');
    s.simulateFinalWords('hello');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 1, 'First: 1');

    s.simulateFinalWords('hello');
    assertEqual(s._advanceQueue.length, 0, 'No new words queued for duplicate');
    assertEqual(s.spokenWords.length, 1, 'Still 1');
})();

console.log('\n--- Test 17: Fillers in batch do not inflate queue ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('I am happy today');
    s.simulateFinalWords('um I uh am happy');
    assertEqual(s._advanceQueue.length, 3, 'Queue is 3 (fillers excluded)');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, '3 real words advanced');
    assertEqual(s.getStuckWord(), 'today', 'Yellow on "today"');
})();

// === Tests for repeated words / sentence boundaries ===

console.log('\n--- Test 18: Repeated words across sentences don\'t skip ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('I saw the cat. The cat ran away.');
    s.simulateFinalWords('I saw the cat');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 4, 'After sentence 1: 4 words');
    assertEqual(s.getStuckWord(), 'The', 'Yellow on "The" (start of sentence 2)');

    s.simulateFinalWords('I saw the cat the cat ran away');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 8, 'After sentence 2: all 8 words');
})();

console.log('\n--- Test 19: Extra/misrecognized words are skipped ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The dog ran fast');
    s.simulateFinalWords('the big dog ran really fast');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 4, 'All 4 matched despite extras');
})();

console.log('\n--- Test 20: Unmatched words don\'t advance position ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat sat on the mat');
    s.simulateFinalWords('hello goodbye world');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 0, 'No matches = no advancement');
    assertEqual(s.getYellowWordIndex(), 0, 'Yellow still on first word');
})();

console.log('\n--- Test 21: Punctuation in expected words matches spoken ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Hello, world! How are you?');
    s.simulateFinalWords('hello world how are you');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 5, 'All 5 matched despite punctuation');
})();

console.log('\n--- Test 22: Multi-sentence passage with shared words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The fox ran. The fox ran home.');
    s.simulateFinalWords('the fox ran');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, 'First sentence: 3');
    assertEqual(s.getStuckWord(), 'The', 'Yellow on second "The"');

    s.simulateFinalWords('the fox ran the fox ran home');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 7, 'Both sentences: all 7');
})();

console.log('\n--- Test 23: SR adds words between matching words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Red ball');
    s.simulateFinalWords('red uh ball');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 2, 'Both matched (filler filtered)');
})();

console.log('\n--- Test 24: Partial match then more words arrive ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('One two three four five');
    s.simulateFinalWords('one');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 1, 'Batch 1: 1 match');

    s.simulateFinalWords('one blah two three');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, 'Batch 2: 3 total matches');

    s.simulateFinalWords('one blah two three four five');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 5, 'Batch 3: all 5');
})();

console.log('\n--- Test 25: Long passage with repeated common words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The big dog and the small cat and the tiny bird');
    s.simulateFinalWords('the big dog and the small cat and the tiny bird');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 11, 'All 11 words matched in order');
})();

// === NEW: Tests for interim results (the actual bug) ===

console.log('\n--- Test 26: Interim results advance tracking ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('In the sky a falcon flies.');
    // Final: "in the sky a falcon", Interim: "flies"
    s.simulateInterimWords('in the sky a falcon', 'flies');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 6, 'All 6 matched including interim "flies"');
})();

console.log('\n--- Test 27: Interim across sentence boundary ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('A falcon flies. It is a peregrine falcon.');
    // Final: "a falcon flies", Interim: "it is a peregrine falcon"
    s.simulateInterimWords('a falcon flies', 'it is a peregrine falcon');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 8, 'All 8 matched across sentence boundary');
})();

console.log('\n--- Test 28: High-water mark when interim shrinks ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat sat on the mat');
    // First: interim shows 4 words matched
    s.simulateInterimWords('the cat', 'sat on');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 4, '4 matched');

    // Interim changes to something shorter (SR revised its guess)
    // High-water mark prevents going backward
    s.simulateInterimWords('the cat', 'sat');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 4, 'Still 4 (high-water mark)');

    // Then final arrives with full text
    s.simulateFinalWords('the cat sat on the mat');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 6, 'All 6 after final arrives');
})();

console.log('\n--- Test 29: The exact failing passage ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('In the sky, a falcon flies. It is a peregrine falcon. "Peregrine falcons are fast,"');
    // Simulate Chrome batching: first sentence final, second sentence in interim
    s.simulateInterimWords('in the sky a falcon flies', 'it is a peregrine falcon');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 11, 'First 11 words matched');
    assertEqual(s.getStuckWord(), '"Peregrine', 'Yellow on quoted "Peregrine"');

    // Third sentence arrives
    s.simulateFinalWords('in the sky a falcon flies it is a peregrine falcon peregrine falcons are fast');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 15, 'All 15 words matched');
})();

console.log('\n--- Test 30: "flies it" not treated as one word ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('A falcon flies. It is fast.');
    // Chrome sends "flies" and "it" in same final result
    s.simulateFinalWords('a falcon flies it is fast');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 6, 'All 6 matched — "flies" and "it" are separate');
})();

console.log('\n--- Test 31: Session restart loses interim words (the "He" bug) ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Once upon a time in a cozy little town, there lived a kind and lovable dog named Storm. Storm was a fluffy golden retriever with big, floppy ears and a wagging tail that never stopped. He loved playing fetch with his favorite red ball and going on walks with his best friend, Lily.');

    // Student reads through the passage. Chrome finalizes up to "a wagging"
    // but keeps "tail that never stopped" as interim.
    // (In real code, lastSpokenText ends with ' ' from += transcript + ' ')
    s.simulateInterimWords(
        'once upon a time in a cozy little town there lived a kind and lovable dog named storm storm was a fluffy golden retriever with big floppy ears and a wagging ',
        'tail that never stopped'
    );
    s.advanceAll();
    assertEqual(s.spokenWords.length, 35, 'Matched up to "stopped" (35 words)');
    assertEqual(s.getStuckWord(), 'He', 'Yellow on "He"');

    // NOW: Chrome ends the session. The interim "tail that never stopped" is lost.
    // With the fix, onend promotes interim to lastSpokenText:
    //   this.lastSpokenText += this._pendingInterim + ' ';
    s.lastSpokenText += 'tail that never stopped ';

    // New session starts. Student says "He loved playing fetch..."
    s.simulateInterimWords(s.lastSpokenText, 'he loved playing fetch');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 39, 'Matched through "fetch" after session restart');
    assert(s.spokenWords.length > 35, '"He" is no longer stuck — highlight advanced past it');
})();

console.log('\n--- Test 32: Tail recovery saves even when _pendingInterim is missing ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Once upon a time in a cozy little town, there lived a kind and lovable dog named Storm. Storm was a fluffy golden retriever with big, floppy ears and a wagging tail that never stopped. He loved playing fetch.');

    // Full match up to "stopped" via interim
    s.simulateInterimWords(
        'once upon a time in a cozy little town there lived a kind and lovable dog named storm storm was a fluffy golden retriever with big floppy ears and a wagging',
        'tail that never stopped'
    );
    s.advanceAll();
    assertEqual(s.spokenWords.length, 35, 'Matched 35 words');

    // Session restarts WITHOUT the _pendingInterim fix: interim lost,
    // only final text remains (up to "a wagging").
    // Student says "he loved playing fetch".
    // The main re-scan only reaches ~31 (below high-water mark of 35),
    // BUT tail recovery searches recent words from position 35 and finds
    // "he loved playing fetch" — 4 consecutive matches, so it advances.
    s.simulateInterimWords(
        'once upon a time in a cozy little town there lived a kind and lovable dog named storm storm was a fluffy golden retriever with big floppy ears and a wagging',
        'he loved playing fetch'
    );
    s.advanceAll();
    assert(s.spokenWords.length >= 39, 'Tail recovery bridges gap even without _pendingInterim fix');
})();

// ===== FIX: Period-joined words (Chrome returns "stopped.He" without space) =====

console.log('\n--- Test 33: Period-joined words "stopped.He" split correctly ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('tail that never stopped. He loved playing fetch.');
    // Chrome returns "stopped.He" as a single token with no space
    s.simulateFinalWords('tail that never stopped.He loved playing fetch');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 8, 'All 8 words matched despite period-joined "stopped.He"');
})();

console.log('\n--- Test 34: Multiple punctuation-joined words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Hello, world! How are you?');
    // Chrome returns "world!How" joined and "you?" at the end
    s.simulateFinalWords('hello,world!How are you?');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 5, 'All 5 words matched despite joined punctuation');
})();

console.log('\n--- Test 35: Comma-joined words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('big, floppy ears and a wagging tail');
    // Chrome returns "big,floppy" joined
    s.simulateFinalWords('big,floppy ears and a wagging tail');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 7, 'All 7 words matched despite comma-join');
})();

console.log('\n--- Test 36: Semicolon and colon joined words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('first: read the book; then answer questions.');
    s.simulateFinalWords('first:read the book;then answer questions');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 7, 'All 7 words matched with colon/semicolon joins');
})();

// ===== FIX: Tail recovery — bridge gaps from lost words =====

console.log('\n--- Test 37: Tail recovery bridges gap from lost words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The dog ran fast. He jumped over the fence.');
    // Student reads up to "fast" (4 words matched)
    s.simulateFinalWords('the dog ran fast');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 4, 'Matched 4 words');
    assertEqual(s.getStuckWord(), 'He', 'Yellow on "He"');

    // Session restarts — words "fast" lost, Chrome only has new speech.
    // Without tail recovery, re-scan from start can't reach high-water mark.
    // Simulate: lastSpokenText is incomplete (missing "fast"), new speech starts
    s.lastSpokenText = 'the dog ran ';
    s.simulateInterimWords(s.lastSpokenText, 'he jumped over the fence');
    s.advanceAll();
    assert(s.spokenWords.length >= 9, 'Tail recovery bridged gap — matched through "fence"');
})();

console.log('\n--- Test 38: Tail recovery requires 2+ matches (no false positives) ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The big red fox jumped over the lazy dog quickly.');
    s.simulateFinalWords('the big red fox jumped');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 5, 'Matched 5 words');

    // Simulate lost words with only 1 stray match — should NOT advance
    // "over" appears in expected but alone is not enough
    s.lastSpokenText = 'the big red ';
    s.simulateInterimWords(s.lastSpokenText, 'something random words');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 5, 'No false advance from random words');
})();

console.log('\n--- Test 39: Tail recovery with full passage and session restart ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Once upon a time in a cozy little town, there lived a kind and lovable dog named Storm. Storm was a fluffy golden retriever with big, floppy ears and a wagging tail that never stopped. He loved playing fetch with his favorite red ball and going on walks with his best friend, Lily.');

    // Read up to "stopped" (35 words matched) via interim
    s.simulateInterimWords(
        'once upon a time in a cozy little town there lived a kind and lovable dog named storm storm was a fluffy golden retriever with big floppy ears and a wagging ',
        'tail that never stopped'
    );
    s.advanceAll();
    assertEqual(s.spokenWords.length, 35, 'Matched 35 words up to "stopped"');

    // Session restarts — several words lost (no _pendingInterim promotion)
    // AND Chrome starts fresh. Only "wagging" survived in lastSpokenText.
    // Student says "He loved playing fetch with his favorite red ball"
    s.lastSpokenText = 'once upon a time in a cozy little town there lived a kind and lovable dog named storm storm was a fluffy golden retriever with big floppy ears and a wagging ';
    s.simulateInterimWords(s.lastSpokenText, 'he loved playing fetch with his favorite red ball');
    s.advanceAll();
    assert(s.spokenWords.length >= 43, 'Tail recovery matched "He loved playing fetch with his favorite red ball"');
})();

console.log('\n--- Test 40: Tail recovery across multiple sentence boundaries ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('She sat down. The cat purred. It was warm.');
    s.simulateFinalWords('she sat down');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, 'Matched first sentence (3 words)');

    // Big gap — "The cat purred" lost entirely. Student says "It was warm"
    s.lastSpokenText = 'she sat ';
    s.simulateInterimWords(s.lastSpokenText, 'the cat purred it was warm');
    s.advanceAll();
    assert(s.spokenWords.length >= 9, 'Recovered across two sentence boundaries');
})();

console.log('\n--- Test 41: Period-joined words + tail recovery combined ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The ball bounced high. She caught it easily.');
    s.simulateFinalWords('the ball bounced high');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 4, 'Matched 4 words');

    // Session restart, Chrome returns "high.She" joined AND words are lost
    s.lastSpokenText = 'the ball bounced ';
    s.simulateInterimWords(s.lastSpokenText, 'high.She caught it easily');
    s.advanceAll();
    assert(s.spokenWords.length >= 8, 'Both fixes work together — period-joined + tail recovery');
})();

console.log('\n--- Test 42: Tail recovery does not go backward ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Red fox brown fox blue fox green fox.');
    s.simulateFinalWords('red fox brown fox blue fox');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 6, 'Matched 6 words');

    // Student repeats earlier words — should not go backward
    s.simulateFinalWords('red fox brown fox blue fox');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 6, 'No backward movement');
})();

console.log('\n--- Test 43: Tail recovery with 300ms gap simulation ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('I love to read books every single day.');
    // First session: matched "I love to read books" (5 words)
    s.simulateFinalWords('i love to read books');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 5, 'Matched 5 words');

    // 300ms gap — "books" was only interim and got lost
    // New session picks up with "every single day"
    s.lastSpokenText = 'i love to read ';
    s.simulateInterimWords(s.lastSpokenText, 'every single day');
    s.advanceAll();
    assert(s.spokenWords.length >= 8, 'Bridged 300ms gap — matched "every single day"');
})();

console.log('\n--- Test 44: Original "He" bug fully resolved with both fixes ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Once upon a time in a cozy little town, there lived a kind and lovable dog named Storm. Storm was a fluffy golden retriever with big, floppy ears and a wagging tail that never stopped. He loved playing fetch with his favorite red ball and going on walks with his best friend, Lily.');

    // Scenario: Chrome returns "stopped.He" joined at sentence boundary
    // AND some words are lost during session restart
    s.simulateFinalWords(
        'once upon a time in a cozy little town there lived a kind and lovable dog named storm storm was a fluffy golden retriever with big floppy ears and a wagging tail that never stopped.He loved playing fetch with his favorite red ball and going on walks with his best friend lily'
    );
    s.advanceAll();
    // With period splitting, "stopped.He" → "stopped" + "He", everything matches
    assert(s.spokenWords.length >= 45, 'Full passage matched with period-joined "stopped.He"');
})();

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
if (failCount === 0) {
    console.log(`\x1b[32mAll ${testCount} tests passed!\x1b[0m`);
} else {
    console.log(`\x1b[31m${failCount} of ${testCount} tests FAILED\x1b[0m`);
    process.exit(1);
}
