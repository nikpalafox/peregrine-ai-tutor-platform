// Word Tracking Unit Tests — run with: node test-tracking.js
//
// Tests the incremental word-by-word advancement that prevents
// the yellow highlight from jumping ahead when Chrome batches
// multiple words into a single final result.

class TestReadingSession {
    constructor() {
        this.spokenWords = [];
        this.expectedWords = [];
        this.displayWords = [];
        this.lastSpokenText = '';
        this.currentTranscript = '';
        this._processedFinalCount = 0;
        this._advanceQueue = [];
    }

    _filterFillers(words) {
        const fillerWords = new Set([
            'um', 'uh', 'ah', 'er', 'like', 'hmm', 'hm', 'mm',
            'ugh', 'huh', 'mhm', 'uhh', 'umm', 'ehm'
        ]);
        return words.filter(w => {
            const clean = w.replace(/[^a-z0-9]/g, '');
            return clean.length > 0 && !fillerWords.has(clean);
        });
    }

    // Simulate what onresult does — returns how many words are QUEUED
    // (in the real code these are animated one-by-one via _advanceOneWord)
    simulateFinalWords(finalText) {
        this.lastSpokenText = finalText;
        this.currentTranscript = finalText;

        const finalWords = this.lastSpokenText.toLowerCase()
            .split(/\s+/).filter(w => w.length > 0);
        const realWords = this._filterFillers(finalWords);
        const expected = this.expectedWords || [];

        const totalReal = Math.min(realWords.length, expected.length);
        const newWordCount = totalReal - this._processedFinalCount;

        if (newWordCount > 0) {
            this._processedFinalCount = totalReal;
            for (let i = 0; i < newWordCount; i++) {
                this._advanceQueue.push(1);
            }
        }
    }

    // Advance ONE word (mirrors _advanceOneWord in reading.js)
    advanceOne() {
        if (this._advanceQueue.length === 0) return false;
        const expected = this.expectedWords || [];
        if (this.spokenWords.length < expected.length) {
            this.spokenWords.push(expected[this.spokenWords.length] || '');
        }
        this._advanceQueue.shift();
        return true;
    }

    // Drain the entire queue (simulates waiting for all animations)
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
        this._processedFinalCount = 0;
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

console.log('\n--- Test 7: Interim words do NOT affect position ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat is big');
    // Only final = 'the cat ', interim would add extras but we only use lastSpokenText
    s.simulateFinalWords('the cat');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 2, 'Only 2 final words (not interim)');
    assertEqual(s.getYellowWordIndex(), 2, 'Yellow on "is" (correct)');
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

console.log('\n--- Test 10: SR adds extra words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('I like cats');
    s.simulateFinalWords('I really like cats');
    s.advanceAll();
    assertEqual(s.spokenWords.length, 3, 'Capped at 3 (not 4)');
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

// === NEW: Tests for incremental word-by-word animation ===

console.log('\n--- Test 14: Chrome batch creates queue, not instant jump ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The quick brown fox jumps');
    // Chrome dumps 4 words as one final result
    s.simulateFinalWords('the quick brown fox');
    // BEFORE advancing: spokenWords should still be 0 (queued, not applied)
    assertEqual(s.spokenWords.length, 0, 'Before advance: spokenWords is 0');
    assertEqual(s._advanceQueue.length, 4, 'Queue has 4 words pending');

    // Advance ONE at a time
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

    // Chrome sends second batch with 3 more words
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

    // Same text again (duplicate event)
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

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
if (failCount === 0) {
    console.log(`\x1b[32mAll ${testCount} tests passed!\x1b[0m`);
} else {
    console.log(`\x1b[31m${failCount} of ${testCount} tests FAILED\x1b[0m`);
    process.exit(1);
}
