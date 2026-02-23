// Word Tracking Unit Tests — run with: node test-tracking.js

class TestReadingSession {
    constructor() {
        this.spokenWords = [];
        this.expectedWords = [];
        this.displayWords = [];
        this.lastSpokenText = '';
        this.currentTranscript = '';
    }

    _countSpokenWords(allSpoken) {
        const fillerWords = new Set([
            'um', 'uh', 'ah', 'er', 'like', 'hmm', 'hm', 'mm',
            'ugh', 'huh', 'mhm', 'uhh', 'umm', 'ehm'
        ]);
        let count = 0;
        for (const w of allSpoken) {
            const clean = w.replace(/[^a-z0-9]/g, '');
            if (clean.length > 0 && !fillerWords.has(clean)) {
                count++;
            }
        }
        return count;
    }

    // Simulate what onresult does: FINAL words only
    simulateFinalWords(finalText) {
        this.lastSpokenText = finalText;
        this.currentTranscript = finalText;

        const finalWords = this.lastSpokenText.toLowerCase()
            .split(/\s+/).filter(w => w.length > 0);

        const spokenCount = Math.min(
            this._countSpokenWords(finalWords), this.expectedWords.length
        );

        while (this.spokenWords.length < spokenCount) {
            this.spokenWords.push(this.expectedWords[this.spokenWords.length] || '');
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
    assertEqual(s.spokenWords.length, 1, '1 word matched');
    assertEqual(s.getYellowWordIndex(), 1, 'Yellow at index 1');
    assertEqual(s.getStuckWord(), 'little', 'Stuck word is "little"');
})();

console.log('\n--- Test 3: Saying 3 words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The little fox ran fast');
    s.simulateFinalWords('the little fox');
    assertEqual(s.spokenWords.length, 3, '3 words matched');
    assertEqual(s.getYellowWordIndex(), 3, 'Yellow at "ran" (index 3)');
    assertEqual(s.getStuckWord(), 'ran', 'Stuck word is "ran"');
})();

console.log('\n--- Test 4: Cap at passage length ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('Hi there');
    s.simulateFinalWords('hi there and more words');
    assertEqual(s.spokenWords.length, 2, 'Capped at 2');
})();

console.log('\n--- Test 5: Filler words excluded ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat sat down');
    s.simulateFinalWords('the um cat uh sat');
    assertEqual(s.spokenWords.length, 3, '3 real words (um/uh excluded)');
    assertEqual(s.getYellowWordIndex(), 3, 'Yellow on "down"');
})();

console.log('\n--- Test 6: Never shrinks ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat is big');
    s.simulateFinalWords('the cat is');
    assertEqual(s.spokenWords.length, 3, '3 after first update');
    s.simulateFinalWords('the cat is');
    assertEqual(s.spokenWords.length, 3, 'Still 3 (no change)');
    s.simulateFinalWords('the cat is big');
    assertEqual(s.spokenWords.length, 4, '4 after "big"');
})();

console.log('\n--- Test 7: Interim words do NOT affect position ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat is big');
    // Only final = 'the cat ', interim adds extras
    s.lastSpokenText = 'the cat ';
    s.currentTranscript = 'the cat is big and fat';
    // Run tracking logic (same as onresult)
    const finalWords = s.lastSpokenText.toLowerCase()
        .split(/\s+/).filter(w => w.length > 0);
    const spokenCount = Math.min(
        s._countSpokenWords(finalWords), s.expectedWords.length
    );
    while (s.spokenWords.length < spokenCount) {
        s.spokenWords.push(s.expectedWords[s.spokenWords.length] || '');
    }
    assertEqual(s.spokenWords.length, 2, 'Only 2 final words (not 6 interim)');
    assertEqual(s.getYellowWordIndex(), 2, 'Yellow on "is" (correct)');
})();

console.log('\n--- Test 8: Highlight rendering ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The cat sat');
    s.simulateFinalWords('the cat');
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
    assertEqual(s.getStuckWord(), 'red', 'Stuck word is "red"');
    s.simulateFinalWords('a big red');
    assertEqual(s.getStuckWord(), 'ball', 'Stuck word is "ball"');
})();

console.log('\n--- Test 10: SR adds extra words ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('I like cats');
    s.simulateFinalWords('I really like cats');
    assertEqual(s.spokenWords.length, 3, 'Capped at 3 (not 4)');
})();

console.log('\n--- Test 11: Empty passage ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('');
    s.simulateFinalWords('hello world');
    assertEqual(s.spokenWords.length, 0, '0 matched for empty passage');
})();

console.log('\n--- Test 12: Incremental final words (Chrome batching) ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The big brown fox jumped over');
    s.simulateFinalWords('the big');
    assertEqual(s.spokenWords.length, 2, 'Chunk 1: 2');
    assertEqual(s.getYellowWordIndex(), 2, 'Yellow on "brown"');

    s.simulateFinalWords('the big brown fox');
    assertEqual(s.spokenWords.length, 4, 'Chunk 2: 4');
    assertEqual(s.getYellowWordIndex(), 4, 'Yellow on "jumped"');

    s.simulateFinalWords('the big brown fox jumped over');
    assertEqual(s.spokenWords.length, 6, 'Chunk 3: all 6');
})();

console.log('\n--- Test 13: displayWords indexing matches expectedWords ---');
(function() {
    const s = new TestReadingSession();
    s.setupPage('The  big   cat');  // extra spaces
    // split(' ').filter(trim) should still work
    assertEqual(s.displayWords.length, s.expectedWords.length, 'displayWords.length === expectedWords.length');
    assertEqual(s.displayWords[0], 'The', 'displayWords[0] = "The"');
    assertEqual(s.expectedWords[0], 'the', 'expectedWords[0] = "the"');
})();

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
if (failCount === 0) {
    console.log(`\x1b[32mAll ${testCount} tests passed!\x1b[0m`);
} else {
    console.log(`\x1b[31m${failCount} of ${testCount} tests FAILED\x1b[0m`);
    process.exit(1);
}
