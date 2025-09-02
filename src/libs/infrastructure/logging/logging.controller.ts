import { Controller, Get, Query, Res, Post } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { LoggingService } from './logging.service';
import { LogType } from './types/logging.types';
import { ApiTags } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';

@ApiTags('Logging')
@Controller('logger')
export class LoggingController {
  private readonly logger = new Logger(LoggingController.name);

  constructor(
    private readonly loggingService: LoggingService,
  ) {}

  private getHtmlTemplate(activeTab: 'logs' | 'events' = 'logs'): string {
    return `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Logging Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 20px; }
        h1 { margin: 0 0 20px; color: #333; text-align: center; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; }
        .tab { padding: 10px 20px; cursor: pointer; border: none; background: #f0f0f0; border-radius: 4px; font-size: 14px; text-decoration: none; color: #333; }
        .tab.active { background: #2196F3; color: white; }
        .controls { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; align-items: center; flex-wrap: wrap; }
        select { padding: 8px; border: 1px solid #ddd; border-radius: 4px; min-width: 150px; }
        button { padding: 8px 16px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        button.danger { background: #dc3545; }
        button.danger:hover { background: #c82333; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .entry { background: #fff; border: 1px solid #eee; border-radius: 4px; padding: 15px; margin-bottom: 10px; }
        .timestamp { color: #666; font-size: 12px; }
        .level { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin-left: 8px; }
        .level.INFO { background: #E3F2FD; color: #1976D2; }
        .level.WARN { background: #FFF3E0; color: #F57C00; }
        .level.ERROR { background: #FFEBEE; color: #D32F2F; }
        .level.DEBUG { background: #E8F5E9; color: #388E3C; }
        .type { display: inline-block; padding: 2px 6px; background: #f0f0f0; border-radius: 3px; font-size: 12px; margin-left: 8px; }
        .message { margin: 10px 0; }
        .metadata { background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap; }
        .empty-state { text-align: center; padding: 40px; color: #666; }
        .refresh-status { font-size: 12px; color: #666; margin-left: 10px; }
        .button-group { display: flex; gap: 10px; }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .loading {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid #f3f3f3;
          border-top: 2px solid #2196F3;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 8px;
          vertical-align: middle;
        }
        .filters {
          margin: 10px 0;
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .time-range {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .entry {
          background: #f5f5f5;
          padding: 10px;
          margin: 5px 0;
          border-radius: 4px;
        }
        .entry .timestamp {
          color: #666;
          font-size: 0.9em;
        }
        .entry .level {
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 0.9em;
          font-weight: bold;
        }
        .entry .level.ERROR { background: #ffebee; color: #d32f2f; }
        .entry .level.WARN { background: #fff3e0; color: #f57c00; }
        .entry .level.INFO { background: #e8f5e9; color: #388e3c; }
        .entry .level.DEBUG { background: #e3f2fd; color: #1976d2; }
        .entry .type {
          font-weight: bold;
          margin-left: 10px;
        }
        .entry .message {
          margin: 5px 0;
          font-family: monospace;
        }
        .entry .metadata {
          font-family: monospace;
          font-size: 0.9em;
          color: #666;
          white-space: pre-wrap;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Logging Dashboard</h1>
        <div class="tabs">
          <button class="tab ${activeTab === 'logs' ? 'active' : ''}" onclick="switchTab('logs')">Logs</button>
          <button class="tab ${activeTab === 'events' ? 'active' : ''}" onclick="switchTab('events')">Events</button>
        </div>
        
        <div id="logsPanel" style="display: ${activeTab === 'logs' ? 'block' : 'none'}">
          <div class="filters">
            <select id="logType">
              <option value="">All Types</option>
              <option value="SYSTEM">System</option>
              <option value="AUTH">Auth</option>
              <option value="ERROR">Error</option>
              <option value="REQUEST">Request</option>
              <option value="RESPONSE">Response</option>
              <option value="DATABASE">Database</option>
              <option value="CACHE">Cache</option>
              <option value="QUEUE">Queue</option>
              <option value="EMAIL">Email</option>
              <option value="AUDIT">Audit</option>
            </select>
            <select id="logLevel">
              <option value="">All Levels</option>
              <option value="ERROR">Error</option>
              <option value="WARN">Warning</option>
              <option value="INFO">Info</option>
              <option value="DEBUG">Debug</option>
            </select>
            <div class="time-range">
              <select id="timeRange" onchange="handleTimeRangeChange()">
                <option value="1">Last 1 hour</option>
                <option value="6">Last 6 hours</option>
                <option value="12">Last 12 hours</option>
                <option value="24" selected>Last 24 hours</option>
                <option value="custom">Custom Range</option>
              </select>
              <div id="customRange" style="display: none;">
                <input type="datetime-local" id="startTime" />
                <input type="datetime-local" id="endTime" />
              </div>
            </div>
            <button id="refreshButton" onclick="refreshContent()">Refresh</button>
            <button onclick="clearLogs()">Clear Logs</button>
            <span id="refreshStatus"></span>
          </div>
          <div id="logsContent"></div>
        </div>
        
        <div id="eventsPanel" style="display: ${activeTab === 'events' ? 'block' : 'none'}">
          <div class="controls">
            <select id="eventType">
              <option value="">All Types</option>
              <option value="user.loggedIn">User Logged In</option>
              <option value="user.registered">User Registered</option>
              <option value="clinic.created">Clinic Created</option>
              <option value="clinic.updated">Clinic Updated</option>
              <option value="clinic.deleted">Clinic Deleted</option>
            </select>
            <div class="button-group">
              <button id="eventRefreshButton" onclick="manualRefresh()">Refresh</button>
              <button id="clearEventsButton" class="danger" onclick="clearEvents()">Clear Events</button>
            </div>
            <span id="eventRefreshStatus" class="refresh-status"></span>
          </div>
          <div id="eventsContent"></div>
        </div>
      </div>
      
      <script>
        let currentTab = '${activeTab}';
        let refreshInterval;
        let isRefreshing = false;
        let lastRefreshTime = new Date();
        const REFRESH_INTERVAL = 30000; // 30 seconds instead of 5 seconds
        let failedAttempts = 0;
        const MAX_FAILED_ATTEMPTS = 3;

        function updateRefreshStatus(isLoading, error = null) {
          const statusElement = document.getElementById(currentTab === 'logs' ? 'refreshStatus' : 'eventRefreshStatus');
          const refreshButton = document.getElementById(currentTab === 'logs' ? 'refreshButton' : 'eventRefreshButton');
          
          if (error) {
            statusElement.innerHTML = '<span style="color: red;">Error: ' + error + '</span>';
            refreshButton.disabled = false;
            return;
          }
          
          if (isLoading) {
            statusElement.innerHTML = '<span class="loading"></span>Refreshing...';
            refreshButton.disabled = true;
          } else {
            lastRefreshTime = new Date();
            const timeString = lastRefreshTime.toLocaleTimeString();
            statusElement.innerHTML = 'Last updated: ' + timeString;
            refreshButton.disabled = false;
          }
        }

        async function clearLogs() {
          if (!confirm('Are you sure you want to clear all logs?')) return;
          
          try {
            const response = await fetch('/logger/logs/clear', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to clear logs');
            refreshContent();
          } catch (error) {
            console.error('Error clearing logs:', error);
            alert('Failed to clear logs');
          }
        }

        async function clearEvents() {
          if (!confirm('Are you sure you want to clear all events?')) return;
          
          try {
            const response = await fetch('/logger/events/clear', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to clear events');
            refreshContent();
          } catch (error) {
            console.error('Error clearing events:', error);
            alert('Failed to clear events');
          }
        }

        function handleTimeRangeChange() {
          const range = document.getElementById('timeRange').value;
          const customRange = document.getElementById('customRange');
          customRange.style.display = range === 'custom' ? 'block' : 'none';
          
          if (range !== 'custom') {
            refreshContent();
          }
        }

        async function refreshContent(manual = false) {
          if (isRefreshing) return;
          
          try {
            isRefreshing = true;
            updateRefreshStatus(true);
            
            const contentId = currentTab === 'logs' ? 'logsContent' : 'eventsContent';
            const container = document.getElementById(contentId);
            
            let url = '/logger/' + currentTab + '/data';
            const params = new URLSearchParams();
            
            if (currentTab === 'logs') {
              const type = document.getElementById('logType').value;
              const level = document.getElementById('logLevel').value;
              const timeRange = document.getElementById('timeRange').value;
              
              if (type) params.append('type', type);
              if (level) params.append('level', level);
              
              if (timeRange === 'custom') {
                const startTime = document.getElementById('startTime').value;
                const endTime = document.getElementById('endTime').value;
                if (startTime) params.append('startTime', new Date(startTime).toISOString());
                if (endTime) params.append('endTime', new Date(endTime).toISOString());
              } else {
                const hours = parseInt(timeRange);
                const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
                params.append('startTime', startTime.toISOString());
              }
            } else {
              const type = document.getElementById('eventType').value;
              if (type) params.append('type', type);
            }
            
            if (params.toString()) {
              url += '?' + params.toString();
            }

            const response = await fetch(url);
            if (!response.ok) {
              throw new Error('Failed to fetch data');
            }
            
            const data = await response.json();
            
            if (!data || data.length === 0) {
              container.innerHTML = '<div class="empty-state">No data found</div>';
              failedAttempts = 0;
              return;
            }

            container.innerHTML = data.map(log => {
              const metadata = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
              return '<div class="entry">' +
                '<span class="timestamp">' + new Date(log.timestamp).toLocaleString() + '</span>' +
                '<span class="level ' + log.level + '">' + log.level + '</span>' +
                '<span class="type">' + log.type + '</span>' +
                '<div class="message">' + log.message + '</div>' +
                '<div class="metadata">' + JSON.stringify(metadata, null, 2) + '</div>' +
                '</div>';
            }).join('');
            
            failedAttempts = 0;
            updateRefreshStatus(false);
            
          } catch (error) {
            console.error('Error refreshing content:', error);
            failedAttempts++;
            
            if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
              clearInterval(refreshInterval);
              updateRefreshStatus(false, 'Auto-refresh stopped due to errors. Click Refresh to try again.');
            } else {
              updateRefreshStatus(false, error.message);
            }
          } finally {
            isRefreshing = false;
          }
        }

        function startAutoRefresh() {
          if (refreshInterval) {
            clearInterval(refreshInterval);
          }
          refreshInterval = setInterval(refreshContent, REFRESH_INTERVAL);
          refreshContent(); // Initial load
        }

        function stopAutoRefresh() {
          if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
          }
        }

        function switchTab(tab) {
          currentTab = tab;
          document.getElementById('logsPanel').style.display = tab === 'logs' ? 'block' : 'none';
          document.getElementById('eventsPanel').style.display = tab === 'events' ? 'block' : 'none';
          
          // Reset refresh state
          stopAutoRefresh();
          startAutoRefresh();
        }

        function manualRefresh() {
          clearInterval(refreshInterval);
          refreshContent();
          startAutoRefresh();
        }

        // Start auto-refresh when page loads
        document.addEventListener('DOMContentLoaded', function() {
          startAutoRefresh();
        });

        // Stop auto-refresh when page is hidden
        document.addEventListener('visibilitychange', function() {
          if (document.hidden) {
            stopAutoRefresh();
          } else {
            startAutoRefresh();
          }
        });

        // Add change handlers for filters
        document.getElementById('logType').addEventListener('change', manualRefresh);
        document.getElementById('logLevel').addEventListener('change', manualRefresh);
        document.getElementById('eventType').addEventListener('change', manualRefresh);
      </script>
    </body>
    </html>`;
  }

