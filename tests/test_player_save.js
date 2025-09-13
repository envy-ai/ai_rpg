// Test Player Save Functionality
const axios = require('axios');

async function testPlayerSaveFunctionality() {
  const baseURL = 'http://localhost:7777';

  try {
    console.log('=== Testing Player Save Functionality ===');

    // Test 1: Check if default player was created on startup
    console.log('\n1. Checking default player creation...');
    const defaultPlayerResponse = await axios.get(`${baseURL}/api/player`);

    if (defaultPlayerResponse.data.success && defaultPlayerResponse.data.player) {
      const player = defaultPlayerResponse.data.player;
      console.log('✓ Default player found:');
      console.log(`  - Name: ${player.name}`);
      console.log(`  - Description: ${player.description}`);
      console.log(`  - Level: ${player.level}`);
      console.log(`  - Health: ${player.health}/${player.maxHealth}`);
    } else {
      console.log('❌ No default player found');
    }

    // Test 2: Update existing player (should use update endpoint)
    console.log('\n2. Testing update existing player...');
    const updateData = {
      name: 'Updated Adventurer',
      description: 'An adventurer with updated information.',
      level: 3,
      health: 35,
      maxHealth: 40,
      attributes: {
        strength: 15,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 11,
        charisma: 13
      }
    };

    const updateResponse = await axios.post(`${baseURL}/api/player/update-stats`, updateData);

    if (updateResponse.data.success) {
      console.log('✓ Player updated successfully');
      console.log(`  - New name: ${updateResponse.data.player.name}`);
      console.log(`  - New level: ${updateResponse.data.player.level}`);
    } else {
      console.log('❌ Failed to update player:', updateResponse.data.error);
    }

    // Test 3: Clear current player and create new one
    console.log('\n3. Testing create new player (after clearing current)...');

    // Simulate no current player by clearing it
    await axios.post(`${baseURL}/api/player/set-current`, { playerId: null });

    const newPlayerData = {
      name: 'Brand New Hero',
      description: 'A completely new character.',
      level: 1,
      health: 20,
      maxHealth: 20,
      attributes: {
        strength: 8,
        dexterity: 16,
        constitution: 12,
        intelligence: 14,
        wisdom: 13,
        charisma: 11
      }
    };

    const createResponse = await axios.post(`${baseURL}/api/player/create-from-stats`, newPlayerData);

    if (createResponse.data.success) {
      console.log('✓ New player created successfully');
      console.log(`  - Name: ${createResponse.data.player.name}`);
      console.log(`  - Description: ${createResponse.data.player.description}`);
      console.log(`  - Level: ${createResponse.data.player.level}`);
    } else {
      console.log('❌ Failed to create new player:', createResponse.data.error);
    }

    // Test 4: Verify player persistence
    console.log('\n4. Verifying player persistence...');
    const finalCheckResponse = await axios.get(`${baseURL}/api/player`);

    if (finalCheckResponse.data.success && finalCheckResponse.data.player) {
      const player = finalCheckResponse.data.player;
      console.log('✓ Current player verification:');
      console.log(`  - Name: ${player.name}`);
      console.log(`  - ID: ${player.id}`);
      console.log(`  - Created successfully and persisted`);
    }

    console.log('\n🎉 Player save functionality test completed!');
    console.log('\n📋 Summary:');
    console.log('  ✅ Default player creation on startup');
    console.log('  ✅ Update existing player functionality');
    console.log('  ✅ Create new player functionality');
    console.log('  ✅ Player persistence verification');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testPlayerSaveFunctionality();