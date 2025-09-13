// Test Save/Load Functionality for AI RPG
// This test creates game state, saves it, clears memory, loads it back, and verifies integrity

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const SERVER_URL = 'http://localhost:7777';
const TEST_SAVE_NAME = 'test_save_' + Date.now();

console.log('🧪 Testing Save/Load Functionality');
console.log('===================================');

async function testSaveLoadFunctionality() {
  try {
    // Step 1: Create a test player with known attributes
    console.log('\n📝 Step 1: Creating test player...');
    const createPlayerResponse = await axios.post(`${SERVER_URL}/api/player`, {
      name: 'Test Hero',
      description: 'A brave test adventurer'
    });

    if (!createPlayerResponse.data.success) {
      throw new Error('Failed to create test player');
    }

    const originalPlayerId = createPlayerResponse.data.player.id;
    console.log(`✅ Created player: ${createPlayerResponse.data.player.name} (ID: ${originalPlayerId})`);

    // Step 2: Modify player stats to create unique state
    console.log('\n🎲 Step 2: Modifying player stats...');

    // Level up the player
    const levelUpResponse = await axios.post(`${SERVER_URL}/api/player/levelup`);
    console.log(`✅ Player leveled up: ${levelUpResponse.data.message}`);

    // Modify health
    const healthResponse = await axios.put(`${SERVER_URL}/api/player/health`, {
      amount: -10,
      reason: 'Test damage'
    });
    console.log(`✅ Modified health: ${healthResponse.data.message}`);

    // Step 3: Add some chat history
    console.log('\n💬 Step 3: Adding test chat history...');
    const chatResponse = await axios.post(`${SERVER_URL}/api/chat`, {
      messages: [
        { role: 'user', content: 'This is a test message for save/load verification' }
      ]
    });
    console.log('✅ Added test chat message');

    // Step 4: Get current state for comparison
    console.log('\n📊 Step 4: Recording current game state...');
    const currentStateResponse = await axios.get(`${SERVER_URL}/api/player`);
    const originalState = {
      player: currentStateResponse.data.player,
      playerId: originalPlayerId
    };

    const chatHistoryResponse = await axios.get(`${SERVER_URL}/api/chat/history`);
    const originalChatHistory = chatHistoryResponse.data.history;

    console.log(`✅ Recorded state - Player Level: ${originalState.player.level}, Health: ${originalState.player.health}, Chat History: ${originalChatHistory.length} messages`);

    // Step 5: Save the game
    console.log('\n💾 Step 5: Saving game state...');
    const saveResponse = await axios.post(`${SERVER_URL}/api/save`);

    if (!saveResponse.data.success) {
      throw new Error(`Save failed: ${saveResponse.data.error}`);
    }

    const saveName = saveResponse.data.saveName;
    console.log(`✅ Game saved as: ${saveName}`);
    console.log(`📁 Save metadata:`, saveResponse.data.metadata);

    // Step 6: Verify save files exist
    console.log('\n🔍 Step 6: Verifying save files...');
    const saveDir = saveResponse.data.saveDir;
    const expectedFiles = ['gameWorld.json', 'chatHistory.json', 'images.json', 'allPlayers.json', 'metadata.json'];

    for (const file of expectedFiles) {
      const filePath = path.join(saveDir, file);
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`✅ ${file} exists (${stats.size} bytes)`);
      } else {
        throw new Error(`Save file missing: ${file}`);
      }
    }

    // Step 7: Create a new player to change memory state
    console.log('\n🔄 Step 7: Changing memory state...');
    const newPlayerResponse = await axios.post(`${SERVER_URL}/api/player`, {
      name: 'Different Player',
      description: 'This should be replaced when loading'
    });
    console.log(`✅ Created different player: ${newPlayerResponse.data.player.name}`);

    // Clear chat history
    const clearChatResponse = await axios.delete(`${SERVER_URL}/api/chat/history`);
    console.log('✅ Cleared chat history');

    // Step 8: Load the saved game
    console.log('\n📂 Step 8: Loading saved game...');
    const loadResponse = await axios.post(`${SERVER_URL}/api/load`, {
      saveName: saveName
    });

    if (!loadResponse.data.success) {
      throw new Error(`Load failed: ${loadResponse.data.error}`);
    }

    console.log(`✅ Game loaded: ${loadResponse.data.message}`);
    console.log(`📊 Loaded data:`, loadResponse.data.loadedData);

    // Step 9: Verify loaded state matches original
    console.log('\n🔍 Step 9: Verifying data integrity...');

    // Check player state
    const loadedStateResponse = await axios.get(`${SERVER_URL}/api/player`);
    const loadedState = loadedStateResponse.data.player;

    // Check chat history
    const loadedChatResponse = await axios.get(`${SERVER_URL}/api/chat/history`);
    const loadedChatHistory = loadedChatResponse.data.history;

    // Verify player data
    const playerVerification = {
      name: originalState.player.name === loadedState.name,
      level: originalState.player.level === loadedState.level,
      health: originalState.player.health === loadedState.health,
      id: originalState.playerId === loadedState.id
    };

    console.log('\n📋 Player Data Verification:');
    Object.entries(playerVerification).forEach(([key, passed]) => {
      console.log(`  ${passed ? '✅' : '❌'} ${key}: ${passed ? 'MATCH' : 'MISMATCH'}`);
      if (!passed) {
        console.log(`    Original: ${originalState.player[key] || originalState.playerId}`);
        console.log(`    Loaded: ${loadedState[key]}`);
      }
    });

    // Verify chat history
    const chatVerification = originalChatHistory.length === loadedChatHistory.length;
    console.log(`\n💬 Chat History Verification:`);
    console.log(`  ${chatVerification ? '✅' : '❌'} Message count: ${chatVerification ? 'MATCH' : 'MISMATCH'}`);
    if (!chatVerification) {
      console.log(`    Original: ${originalChatHistory.length} messages`);
      console.log(`    Loaded: ${loadedChatHistory.length} messages`);
    }

    // Step 10: Test save listing
    console.log('\n📋 Step 10: Testing save listing...');
    const listSavesResponse = await axios.get(`${SERVER_URL}/api/saves`);
    const saves = listSavesResponse.data.saves;

    const ourSave = saves.find(save => save.saveName === saveName);
    if (ourSave) {
      console.log(`✅ Found our save in list: ${ourSave.playerName} (${ourSave.timestamp})`);
    } else {
      throw new Error('Our save not found in saves list');
    }

    // Step 11: Clean up test save
    console.log('\n🧹 Step 11: Cleaning up test save...');
    const deleteResponse = await axios.delete(`${SERVER_URL}/api/save/${saveName}`);
    if (deleteResponse.data.success) {
      console.log(`✅ Test save deleted: ${deleteResponse.data.message}`);
    } else {
      console.log(`⚠️ Failed to delete test save: ${deleteResponse.data.error}`);
    }

    // Final assessment
    const allTestsPassed = Object.values(playerVerification).every(v => v) && chatVerification;

    console.log('\n🎯 FINAL ASSESSMENT');
    console.log('==================');
    if (allTestsPassed) {
      console.log('✅ ALL TESTS PASSED - Save/Load functionality is working correctly!');
      console.log('🎉 Data integrity maintained across save/load cycle');
    } else {
      console.log('❌ SOME TESTS FAILED - Save/Load functionality needs attention');
      console.log('⚠️ Data integrity issues detected');
    }

    return allTestsPassed;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    return false;
  }
}

// Run the test
testSaveLoadFunctionality().then(success => {
  process.exit(success ? 0 : 1);
});