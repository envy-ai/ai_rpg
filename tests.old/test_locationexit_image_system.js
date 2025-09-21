const LocationExit = require('../LocationExit.js');

console.log('🧪 Testing LocationExit Image System...\n');

// Test 1: Create a location exit with imageId
console.log('1️⃣ Testing LocationExit creation with imageId...');
const testExit = new LocationExit({
  description: 'A narrow stone archway covered in ancient moss and glowing runes. The passage beckons adventurers toward unknown mysteries.',
  destination: 'mystical_grove_001',
  bidirectional: true,
  imageId: 'test_exit_image_123'
});

console.log('✅ LocationExit created:', testExit.toString());
console.log('📷 Image ID:', testExit.imageId);
console.log('📅 Last Updated:', testExit.lastUpdated);
console.log('🔄 Bidirectional:', testExit.bidirectional);
console.log('📋 LocationExit Summary:', JSON.stringify(testExit.getSummary(), null, 2));

// Test 2: Update description (should update lastUpdated)
console.log('\n2️⃣ Testing description update...');
const oldLastUpdated = testExit.lastUpdated;
setTimeout(() => {
  testExit.description = 'A narrow stone archway covered in ancient moss and glowing runes. Ethereal blue light now pulses from within the passage, casting dancing shadows.';
  console.log('✅ Description updated');
  console.log('📅 Old Last Updated:', oldLastUpdated);
  console.log('📅 New Last Updated:', testExit.lastUpdated);
  console.log('🔄 Last Updated changed:', testExit.lastUpdated > oldLastUpdated);

  // Test 3: Update imageId
  console.log('\n3️⃣ Testing imageId update...');
  const oldImageId = testExit.imageId;
  testExit.imageId = 'new_generated_exit_image_456';
  console.log('✅ ImageId updated from', oldImageId, 'to', testExit.imageId);

  // Test 4: Test bidirectional flag change
  console.log('\n4️⃣ Testing bidirectional flag change...');
  const oldBidirectional = testExit.bidirectional;
  testExit.bidirectional = false;
  console.log('✅ Bidirectional changed from', oldBidirectional, 'to', testExit.bidirectional);

  // Test 5: JSON serialization
  console.log('\n5️⃣ Testing JSON serialization...');
  const exitJson = testExit.toJSON();
  console.log('📄 LocationExit JSON:', JSON.stringify(exitJson, null, 2));

  // Test 6: Create bidirectional pair
  console.log('\n6️⃣ Testing bidirectional exit pair creation...');
  const exitPair = LocationExit.createBidirectionalPair({
    location1Id: 'tavern_001',
    location2Id: 'market_square_001',
    description1to2: 'A wooden door leading to the bustling market square',
    description2to1: 'A cozy tavern entrance with warm light spilling out'
  });

  console.log('✅ Exit pair created:');
  console.log('  🚪 Exit 1→2:', exitPair.exit1to2.toString());
  console.log('  🚪 Exit 2→1:', exitPair.exit2to1.toString());
  console.log('  📷 Exit 1→2 Image ID:', exitPair.exit1to2.imageId);
  console.log('  📷 Exit 2→1 Image ID:', exitPair.exit2to1.imageId);

  console.log('\n🎉 All LocationExit Image System tests completed successfully!');
}, 100);