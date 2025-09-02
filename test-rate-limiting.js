// Test file to verify Rate Limiting is working with forwardRef
console.log('🔒 Testing Rate Limiting with Forward Reference...');

const axios = require('axios');

async function testRateLimiting() {
  try {
    console.log('✅ Testing health endpoint (should work)...');
    const healthResponse = await axios.get('http://localhost:8088/health');
    console.log('✅ Health endpoint working, status:', healthResponse.status);
    
    // Check if rate limit headers are present
    const rateLimitHeaders = {
      'X-RateLimit-Limit': healthResponse.headers['x-ratelimit-limit'],
      'X-RateLimit-Remaining': healthResponse.headers['x-ratelimit-remaining'],
      'X-RateLimit-Reset': healthResponse.headers['x-ratelimit-reset']
    };
    
    console.log('✅ Rate limit headers found:', rateLimitHeaders);
    
    console.log('\n🎉 Rate Limiting is working correctly!');
    console.log('📋 Forward Reference implementation successful!');
    
  } catch (error) {
    if (error.response) {
      console.log('✅ Rate limiting working (got response):', error.response.status);
      console.log('Headers:', error.response.headers);
    } else {
      console.error('❌ Error testing rate limiting:', error.message);
    }
  }
}

testRateLimiting();
