const Location = require('./Location.js');

// Test the XML parsing with various inputs
const testCases = [
  '<location><name>Test Location</name><description>A beautiful test location</description><baseLevel>5</baseLevel></location>',
  'Here is your location: <location><name>Ancient Forest</name><description>A mystical forest filled with ancient trees</description><baseLevel>3</baseLevel></location>',
  'Some text before\n<location>\n<name>Cave of Wonders</name>\n<description>A mysterious cave</description>\n<baseLevel>7</baseLevel>\n</location>\nSome text after',
  'Invalid XML without location tags',
  '<location><name>Incomplete Location</name></location>'
];

console.log('Testing XML parsing with various inputs...\n');

testCases.forEach((testCase, index) => {
  console.log(`\n=== Test Case ${index + 1} ===`);
  console.log('Input:', JSON.stringify(testCase));

  try {
    const location = Location.fromXMLSnippet(testCase);
    console.log('✅ Success! Created location:', location.toJSON());
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
});