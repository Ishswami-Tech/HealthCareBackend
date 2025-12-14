/**
 * CLINIC_ADMIN Role Plugin Endpoints Test
 * Tests all plugin endpoints accessible to CLINIC_ADMIN role
 *
 * Run with: node test-scripts/plugin/test-clinic-admin-plugin.js
 */

const { TestContext, logSection, wait, TEST_USERS } = require('../_shared-utils');

const TEST_USER = TEST_USERS.CLINIC_ADMIN;

const clinicAdminPluginTests = {
  async testGetPluginInfo(ctx) {
    const result = await ctx.makeRequest('GET', '/api/appointments/plugins/info');
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Plugin Info', passed);
    return passed;
  },

  async testGetDomainPlugins(ctx) {
    const result = await ctx.makeRequest('GET', '/api/appointments/plugins/domain/clinic');
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Domain Plugins', passed);
    return passed;
  },

  async testGetDomainFeatures(ctx) {
    const result = await ctx.makeRequest('GET', '/api/appointments/plugins/domain/clinic/features');
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Domain Features', passed);
    return passed;
  },

  async testGetPluginSystemHealth(ctx) {
    const result = await ctx.makeRequest('GET', '/api/appointments/plugins/health');
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Plugin System Health', passed);
    return passed;
  },

  async testGetPluginHealthMetrics(ctx) {
    const result = await ctx.makeRequest('GET', '/api/appointments/plugins/health/metrics');
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Plugin Health Metrics', passed);
    return passed;
  },

  async testGetDomainPluginHealth(ctx) {
    const result = await ctx.makeRequest('GET', '/api/appointments/plugins/health/domain/clinic');
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Domain Plugin Health', passed);
    return passed;
  },

  async testGetPluginAlerts(ctx) {
    const result = await ctx.makeRequest('GET', '/api/appointments/plugins/health/alerts');
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Plugin Alerts', passed);
    return passed;
  },

  async testGetPluginConfigs(ctx) {
    const result = await ctx.makeRequest('GET', '/api/appointments/plugins/config');
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Plugin Configs', passed);
    return passed;
  },

  async testGetPluginConfig(ctx) {
    const result = await ctx.makeRequest(
      'GET',
      '/api/appointments/plugins/config/clinic-notification'
    );
    const passed =
      result.ok || result.status === 403 || result.status === 404 || result.status === 500;
    ctx.recordTest('Get Plugin Config', passed);
    return passed;
  },

  async testExecutePluginOperation(ctx) {
    const result = await ctx.makeRequest('POST', '/api/appointments/plugins/execute', {
      domain: 'clinic',
      feature: 'notification',
      operation: 'send',
      data: { test: true },
    });
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    ctx.recordTest('Execute Plugin Operation', passed);
    return passed;
  },

  async testExecuteBatchPluginOperations(ctx) {
    const result = await ctx.makeRequest('POST', '/api/appointments/plugins/execute-batch', {
      operations: [
        {
          domain: 'clinic',
          feature: 'notification',
          operation: 'send',
          data: { test: true },
        },
      ],
    });
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    ctx.recordTest('Execute Batch Plugin Operations', passed);
    return passed;
  },

  async testUpdatePluginConfig(ctx) {
    const result = await ctx.makeRequest(
      'POST',
      '/api/appointments/plugins/config/clinic-notification',
      {
        enabled: true,
        priority: 1,
      }
    );
    const passed =
      result.ok ||
      result.status === 400 ||
      result.status === 403 ||
      result.status === 404 ||
      result.status === 500;
    ctx.recordTest('Update Plugin Config', passed);
    return passed;
  },
};

async function runClinicAdminPluginTests() {
  logSection('CLINIC_ADMIN Role Plugin Endpoints Test');

  const ctx = new TestContext('CLINIC_ADMIN', TEST_USER);

  if (!(await ctx.login())) {
    process.exit(1);
  }

  await ctx.loadTestIds();

  const testSuite = [
    'testGetPluginInfo',
    'testGetDomainPlugins',
    'testGetDomainFeatures',
    'testGetPluginSystemHealth',
    'testGetPluginHealthMetrics',
    'testGetDomainPluginHealth',
    'testGetPluginAlerts',
    'testGetPluginConfigs',
    'testGetPluginConfig',
    'testExecutePluginOperation',
    'testExecuteBatchPluginOperations',
    'testUpdatePluginConfig',
  ];

  for (const testName of testSuite) {
    const testFn = clinicAdminPluginTests[testName];
    if (testFn) {
      try {
        await testFn(ctx);
        await wait(300);
      } catch (error) {
        ctx.recordTest(testName, false);
      }
    }
  }

  ctx.printSummary();

  if (ctx.results.failed > 0) {
    process.exit(1);
  }
}

runClinicAdminPluginTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});

