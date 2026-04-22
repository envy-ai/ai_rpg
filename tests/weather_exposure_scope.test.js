const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const Location = require('../Location.js');
const Region = require('../Region.js');
const Globals = require('../Globals.js');

Globals.config = Globals.config || {};

function createRegion() {
    return new Region({
        id: `region_weather_scope_${Date.now()}_${Math.random()}`,
        name: 'Weather Scope Test Region',
        description: 'A region for testing weather exposure scopes.'
    });
}

function renderCurrentConditions(worldTime) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'base-context.xml.njk'), 'utf8');
    const start = source.indexOf('<currentConditions>');
    const end = source.indexOf('</currentConditions>', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate currentConditions block in base-context.xml.njk');
    }
    const template = source.slice(start, end + '</currentConditions>'.length);
    const env = new nunjucks.Environment(null, {
        autoescape: false,
        throwOnUndefined: false,
        trimBlocks: true,
        lstripBlocks: true
    });
    return env.renderString(template, {
        worldTime,
        currentVehicle: null,
        npcs: [],
        party: []
    });
}

test('Location generationHints.hasWeather normalizes yes/no/outside and legacy booleans', () => {
    const region = createRegion();

    const outside = new Location({
        id: `location_weather_scope_outside_${Date.now()}_${Math.random()}`,
        name: 'Windowed Gallery',
        description: 'A gallery with broad windows.',
        regionId: region.id,
        generationHints: {
            hasWeather: 'outside'
        }
    });
    assert.equal(outside.generationHints.hasWeather, 'outside');

    const legacyTrue = new Location({
        id: `location_weather_scope_true_${Date.now()}_${Math.random()}`,
        name: 'Courtyard',
        description: 'An exposed courtyard.',
        regionId: region.id,
        generationHints: {
            hasWeather: true
        }
    });
    assert.equal(legacyTrue.generationHints.hasWeather, 'yes');

    const legacyFalse = new Location({
        id: `location_weather_scope_false_${Date.now()}_${Math.random()}`,
        name: 'Deep Cellar',
        description: 'A cellar without windows.',
        regionId: region.id,
        generationHints: {
            hasWeather: false
        }
    });
    assert.equal(legacyFalse.generationHints.hasWeather, 'no');

    assert.throws(
        () => new Location({
            id: `location_weather_scope_invalid_${Date.now()}_${Math.random()}`,
            name: 'Invalid Weather Hint Room',
            description: 'A room with invalid weather metadata.',
            regionId: region.id,
            generationHints: {
                hasWeather: 'maybe'
            }
        }),
        /hasWeather must be "yes", "no", "outside", true, false, or null/
    );
});

test('Region XML location hasWeather accepts outside and legacy booleans', () => {
    const region = Region.fromXMLSnippet(`
<region>
  <regionName>Weather Scope XML Region</regionName>
  <regionDescription>A region with mixed weather exposure.</regionDescription>
  <shortDescription>A mixed weather exposure test region.</shortDescription>
  <relativeLevel>1</relativeLevel>
  <weather><hasDynamicWeather>false</hasDynamicWeather></weather>
  <locations>
    <location>
      <name>Windowed Gallery</name>
      <description>Interior view of the storm.</description>
      <shortDescription>Windows show the weather outside.</shortDescription>
      <hasWeather>outside</hasWeather>
    </location>
    <location>
      <name>Open Yard</name>
      <description>Open to the sky.</description>
      <shortDescription>Open ground under the sky.</shortDescription>
      <hasWeather>true</hasWeather>
    </location>
    <location>
      <name>Sealed Vault</name>
      <description>Sealed from the outdoors.</description>
      <shortDescription>No weather reaches here.</shortDescription>
      <hasWeather>false</hasWeather>
    </location>
  </locations>
</region>`);

    assert.equal(region.locationBlueprints[0].hasWeather, 'outside');
    assert.equal(region.locationBlueprints[1].hasWeather, 'yes');
    assert.equal(region.locationBlueprints[2].hasWeather, 'no');

    assert.throws(
        () => Region.fromXMLSnippet(`
<region>
  <regionName>Invalid Weather Scope XML Region</regionName>
  <regionDescription>A region with invalid weather exposure.</regionDescription>
  <shortDescription>An invalid weather exposure test region.</shortDescription>
  <relativeLevel>1</relativeLevel>
  <weather><hasDynamicWeather>false</hasDynamicWeather></weather>
  <locations>
    <location>
      <name>Impossible Room</name>
      <description>Invalid weather scope.</description>
      <shortDescription>Invalid weather scope.</shortDescription>
      <hasWeather>maybe</hasWeather>
    </location>
  </locations>
</region>`),
        /hasWeather must be "yes", "no", "outside", true, false, or null/
    );
});

test('base context renders weatherOutside for outside-visible weather', () => {
    const rendered = renderCurrentConditions({
        dateLabel: '1 Spring',
        timeLabel: '11:30 PM',
        segment: 'night',
        season: 'Spring',
        lighting: 'Moonlit night',
        lightLevelDescription: 'Moonlit night',
        hasLocalWeather: true,
        weatherScope: 'outside',
        weatherName: 'Rain',
        weatherDescription: 'Rain streaks the window.'
    });

    assert.match(rendered, /<weatherOutside>/);
    assert.match(rendered, /<name>Rain<\/name>/);
    assert.doesNotMatch(rendered, /<weather>\s*<name>Rain<\/name>/);
});
