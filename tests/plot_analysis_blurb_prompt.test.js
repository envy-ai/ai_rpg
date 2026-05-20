const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');

function createPromptEnv() {
    return nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
}

function renderBlurb(overrides = {}) {
    const promptEnv = createPromptEnv();
    return promptEnv.render('_includes/plot-analysis-blurb.njk', {
        config: {
            plot_analysis: {
                max_plot_threads: 2,
                max_plot_complications: 2
            }
        },
        plotAnalysis: {
            plotThreads: [
                {
                    description: 'Find the missing courier before the trail goes cold.',
                    isCurrentFocus: true
                },
                {
                    description: 'Track the smugglers working the river gate.',
                    isCurrentFocus: false
                }
            ],
            currentPlotComplications: [
                { description: 'Find the missing courier.' },
                { description: 'Get access to the locked customs ledger.' }
            ]
        },
        ...overrides
    });
}

test('plot analysis blurb renders threads and current complications as readable lists', () => {
    const rendered = renderBlurb();

    assert.match(rendered, /Current major plot threads:/);
    assert.match(rendered, /- \[CURRENT\] Find the missing courier before the trail goes cold\./);
    assert.match(rendered, /- Track the smugglers working the river gate\./);
    assert.match(rendered, /Current plot complications:/);
    assert.match(rendered, /- Find the missing courier\./);
    assert.match(rendered, /- Get access to the locked customs ledger\./);
    assert.doesNotMatch(rendered, /CODEX:/);
});

test('plot analysis blurb uses current thread when no complications are listed', () => {
    const rendered = renderBlurb({
        plotAnalysis: {
            plotThreads: [
                {
                    description: 'Unmask the patron behind the haunted observatory.',
                    isCurrentFocus: true
                }
            ],
            currentPlotComplications: []
        }
    });

    assert.match(rendered, /Current plot complications:/);
    assert.match(rendered, /- Unmask the patron behind the haunted observatory\./);
});

test('plot analysis blurb warns when configured complication limit is exceeded', () => {
    const rendered = renderBlurb({
        config: {
            plot_analysis: {
                max_plot_threads: 1,
                max_plot_complications: 1
            }
        }
    });

    assert.doesNotMatch(rendered, /There are currently too many major plot threads\./);
    assert.match(rendered, /IMPORTANT: There are currently too many plot complications\./);
});
