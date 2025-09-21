const Location = require('../Location.js');

console.log('🧪 Testing Location Image System...\n');

// Test 1: Create a location with imageId
console.log('1️⃣ Testing Location creation with imageId...');
const testLocation = new Location({
  description: 'A mystical forest clearing surrounded by ancient oak trees. Rays of golden sunlight filter through the canopy, illuminating patches of moss-covered stones and wildflowers.',
  baseLevel: 5,
  imageId: 'test_image_123'
});

console.log('✅ Location created:', testLocation.toString());
console.log('📷 Image ID:', testLocation.imageId);
console.log('📅 Last Updated:', testLocation.lastUpdated);
console.log('📋 Location Summary:', JSON.stringify(testLocation.getSummary(), null, 2));

// Test 2: Update description (should update lastUpdated)
console.log('\n2️⃣ Testing description update...');
const oldLastUpdated = testLocation.lastUpdated;
setTimeout(() => {
  testLocation.description = 'A mystical forest clearing surrounded by ancient oak trees. Glowing mushrooms now dot the forest floor, casting an eerie blue light in the twilight.';
  console.log('✅ Description updated');
  console.log('📅 Old Last Updated:', oldLastUpdated);
  console.log('📅 New Last Updated:', testLocation.lastUpdated);
  console.log('🔄 Last Updated changed:', testLocation.lastUpdated > oldLastUpdated);

  // Test 3: Update imageId
  console.log('\n3️⃣ Testing imageId update...');
  const oldImageId = testLocation.imageId;
  testLocation.imageId = 'new_generated_image_456';
  console.log('✅ ImageId updated from', oldImageId, 'to', testLocation.imageId);

  // Test 4: JSON serialization
  console.log('\n4️⃣ Testing JSON serialization...');
  const locationJson = testLocation.toJSON();
  console.log('📄 Location JSON:', JSON.stringify(locationJson, null, 2));

  console.log('\n🎉 All Location Image System tests completed successfully!');
}, 100);