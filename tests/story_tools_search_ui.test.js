const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.scss'), 'utf8');

test('Story Tools exposes client-side search controls', () => {
    assert.match(viewSource, /id="storyToolsSearchInput"/);
    assert.match(viewSource, /type="search"[^>]+id="storyToolsSearchInput"/);
    assert.match(viewSource, /placeholder="Search entries"/);
    assert.match(viewSource, /id="storyToolsSearchClear"/);
    assert.match(viewSource, /id="storyToolsSearchMode"/);
    assert.match(viewSource, /value="allWords"/);
    assert.match(viewSource, /value="substring"/);
    assert.match(viewSource, /value="regex"/);
    assert.match(viewSource, /id="storyToolsSearchCaseSensitive"/);
    assert.match(viewSource, /type="checkbox"[^>]+id="storyToolsSearchCaseSensitive"/);
    assert.match(viewSource, /id="storyToolsSearchStatus"/);
});

test('Story Tools search keeps full history and filtered result state', () => {
    assert.match(viewSource, /entries:\s*\[\]/);
    assert.match(viewSource, /filteredEntries:\s*\[\]/);
    assert.match(viewSource, /searchTerms:\s*\[\]/);
    assert.match(viewSource, /searchMode:\s*'allWords'/);
    assert.match(viewSource, /caseSensitive:\s*false/);
    assert.match(viewSource, /searchRegex:\s*null/);
    assert.match(viewSource, /searchError:\s*null/);
    assert.match(viewSource, /normalizeStoryToolsSearchText/);
    assert.match(viewSource, /normalizeStoryToolsComparableText/);
    assert.match(viewSource, /buildStoryToolsSearchText/);
    assert.match(viewSource, /applyStoryToolsSearch/);
    assert.match(viewSource, /storyToolsSearchDebounceMs\s*=\s*1000/);
    assert.match(viewSource, /scheduleStoryToolsSearchInput/);
    assert.match(viewSource, /clearTimeout\(storyToolsSearchDebounceTimer\)/);
});

test('Story Tools search highlights matches without HTML injection', () => {
    assert.match(viewSource, /createStoryToolsRegex/);
    assert.match(viewSource, /getStoryToolsSearchMatcher/);
    assert.match(viewSource, /findNextStoryToolsSearchMatch/);
    assert.match(viewSource, /cloneStoryToolsRegexForHighlight/);
    assert.match(viewSource, /renderHighlightedText/);
    assert.match(viewSource, /document\.createTextNode/);
    assert.match(viewSource, /document\.createElement\('mark'\)/);
    assert.match(viewSource, /story-tools-search-mark/);
    assert.match(viewSource, /Invalid regular expression/);
    assert.doesNotMatch(viewSource, /renderHighlightedText[\s\S]{0,1600}\.innerHTML\s*=/);
});

test('Story Tools search has scoped styling hooks', () => {
    assert.match(scssSource, /\.story-tools-search/);
    assert.match(scssSource, /\.story-tools-search-row/);
    assert.match(scssSource, /\.story-tools-search-input/);
    assert.match(scssSource, /\.story-tools-search-clear/);
    assert.match(scssSource, /\.story-tools-search-options/);
    assert.match(scssSource, /\.story-tools-search-mode/);
    assert.match(scssSource, /\.story-tools-search-case-toggle/);
    assert.match(scssSource, /\.story-tools-search-status/);
    assert.match(scssSource, /\.story-tools-search-error/);
    assert.match(scssSource, /\.story-tools-search-invalid/);
    assert.match(scssSource, /\.story-tools-search-mark/);
});
