const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const lightboxSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'lightbox.js'), 'utf8');

test('shared image lightbox closes when the transparent inner backdrop is clicked', () => {
    const innerClickHandler = lightboxSource.match(
        /lightboxInner\.addEventListener\('click', \(event\) => \{([\s\S]*?)\n\s*\}\);/
    );

    assert.ok(innerClickHandler, 'expected the lightbox inner click handler to exist');
    assert.match(
        innerClickHandler[1],
        /event\.target\s*===\s*lightboxInner/,
        'clicking transparent inner backdrop space should be distinguished from pane/content clicks'
    );
    assert.match(
        innerClickHandler[1],
        /hideLightbox\(\)/,
        'transparent inner backdrop clicks should dismiss the shared lightbox'
    );
    assert.match(
        innerClickHandler[1],
        /event\.stopPropagation\(\)/,
        'non-backdrop inner clicks should not leak to the outer lightbox handler'
    );
});
