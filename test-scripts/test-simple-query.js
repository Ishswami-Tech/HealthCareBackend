const axios = require('axios');

async function testHealth() {
  try {
    const response = await axios.get('http://localhost:8088/health');
    console.log('Health check passed');
    console.log('Database status:', response.data.info.database.status);
    console.log('Database isHealthy:', response.data.info.database.isHealthy);
  } catch (error) {
    console.error('Health check failed:', error.message);
  }
}

testHealth();
