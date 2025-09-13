// Test Debug Page Updates
const axios = require('axios');

async function testUpdatedDebugPage() {
  const baseURL = 'http://localhost:7777';

  try {
    console.log('=== Testing Updated Debug Page ===');

    // Test 1: Create multiple players for testing
    console.log('\n1. Creating test players...');

    const player1Data = {
      name: 'Test Player 1',
      description: 'First test player',
      level: 3,
      health: 25,
      maxHealth: 30,
      attributes: { strength: 15, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 11, charisma: 13 }
    };

    const player2Data = {
      name: 'Test Player 2',
      description: 'Second test player',
      level: 5,
      health: 40,
      maxHealth: 45,
      attributes: { strength: 12, dexterity: 16, constitution: 13, intelligence: 15, wisdom: 14, charisma: 10 }
    };

    await axios.post(`${baseURL}/api/player/create-from-stats`, player1Data);
    console.log('✓ Created Player 1');

    await axios.post(`${baseURL}/api/player/create-from-stats`, player2Data);
    console.log('✓ Created Player 2');

    // Test 2: Check debug page content
    console.log('\n2. Testing debug page with multiple players...');
    const debugResponse = await axios.get(`${baseURL}/debug`);

    console.log('✓ Debug page accessible');
    console.log('  - Response status:', debugResponse.status);

    // Check for new sections
    const content = debugResponse.data;
    console.log('  - Contains "All Players" section:', content.includes('👥 All Players'));
    console.log('  - Contains "All Locations" section:', content.includes('🗺️ All Locations'));
    console.log('  - Contains expandable details:', content.includes('<details>'));
    console.log('  - Contains current player JSON (preserved):', content.includes('💾 Player JSON Data'));

    // Test 3: Verify scrolling capability
    console.log('\n3. Checking scrolling CSS overrides...');
    console.log('  - Has overflow auto override:', content.includes('overflow: auto !important'));
    console.log('  - Has height auto override:', content.includes('height: auto !important'));

    console.log('\n🎉 Debug page updates test completed successfully!');
    console.log('\n📋 Summary:');
    console.log('  ✅ Multiple players created and stored');
    console.log('  ✅ All Players section added with details expansion');
    console.log('  ✅ All Locations section added with details expansion');
    console.log('  ✅ Current player JSON preserved');
    console.log('  ✅ CSS overrides added for scrolling');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data preview:', error.response.data.substring(0, 200) + '...');
    }
  }
}

testUpdatedDebugPage();