  @Get()
  async getUI(@Res() reply: FastifyReply) {
    reply.header('Content-Type', 'text/html');
    return reply.send(this.getHtmlTemplate('logs'));
  }

  @Get('logs')
  async getLogsPage(@Res() reply: FastifyReply) {
    reply.header('Content-Type', 'text/html');
    return reply.send(this.getHtmlTemplate('logs'));
  }

  @Get('events')
  async getEventsPage(@Res() reply: FastifyReply) {
    reply.header('Content-Type', 'text/html');
    return reply.send(this.getHtmlTemplate('events'));
  }

  @Get('logs/data')
  async getLogs(
    @Query('type') type?: LogType,
    @Query('level') level?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    try {
      const logs = await this.loggingService.getLogs(
        type,
        startTime ? new Date(startTime) : undefined,
        endTime ? new Date(endTime) : undefined,
        level
      );
      
      return logs.map(log => ({
        ...log,
        disabled: false // Ensure disabled property is always set
      }));
    } catch (error) {
      this.logger.error(`Failed to fetch logs: ${error.message}`);
      return []; // Return empty array instead of null
    }
  }

  @Get('events/data')
  async getEvents(
    @Query('type') type?: string,
  ) {
    return this.loggingService.getEvents(type);
  }

  @Post('logs/clear')
  async clearLogs() {
    return this.loggingService.clearLogs();
  }

  @Post('events/clear')
  async clearEvents() {
    return this.loggingService.clearEvents();
  }
} 